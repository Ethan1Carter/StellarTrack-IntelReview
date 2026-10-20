const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const fsp=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const vm=require('node:vm');const {createRequire}=require('node:module');
const {scanMaterialIntegrity,integrityExtra,fileFingerprint}=require('../services/materialIntegrity');
const {buildWorkItems}=require('../services/workItems');
function load(relative,mocks){const filename=path.resolve(__dirname,'..',relative);const local=createRequire(filename);const module={exports:{}};vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`,{filename})(id=>Object.hasOwn(mocks,id)?mocks[id]:local(id),module,module.exports);return module.exports;}

test('文件改名仍能识别同内容，跨模块编号给出提醒，只比较本人且服务端要求说明',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'xinggui-integrity-'));const dir='20261020_u9';await fsp.mkdir(path.join(root,dir));
  await fsp.writeFile(path.join(root,dir,'old.pdf'),'synthetic certificate');await fsp.writeFile(path.join(root,dir,'new.pdf'),'synthetic certificate');
  const records=[{id:1,studentId:9,title:'原成果',moduleId:1,certificateNo:'TEST-2026-01',attachPhotos:[`/uploads/${dir}/old.pdf`],status:'approved'},
    {id:2,studentId:10,title:'他人信息不可返回',moduleId:2,certificateNo:'TEST-2026-01',attachPhotos:[],status:'approved'}];
  let query;
  try{
    const scan=await scanMaterialIntegrity({studentId:9,candidate:{title:'新标题',moduleId:2,certificateNo:'test 2026 01',proofUrl:[`/uploads/${dir}/new.pdf`]},Application:{findAll:async options=>{query=options;return records;}},root,secret:'synthetic-signing-secret'});
    assert.equal(query.where.studentId,9);assert.equal(scan.matches.length,1);assert.ok(scan.matches[0].reasons.includes('附件文件内容相同'));assert.ok(scan.matches[0].reasons.includes('证书编号相同'));
    assert.throws(()=>integrityExtra({duplicateReview:{matches:[]}},scan,'',true),{statusCode:400});
    const saved=integrityExtra({},scan,'同一团队成果，补充另一维度说明',true);assert.equal(saved.duplicateReview.matches[0].id,1);assert.ok(saved.materialIntegrity.signature);
    await assert.rejects(()=>fileFingerprint(root,'/uploads/../../outside.pdf'));
    await assert.rejects(()=>scanMaterialIntegrity({studentId:9,candidate:{proofUrl:['/uploads/20261020_u10/other.pdf']},Application:{findAll:async()=>records},root,secret:'synthetic-signing-secret'}),{statusCode:403});
    await assert.rejects(()=>scanMaterialIntegrity({studentId:9,candidate:{proofUrl:['https://example.test/uploads/20261020_u9/new.pdf']},Application:{findAll:async()=>records},root,secret:'synthetic-signing-secret'}),{statusCode:400});
  }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fsp.rm(root,{recursive:true,force:true});}
});

test('历史附件无法读取时明确标记未完整核对，草稿不伪造正式确认',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'xinggui-integrity-'));
  try{await fsp.mkdir(path.join(root,'20261020_u9'));await fsp.writeFile(path.join(root,'20261020_u9/a.pdf'),'synthetic');
    const result=await scanMaterialIntegrity({studentId:9,candidate:{proofUrl:['/uploads/20261020_u9/a.pdf']},root,secret:'test-secret',Application:{findAll:async()=>[{id:1,studentId:9,attachPhotos:['/uploads/20261019_9/missing.pdf']}]}});
    assert.equal(result.incomplete,true);assert.equal(result.matches.length,0);assert.equal(integrityExtra({},result,'',false).duplicateReview.reason,'');
  }finally{await fsp.rm(root,{recursive:true,force:true});}
});

test('真实计分引擎排除终审驳回，劳育历史加分进入计算，解释与加权、封顶一致',async()=>{
  const apps=[{title:'竞赛',finalScore:20,module:{category:'competition'}},{title:'终审驳回',finalScore:99,finalReviewAction:'reject',module:{category:'competition'}},
    {title:'干部一',finalScore:3,module:{category:'leadership'}},{title:'干部二',finalScore:2,module:{category:'leadership'}},{title:'劳动',finalScore:3,module:{category:'volunteer'}},{title:'体育扣分',finalScore:-5,module:{category:'sports'}}];
  const evaluation=load('utils/evaluation.js',{'../models':{User:{findByPk:async()=>({collegeId:10})},EvaluationConfig:{findOne:async()=>null},CourseScore:{findAll:async()=>[{courseName:'甲',score:90,credit:2},{courseName:'乙',score:60,credit:1}]},Application:{findAll:async()=>apps}},'../models/BonusClaim':{findAll:async()=>[{pillar:'labor',finalScore:2}]}});
  const result=await evaluation.calcEvaluation(9,'2026-2027','first');
  assert.equal(result.modules.F1.score,12);assert.equal(result.modules.F2.f2a,80);assert.equal(result.modules.F2.f2b,14);assert.equal(result.modules.F2.score,46.76);assert.equal(result.modules.F3.score,0);assert.equal(result.modules.F5.score,5);assert.equal(result.totalScore,63.76);
  const explanation=result.calculation;assert.equal(explanation.steps.find(step=>step.key==='F2b').rawValue,20);assert.equal(explanation.steps.find(step=>step.key==='F5').variables.F5_PRACTICE,5);assert.equal(explanation.steps.find(step=>step.key==='total').score,result.totalScore);
  const changed=await evaluation.calcEvaluation(9,'2026-2027','first',{totalFormula:'F1 * 2 + F2'});assert.equal(changed.totalScore,70.76);assert.notEqual(changed.calculation.version,explanation.version);
  const broken=await evaluation.calcEvaluation(9,'2026-2027','first',{f2Formula:'unknown(1)'});assert.equal(broken.modules.F2.score,46.76);assert.ok(broken.calculation.steps.find(step=>step.key==='F2').warning);
});

test('待办仅包含本人事项，消息合并、临期和中国时区截止时间正确，跳转保留原学期',()=>{
  const now=new Date('2026-10-20T10:00:00Z');const actor={id:9,role:'student',collegeId:10,classIds:[100]};
  const data=buildWorkItems({actor,now,applications:[{id:1,studentId:9,title:'草稿',status:'draft'},{id:2,studentId:10,status:'returned'}],
    plans:[{id:1,studentId:9,classId:100,academicYear:'2025-2026',semester:'second',tasks:[{id:'t',title:'补录',status:'returned',dueAt:'2026-10-19'}]},{id:2,studentId:10,classId:100,tasks:[{id:'x',status:'todo'}]}],
    semesters:[{id:1,name:'本院学期',collegeIds:[10],status:'active',applyStatus:'started',applyEndAt:'2026-10-22T10:00:00Z'},{id:2,name:'其他学院',collegeIds:[20],status:'active',applyStatus:'started',applyEndAt:'2026-10-22T10:00:00Z'}],
    messages:[{id:1,userId:9,title:'审批结果',relatedId:3,relatedType:'application',type:'result'},{id:2,userId:9,title:'审批结果',relatedId:3,relatedType:'application',type:'result'},{id:3,userId:10,title:'其他人'}]});
  assert.equal(data.counts.total,4);assert.equal(data.counts.overdue,1);assert.equal(data.counts.soon,1);assert.equal(data.items.find(item=>item.kind==='message').messageIds.length,2);assert.match(data.items.find(item=>item.kind==='growth').to,/2025-2026&semester=second/);
  const teacher=buildWorkItems({actor:{id:8,role:'counselor',collegeId:10,classIds:[100]},now,plans:[{id:1,studentId:9,classId:200,tasks:[{id:'x',status:'submitted'}]},{id:2,studentId:9,classId:100,tasks:[{id:'y',title:'待核验',status:'submitted'}]}],approvals:[{approverId:8,level:1,application:{id:3,classId:100,title:'当前阶段',status:'approving',currentLevel:2}}]});
  assert.equal(teacher.items.length,1);assert.equal(teacher.items[0].title,'待核验');
});

test('整套规则试算路由限制院系、样本和角色，并且不调用写入接口',async()=>{
  const express=require('express');let writes=0;let selected;
  const readonly={create:async()=>{writes++;},update:async()=>{writes++;},destroy:async()=>{writes++;}};
  const router=load('routes/evaluation.js',{'../models':{User:{...readonly,findAll:async options=>{selected=options;return[{id:9,realName:'合成学生',studentNo:'TEST-9'}];},findByPk:async()=>({collegeId:10})},Class:{},College:{},EvaluationConfig:readonly},
    '../middleware/auth':{auth:(_req,_res,next)=>next(),requireStudent:(_req,_res,next)=>next(),requireAdmin:(_req,_res,next)=>next(),requireSchoolAdmin:(_req,_res,next)=>next(),requireCollegeAbove:(req,_res,next)=>next(['college_admin','school_admin','super_admin'].includes(req.role)?undefined:Object.assign(new Error('Forbidden'),{statusCode:403}))},
    '../middleware/scope':{assertStudentInScope:async()=>{},narrowCollegeIds:(_req,id)=>{if(id!==10)throw Object.assign(new Error('Forbidden'),{statusCode:403});}},
    '../utils/evaluation':{buildEffectiveConfig:()=>({}),DEFAULT_FORMULAS:{},calcEvaluation:async(id,_year,_semester,config)=>({totalScore:config?20:10,modules:{F1:{name:'德育',score:config?20:10}},calculation:{steps:[],version:'test'}})},
    '../utils':{resolveAcademicTerm:()=>({academicYear:'2026-2027',semester:'first'})},'../middleware/logger':{}});
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.role=req.get('x-role')||'college_admin';req.userId=8;req.user={collegeId:10};res.success=data=>res.json({data});next();});app.use(router);app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}/config/preview`;
  const request=async(body,role='college_admin')=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-role':role},body:JSON.stringify(body)});
  try{assert.equal((await request({config:{}},'student')).status,403);assert.equal((await request({collegeId:20,config:{}},'school_admin')).status,403);assert.equal((await request({config:{},sampleSize:99})).status,400);
    const response=await request({collegeId:20,config:{},sampleSize:3});assert.equal(response.status,200);const result=(await response.json()).data;assert.equal(selected.where.collegeId,10);assert.equal(result.rows[0].delta,10);assert.equal(writes,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('真实查重接口忽略伪造账号，旧目录本人材料仍可编辑，不能借排除编号访问他人',async()=>{
  const express=require('express');const root=await fsp.mkdtemp(path.join(os.tmpdir(),'xinggui-integrity-http-'));await fsp.mkdir(path.join(root,'20261019_9'));await fsp.writeFile(path.join(root,'20261019_9/legacy.pdf'),'synthetic legacy');
  const own={id:1,studentId:9,moduleId:1,status:'approved',title:'旧成果',attachPhotos:['/uploads/20261019_9/legacy.pdf']};
  const pass=(_req,_res,next)=>next();const auth=new Proxy({auth:pass,requireRole:()=>pass,requireStudent:pass},{get:(target,key)=>target[key]||pass});
  const router=load('routes/applications.js',{'../models':{Application:{findAll:async()=>[own],findOne:async()=>null,findByPk:async id=>id===1?own:{id:2,studentId:10}}},'../middleware/auth':auth,'../middleware/scope':{},'../utils':{},'../utils/scoring':{},'../middleware/logger':{},'../config':{jwt:{secret:'synthetic-key'}},'../middleware/upload':{upload:{array:()=>pass},compressImages:pass,UPLOAD_ROOT:root}});
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.userId=9;req.user={id:9};res.success=data=>res.json({data});next();});app.use(router);app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}/check-duplicate`;
  const request=body=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try{const result=await request({studentId:10,excludeId:1,proofUrl:own.attachPhotos});assert.equal(result.status,200);assert.deepEqual((await result.json()).data.materialMatches,[]);assert.equal((await request({excludeId:2,proofUrl:own.attachPhotos})).status,403);assert.equal((await request({excludeId:'bad'})).status,400);}
  finally{await new Promise(resolve=>server.close(resolve));await fsp.rm(root,{recursive:true,force:true});}
});
