const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { searchRules } = require('../services/ruleGuide');
const user = { id:9, collegeId:10, classId:100, grade:'2026', major:'计算机' };
const moduleFixture = { id:1, name:'志愿服务', status:'active', collegeId:10, applyScope:'all',
  ruleDescription:'志愿服务需提供主办方证明。每学年累计不超过 5 分。', singleMaxScore:0, yearlyMaxScore:5, yearlyMaxCount:0,
  requirePhoto:true, minPhotoCount:2, requireDescription:true, requireCertificateNo:false, updatedAt:'2026-10-20T00:00:00Z' };

test('规则查询只返回适用模块，原文可逐字追溯，零上限和不限次数不被替换', () => {
  const modules = [moduleFixture, { ...moduleFixture, id:2, collegeId:20 },
    { ...moduleFixture, id:3, applyScope:'specific_grade', applyGrades:['2025'] },
    { ...moduleFixture, id:4, applyScope:'specific_class', applyClassIds:[200] },
    { ...moduleFixture, id:5, applyScope:'specific_major', applyMajors:['数学'] },
    { ...moduleFixture, id:6, status:'disabled' }];
  const result = searchRules('志愿服务需要哪些材料？', modules, user);
  assert.deepEqual(result.results.map(item => item.id), [1]);
  for (const quote of result.results[0].citations) assert.ok(moduleFixture.ruleDescription.includes(quote));
  assert.equal(result.results[0].limits.singleMaxScore, 0);
  assert.equal(result.results[0].limits.yearlyMaxCount, 0);
  assert.ok(result.results[0].requirements.includes('上传至少 2 份证明材料'));
  assert.match(result.notice, /未认证为学校正式制度/);
  assert.equal(searchRules('登月成果', modules, user).results.length, 0);
});

test('缺少规则不生成计分条款，版本随规则改变，异常问题被拒绝', () => {
  const missing = searchRules('志愿', [{...moduleFixture,ruleDescription:''}], user).results[0];
  assert.equal(missing.hasRule, false); assert.deepEqual(missing.citations, []);
  const first = searchRules('', [moduleFixture], user).results[0];
  const second = searchRules('', [{...moduleFixture,ruleDescription:'修订后规则'}], user).results[0];
  assert.notEqual(first.version, second.version);
  assert.throws(() => searchRules(['志愿'], [moduleFixture], user), { statusCode:400 });
  assert.throws(() => searchRules('问'.repeat(201), [], user), { statusCode:400 });
});

test('真实查询路由拒绝教师入口、无归属和数组问题，忽略伪造学生及院系参数', async () => {
  let selectedWhere; const filename = path.resolve(__dirname, '../routes/rule-guide.js');
  const nativeRequire = createRequire(filename); const module = {exports:{}};
  const mocks = { '../models': { BonusModule: { findAll:async options => { selectedWhere=options.where; return [{toJSON:()=>moduleFixture}]; } } },
    '../middleware/auth': { requireStudent:(req,_res,next)=>next(['student','class_admin'].includes(req.role) ? undefined : Object.assign(new Error('Forbidden'),{statusCode:403})) } };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`,{filename})(id=>Object.hasOwn(mocks,id)?mocks[id]:nativeRequire(id),module,module.exports);
  const app=express(); app.use((req,res,next)=>{req.role=req.get('x-role')||'student';req.user={...user,collegeId:req.get('x-unbound')?null:10};res.success=data=>res.json({data});next();});
  app.use(module.exports); app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/?question=志愿',{headers:{'x-role':'counselor'}})).status,403);
    assert.equal((await fetch(base+'/?question=志愿',{headers:{'x-unbound':'1'}})).status,400);
    assert.equal((await fetch(base+'/?question[]=志愿')).status,400);
    const result=await (await fetch(base+'/?question=志愿&collegeId=20&studentId=999')).json();
    assert.equal(result.data.results[0].id,1);
    const {Op}=require('sequelize');assert.equal(selectedWhere[Op.or][0].collegeId,10);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
