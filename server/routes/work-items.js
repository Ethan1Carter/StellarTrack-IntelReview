const express=require('express');const {Op}=require('sequelize');
const {Application,ApprovalRecord,GrowthPlan,Semester,Message,User}=require('../models');
const {narrowClassIds}=require('../middleware/scope');const {buildWorkItems}=require('../services/workItems');
const router=express.Router();
router.get('/',async(req,res,next)=>{
  try{
    const classIds=narrowClassIds(req);const student=['student','class_admin'].includes(req.role);const reviewer=['counselor','college_admin','school_admin','super_admin'].includes(req.role);
    const classWhere=classIds===null?{}:{classId:{[Op.in]:classIds.length?classIds:[-1]}};
    const [applications,approvals,plans,semesters,messages]=await Promise.all([
      Application.findAll({where:student?{studentId:req.userId,status:{[Op.in]:['draft','returned']}}:req.role==='counselor'?{...classWhere,status:'approved',finalReviewedAt:null}:{id:-1},attributes:['id','studentId','classId','title','status','semesterId','academicYear','semester','updatedAt','approvedAt','finalReviewedAt'],order:[['id','DESC']],limit:100,raw:true}),
      ApprovalRecord.findAll({where:{approverId:req.userId,action:null},include:[{association:'application',attributes:['id','classId','title','status','currentLevel']}],order:[['id','DESC']],limit:100}),
      GrowthPlan.findAll({where:reviewer?classWhere:{studentId:req.userId},attributes:['id','studentId','classId','academicYear','semester','tasks'],order:[['id','DESC']],limit:100,raw:true}),
      student?Semester.findAll({where:{status:'active'},attributes:['id','name','academicYear','semester','collegeIds','status','applyStatus','applyEndAt'],order:[['id','DESC']],limit:100,raw:true}):[],
      Message.findAll({where:{userId:req.userId,isRead:false},attributes:['id','userId','title','content','isRead','type','relatedId','relatedType','createdAt'],order:[['id','DESC']],limit:100,raw:true})
    ]);
    const people=reviewer&&plans.length?await User.findAll({where:{...classWhere,id:{[Op.in]:plans.map(plan=>plan.studentId)}},attributes:['id','realName'],raw:true}):[];
    const names=Object.fromEntries(people.map(person=>[person.id,person.realName]));
    const visiblePlans=reviewer?plans.filter(plan=>Object.hasOwn(names,plan.studentId)):plans;
    const result=buildWorkItems({actor:{id:req.userId,role:req.role,collegeId:req.user.collegeId,classIds:classIds||[],global:classIds===null},applications,approvals,plans:visiblePlans,semesters,messages,studentNames:names});
    res.success({...result,limited:[applications,approvals,plans,semesters,messages].some(rows=>rows.length===100),limitNotice:'各来源最多加载最近 100 条记录，更多事项请前往原业务页面查看。'});
  }catch(error){next(error);}
});module.exports=router;
