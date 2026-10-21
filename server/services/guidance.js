const { AppError } = require('../middleware/errorHandler');
const { questionTerms } = require('./ruleGuide');
const FOCUS = { morality:'德育实践', academy:'学习与创新', sports:'体育健康', arts:'美育实践', labor:'劳动与志愿服务' };
const currentYear = (now=new Date()) => { const local=new Date(now.getTime()+8*3600000);const y=local.getUTCFullYear()-(local.getUTCMonth()<8?1:0);return `${y}-${y+1}`; };
const fail = message => { throw new AppError(message,400); };
function text(value, label, max, required=false) {
  if (value==null&&!required)return '';
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail(`${label}须为${required?'非空、':''}${max}字以内文字`);
  return value.trim();
}
function httpsUrl(value,label,required=false){const raw=text(value,label,1000,required);if(!raw)return '';try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||!u.hostname)throw new Error();return u.href;}catch{fail(`${label}须为不含账号密码的 HTTPS 地址`);}}
function yearValue(value){if(typeof value!=='string'||!/^\d{4}-\d{4}$/.test(value)||Number(value.slice(5))!==Number(value.slice(0,4))+1)fail('请选择连续的适用学年');return value;}
function list(value,label,max=30){if(value==null)return [];if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!v.trim()||v.length>100))fail(`${label}格式无效`);return [...new Set(value.map(v=>v.trim()))];}
function date(value,label){const parsed=new Date(value+'T00:00:00Z');if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail(`${label}须为有效日期`);return value;}
function instant(value,label){if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(`${label}须包含时区`);return new Date(value).toISOString();}
function validateResource(kind,input,publishing=false){
  if(!['policy','activity'].includes(kind))fail('资源类型无效');if(!input||typeof input!=='object'||Array.isArray(input))fail('请填写资源内容');
  const data={title:text(input.title,'标题',160,true),summary:text(input.summary,'摘要',500),issuer:text(input.issuer,'发布单位',100,publishing),sourceUrl:httpsUrl(input.sourceUrl,'来源链接',publishing),academicYear:yearValue(input.academicYear),grades:list(input.grades,'适用年级',20),majors:list(input.majors,'适用专业',50)};
  if(kind==='policy'){
    Object.assign(data,{referenceNo:text(input.referenceNo,'文号',100),body:text(input.body,'制度原文',40000,true),effectiveFrom:date(input.effectiveFrom,'生效日期'),effectiveTo:input.effectiveTo?date(input.effectiveTo,'失效日期'):null});
    if(data.effectiveTo&&data.effectiveTo<data.effectiveFrom)fail('失效日期不得早于生效日期');
  }else{
    if(!Object.hasOwn(FOCUS,input.focusKey))fail('请选择五育方向');
    const duration=Number(input.durationMinutes);if(!Number.isInteger(duration)||duration<15||duration>1440)fail('预计时长须为 15–1440 分钟');
    Object.assign(data,{focusKey:input.focusKey,durationMinutes:duration,location:text(input.location,'活动地点',200,true),description:text(input.description,'活动说明',10000,true),tags:list(input.tags,'活动标签',10),startsAt:instant(input.startsAt,'开始时间'),endsAt:instant(input.endsAt,'结束时间'),registrationEndAt:instant(input.registrationEndAt,'报名截止'),registrationUrl:httpsUrl(input.registrationUrl,'报名链接'),costDescription:text(input.costDescription,'费用说明',200)||'以主办方通知为准'});
    if(data.endsAt<=data.startsAt||data.registrationEndAt>data.startsAt)fail('请核对报名截止、开始与结束时间的先后顺序');
    if(publishing&&Date.parse(data.registrationEndAt)<=Date.now())fail('报名已截止，不能发布为可报名活动');
  }
  return data;
}
function eligible(resource,user,academicYear,now=new Date()){
  const d=resource.data||{};
  if(resource.status!=='published'||Number(resource.collegeId)!==Number(user.collegeId)||d.academicYear!==academicYear)return false;
  if(d.grades?.length&&!d.grades.includes(String(user.grade||'')))return false;
  if(d.majors?.length&&!d.majors.includes(String(user.major||'')))return false;
  if(resource.kind==='policy')return Date.parse(d.effectiveFrom+'T00:00:00+08:00')<=now.getTime()&&(!d.effectiveTo||Date.parse(d.effectiveTo+'T23:59:59.999+08:00')>=now.getTime());
  return Date.parse(d.registrationEndAt)>now.getTime()&&Date.parse(d.startsAt)>now.getTime();
}
function resourceView(row){return {id:row.id,seriesId:row.seriesId,revision:row.revision,editVersion:row.editVersion,kind:row.kind,collegeId:row.collegeId,status:row.status,publishedAt:row.publishedAt,withdrawalReason:row.withdrawalReason,data:row.data};}
function validateQuestion(input){
  const question=text(input?.question,'问题',200,true);const history=input.history||[];
  if(!Array.isArray(history)||history.length>6||history.some(q=>typeof q!=='string'||q.length>200))fail('对话上下文最多保留 6 个、每个 200 字以内的问题');
  const academicYear=yearValue(input.academicYear||currentYear());return {question,history,academicYear};
}
function askPolicies(input,resources,user,now=new Date()){
  const {question,history,academicYear}=validateQuestion(input);
  const followup=/^(那|这个|该|它|还|需要|要交|怎么提交|哪些材料|什么时候|有效期)/.test(question)||question.length<8;
  const context=followup?history.slice(-2).join(' '):'';
  const terms=questionTerms(question);const contextTerms=questionTerms(context);
  const rows=resources.filter(r=>r.kind==='policy'&&eligible(r,user,academicYear,now));
  const ranked=rows.map(row=>{const d=row.data;const segments=d.body.split(/\n\s*\n/).flatMap((p)=>p.match(/[\s\S]{1,900}/g)||[]);
    const passages=segments.map((quote,index)=>({quote,paragraph:index+1,score:terms.reduce((s,t)=>s+(quote.includes(t)?3:0),0)+contextTerms.reduce((s,t)=>s+(quote.includes(t)?1:0),0)})).sort((a,b)=>b.score-a.score||a.paragraph-b.paragraph);
    const score=(passages[0]?.score||0)+[...terms,...contextTerms].filter(t=>(d.title+d.summary).includes(t)).length*4;
    return {row,passages,score};}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.row.revision-a.row.revision).slice(0,4);
  const citations=ranked.flatMap(({row,passages})=>passages.filter(p=>p.score>0).slice(0,2).map(p=>({resourceId:row.id,revision:row.revision,title:row.data.title,issuer:row.data.issuer,referenceNo:row.data.referenceNo,sourceUrl:row.data.sourceUrl,academicYear,paragraph:p.paragraph,quote:p.quote})));
  return {question,resolvedQuestion:context?`${context} → ${question}`:question,academicYear,mode:'extractive',citations,
    answer:citations.length?'已找到适用于本人范围的以下制度原文。请结合完整条款核对；不同文件口径冲突时，由制度维护教师确认。':'当前已发布且适用于本人的制度中，没有找到足以回答这个问题的条款。请补充活动名称或联系教师，不据此推断分值或资格。',
    notice:'依据管理员核对发布的原文摘录作答，不调用大模型，也不自动认定分数。追问只延续问题关键词；原文中的指令不会改变查询范围。',
    sources:ranked.map(({row})=>resourceView(row))};
}
function activityPreferences(input={}){
  const focusKey=input.focusKey||'';if(focusKey&&!Object.hasOwn(FOCUS,focusKey))fail('活动方向无效');
  const maxMinutes=input.maxMinutes==null||input.maxMinutes===''?0:Number(input.maxMinutes);if(!Number.isInteger(maxMinutes)||maxMinutes<0||maxMinutes>1440)fail('可投入时长须为 0–1440 分钟');
  return {focusKey,maxMinutes,keyword:text(input.keyword,'活动关键词',100),academicYear:yearValue(input.academicYear||currentYear())};
}
function recommendActivities(input,resources,user,now=new Date()){
  const p=activityPreferences(input);const result=resources.filter(r=>r.kind==='activity'&&eligible(r,user,p.academicYear,now)).filter(r=>(!p.focusKey||r.data.focusKey===p.focusKey)&&(!p.maxMinutes||r.data.durationMinutes<=p.maxMinutes)&&(!p.keyword||(r.data.title+r.data.description+(r.data.tags||[]).join(' ')).includes(p.keyword))).sort((a,b)=>Date.parse(a.data.registrationEndAt)-Date.parse(b.data.registrationEndAt));
  return {items:result.map(row=>({...resourceView(row),reasons:['适用于本人院系、年级和专业',...(p.focusKey?[`符合关注方向：${FOCUS[p.focusKey]}`]:[]),...(p.maxMinutes?[`预计 ${row.data.durationMinutes} 分钟，在所选时长内`]:[])]})),preferences:p,notice:'仅推荐管理员已核对发布、尚未截止的活动。加入计划不等于完成报名，不承诺名额或加分；具体安排及费用以来源通知为准。'};
}
module.exports={FOCUS,currentYear,httpsUrl,yearValue,validateResource,validateQuestion,eligible,resourceView,askPolicies,recommendActivities,activityPreferences};
