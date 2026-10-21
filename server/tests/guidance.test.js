const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {createRequire}=require('node:module');const express=require('express');const {Op}=require('sequelize');
const {validateResource,eligible,askPolicies,recommendActivities,currentYear}=require('../services/guidance');
const user={id:9,collegeId:10,grade:'2026',major:'软件工程',realName:'测试学生'};const now=new Date('2026-10-21T04:00:00Z');
const policyData={title:'志愿服务认定办法',summary:'实践材料与有效期',issuer:'测试学校',sourceUrl:'https://school.example.test/rules',academicYear:'2026-2027',grades:['2026'],majors:['软件工程'],referenceNo:'测试〔2026〕1号',effectiveFrom:'2026-09-01',effectiveTo:'2027-08-31',body:'第一条：志愿服务需提交主办方证明与本人参与记录。\n\n第二条：证明材料的有效期为本学年，跨学年成果须另行确认。'};
const policy={id:1,seriesId:'policy-series',kind:'policy',revision:1,editVersion:1,status:'published',collegeId:10,data:policyData};
const activityData={title:'图书馆志愿服务',summary:'整理图书',issuer:'测试学校图书馆',sourceUrl:'https://school.example.test/notice',registrationUrl:'https://school.example.test/register',academicYear:'2026-2027',grades:[],majors:[],focusKey:'labor',durationMinutes:60,startsAt:'2026-11-01T09:00:00+08:00',endsAt:'2026-11-01T10:00:00+08:00',registrationEndAt:'2026-10-30T18:00:00+08:00',location:'图书馆',costDescription:'免费（测试）',tags:['图书'],description:'按主办方安排整理图书，不承诺加分。'};
test('发布校验拒绝危险链接、无时区时间、无效日期与过期报名；保留显式年级范围',()=>{
  assert.equal(validateResource('policy',policyData,true).sourceUrl,policyData.sourceUrl);
  assert.throws(()=>validateResource('policy',{...policyData,sourceUrl:'javascript:alert(1)'},true),{statusCode:400});
  assert.throws(()=>validateResource('policy',{...policyData,effectiveFrom:'2026-13-01'}),{statusCode:400});
  assert.throws(()=>validateResource('policy',{...policyData,effectiveFrom:'2026-02-31'}),{statusCode:400});
  assert.throws(()=>validateResource('activity',{...activityData,startsAt:'2026-11-01T09:00:00'}),{statusCode:400});
  assert.throws(()=>validateResource('activity',{...activityData,registrationEndAt:'2020-01-01T01:00:00Z'},true),{statusCode:400});
  assert.throws(()=>validateResource('policy',{...policyData,grades:['']}),{statusCode:400});
  assert.equal(currentYear(new Date('2026-08-31T16:01:00Z')),'2026-2027');
});
test('制度引用只来自有效本人范围，追问保留原文位置，注入内容不能越权',()=>{
  const rows=[policy,{...policy,id:2,collegeId:20},{...policy,id:3,data:{...policyData,grades:['2025']}},{...policy,id:4,status:'draft'},{...policy,id:5,data:{...policyData,effectiveTo:'2026-09-02'}},{...policy,id:6,data:{...policyData,academicYear:'2025-2026'}},{...policy,id:7,data:{...policyData,majors:['数学']}}];
  const first=askPolicies({question:'志愿服务需要哪些证明？',academicYear:'2026-2027'},rows,user,now);assert.ok(first.citations.length);assert.deepEqual(first.sources.map(s=>s.id),[1]);for(const c of first.citations)assert.ok(policyData.body.includes(c.quote));
  const next=askPolicies({question:'那有效期呢？',history:[first.question],academicYear:'2026-2027'},rows,user,now);assert.match(next.resolvedQuestion,/志愿服务/);assert.ok(next.citations.some(c=>c.quote.includes('有效期')));assert.equal(next.citations[0].revision,1);
  const none=askPolicies({question:'登月项目资格',academicYear:'2026-2027'},rows,user,now);assert.equal(none.citations.length,0);assert.match(none.answer,/没有找到/);
  assert.throws(()=>askPolicies({question:['志愿'],academicYear:'2026-2027'},rows,user,now),{statusCode:400});
  assert.throws(()=>askPolicies({question:'志愿',history:Array(7).fill('问')},rows,user,now),{statusCode:400});
  assert.equal(eligible({...policy,data:{...policyData,effectiveTo:'2026-10-21'}},user,'2026-2027',new Date('2026-10-21T15:59:59Z')),true);
  assert.equal(eligible({...policy,data:{...policyData,effectiveTo:'2026-10-21'}},user,'2026-2027',new Date('2026-10-21T16:00:00Z')),false);
});
test('校园活动推荐按可报名状态、本人范围、方向、时长筛选，不编造活动或分值',()=>{
  const a={id:2,kind:'activity',status:'published',collegeId:10,revision:1,data:activityData};const rows=[a,{...a,id:3,status:'withdrawn'},{...a,id:4,collegeId:20},{...a,id:5,data:{...activityData,registrationEndAt:'2026-10-20T00:00:00Z'}},{...a,id:6,data:{...activityData,durationMinutes:180}}];
  const result=recommendActivities({focusKey:'labor',maxMinutes:60,academicYear:'2026-2027'},rows,user,now);assert.deepEqual(result.items.map(r=>r.id),[2]);assert.ok(result.items[0].reasons.some(r=>r.includes('60')));assert.equal(result.items[0].data.score,undefined);
  assert.equal(recommendActivities({focusKey:'arts',academicYear:'2026-2027'},rows,user,now).items.length,0);assert.throws(()=>recommendActivities({maxMinutes:-1},rows,user,now),{statusCode:400});
});
function loadRoute(models){const filename=path.resolve(__dirname,'../routes/guidance.js');const native=createRequire(filename);const mod={exports:{}};const guard=allowed=>(req,_res,next)=>next(allowed.includes(req.role)?undefined:Object.assign(new Error('Forbidden'),{statusCode:403}));const mocks={'../models':models,'../middleware/auth':{requireStudent:guard(['student','class_admin']),requireCollegeAbove:guard(['college_admin','school_admin','super_admin'])},'../middleware/scope':{narrowCollegeIds:(req,college)=>{if(college!=null&&!req.scope.collegeIds.includes(Number(college)))throw Object.assign(new Error('Forbidden college'),{statusCode:403});return college?[Number(college)]:req.scope.collegeIds;}},'../middleware/logger':{writeOperateLog:async()=>{}}};vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`,{filename})(id=>Object.hasOwn(mocks,id)?mocks[id]:native(id),mod,mod.exports);return mod.exports;}
function memoryModels(){let next=1;const rows=[];const plan={studentId:9,academicYear:'2026-2027',semester:'first',revision:1,tasks:[],async update(data){Object.assign(this,data);}};const match=(row,where)=>Reflect.ownKeys(where||{}).every(k=>{const value=where[k];if(typeof value==='object'&&value?.[Op.in])return value[Op.in].includes(row[k]);return row[k]===value;});const wrap=values=>({...values,toJSON(){const {toJSON,update,...data}=this;return JSON.parse(JSON.stringify(data));},async update(data){Object.assign(this,data);return this;}});return {rows,plan,sequelize:{literal:()=>({increment:true}),transaction:async fn=>fn({LOCK:{UPDATE:'UPDATE'}})},College:{findByPk:async id=>id===10?{id}:null},GuidanceResource:{async create(data){const row=wrap({id:next++,...data});rows.push(row);return row;},async findByPk(id){return rows.find(r=>r.id===id)||null;},async findAll(options){const result=rows.filter(r=>match(r,options.where)).sort((a,b)=>b.id-a.id).slice(0,options.limit||Infinity);return options.raw?result.map(r=>r.toJSON()):result;},async update(data,options){for(const row of rows.filter(r=>match(r,options.where)))await row.update({...data,editVersion:row.editVersion+1});}},GrowthPlan:{findOne:async({where})=>match(plan,where)?plan:null}};}
test('真实管理路由：草稿不外泄，发布/修订保留旧版，禁止覆盖已发布正文和跨院系操作',async()=>{
  const models=memoryModels();const app=express();app.use(express.json());app.use((req,res,next)=>{req.role=req.get('x-role')||'student';req.user={...user};req.userId=9;req.scope={collegeIds:[10]};res.success=data=>res.json({data});next();});app.use(loadRoute(models));app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({message:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;const call=async(url,method='GET',body,role='college_admin')=>{const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','x-role':role},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
  try{
    assert.equal((await call('/manage','POST',{kind:'policy',collegeId:20,data:policyData},'student')).status,403);
    const created=await call('/manage','POST',{kind:'policy',collegeId:20,data:policyData});assert.equal(created.data.collegeId,10);const id=created.data.id;
    assert.equal((await call('/policies?academicYear=2026-2027','GET',null,'student')).data.items.length,0);
    assert.equal((await call(`/manage/${id}/publish`,'POST',{editVersion:1})).status,400);
    assert.equal((await call(`/manage/${id}/publish`,'POST',{editVersion:1,sourceConfirmed:true})).status,200);
    assert.equal((await call(`/manage/${id}`,'PUT',{editVersion:1,data:policyData})).status,409);
    assert.equal((await call(`/manage/${id}`,'PUT',{editVersion:2,data:{...policyData,body:'覆盖'}})).status,409);
    const revised=await call(`/manage/${id}/revise`,'POST',{editVersion:2});assert.equal(revised.data.revision,2);assert.equal(models.rows[0].data.body,policyData.body);
    assert.equal((await call(`/manage/${id}/revise`,'POST',{editVersion:2})).status,409);
    const saved=await call(`/manage/${revised.data.id}`,'PUT',{editVersion:1,data:{...policyData,body:policyData.body+'\n\n第三条：修订。'}});assert.equal(saved.data.editVersion,2);
    const published=await call(`/manage/${revised.data.id}/publish`,'POST',{editVersion:2,sourceConfirmed:true});assert.equal(published.status,200);assert.equal(models.rows[0].status,'superseded');
    const answer=await call('/ask','POST',{question:'志愿服务证明',academicYear:'2026-2027',collegeId:20,studentId:1000},'student');assert.equal(answer.data.sources[0].revision,2);
    assert.equal((await call('/manage?collegeId=20')).status,403);
    models.rows.push({...models.rows[0],id:99,collegeId:20});assert.equal((await call('/manage/99','PUT',{editVersion:3,data:policyData})).status,403);
    assert.equal((await call(`/manage/${revised.data.id}/withdraw`,'POST',{editVersion:3,reason:'制度需重新核对'})).status,200);
    assert.equal((await call('/ask','POST',{question:'志愿证明',academicYear:'2026-2027'},'student')).data.citations.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('加入成长计划路由拒绝过期/非本人范围与旧修订，重复活动不重复建任务',async()=>{
  const models=memoryModels();const future=days=>new Date(Date.now()+days*86400000).toISOString();const academicYear=currentYear();models.plan.academicYear=academicYear;const data={...activityData,academicYear,startsAt:future(4),endsAt:future(4.1),registrationEndAt:future(2)};const resource=await models.GuidanceResource.create({kind:'activity',collegeId:10,seriesId:'activity-series',revision:1,status:'published',data});const app=express();app.use(express.json());app.use((req,res,next)=>{req.role='student';req.user={...user};req.userId=9;res.success=data=>res.json({data});next();});app.use(loadRoute(models));app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({message:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;const join=revision=>fetch(base+`/activities/${resource.id}/plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({academicYear,semester:'first',revision,studentId:999})});
  try{assert.equal((await join(99)).status,409);assert.equal((await join(1)).status,200);assert.equal(models.plan.tasks.length,1);assert.equal(models.plan.tasks[0].source.seriesId,'activity-series');assert.equal((await join(2)).status,409);resource.status='withdrawn';assert.equal((await join(2)).status,409);assert.equal(models.plan.tasks.length,1);}finally{await new Promise(resolve=>server.close(resolve));}
});
