<template>
  <details v-if="review" class="ai-evidence" :open="expanded">
    <summary>查看材料原文与评分依据 <span>{{ groups.length }} 段原文</span></summary>
    <div class="evidence-content">
      <p v-if="review.document" class="source">本次分析读取 {{ review.document.pageCount }} 页附件，以下为分析时保留的依据。相同页码的重复原文已合并展示。</p>
      <el-alert v-if="review.scoreBasis" :title="review.scoreBasis.message"
        :type="review.scoreBasis.status === 'referenced' ? 'info' : 'warning'" :closable="false" />
      <blockquote v-if="review.scoreBasis?.ruleExcerpt">{{ review.scoreBasis.ruleExcerpt }}</blockquote>
      <p v-if="review.scoreBasis?.source" class="source">{{ review.scoreBasis.source }} · 规则版本 {{ review.scoreBasis.version || '未记录' }}</p>
      <article v-for="group in groups" :key="group.key" class="evidence-excerpt">
        <div class="excerpt-heading">{{ group.page ? `第 ${group.page} 页` : '页码未记录' }} · 材料原文
          <button v-if="group.page && sourceAvailable" type="button" class="view-source" @click="$emit('view-page', group.page)">查看对应原件 ↗</button>
        </div>
        <p v-if="group.recipients.length" class="excerpt-context">对应获奖人：{{ group.recipients.map(person => `${person.name}${person.studentNo ? `（学号：${person.studentNo}）` : ''}`).join('、') }}</p>
        <p v-if="group.facts.length" class="excerpt-context">对应事实：{{ group.facts.join('、') }}</p>
        <blockquote>{{ group.evidence || '未保留原文，请核对原件。' }}</blockquote>
      </article>
      <p v-if="!review.scoreBasis && !groups.length" class="source">此历史结果没有保留规则原文和附件依据，请核对原件。</p>
    </div>
  </details>
</template>
<script setup>
import { computed } from 'vue';
import { groupReviewEvidence } from '../utils/aiReviewEvidence';

const props = defineProps({ review: Object, expanded: Boolean, sourceAvailable: Boolean });
defineEmits(['view-page']);
const groups = computed(() => groupReviewEvidence(props.review));
</script>
<style scoped>
.ai-evidence { margin-top:16px; border:1px solid var(--el-border-color-light); border-radius:10px; background:#fff; color:var(--el-text-color-regular); }
summary { padding:12px 14px; cursor:pointer; font-size:13px; font-weight:600; line-height:1.6; }
summary span { margin-left:8px; color:#7c899d; font-size:12px; font-weight:400; }
summary:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:2px; border-radius:10px; }
.evidence-content { max-height:380px; overflow:auto; padding:0 14px 14px; border-top:1px solid #e7edf4; }
.evidence-excerpt { margin-top:14px; }
.excerpt-heading { font-size:12px; font-weight:600; color:var(--el-text-color-primary); }
.view-source { margin-left:8px; padding:2px 0; border:0; background:none; color:var(--el-color-primary); cursor:pointer; font:inherit; text-decoration:underline; text-underline-offset:3px; }
.view-source:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:3px; }
.excerpt-context { margin:6px 0; font-size:12px; line-height:1.7; overflow-wrap:anywhere; }
blockquote { margin:8px 0 0; border-left:3px solid var(--el-color-primary-light-5); background:var(--el-fill-color-lighter); padding:10px 12px; white-space:pre-wrap; line-height:1.8; font-size:13px; overflow-wrap:anywhere; }
.source { color:#7c899d; font-size:12px; line-height:1.7; }
</style>
