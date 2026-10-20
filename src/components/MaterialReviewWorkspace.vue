<template>
  <section class="material-desk" aria-label="材料核对工作台">
    <div class="desk-heading">
      <div><h3>材料核对</h3><p>对照原件、申报内容与评分依据，再作出审核决定。</p></div>
      <span class="desk-status">{{ review ? '已保留分析依据' : '人工核对材料' }}</span>
    </div>
    <div class="desk-columns">
      <section ref="documentPane" class="document-pane" aria-label="证明材料预览" tabindex="-1">
        <div class="document-toolbar">
          <label for="review-proof-select">证明材料</label>
          <el-select id="review-proof-select" v-model="selectedUrl" :disabled="!files.length" aria-label="选择证明材料" @change="resetPreview">
            <el-option v-for="(file, index) in files" :key="file.url" :label="`${index + 1}. ${file.name}`" :value="file.url" />
          </el-select>
          <a v-if="activeFile" :href="previewSrc" target="_blank" rel="noopener noreferrer">新窗口查看</a>
        </div>
        <div v-if="activeFile?.kind === 'pdf'" class="pdf-page-tools">
          <span aria-live="polite">{{ focusedPage ? `正在查看依据 · 第 ${page} 页` : 'PDF 页码' }}</span>
          <el-input-number v-model="page" :min="1" :max="pageLimit" :precision="0" size="small" aria-label="PDF 预览页码" @change="focusedPage = false" />
          <small>预览不可用时请在新窗口查看</small>
        </div>
        <div class="document-viewer" :class="{ 'is-image': activeFile?.kind === 'image' }">
          <iframe v-if="activeFile?.kind === 'pdf'" :key="previewSrc" :src="previewSrc" :title="`${activeFile.name}，第 ${page} 页`" />
          <el-image v-else-if="activeFile?.kind === 'image'" :src="activeFile.url" fit="contain" :preview-src-list="[activeFile.url]" preview-teleported>
            <template #error><div class="preview-fallback">图片加载失败，请确认登录状态后重试或在新窗口查看。</div></template>
          </el-image>
          <div v-else class="preview-fallback">
            <strong>{{ activeFile ? '此格式请在新窗口查看' : '暂无可预览的证明材料' }}</strong>
            <p>{{ activeFile ? '核对原件后，再填写审核意见。' : '请检查申报附件，必要时退回学生补充。' }}</p>
          </div>
        </div>
        <p class="document-caption">{{ activeFile?.kind === 'image' ? '点击图片可放大核对。' : activeFile?.kind === 'pdf' ? '页码定位依赖浏览器 PDF 阅读器；请核对阅读器显示的实际页码。' : '材料访问沿用当前账号的查看权限。' }}</p>
      </section>
      <section class="evidence-pane" aria-label="申报与建议对照">
        <div class="comparison-heading"><h4>申报与建议对照</h4><span v-if="review">{{ differenceCount ? `${differenceCount} 处内容不同，需核对` : '逐项核对原件' }}</span></div>
        <p v-if="reviewedFile" class="comparison-note">分析对应附件：{{ reviewedFile.name }}<span v-if="activeFile?.url !== reviewedFile.url">。当前查看的是另一份附件。</span></p>
        <p class="comparison-note">AI 建议仅供辅助；内容不同不代表申报错误，内容一致也不代表材料真实。</p>
        <div v-if="review" class="comparison-scroll">
          <table class="comparison-table">
            <caption class="sr-only">学生申报内容与分析时保留的 AI 建议</caption>
            <thead><tr><th scope="col">核对项</th><th scope="col">学生申报</th><th scope="col">分析时建议</th></tr></thead>
            <tbody><tr v-for="item in comparisons" :key="item.field" :class="{ 'has-difference': item.changed }">
              <th scope="row">{{ item.label }}<span v-if="item.changed" class="difference-label">待核对</span></th>
              <td>{{ item.declared }}</td><td>{{ item.suggested }}<button v-if="item.page && sourceAvailable" type="button" class="source-page" @click="focusEvidence(item.page)">第 {{ item.page }} 页 ↗</button></td>
            </tr></tbody>
          </table>
        </div>
        <el-empty v-else description="本申报未保留 AI 分析，请按原件和加分标准人工核对" :image-size="50" />
        <el-alert v-if="review" class="ownership-notice" :type="review.ownership?.status === 'matched' ? 'info' : 'warning'" :closable="false" show-icon
          :title="review.ownership?.message || '未保留归属核验结果，请人工核对获奖人。'" />
        <p v-if="review?.mode && review.mode !== 'model'" class="comparison-note">此分析来自{{ review.mode === 'fallback' ? '规则降级' : '历史记录' }}，请以原件核对为准。</p>
        <p v-if="review && !sourceAvailable" class="source-unavailable">分析时的附件不在当前清单中，已暂停页码定位，请人工核对对应原件。</p>
        <div v-if="confirmation" class="confirmation-note"><strong>申报人核对说明</strong><p>{{ confirmation }}</p></div>
        <AIReviewEvidence :review="review" expanded :source-available="sourceAvailable" @view-page="focusEvidence" />
        <details class="current-rules"><summary>查看当前模块加分标准</summary><p>当前配置与分析时的版本可能不同，请核对适用学年。</p><blockquote>{{ app.module?.ruleDescription || '尚未配置规则说明，请联系规则维护人员确认。' }}</blockquote></details>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import AIReviewEvidence from './AIReviewEvidence.vue';
