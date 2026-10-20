function buildWorkItems({actor,applications=[],approvals=[],plans=[],semesters=[],messages=[],studentNames={},now=new Date()}){
  const student=['student','class_admin'].includes(actor.role);const reviewer=['counselor','college_admin','school_admin','super_admin'].includes(actor.role);
  const allowed=classId=>actor.global || actor.classIds.includes(Number(classId));const items=[];
  semesters=semesters.filter(sem=>Number(actor.collegeId)>0 && (!Array.isArray(sem.collegeIds)||!sem.collegeIds.length||sem.collegeIds.map(Number).includes(Number(actor.collegeId))));
  const urgency=dueAt=>{const time=dueAt?Date.parse(dueAt):NaN;if(!Number.isFinite(time))return'normal';return time<now.getTime()?'overdue':time-now.getTime()<=3*86400000?'soon':'normal';};
  const deadlineFor=app=>{if(app.semesterId)return semesters.find(sem=>sem.id===app.semesterId)?.applyEndAt||null;const candidates=semesters.filter(sem=>app.academicYear&&app.semester&&sem.academicYear===app.academicYear&&sem.semester===app.semester);return candidates.length===1?candidates[0].applyEndAt:null;};
  function add(item){items.push({...item,urgency:urgency(item.dueAt)});}
  if(student){
    for(const app of applications.filter(app=>Number(app.studentId)===actor.id && ['draft','returned'].includes(app.status)))
      add({key:`application-${app.id}`,kind:'application',title:app.title||'未命名申报',description:app.status==='returned'?'申报被退回，请补充材料后重新提交。':'草稿尚未提交，请核对申报期限。',to:'/my-applications',createdAt:app.updatedAt,
        dueAt:deadlineFor(app)});
    for(const sem of semesters){
      const ids=sem.collegeIds;
      if(!Number(actor.collegeId)||(Array.isArray(ids)&&ids.length&&!ids.map(Number).includes(Number(actor.collegeId))))continue;
      if(sem.status!=='active'||sem.applyStatus!=='started'||!sem.applyEndAt||urgency(sem.applyEndAt)!=='soon')continue;
      add({key:`semester-${sem.id}`,kind:'deadline',title:`${sem.name}即将截止`,description:'如有尚未申报的成果，请核对材料与适用规则。已完成申报可忽略此提醒。',dueAt:sem.applyEndAt,to:'/my-applications'});
    }
  }
  for(const record of approvals){const app=record.application;
    if(!app||record.approverId!==actor.id||record.action||!allowed(app.classId)||!['pending','approving'].includes(app.status)||Number(record.level)!==Number(app.currentLevel))continue;
    add({key:`approval-${app.id}`,kind:'approval',title:app.title||'待审核申报',description:'已分配给本人的当前审批步骤。',createdAt:record.assignedAt,to:`/approval?applicationId=${app.id}`});
  }
  if(actor.role==='counselor')for(const app of applications.filter(app=>allowed(app.classId)&&app.status==='approved'&&!app.finalReviewedAt))
    add({key:`final-${app.id}`,kind:'approval',title:app.title||'待终审申报',description:'班级管理员已处理，等待辅导员终审。',createdAt:app.approvedAt,to:`/approval?applicationId=${app.id}`});
  for(const plan of plans){
    if(!(student&&plan.studentId===actor.id)&&!(reviewer&&plan.studentId!==actor.id&&allowed(plan.classId)))continue;
    for(const task of plan.tasks||[]){
      const own=plan.studentId===actor.id;if(own?!['todo','in_progress','returned'].includes(task.status):task.status!=='submitted')continue;
      add({key:`growth-${plan.id}-${task.id}`,kind:'growth',title:task.title,description:own?(task.status==='returned'?'教师已退回，请补充执行记录或证明。':'按计划记录行动进展，完成后提交教师核验。'):`${studentNames[plan.studentId]||'学生'}已提交执行记录，等待核验。`,
        dueAt:own&&/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt)?`${task.dueAt}T23:59:59+08:00`:null,
        to:`/growth-plan?academicYear=${encodeURIComponent(plan.academicYear)}&semester=${plan.semester}${own?'':`&studentId=${plan.studentId}`}`});
    }
  }
  const grouped=new Map();
  for(const message of messages.filter(message=>message.userId===actor.id&&!message.isRead)){
    const key=message.relatedId?JSON.stringify([message.type,message.relatedType,message.relatedId]):JSON.stringify([message.title,message.content]);
    if(grouped.has(key)){grouped.get(key).messageIds.push(message.id);continue;}
    const item={key:`message-${message.id}`,kind:'message',title:message.title,description:message.content,messageIds:[message.id],createdAt:message.createdAt,urgency:'normal'};grouped.set(key,item);
  }
  items.push(...grouped.values());const rank={overdue:0,soon:1,normal:2};
  items.sort((a,b)=>rank[a.urgency]-rank[b.urgency]||(Date.parse(a.dueAt)||Infinity)-(Date.parse(b.dueAt)||Infinity)||String(a.key).localeCompare(String(b.key)));
  return {items,counts:{total:items.length,overdue:items.filter(item=>item.urgency==='overdue').length,soon:items.filter(item=>item.urgency==='soon').length},generatedAt:now.toISOString(),
    notice:'提醒按打开页面时的状态生成，不会自动发送短信或站外消息；只汇总本次加载范围，已完成事项刷新后移除。'};
}
module.exports={buildWorkItems};
