import { currentState, saveState, roles, modules, year, term, semester, defaults, formulas, calculate, duplicateCheck, planTemplate, workItems } from './data.js';
import { evalFormula } from './formulaParser.js';
const copy=value=>JSON.parse(JSON.stringify(value));
const list=rows=>({list:rows,total:rows.length,page:1,pageSize:100});
export async function demoAdapter(config){
  const path=config.url.replace(/^\/api/,'').split('?')[0];const method=(config.method||'get').toLowerCase();let data=config.data;try{if(typeof data==='string')data=JSON.parse(data);}catch{}data ||= {};const params=config.params||{};const state=currentState();const actor=Object.values(roles).find(u=>'Bearer demo-'+u.role===config.headers?.Authorization)||roles.student;const result=value=>({data:{code:0,data:copy(value)},status:200,statusText:'OK',headers:{},config,request:{}});const fail=message=>{throw new Error(message);};
  const matches=path.match(/^\/applications\/(\d+)(?:\/(.*))?$/);const app=matches?state.applications.find(a=>a.id===Number(matches[1])):null;
  if(path==='/auth/login')return result({token:'demo-'+data.role,user:roles[data.role]||roles.student});
  if(path==='/auth/me'||path==='/profile')return result(actor);
  if(path==='/auth/logout')return result(null);
  if(path==='/messages/unread-count'||path==='/profile/unread-count')return result({count:2-state.readMessages.length});
  if(/^\/messages\/\d+\/read$/.test(path)){state.readMessages.push(Number(path.split('/')[2]));state.readMessages=[...new Set(state.readMessages)];saveState();return result(null);}
  if(path==='/work-items')return result(workItems(actor.role));
  if(path==='/modules/active')return result(modules);
  if(path==='/modules')return result(list(modules));
  if(path==='/semesters/current')return result(semester);
  if(path==='/applications/my/semesters'||path==='/semesters'||path==='/semesters/active')return result([semester]);
  if(path==='/colleges')return result(list([{id:1,name:'示例信息学院'}]));
  if(path==='/classes/my/info')return result({id:1,name:'2026 级软件工程 1 班'});
  if(path.startsWith('/classes'))return result(list([{id:1,name:'2026 级软件工程 1 班',collegeId:1}]));
  if(path==='/users'||path==='/growth-plans/students')return result(list([roles.student]));
  if(path==='/applications/my/summary') {const rows=modules.map(m=>({moduleId:m.id,moduleName:m.name,name:m.name,pendingScore:state.applications.filter(a=>a.moduleId===m.id&&a.status==='pending').reduce((s,a)=>s+Number(a.score),0),approvedScore:state.applications.filter(a=>a.moduleId===m.id&&a.status==='approved').reduce((s,a)=>s+Number(a.finalScore||0),0),yearlyMaxScore:m.yearlyMaxScore}));return result({modules:rows,totalPending:rows.reduce((s,r)=>s+r.pendingScore,0),totalApproved:rows.reduce((s,r)=>s+r.approvedScore,0)});}
  if(path==='/applications/my'||(path==='/applications'&&method==='get')){const rows=state.applications.filter(a=>(!params.status||String(params.status).split(',').includes(a.status))&&(!params.moduleId||a.moduleId===Number(params.moduleId))&&(!params.keyword||a.title.includes(params.keyword))).sort((a,b)=>b.id-a.id);return result(list(rows));}
  if(path==='/applications/check-duplicate')return result(duplicateCheck(data));
  if(path==='/applications/upload')return fail('演示站不接收个人附件。请使用已提供的示例草稿体验材料预览与审核。');
  if(path==='/applications'&&method==='post'){
    const check=duplicateCheck(data);if(!data.saveDraft&&check.materialMatches.length&&String(data.duplicateReason||'').trim().length<5)return fail('请填写至少 5 字的同成果说明。');
    const a={id:Math.max(...state.applications.map(a=>a.id),0)+1,...data,studentId:9,classId:1,academicYear:year,semester:term,semesterId:1,status:data.saveDraft?'draft':'pending',currentLevel:1,score:Number(data.score||data.applyScore||0),applyScore:Number(data.score||data.applyScore||0),module:modules.find(m=>m.id===Number(data.moduleId)),student:roles.student,attachPhotos:data.proofUrl||[],extraData:{...data.extraData,duplicateReview:{matches:check.materialMatches,reason:data.duplicateReason}},createdAt:new Date().toISOString(),approvalRecords:[],appeals:[]};state.applications.push(a);saveState();return result(a);
  }
  if(matches){if(!app)return fail('示例申报不存在，请重置演示数据。');const action=matches[2];if(method==='get')return result(action==='cc-records'?[]:app);if(method==='delete'){state.applications=state.applications.filter(a=>a!==app);saveState();return result(null);}if(method==='put'||action==='resubmit'){const check=duplicateCheck({...app,...data,excludeId:app.id});if(!data.saveDraft&&check.materialMatches.length&&String(data.duplicateReason||'').trim().length<5)return fail('请填写至少 5 字的同成果说明。');Object.assign(app,data,{applyScore:Number(data.score??app.score),attachPhotos:data.proofUrl||app.attachPhotos,status:data.saveDraft?'draft':'pending',module:modules.find(m=>m.id===Number(data.moduleId||app.moduleId)),extraData:{...app.extraData,...data.extraData,duplicateReview:{matches:check.materialMatches,reason:data.duplicateReason}}});}
    else if(action==='withdraw')app.status='draft';else if(action==='review'||action==='final-review'){app.status=data.action==='reject'?'rejected':data.action==='return'?'returned':'approved';app.finalScore=app.status==='approved'?Number(data.finalScore??app.score):null;app.approvalRecords.push({id:Date.now(),approver:actor,action:data.action,comment:data.comment,finalScore:app.finalScore,createdAt:new Date().toISOString()});if(action==='final-review')app.finalReviewedAt=new Date().toISOString();}else return fail('此操作需要完整后端，独立演示版暂不提供。');saveState();return result(app);}
  if(path==='/evaluation/config/defaults')return result({formulas:{f1:formulas.f1Formula,f2:formulas.f2Formula,f3:formulas.f3Formula,f4:formulas.f4Formula,f5:formulas.f5Formula,total:formulas.totalFormula},variables:{},defaultConfig:defaults});
  if(path==='/evaluation/config/test'){try{return result({ok:true,result:evalFormula(data.formula,data.vars)});}catch(error){return result({ok:false,error:error.message});}}
  if(path==='/evaluation/config/preview'){const before=calculate();const after=calculate(data.config);return result({notice:'仅对示例学生试算，不保存配置。',sampleSize:1,academicYear:year,semester:term,rows:[{studentId:9,name:roles.student.realName,studentNo:'DEMO-009',before:before.totalScore,after:after.totalScore,delta:Math.round((after.totalScore-before.totalScore)*100)/100,modules:Object.keys(before.modules).map(key=>({key,name:before.modules[key].name,before:before.modules[key].score,after:after.modules[key].score})),warnings:[]} ]});}
  if(path==='/evaluation/config/reset'){state.config=copy(defaults);saveState();return result(state.config);}
  if(path==='/evaluation/config'){if(method==='put'){calculate(data);state.config={...defaults,...data,isCustom:true};saveState();}return result(state.config);}
  if(path.startsWith('/evaluation/class/')){const r=calculate();return result({classId:1,className:'2026 级软件工程 1 班',count:1,total:1,list:[{studentId:9,realName:roles.student.realName,username:'DEMO-009',studentNo:'DEMO-009',rank:1,totalScore:r.totalScore,modules:Object.fromEntries(Object.entries(r.modules).map(([k,v])=>[k,v.score]))}]});}
  if(path.startsWith('/evaluation/'))return result(calculate());
  if(path==='/rule-guide'){const q=String(params.question||'');let found=q?modules.filter(m=>(m.name+m.ruleDescription).split('').some(char=>q.includes(char)&&!['的','要','需','怎','么'].includes(char))):modules;return result({mode:q?'search':'browse',question:q,total:modules.length,message:'以下全部为演示配置，不能作为学校正式计分依据。',results:found.map(m=>({...m,scope:'示例信息学院',hasRule:true,citations:[m.ruleDescription],limits:{singleMaxScore:m.singleMaxScore,yearlyMaxScore:m.yearlyMaxScore,yearlyMaxCount:0},requirements:['核对成果名称与日期','准备成果证明，提交教师审核'],source:'演示模块配置',version:'demo-v1'}))});}
  if(path==='/growth-plans/preview')return result(planTemplate(data.preferences));
  if(path==='/growth-plans'&&method==='get')return result({plan:state.plan,preview:state.plan?null:planTemplate(),student:roles.student});
  if(path==='/growth-plans'&&method==='post'){state.plan=planTemplate(data.preferences);saveState();return result(state.plan);}
  const taskMatch=path.match(/^\/growth-plans\/1\/tasks\/([^/]+)(?:\/(review|definition))?$/);
  if(taskMatch){const task=state.plan.tasks.find(t=>t.id===taskMatch[1]);if(!task)return fail('示例任务不存在。');if(data.revision!==state.plan.revision)return fail('示例记录已更新，请刷新后重试。');const event={at:new Date().toISOString(),actorName:actor.realName,status:data.status||task.status,notes:data.notes,message:data.reason||data.feedback||'更新演示记录'};
    if(taskMatch[2]==='review'){task.status=data.decision;task.feedback.push({reviewerName:actor.realName,text:data.feedback,at:event.at});}
    else if(taskMatch[2]==='definition'){event.previousDefinition={title:task.title,dueAt:task.dueAt};task.title=data.title;task.dueAt=data.dueAt;event.definition={title:task.title,dueAt:task.dueAt};}
    else Object.assign(task,{status:data.status,notes:data.notes,attachments:data.attachments||[]});task.history.push(event);state.plan.revision++;saveState();return result(state.plan);}
  if(path.startsWith('/appeals'))return method==='get'?result(list([])):fail('申诉流程需要完整后端，演示版暂不提供。');
  if(path.startsWith('/messages'))return result(list([]));
  return fail('此功能需要完整后端，当前 Sites 演示版仅开放导航中的体验流程。');
}