import { applicationProofFiles, proofUrl, reviewComparisons } from '@/utils/reviewWorkspace';

const props = defineProps({ app: { type: Object, required: true } });
const origin = window.location?.origin || 'https://xinggui.invalid';
const review = computed(() => props.app.extraData?.aiReview);
const confirmation = computed(() => props.app.extraData?.aiConfirmation?.reason);
const files = computed(() => applicationProofFiles(props.app, origin));
const comparisons = computed(() => reviewComparisons(props.app));
const differenceCount = computed(() => comparisons.value.filter(item => item.changed).length);
const selectedUrl = ref('');
const documentPane = ref(null);
const page = ref(1);
const focusedPage = ref(false);
const activeFile = computed(() => files.value.find(file => file.url === selectedUrl.value));
const reviewedUrl = computed(() => proofUrl(review.value?.fileUrl, origin));
const reviewedFile = computed(() => files.value.find(file => file.url === reviewedUrl.value));
const sourceAvailable = computed(() => !!reviewedFile.value && ['image', 'pdf'].includes(reviewedFile.value.kind));
const pageLimit = computed(() => activeFile.value?.url === reviewedUrl.value && Number.isInteger(review.value?.document?.pageCount)
  ? Math.max(1, review.value.document.pageCount) : 9999);
const previewSrc = computed(() => activeFile.value?.kind === 'pdf'
  ? `${activeFile.value.url}#page=${page.value || 1}&view=FitH` : activeFile.value?.url || '');

function resetPreview() { page.value = 1; focusedPage.value = false; }
function focusEvidence(targetPage) {
  const count = review.value?.document?.pageCount;
  if (!sourceAvailable.value || !Number.isInteger(targetPage) || targetPage < 1 || targetPage > 9999
    || (Number.isInteger(count) && targetPage > count) || (reviewedFile.value.kind === 'image' && targetPage !== 1)) {
    ElMessage.warning('无法定位这段依据，请人工核对对应原件。'); return;
  }
  selectedUrl.value = reviewedFile.value.url;
  page.value = targetPage;
  focusedPage.value = true;
  documentPane.value?.scrollIntoView({ behavior: 'auto', block: 'start' });
  documentPane.value?.focus({ preventScroll: true });
}
watch(() => [props.app.id, files.value.map(file => file.url).join('\n'), reviewedUrl.value], () => {
  selectedUrl.value = reviewedFile.value?.url || files.value[0]?.url || '';
  resetPreview();
}, { immediate: true });
</script>

