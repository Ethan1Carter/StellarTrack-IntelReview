import {currentState,saveState,year,after} from './data.js';
import {validateResource,eligible,askPolicies,recommendActivities,resourceView} from './guidanceService.js';
const clone=value=>JSON.parse(JSON.stringify(value));
function resourceSeed(){const origin=typeof window!=='undefined'&&window.location?.protocol==='https:'?window.location.origin:'https://xinggui-intelreview.ajhz217.chatgpt.site';const dateStart=year.slice(0,4)+'-09-01';const dateEnd=year.slice(5)+'-08-31';
  const policy={id:1,seriesId:'demo-policy',revision:1,editVersion:1,kind:'policy',collegeId:1,status:'published',publishedAt:after(-2),data:{title:'志愿实践材料与有效期说明（演示）',summary:'用于体验带引用问答，不是校方正式制度。',issuer:'示例学校（演示数据）',sourceUrl:origin+'/demo/policy-sample.html',academicYear:year,grades:[],majors:[],referenceNo:'DEMO-2026-01',effectiveFrom:dateStart,effectiveTo:dateEnd,body:'【演示原文，不是正式制度】本文件仅用于体验查询和引用，不作为真实计分、资格或报名依据。\n\n第一条：志愿服务材料应包含主办方参与证明、本人参与内容及服务过程记录。团队材料未列出本人时，应补充成员证明。\n\n第二条：成果证明的有效期为所选学年；跨学年经历请咨询教师，不自动累计到本期分数。\n\n第三条：参与活动或完成成长任务，不等于自动获得综测加分，须按正式规则另行申报并审核。'}};
  const base={academicYear:year,issuer:'示例校园活动中心（演示）',sourceUrl:origin+'/demo/activity-sample.html',registrationUrl:'',grades:[],majors:[],costDescription:'演示活动，无实际报名或收费',tags:[],description:'这是虚构校园活动，用于体验筛选与加入成长计划；没有实际报名名额，也不代表真实活动通知。'};
  return [policy,...[{title:'图书馆图书整理实践（演示）',focusKey:'labor',durationMinutes:60,location:'示例图书馆',days:4},{title:'校园艺术作品观摩（演示）',focusKey:'arts',durationMinutes:120,location:'示例艺术空间',days:6},{title:'校园健康慢跑（演示）',focusKey:'sports',durationMinutes:30,location:'示例操场',days:5}].map((item,i)=>({id:i+2,seriesId:'demo-activity-'+i,revision:1,editVersion:1,kind:'activity',collegeId:1,status:'published',publishedAt:after(-1),data:{...base,title:item.title,focusKey:item.focusKey,durationMinutes:item.durationMinutes,location:item.location,summary:'仅为功能演示提供的虚构活动。',registrationEndAt:after(item.days-1),startsAt:after(item.days),endsAt:after(item.days+item.durationMinutes/1440)}}))];
}
export async function demoGuidance(path,method,input,params,actor){
  const state=currentState();state.guidanceResources ||= resourceSeed();const rows=state.guidanceResources;const admin=actor.role==='college_admin';
  const fail=message=>{throw new Error(message);};const student=['student','class_admin'].includes(actor.role);const user={...actor,collegeId:1};
  if(path==='/guidance/manage'&&method==='get'){if(!admin)fail('请切换学院管理员身份维护演示资源');return {items:rows.filter(r=>!params.kind||r.kind===params.kind).slice().reverse().map(resourceView),limited:false};}
  if(path.startsWith('/guidance/manage')){
    if(!admin)fail('只有学院管理员可维护演示资源');
    if(path==='/guidance/manage'){const data=validateResource(input.kind,input.data);const row={id:Math.max(...rows.map(r=>r.id),0)+1,seriesId:crypto.randomUUID(),revision:1,editVersion:1,kind:input.kind,collegeId:1,status:'draft',data,createdBy:actor.id};rows.push(row);saveState();return resourceView(row);}
    const match=path.match(/^\/guidance\/manage\/(\d+)(?:\/(revise|publish|withdraw))?$/);const row=rows.find(r=>r.id===Number(match?.[1]));if(!row)fail('演示资源不存在');if(row.editVersion!==input.editVersion)fail('记录已更新，请刷新后重试');const action=match[2];
    if(action==='revise'){if(rows.some(r=>r.seriesId===row.seriesId&&r.status==='draft'))fail('已有未发布修订草稿');const draft={...clone(row),id:Math.max(...rows.map(r=>r.id))+1,revision:Math.max(...rows.filter(r=>r.seriesId===row.seriesId).map(r=>r.revision))+1,editVersion:1,status:'draft',publishedAt:null};rows.push(draft);saveState();return resourceView(draft);}
    if(action==='withdraw'){if(row.status!=='published'||String(input.reason||'').trim().length<2)fail('请填写撤回原因并选择当前发布版本');row.status='withdrawn';row.withdrawalReason=input.reason;}
    else if(action==='publish'){if(row.status!=='draft'||input.sourceConfirmed!==true)fail('请核对草稿来源后再发布');const data=validateResource(row.kind,row.data,true);for(const old of rows.filter(r=>r.seriesId===row.seriesId&&r.status==='published')){old.status='superseded';old.editVersion++;}row.data=data;row.status='published';row.publishedAt=new Date().toISOString();}
    else{if(row.status!=='draft')fail('已发布正文不可覆盖，请创建修订版');row.data=validateResource(row.kind,input.data);}
    row.editVersion++;saveState();return resourceView(row);
  }
  if(!student)fail('请切换学生身份体验制度查询和活动推荐');
  if(path==='/guidance/policies')return {items:rows.filter(r=>r.kind==='policy'&&eligible(r,user,params.academicYear)).map(resourceView),limited:false};
  if(path==='/guidance/ask')return askPolicies(input,rows,user);
  if(path==='/guidance/activities')return recommendActivities(params,rows,user);
  const match=path.match(/^\/guidance\/activities\/(\d+)\/plan$/);
  if(match){const row=rows.find(r=>r.id===Number(match[1]));if(!row||!eligible(row,user,input.academicYear))fail('活动已截止或撤回，请刷新清单');const plan=state.plan;if(!plan||plan.academicYear!==input.academicYear||plan.semester!==input.semester)fail('请先保存目标学期成长计划');if(plan.revision!==input.revision)fail('成长计划已更新，请刷新');if(plan.tasks.some(t=>t.source?.seriesId===row.seriesId))fail('活动已在成长计划中');if(plan.tasks.length>=12)fail('本期计划已达到 12 项');plan.tasks.push({id:crypto.randomUUID(),title:row.data.title,dueAt:new Date(Date.parse(row.data.startsAt)+8*3600000).toISOString().slice(0,10),status:'todo',notes:'演示活动，仅加入行动安排，没有实际报名。',attachments:[],feedback:[],history:[],source:{kind:'campus_activity',resourceId:row.id,seriesId:row.seriesId,revision:row.revision,sourceUrl:row.data.sourceUrl}});plan.revision++;saveState();return plan;}
  fail('此演示操作暂不支持');
}
