const express=require('express');const crypto=require('crypto');const {Op}=require('sequelize');
const {sequelize,GuidanceResource,College,GrowthPlan}=require('../models');
const {requireStudent,requireCollegeAbove}=require('../middleware/auth');const {narrowCollegeIds}=require('../middleware/scope');
const {AppError}=require('../middleware/errorHandler');const {writeOperateLog}=require('../middleware/logger');
const {validateResource,validateQuestion,eligible,resourceView,askPolicies,recommendActivities,currentYear,activityPreferences}=require('../services/guidance');
const router=express.Router();
const idValue=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new AppError('记录 ID 无效',400);return n;};
const plain=row=>row.toJSON?row.toJSON():row;
const asyncRoute=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){if(error.name==='SequelizeUniqueConstraintError')return next(new AppError('资源已更新，请刷新后重试',409));if(error.original?.code==='42P01')return next(new AppError('制度与活动数据表尚未启用，请联系维护人员完成升级',503));next(error);}};
function ownCollege(req){const college=idValue(req.user.collegeId);return college;}
function assertVersion(row,value){if(!Number.isInteger(value)||row.editVersion!==value)throw new AppError('记录已更新，请刷新后重试',409);}
async function managedRow(req,id,transaction){const row=await GuidanceResource.findByPk(idValue(id),{transaction,lock:transaction?.LOCK?.UPDATE});if(!row)throw new AppError('记录不存在',404);narrowCollegeIds(req,row.collegeId);return row;}
async function visibleRows(req,kind){return GuidanceResource.findAll({where:{collegeId:ownCollege(req),kind,status:'published'},order:[['publishedAt','DESC'],['id','DESC']],limit:501,raw:true});}
async function audit(req,action,id){await writeOperateLog({userId:req.userId,username:req.username,role:req.role,module:'guidance',action,content:{id},ip:req.ip});}
router.get('/policies',requireStudent,asyncRoute(async(req,res)=>{const year=req.query.academicYear||currentYear();validateQuestion({question:'浏览制度',academicYear:year});const rows=await visibleRows(req,'policy');res.success({items:rows.slice(0,500).filter(r=>eligible(r,req.user,year)).map(resourceView),limited:rows.length>500});}));
router.post('/ask',requireStudent,asyncRoute(async(req,res)=>{validateQuestion(req.body);const rows=await visibleRows(req,'policy');const answer=askPolicies(req.body,rows.slice(0,500),req.user);res.success({...answer,limited:rows.length>500});}));
router.get('/activities',requireStudent,asyncRoute(async(req,res)=>{activityPreferences(req.query);const rows=await visibleRows(req,'activity');res.success({...recommendActivities(req.query,rows.slice(0,500),req.user),limited:rows.length>500});}));
router.post('/activities/:id/plan',requireStudent,asyncRoute(async(req,res)=>{
  const result=await sequelize.transaction(async transaction=>{
    const resource=await GuidanceResource.findByPk(idValue(req.params.id),{transaction,lock:transaction.LOCK.UPDATE});
    const academicYear=req.body.academicYear||currentYear();const semester=req.body.semester;
    if(!['first','second','annual'].includes(semester))throw new AppError('请选择加入计划的学期',400);
    if(!resource||resource.kind!=='activity'||!eligible(plain(resource),req.user,academicYear))throw new AppError('该活动已截止、撤回或不适用于本人',409);
    const plan=await GrowthPlan.findOne({where:{studentId:req.userId,academicYear,semester},transaction,lock:transaction.LOCK.UPDATE});
    if(!plan)throw new AppError('请先保存本学期成长计划，再加入活动',409);
    assertVersion({editVersion:plan.revision},req.body.revision);
    const tasks=JSON.parse(JSON.stringify(plan.tasks||[]));
    if(tasks.some(t=>t.source?.seriesId===resource.seriesId))throw new AppError('该活动已在成长计划中',409);
    if(tasks.length>=12)throw new AppError('本期计划已达到 12 项，请先整理已有任务',400);
    const dueAt=new Date(Date.parse(resource.data.startsAt)+8*3600000).toISOString().slice(0,10);
    tasks.push({id:crypto.randomUUID(),title:resource.data.title,dueAt,status:'todo',notes:'加入计划仅作行动安排，请自行查看主办方通知完成报名。',attachments:[],feedback:[],history:[{at:new Date().toISOString(),actorName:req.user.realName,status:'todo',message:'从已发布校园活动加入成长计划'}],source:{kind:'campus_activity',resourceId:resource.id,seriesId:resource.seriesId,revision:resource.revision,sourceUrl:resource.data.sourceUrl}});
    await plan.update({tasks,revision:plan.revision+1},{transaction});return plan;
  });res.success(result);
}));
router.get('/manage',requireCollegeAbove,asyncRoute(async(req,res)=>{const ids=narrowCollegeIds(req,req.query.collegeId);const kind=req.query.kind;if(kind&&!['policy','activity'].includes(kind))throw new AppError('资源类型无效',400);const rows=await GuidanceResource.findAll({where:{...(ids===null?{}:{collegeId:{[Op.in]:ids}}),...(kind?{kind}:{})},order:[['id','DESC']],limit:201,raw:true});res.success({items:rows.slice(0,200).map(resourceView),limited:rows.length>200});}));
router.post('/manage',requireCollegeAbove,asyncRoute(async(req,res)=>{
  const collegeId=req.role==='college_admin'?ownCollege(req):idValue(req.body.collegeId);narrowCollegeIds(req,collegeId);
  if(!await College.findByPk(collegeId,{attributes:['id']}))throw new AppError('目标院系不存在',400);
  const data=validateResource(req.body.kind,req.body.data);const row=await GuidanceResource.create({seriesId:crypto.randomUUID(),revision:1,editVersion:1,kind:req.body.kind,collegeId,status:'draft',data,createdBy:req.userId});await audit(req,'create',row.id);res.success(resourceView(plain(row)));
}));
router.put('/manage/:id',requireCollegeAbove,asyncRoute(async(req,res)=>{const result=await sequelize.transaction(async transaction=>{const row=await managedRow(req,req.params.id,transaction);assertVersion(row,req.body.editVersion);if(row.status!=='draft')throw new AppError('已发布内容不可覆盖，请创建修订版',409);const data=validateResource(row.kind,req.body.data);await row.update({data,editVersion:row.editVersion+1},{transaction});return resourceView(plain(row));});await audit(req,'edit',result.id);res.success(result);}));
router.post('/manage/:id/revise',requireCollegeAbove,asyncRoute(async(req,res)=>{const result=await sequelize.transaction(async transaction=>{const row=await managedRow(req,req.params.id,transaction);assertVersion(row,req.body.editVersion);const versions=await GuidanceResource.findAll({where:{seriesId:row.seriesId},transaction,lock:transaction.LOCK.UPDATE});if(versions.some(v=>v.status==='draft'))throw new AppError('已有未发布修订草稿，请先处理该草稿',409);const revision=Math.max(...versions.map(v=>v.revision))+1;const created=await GuidanceResource.create({seriesId:row.seriesId,revision,editVersion:1,kind:row.kind,collegeId:row.collegeId,status:'draft',data:row.data,createdBy:req.userId},{transaction});return resourceView(plain(created));});await audit(req,'revise',result.id);res.success(result);}));
router.post('/manage/:id/publish',requireCollegeAbove,asyncRoute(async(req,res)=>{if(req.body.sourceConfirmed!==true)throw new AppError('请先核对原文、发布单位和来源链接',400);const result=await sequelize.transaction(async transaction=>{const row=await managedRow(req,req.params.id,transaction);assertVersion(row,req.body.editVersion);if(row.status!=='draft')throw new AppError('只有草稿可以发布',409);const data=validateResource(row.kind,row.data,true);await GuidanceResource.update({status:'superseded',editVersion:sequelize.literal('edit_version + 1')},{where:{seriesId:row.seriesId,status:'published'},transaction});await row.update({data,status:'published',publishedBy:req.userId,publishedAt:new Date(),editVersion:row.editVersion+1},{transaction});return resourceView(plain(row));});await audit(req,'publish',result.id);res.success(result);}));
router.post('/manage/:id/withdraw',requireCollegeAbove,asyncRoute(async(req,res)=>{const reason=typeof req.body.reason==='string'?req.body.reason.trim():'';if(reason.length<2||reason.length>500)throw new AppError('请填写 2–500 字撤回原因',400);const result=await sequelize.transaction(async transaction=>{const row=await managedRow(req,req.params.id,transaction);assertVersion(row,req.body.editVersion);if(row.status!=='published')throw new AppError('只有当前发布版本可以撤回',409);await row.update({status:'withdrawn',withdrawalReason:reason,editVersion:row.editVersion+1},{transaction});return resourceView(plain(row));});await audit(req,'withdraw',result.id);res.success(result);}));
module.exports=router;
