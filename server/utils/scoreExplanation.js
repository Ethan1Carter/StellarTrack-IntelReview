const crypto=require('crypto');
const {evalFormula}=require('./formulaParser');
const round=value=>Number(Number(value).toFixed(2));
function explainEvaluation(result,config,rawConfig) {
  const m=result.modules;
  const defaults={F1:'F1_BASE + F1_BONUS - F1_DEDUCT',F2:'(F2A * F2A_W + F2B * F2B_W) * F2_SCALE',F3:'F3_BASE + F3_BONUS - F3_DEDUCT',F4:'F4_BASE + F4_BONUS - F4_DEDUCT',F5:'F5_BASE + F5_PRACTICE',total:'F1 + F2 + F3 + F4 + F5'};
  const variables={F1:{F1_BASE:m.F1.baseScore,F1_BONUS:m.F1.bonusScore,F1_DEDUCT:m.F1.deductScore},F2:{F2A:m.F2.f2a,F2B:m.F2.f2b,F2A_W:config.f2aWeight,F2B_W:config.f2bWeight,F2_SCALE:config.f2Scale},F3:{F3_BASE:m.F3.baseScore,F3_BONUS:m.F3.bonusScore,F3_DEDUCT:m.F3.deductScore},F4:{F4_BASE:m.F4.baseScore,F4_BONUS:m.F4.bonusScore,F4_DEDUCT:m.F4.deductScore},F5:{F5_BASE:m.F5.baseScore,F5_PRACTICE:m.F5.practiceScore},total:Object.fromEntries(Object.entries(m).map(([key,value])=>[key,value.score]))};
  const steps=Object.entries(variables).map(([key,vars])=>{
    const requested=config[key==='total'?'totalFormula':`${key.toLowerCase()}Formula`];let formula=requested||defaults[key];let warning=null;let raw;
    try{raw=evalFormula(formula,vars);}catch(_){formula=defaults[key];raw=evalFormula(formula,vars);warning='配置公式执行失败，本次使用默认公式；请联系配置维护人员核对。';}
    const score=key==='total'?result.totalScore:m[key].score;
    return {key,name:key==='total'?'综测总分':m[key].name,formula,requestedFormula:requested,variables:vars,rawValue:round(raw),score,
      max:key==='total'?null:m[key].max,min:['F3','F4','F5'].includes(key)?0:null,warning};
  });
  const rawReward=(m.F2.f2bDetails||[]).reduce((sum,item)=>sum+Number(item.score||0),0);
  steps.splice(1,0,{key:'F2b',name:'智育奖励封顶',formula:'min(奖励原始合计, 奖励上限)',variables:{奖励原始合计:round(rawReward),奖励上限:config.f2bMax},rawValue:round(rawReward),score:m.F2.f2b,max:config.f2bMax,min:null});
  return {source:rawConfig?'学院当前配置':'系统默认配置',version:crypto.createHash('sha256').update(JSON.stringify([rawConfig?.id,rawConfig?.updatedAt,config])).digest('hex').slice(0,12),
    calculatedAt:new Date().toISOString(),notice:'按查询时配置重算，展示变量、公式及封顶处理；不是历史规则快照或报表签章结果。德育干部职务按最高分计入，课程按学分加权。',steps};
}
module.exports={explainEvaluation};