<style scoped>
.material-desk { --desk-ink:#1f3655; --desk-blue:#2563eb; --desk-muted:#63758b; margin:16px 20px 24px; border:1px solid #dbe4ef; border-radius:14px; overflow:hidden; background:#fff; }
.desk-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 20px; background:#f4f7fb; border-bottom:1px solid #dbe4ef; }
.desk-heading h3 { margin:0; color:var(--desk-ink); font-size:18px; font-weight:700; }
.desk-heading p,.comparison-note { margin:6px 0 0; font-size:12px; line-height:1.7; color:var(--desk-muted); }
.desk-status { flex-shrink:0; font-size:12px; color:#0f766e; }
.desk-columns { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); }
.document-pane,.evidence-pane { min-width:0; padding:16px; }
.document-pane { background:#f4f7fb; border-right:1px solid #dbe4ef; }
.document-toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.document-toolbar label { font-size:12px; font-weight:600; color:var(--desk-ink); }
.document-toolbar .el-select { flex:1; min-width:140px; }
.document-toolbar a,.source-page { color:var(--desk-blue); font-size:12px; }
.document-toolbar a { text-decoration:underline; text-underline-offset:3px; }
.pdf-page-tools { display:flex; align-items:center; gap:8px; margin-top:12px; flex-wrap:wrap; font-size:12px; color:var(--desk-ink); }
.pdf-page-tools .el-input-number { width:100px; }
.pdf-page-tools small { color:var(--desk-muted); }
.document-viewer { margin-top:12px; height:570px; background:#e7edf4; border:1px solid #d3dfec; border-radius:8px; overflow:hidden; }
.document-viewer iframe { width:100%; height:100%; display:block; border:0; background:#fff; }
.document-viewer .el-image { width:100%; height:100%; }
.document-viewer.is-image { background:#fff; }
.preview-fallback { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; height:100%; padding:24px; box-sizing:border-box; color:var(--desk-muted); font-size:13px; line-height:1.8; }
.document-caption { margin:10px 0 0; color:var(--desk-muted); font-size:12px; line-height:1.7; }
.comparison-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.comparison-heading h4 { color:var(--desk-ink); margin:0; font-size:15px; }
.comparison-heading span { color:#b45309; font-size:12px; }
.comparison-scroll { margin-top:12px; overflow-x:auto; }
.comparison-table { width:100%; border-collapse:collapse; font-size:12px; text-align:left; table-layout:fixed; }
.comparison-table th,.comparison-table td { padding:10px 8px; border-bottom:1px solid #e4ebf3; vertical-align:top; overflow-wrap:anywhere; line-height:1.6; }
.comparison-table thead { background:#f4f7fb; color:var(--desk-muted); }
.comparison-table th:first-child { width:64px; color:var(--desk-ink); }
.comparison-table td { color:#364a63; }
.has-difference { background:#fffbeb; }
.difference-label { display:block; color:#b45309; font-size:11px; font-weight:400; }
.source-page { display:block; background:none; border:0; padding:4px 0 0; cursor:pointer; font:inherit; color:var(--desk-blue); text-decoration:underline; text-underline-offset:3px; }
.ownership-notice { margin-top:14px; }
.source-unavailable { margin:10px 0; color:#b45309; font-size:12px; line-height:1.7; }
.confirmation-note { margin-top:14px; padding:12px; border-left:3px solid #0f766e; background:#f0fdfa; font-size:12px; color:var(--desk-ink); }
.confirmation-note p { margin:6px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; }
.current-rules { margin-top:14px; font-size:12px; color:var(--desk-ink); }
.current-rules summary { cursor:pointer; font-weight:600; padding:8px 0; }
.current-rules p { color:var(--desk-muted); line-height:1.7; }
.current-rules blockquote { margin:8px 0; padding:12px; background:#f4f7fb; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
button:focus-visible,a:focus-visible,summary:focus-visible { outline:2px solid var(--desk-blue); outline-offset:3px; border-radius:3px; }
@media (max-width:900px) { .desk-columns { grid-template-columns:minmax(0,1fr); } .document-pane { border-right:0; border-bottom:1px solid #dbe4ef; } .document-viewer { height:420px; } }
@media (max-width:540px) { .material-desk { margin:12px 8px 18px; } .desk-heading { padding:14px 12px; align-items:flex-start; flex-direction:column; } .document-pane,.evidence-pane { padding:12px; } .document-toolbar .el-select { flex-basis:60%; } .document-viewer { height:340px; } .comparison-heading { align-items:flex-start; flex-direction:column; } }
</style>
