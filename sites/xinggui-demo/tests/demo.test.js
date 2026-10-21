import test from 'node:test';
import assert from 'node:assert/strict';
const values = new Map();
globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
globalThis.window={dispatchEvent(){}};
globalThis.fetch=()=>{throw new Error('演示数据不得访问网络');};
const {demoAdapter}=await import('../src/demo/adapter.js');
const {currentState,resetState,calculate,duplicateCheck,proof,readState}=await import('../src/demo/data.js');
async function request(url,method='get',data={},role='student',params={}){return (await demoAdapter({url,method,data,params,headers:{Authorization:'Bearer demo-'+role}})).data.data;}
test('示例申报由学生提交，教师审核后计入计算并持久化',async()=>{
  resetState();const before=calculate().totalScore;
  const app=await request('/applications','post',{moduleId:2,title:'演示劳动实践',score:2,proofUrl:[]});assert.equal(app.status,'pending');
  await request('/applications/'+app.id+'/review','post',{action:'approve',finalScore:2,comment:'示例证据完整'},'class_admin');
  assert.equal(calculate().totalScore,before+2);assert.equal(readState().applications.find(a=>a.id===app.id).status,'approved');
});
test('同成果提示展示证书与附件依据，正式提交要求说明',async()=>{
  resetState();const d={moduleId:1,title:'另一成果',certificateNo:'DEMO-2026-001',proofUrl:[proof],score:2};
  const check=duplicateCheck(d);assert.equal(check.materialMatches[0].reasons.length,2);
  await assert.rejects(request('/applications','post',d),/至少 5 字/);
  const draft=await request('/applications','post',{...d,saveDraft:true});assert.equal(draft.status,'draft');
  const app=await request('/applications','post',{...d,duplicateReason:'同证书含多个成果，提交教师核验'});assert.equal(app.extraData.duplicateReview.matches.length,3);
});
test('配置试算返回页面所需行与各维度对照，且不修改现有配置',async()=>{
  resetState();const before=JSON.stringify(currentState().config);const c={...currentState().config,f1Base:12};const result=await request('/evaluation/config/preview','post',{config:c},'college_admin');
  assert.equal(result.rows[0].delta,3);assert.equal(result.rows[0].modules[0].name,'德育');assert.equal(JSON.stringify(currentState().config),before);
  await assert.rejects(request('/evaluation/config','put',{...c,totalFormula:'alert(1)'},'college_admin'));
  assert.equal(JSON.stringify(currentState().config),before);
});
test('成长记录可提交并由教师核验，过期修订被拒绝',async()=>{
  resetState();let plan=currentState().plan;const old=plan.revision;
  plan=await request('/growth-plans/1/tasks/action','patch',{revision:plan.revision,status:'submitted',notes:'完成一次校园劳动实践，并整理过程反思。',attachments:[]});
  assert.equal(plan.tasks.find(t=>t.id==='action').status,'submitted');
  await assert.rejects(request('/growth-plans/1/tasks/action','patch',{revision:old,status:'in_progress'}),/刷新/);
  plan=await request('/growth-plans/1/tasks/action/review','post',{revision:plan.revision,decision:'completed',feedback:'记录完整，示例核验通过。'},'counselor');
  assert.equal(plan.tasks.find(t=>t.id==='action').feedback.length,1);assert.equal(plan.tasks.find(t=>t.id==='action').history.length,2);
});
test('未读消息合并、标记后消失，重置恢复初始数据',async()=>{
  resetState();let todo=await request('/work-items');assert.equal(todo.items.find(i=>i.kind==='message').messageIds.length,2);
  await request('/messages/1/read','post');await request('/messages/2/read','post');todo=await request('/work-items');assert.ok(!todo.items.some(i=>i.kind==='message'));
  resetState();assert.equal(currentState().readMessages.length,0);assert.equal(currentState().applications.length,4);
});
test('内置证书、学生和配置接口提供前端需要的数据结构',async()=>{
  resetState();assert.equal((await request('/growth-plans/students')).list[0].id,9);assert.equal((await request('/semesters/current')).id,1);
  const result=calculate();assert.equal(result.calculation.steps.length,7);assert.equal(result.modules.F2.f2a,88.5);assert.equal(result.totalScore,62.12);
});
test('上传、未实现的导出和危险业务操作明确拒绝，未伪造成功',async()=>{
  await assert.rejects(request('/applications/upload','post'),/不接收个人附件/);
  await assert.rejects(request('/applications/my/export'),/完整后端/);
  await assert.rejects(request('/backups/restore','post'),/完整后端/);
});
