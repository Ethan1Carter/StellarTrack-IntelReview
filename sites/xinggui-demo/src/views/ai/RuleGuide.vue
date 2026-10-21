<template>
  <div class="rule-guide">
    <WorkspaceHero eyebrow="RULES & EVIDENCE" title="规则查询与申报指引" description="输入成果或活动问题，查找适用于本人的模块原文，再准备申报材料。" />
    <section class="card question-panel">
      <form @submit.prevent="search()">
        <label for="rule-question">你想了解哪项成果的申报要求？</label>
        <div class="question-input"><el-input id="rule-question" v-model="question" maxlength="200" show-word-limit clearable placeholder="例如：省级竞赛二等奖怎么申报？" /><el-button native-type="submit" type="primary" :loading="loading">查找规则</el-button></div>
      </form>
      <div class="sample-questions"><span>试试这些问题</span><el-button v-for="sample in samples" :key="sample" text @click="search(sample)">{{ sample }}</el-button></div>
      <p class="source-notice">当前采用规则原文检索，不调用大模型生成政策结论。规则来自管理员配置，正式制度及适用学年请向教师确认。</p>
    </section>
    <el-alert v-if="error" class="guide-error" type="error" :title="error" show-icon :closable="false" />
    <section v-loading="loading" aria-live="polite" class="rule-results">
      <div v-if="result && !error" class="result-heading"><div><h2>{{ result.mode === 'browse' ? '当前适用模块' : `关于「${result.question}」` }}</h2><p>{{ result.message }}</p></div><span>{{ result.results.length }} / {{ result.total }} 个相关模块</span></div>
      <el-empty v-if="result && !result.results.length && !error" description="没有找到相关规则。可缩短问题，改用活动类型、成果名称或咨询辅导员。" />
      <article v-for="item in result?.results || []" :key="item.id" class="card rule-result">
        <div class="rule-heading"><div><span class="rule-scope">{{ item.scope }}</span><h3>{{ item.name }}</h3></div><el-button v-if="item.hasRule" type="primary" plain @click="router.push({path:'/apply', query:{moduleId:item.id,from:'rule-guide'}})">按此模块准备申报</el-button></div>
        <div class="rule-answer"><strong>{{ item.hasRule ? '相关规则原文' : '该模块尚未配置规则正文' }}</strong><blockquote v-for="(quote, index) in item.citations" :key="index">{{ quote }}</blockquote><p v-if="!item.hasRule">请先联系规则维护人员确认具体条件，不根据模块名称推断应得分数。</p></div>
        <dl class="rule-limits"><div><dt>单次申报上限</dt><dd>{{ number(item.limits.singleMaxScore) }} 分</dd></div><div><dt>学年累计上限</dt><dd>{{ number(item.limits.yearlyMaxScore) }} 分</dd></div><div><dt>学年次数限制</dt><dd>{{ item.limits.yearlyMaxCount === 0 ? '未限制' : item.limits.yearlyMaxCount === null ? '未配置' : `${item.limits.yearlyMaxCount} 次` }}</dd></div></dl>
        <p class="limit-note">以上为模块上限，具体认定分值须结合原文条件和教师审核。</p>
        <div class="requirement-list"><strong>提交前准备</strong><ul v-if="item.requirements.length"><li v-for="requirement in item.requirements" :key="requirement">{{ requirement }}</li></ul><p v-else>未额外配置必填材料，请继续核对规则正文中的条件。</p></div>
        <details v-if="item.hasRule" class="full-rule"><summary>查看完整配置原文</summary><p>{{ item.ruleDescription }}</p></details>
        <footer>{{ item.source }} · 版本 {{ item.version }}<span v-if="item.updatedAt"> · 更新于 {{ date(item.updatedAt) }}</span></footer>
      </article>
    </section>
  </div>
</template>
<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { queryRuleGuide } from '@/api/rule-guide';
const router = useRouter();
const question = ref(''); const result = ref(null); const loading = ref(false); const error = ref('');
const samples = ['竞赛获奖需要哪些材料？', '志愿服务怎么申报？', '体育比赛的加分要求'];
let version = 0;
const number = value => value === null ? '未配置' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const date = value => new Date(value).toLocaleDateString('zh-CN');
async function search(text) {
  if (typeof text === 'string') question.value = text;
  const query = question.value.trim(); const requestVersion = ++version;
  result.value = null; loading.value = true; error.value = '';
  try { const data = await queryRuleGuide(query); if (requestVersion === version && question.value.trim() === query) result.value = data; }
  catch (err) { if (requestVersion === version) error.value = err.message || '规则加载失败，请重新查询'; }
  finally { if (requestVersion === version) loading.value = false; }
}
watch(question, () => { version++; loading.value = false; result.value = null; error.value = ''; }, { flush: 'sync' });
onMounted(() => search());
</script>
<style scoped>
.rule-guide { --ink:#1f3655; --muted:#63758b; }.question-panel { padding:24px; margin-top:18px; }.question-panel label { display:block; margin-bottom:12px; color:var(--ink); font-weight:650; font-size:15px; }.question-input { display:flex; gap:12px; }.question-input .el-input { flex:1; }.sample-questions { display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin-top:14px; font-size:12px; color:var(--muted); }.sample-questions :deep(.el-button+.el-button) { margin-left:0; }.source-notice,.limit-note { font-size:12px; color:var(--muted); line-height:1.8; margin:12px 0 0; }.guide-error { margin-top:16px; }.result-heading { display:flex; gap:16px; align-items:center; justify-content:space-between; margin:26px 0 16px; }.result-heading h2 { font-size:19px; margin:0; overflow-wrap:anywhere; }.result-heading p,.result-heading>span { font-size:13px; color:var(--muted); }.result-heading>span { white-space:nowrap; }.rule-result { margin-bottom:18px; padding:24px; }.rule-heading { display:flex; align-items:center; justify-content:space-between; gap:14px; }.rule-heading h3 { margin:6px 0 0; color:var(--ink); font-size:20px; }.rule-scope { color:#0f766e; font-size:12px; }.rule-answer { margin-top:22px; color:var(--ink); font-size:14px; }.rule-answer blockquote { margin:12px 0 0; padding:14px 16px; background:#f4f7fb; border-left:3px solid var(--el-color-primary); white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.9; }.rule-limits { display:flex; gap:32px; margin:22px 0 0; flex-wrap:wrap; }.rule-limits dt { font-size:12px; color:var(--muted); }.rule-limits dd { margin:7px 0 0; font-size:17px; color:var(--ink); font-weight:650; }.requirement-list { margin-top:20px; font-size:13px; line-height:1.9; }.requirement-list ul { padding-left:20px; margin:8px 0; }.requirement-list p { color:var(--muted); }.full-rule { margin-top:16px; font-size:13px; }.full-rule summary { cursor:pointer; color:var(--el-color-primary); }.full-rule p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.9; }footer { margin-top:20px; padding-top:14px; border-top:1px solid #e4ebf3; font-size:11px; color:var(--muted); overflow-wrap:anywhere; }summary:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:3px; }@media(max-width:600px) { .question-panel,.rule-result { padding:18px 14px; }.question-input { flex-direction:column; }.rule-heading,.result-heading { align-items:flex-start; flex-direction:column; }.rule-limits { gap:20px; } }
</style>
