<template>
  <div class="ai-review-page">
    <WorkspaceHero
      eyebrow="AI MATERIAL REVIEW"
      title="AI 材料审核中心"
      description="上传成长证明材料，先核对证书获奖人与当前账号，再提取成果、匹配五育模块。姓名一致仍需教师核验原件。"
    />

    <div class="review-grid">
      <section class="card form-card">
        <div class="card-title">
          <span class="step-label">01</span>
          <span>上传与补充材料</span>
          <span class="card-caption">先上传，再分析</span>
        </div>
        <el-form label-position="top" class="review-form">
          <div class="panel-body form-body" tabindex="0" role="region" aria-label="上传与补充材料">
          <el-form-item label="证明材料">
            <div class="upload-options">
              <el-upload
                class="material-upload"
                action="#"
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*,.pdf"
                multiple
                :on-change="onFileChange">
                <div class="upload-zone">
                  <div class="upload-icon"><el-icon><Upload /></el-icon></div>
                  <div>
                    <strong>选择图片或 PDF</strong>
                    <p>可一次多选；图片或 PDF，单文件不超过 10MB，PDF 默认最多 5 页</p>
                  </div>
                  <el-icon class="upload-arrow"><Right /></el-icon>
                </div>
              </el-upload>
              <el-upload
                class="material-upload"
                action="#"
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*,.pdf"
                multiple
                directory
                :on-change="onFileChange">
                <div class="upload-zone folder-zone">
                  <div class="upload-icon"><el-icon><FolderOpened /></el-icon></div>
                  <div>
                    <strong>选择文件夹</strong>
                    <p>把一个学生的材料放在同一文件夹里，一次全部导入</p>
                  </div>
                  <el-icon class="upload-arrow"><Right /></el-icon>
                </div>
              </el-upload>
            </div>
            <div v-if="uploading" class="upload-tip">
              <el-icon class="is-loading"><Loading /></el-icon> 正在上传材料…
            </div>
          </el-form-item>

          <div class="form-divider"><span>材料清单</span><i></i></div>
          <div v-if="!materials.length" class="materials-empty">
            还没有材料。可以点上方「选择图片或 PDF」多选，或点「选择文件夹」整目录导入。
          </div>
          <div v-else class="material-list">
            <div
              v-for="item in materials"
              :key="item.id"
              class="material-item"
              :class="{ active: item.id === activeId }"
              @click="activeId = item.id">
              <el-icon class="mi-icon" :class="statusClass(item.status)">
                <Loading v-if="item.status === 'analyzing'" />
                <CircleCheckFilled v-else-if="item.status === 'done'" />
                <WarningFilled v-else-if="item.status === 'error'" />
                <Document v-else />
              </el-icon>
              <div class="mi-body">
                <div class="mi-name" :title="item.fileName">{{ item.fileName }}</div>
                <div class="mi-meta">
                  <span class="mi-status" :class="statusClass(item.status)">{{ statusText(item.status) }}</span>
                  <span v-if="item.status === 'done'">{{ ownershipText(item.result) }} · {{ item.result.scoreSuggestion == null ? '暂停分值建议' : `${item.result.scoreSuggestion} 分` }}</span>
                  <span v-else-if="item.status === 'error'" class="mi-error">{{ item.error }}</span>
                  <span v-if="item.submitted || item.savedDraft" class="mi-submitted">{{ item.savedDraft ? '已保存草稿' : '已申报' }}</span>
                  <span v-if="item.submitError" class="mi-error">{{ item.submitError }}</span>
                </div>
              </div>
              <el-button v-if="canApply && item.status === 'done' && !item.submitted && !item.savedDraft" link type="primary" :disabled="item.result?.ownership?.status === 'mismatch'" @click.stop="continueApplication(item)">{{ item.result?.ownership?.status === 'matched' ? '去申报' : '转人工填写' }}</el-button>
              <el-button link @click.stop="removeMaterial(item)">移除</el-button>
            </div>
          </div>
          <div v-if="materials.length" class="list-actions">
            <span class="list-summary">
              共 {{ materials.length }} 份 · 已识别 {{ doneCount }} 份<span v-if="totalScore"> · 建议合计 {{ totalScore }} 分</span><span v-if="submittedCount"> · 已申报 {{ submittedCount }} 份</span>
            </span>
            <span class="list-buttons">
              <el-button v-if="canApply" type="primary" size="small" :disabled="!submittable.length" @click="openBatchDialog">
                批量申报{{ submittable.length ? `（${submittable.length} 份）` : '' }}
              </el-button>
              <el-button link type="danger" @click="clearMaterials">清空</el-button>
            </span>
          </div>

          <div class="form-divider"><span>补充信息</span><i></i></div>
          <el-form-item label="优先匹配模块">
            <el-select v-model="form.moduleId" clearable filterable placeholder="AI 自动判断，也可手动指定" style="width:100%">
              <el-option v-for="module in modules" :key="module.id" :label="module.name" :value="module.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="成果标题">
            <el-input v-model="form.title" maxlength="200" placeholder="例如：全国大学生创新创业训练计划结项" />
          </el-form-item>
          <el-form-item label="补充说明">
            <el-input v-model="form.description" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="可补充赛事、时间、等级、成果等信息" />
          </el-form-item>
          </div>
          <div class="panel-footer review-actions">
            <el-button class="review-button" type="primary" size="large" :loading="reviewing" :disabled="!pendingCount" @click="handleReview">
              <el-icon><MagicStick /></el-icon> 开始 AI 分析
            </el-button>
            <span v-if="reviewing" class="review-hint">正在逐份分析，第 {{ analyzingIndex }} / {{ reviewingTotal }} 份…</span>
            <span v-else-if="pendingCount" class="review-hint">待分析 {{ pendingCount }} 份材料</span>
            <span v-else-if="materials.length" class="review-hint">全部分析完成</span>
          </div>
        </el-form>
      </section>

      <section class="card result-card" v-loading="reviewing">
          <div class="card-title">
            <span class="step-label">02</span>
            <span>AI 审核建议</span>
            <el-tag v-if="result" :type="result.mode === 'model' ? 'success' : 'warning'" size="small">
              {{ result.mode === 'model' ? '模型分析' : '规则降级' }}
            </el-tag>
            <el-tag v-else-if="materials.length" type="info" size="small">
              共 {{ materials.length }} 份 · 已识别 {{ doneCount }} 份
            </el-tag>
            <span v-if="current" class="card-caption current-name">{{ current.fileName }}</span>
          </div>
          <div class="panel-body result-body" :class="{ 'is-empty': !result }" tabindex="0" role="region" aria-label="AI 审核建议内容">
          <div v-if="!result" class="review-empty">
            <el-empty :image-size="108" :description="current?.status === 'error' ? '本次分析未完成，请重新分析' : materials.length ? '材料已就绪，开始 AI 分析后查看建议' : '上传材料后，审核建议将在这里展示'" />
            <p v-if="current?.status === 'error'" class="empty-hint">{{ current.error }}</p>
            <p v-else class="empty-hint">核对材料归属 · 提取成果信息 · 匹配申报模块</p>
          </div>
          <template v-else>
            <el-alert :type="ownershipAlertType(result)" :closable="false" show-icon class="mb-12"
              :title="`证书归属：${ownershipText(result)}`"
              :description="result.ownership?.message || '旧分析结果未核验证书归属，请重新分析或转人工核验。'" />
            <el-descriptions :column="1" size="small" border class="ownership-desc mb-12">
              <el-descriptions-item label="当前账号姓名">{{ result.ownership?.expectedName || '未获取' }}</el-descriptions-item>
              <el-descriptions-item label="材料获奖人">{{ recipientText(result) }}</el-descriptions-item>
            </el-descriptions>
            <el-alert v-if="result.scoreBasis" :type="result.scoreBasis.status === 'referenced' ? 'info' : 'warning'"
              :closable="false" class="mb-12" :title="result.scoreBasis.message" />
            <el-alert v-if="result.warning" type="warning" :closable="false" show-icon class="mb-12" :title="result.warning" />
            <div class="confidence-row">
              <span>模型自评置信度（不代表归属或真伪核验）</span>
              <el-progress :percentage="Math.round((result.confidence || 0) * 100)" :color="result.confidence >= .7 ? 'var(--el-color-success)' : 'var(--el-color-warning)'" />
            </div>
            <el-descriptions :column="2" size="small" border class="result-desc">
              <el-descriptions-item label="成果标题">{{ result.title || '未识别' }}</el-descriptions-item>
              <el-descriptions-item label="建议模块">{{ result.suggestedModuleName || '请手动选择' }}</el-descriptions-item>
              <el-descriptions-item label="建议分值">{{ result.scoreSuggestion == null ? '暂停建议，待人工核验' : `${result.scoreSuggestion} 分` }}</el-descriptions-item>
              <el-descriptions-item label="获奖等级">{{ levelText(result.awardLevel) }}</el-descriptions-item>
              <el-descriptions-item label="发生日期">{{ result.eventDate || '未识别' }}</el-descriptions-item>
              <el-descriptions-item label="证书编号">{{ result.certificateNo || '未识别' }}</el-descriptions-item>
            </el-descriptions>

            <div class="result-section">
              <div class="section-title">识别说明</div>
              <p class="desc-text">{{ result.description }}</p>
            </div>
            <div class="result-section">
              <div class="section-title">判定依据</div>
              <ul><li v-for="item in result.evidence" :key="item">{{ item }}</li></ul>
            </div>
            <div class="result-section" v-if="result.riskFlags?.length">
              <div class="section-title">风险提示</div>
              <el-tag v-for="flag in result.riskFlags" :key="`${flag.code}-${flag.label}`" type="warning" class="risk-tag">{{ flag.label }}</el-tag>
            </div>
            <AIReviewEvidence :key="current?.id" :review="result" />
            <el-alert type="info" :closable="false" :title="result.nextAction" />
          </template>
          </div>
            <div v-if="result" class="panel-footer result-actions">
              <el-button v-if="canApply" type="primary" :disabled="current?.submitted || current?.savedDraft || result.ownership?.status === 'mismatch'" @click="continueApplication(current)">{{ result.ownership?.status === 'matched' ? '带结果去申报' : '转人工填写与核验' }}</el-button>
              <el-button @click="reanalyze(current)">重新分析</el-button>
              <el-button v-if="current" link type="primary" @click="previewFile(current)">预览材料</el-button>
            </div>
      </section>
    </div>

    <el-dialog
      v-model="batchVisible"
      title="批量申报确认"
      width="min(660px, 94vw)"
      :close-on-click-modal="!batchSubmitting"
      :show-close="!batchSubmitting">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="mb-12"
        :title="`将按 AI 建议为 ${submittable.length} 份材料各生成一条加分申报，提交后进入班级管理员审批。`" />
      <el-table :data="submittable" size="small" max-height="320" class="batch-table">
        <el-table-column prop="fileName" label="材料" min-width="210" show-overflow-tooltip />
        <el-table-column label="建议模块" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.result.suggestedModuleName || '—' }}</template>
        </el-table-column>
        <el-table-column label="建议分值" width="90" align="right">
          <template #default="{ row }">{{ row.result.scoreSuggestion }} 分</template>
        </el-table-column>
        <el-table-column label="获奖等级" width="90">
          <template #default="{ row }">{{ levelText(row.result.awardLevel) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="blocked.length" class="dialog-blocked">
        <div class="blocked-title">以下 {{ blocked.length }} 份材料本次不会提交：</div>
        <ul>
          <li v-for="row in blocked" :key="row.item.id">
            <span class="blocked-name">{{ row.item.fileName }}</span>
            <span class="blocked-reason">{{ row.reason }}</span>
          </li>
        </ul>
        <div class="blocked-hint">归属不符请更换材料；无法核验请补充清晰证明或转人工填写；其他缺失信息可在申报页补齐。</div>
      </div>
      <p class="dialog-note">
        提交后如需调整，可在「我的申报」中撤回，或等审批结果；每份材料都会保留 AI 审核建议作为审批依据。
      </p>
      <template #footer>
        <span v-if="batchSubmitting" class="dialog-progress">
          正在提交第 {{ batchProgress.index }} / {{ batchProgress.total }} 份…
        </span>
        <el-button :disabled="batchSubmitting" @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSubmitting" @click="confirmBatchSubmit">确认提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  CircleCheckFilled, Document, FolderOpened, Loading,
  MagicStick, Right, Upload, WarningFilled
} from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import AIReviewEvidence from '@/components/AIReviewEvidence.vue';
import { createApplication, getMySemesters, uploadProof } from '@/api/applications';
import { listActiveModules } from '@/api/modules';
import { reviewMaterial } from '@/api/ai-material';
import { useUserStore } from '@/stores/user';
import { ROLE_GROUPS } from '@/constants/roles';

const router = useRouter();
const userStore = useUserStore();
const modules = ref([]);
const materials = ref([]);          // 材料清单：{ id, fileName, fileUrl, mimeType, size, status, result, error }
const activeId = ref(null);         // 当前查看详情的材料
const uploading = ref(false);
const reviewing = ref(false);
const analyzingIndex = ref(0);
const reviewingTotal = ref(0);
const semesters = ref([]);
const semesterId = ref(null);
const batchVisible = ref(false);
const batchSubmitting = ref(false);
const batchProgress = ref({ index: 0, total: 0 });
const form = reactive({ moduleId: null, title: '', description: '' });
const batchStorageKey = `xinggui.aiBatch.${userStore.userId}`;
function persistBatch() {
  try {
    sessionStorage.setItem(batchStorageKey, JSON.stringify({ materials: materials.value, activeId: activeId.value, form, semesterId: semesterId.value }));
  } catch (_) { /* 浏览器存储不可用时，仍允许继续处理当前材料。 */ }
}
watch([materials, activeId, form, semesterId], persistBatch, { deep: true });

const canApply = computed(() => ROLE_GROUPS.STUDENT_LIKE.includes(userStore.role));

const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BATCH = 30;      // 单次导入的材料上限
const CHUNK_SIZE = 10;     // 后端一次请求最多接收 10 个文件

let seq = 0;
let pending = [];
let flushTimer = null;

const current = computed(() => materials.value.find(m => m.id === activeId.value) || null);
const result = computed(() => current.value?.result || null);
const doneCount = computed(() => materials.value.filter(m => m.status === 'done').length);
const pendingCount = computed(() => materials.value.filter(m => m.status === 'ready' || m.status === 'error').length);
const totalScore = computed(() => {
  const sum = materials.value.reduce(
    (acc, m) => acc + (m.status === 'done' && m.result?.ownership?.status === 'matched' ? Number(m.result?.scoreSuggestion || 0) : 0), 0);
  return Math.round(sum * 10) / 10;
});
const moduleById = computed(() => new Map(modules.value.map(m => [Number(m.id), m])));
/** 提交前预检：模块必填项没凑齐的先不批量提交，避免提交后被打回 */
const readiness = (item) => {
  const status = item.result?.ownership?.status;
  if (status === 'mismatch') return '证书归属不符，请更换本人材料或联系老师核验';
  if (status !== 'matched') return '证书归属尚未核验，不能自动批量申报';
  if (item.result.scoreSuggestion == null) return '暂无分值建议，请人工填写';
  const mod = moduleById.value.get(Number(item.result?.suggestedModuleId));
  if (!item.result?.suggestedModuleId || !mod) return '没有匹配到申报模块';
  if (mod.requireCertificateNo && !item.result.certificateNo) return '该模块要求证书编号，AI 未识别到';
  if (mod.requireDescription && !item.result.description) return '该模块要求申报说明，AI 未生成';
  return '';
};
// 可批量申报：已识别 + 必填项齐全 + 还没提交过
const submittable = computed(() => materials.value.filter(
  m => m.status === 'done' && !m.submitted && !m.savedDraft && !readiness(m)));
// 需要手动补齐后再申报
const blocked = computed(() => materials.value
  .filter(m => m.status === 'done' && !m.submitted && !m.savedDraft && readiness(m))
  .map(m => ({ item: m, reason: readiness(m) })));
const submittedCount = computed(() => materials.value.filter(m => m.submitted).length);

const statusText = (status) => ({ ready: '待分析', analyzing: '分析中', done: '已识别', error: '失败' }[status] || status);
const statusClass = (status) => `is-${status}`;
const ownershipText = (review) => ({ matched: '身份信息一致，仍需复核', mismatch: '归属不符', unverified: '无法核验' }[review?.ownership?.status] || '尚未核验');
const ownershipAlertType = (review) => ({ matched: 'info', mismatch: 'error' }[review?.ownership?.status] || 'warning');
const recipientText = (review) => review?.ownership?.recognizedRecipients?.map(person => `${person.name || '姓名不清晰'}${person.studentNo ? `（学号：${person.studentNo}）` : ''}`).join('、') || '未读取到明确获奖人';

/** el-upload 在多选 / 选目录时会对每个文件各触发一次 change，这里合并成一批一起上传 */
const onFileChange = (uploadFile) => {
  if (!uploadFile?.raw) return;
  pending.push(uploadFile.raw);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPending, 60);
};

async function flushPending() {
  const files = pending.splice(0);
  if (!files.length) return;

  let skipped = 0;
  const accepted = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext) || file.size > MAX_FILE_SIZE) { skipped++; continue; }
    if (materials.value.some(m => m.fileName === file.name && m.size === file.size)) { skipped++; continue; }
    accepted.push(file);
  }
  if (materials.value.length + accepted.length > MAX_BATCH) {
    skipped += materials.value.length + accepted.length - MAX_BATCH;
    accepted.length = Math.max(0, MAX_BATCH - materials.value.length);
  }
  if (!accepted.length) {
    ElMessage.warning(skipped ? `已跳过 ${skipped} 个文件（格式不支持、超过 10MB 或重复）` : '没有可上传的文件');
    return;
  }

  uploading.value = true;
  let added = 0;
  let failed = 0;
  try {
    for (let i = 0; i < accepted.length; i += CHUNK_SIZE) {
      const chunk = accepted.slice(i, i + CHUNK_SIZE);
      const body = new FormData();
      chunk.forEach(file => body.append('photos', file));
      try {
        const response = await uploadProof(body);
        const urls = response?.urls || [];
        chunk.forEach((file, index) => {
          if (!urls[index]) { failed++; return; }
          materials.value.push({
            id: ++seq,
            fileName: file.name,
            fileUrl: urls[index],
            mimeType: file.type || '',
            size: file.size,
            status: 'ready',
            result: null,
            error: ''
          });
          added++;
        });
      } catch (_error) {
        failed += chunk.length;
      }
    }
  } finally {
    uploading.value = false;
  }

  if (!activeId.value && materials.value.length) activeId.value = materials.value[0].id;

  const parts = [];
  if (added) parts.push(`已导入 ${added} 份材料`);
  if (skipped) parts.push(`跳过 ${skipped} 个`);
  if (failed) parts.push(`上传失败 ${failed} 份`);
  if (parts.length) failed ? ElMessage.warning(parts.join('，')) : ElMessage.success(parts.join('，'));
}

const handleReview = async () => {
  const queue = materials.value.filter(m => m.status === 'ready' || m.status === 'error');
  if (!queue.length) return;
  const single = materials.value.length === 1;   // 只有一份材料时，补充信息里的标题才跟着传给模型
  reviewing.value = true;
  reviewingTotal.value = queue.length;
  analyzingIndex.value = 0;
  try {
    for (const item of queue) {
      analyzingIndex.value += 1;
      item.status = 'analyzing';
      item.error = '';
      try {
        item.result = await reviewMaterial({
          fileUrl: item.fileUrl,
          fileName: item.fileName,
          mimeType: item.mimeType,
          moduleId: form.moduleId,
          title: single ? form.title : '',
          description: form.description
        });
        item.status = 'done';
        if (!activeId.value) activeId.value = item.id;
      } catch (error) {
        item.status = 'error';
        item.error = error?.message || '分析失败';
      }
    }
  } finally {
    reviewing.value = false;
    reviewingTotal.value = 0;
    analyzingIndex.value = 0;
  }
  const failedCount = materials.value.filter(m => m.status === 'error').length;
  if (failedCount) ElMessage.warning(`${failedCount} 份材料分析失败，可在材料清单里单独重新分析`);
  else ElMessage.success(`已完成 ${queue.length} 份材料的 AI 分析`);
};

const reanalyze = async (item) => {
  if (!item) return;
  item.status = 'ready';
  item.result = null;
  activeId.value = item.id;
  await handleReview();
};

const removeMaterial = (item) => {
  const index = materials.value.findIndex(m => m.id === item.id);
  if (index < 0) return;
  materials.value.splice(index, 1);
  if (activeId.value === item.id) activeId.value = materials.value[0]?.id || null;
};

const clearMaterials = () => {
  materials.value = [];
  activeId.value = null;
  ElMessage.success('已清空材料清单');
};

const levelText = (level) => ({
  international: '国际级', national: '国家级', provincial: '省部级', school: '校级', college: '院系级', other: '其他'
}[level] || '未识别');

const previewFile = (item) => {
  const url = (item || current.value)?.fileUrl;
  if (url) window.open(url, '_blank');
};

const continueApplication = (item) => {
  if (!canApply.value) return;
  const target = item || current.value;
  if (!target?.result) return;
  if (target.submitted || target.savedDraft) return;
  if (target.result.ownership?.status === 'mismatch') {
    ElMessage.error('证书归属不符，不能带入申报。请更换本人材料；如识别有误请联系老师核验。');
    return;
  }
  if (target.result.ownership?.status !== 'matched') {
    ElMessage.warning('证书归属未确认，将转为人工填写，最终由教师核验。');
  }
  persistBatch();
  sessionStorage.setItem(`xinggui.aiReview.${userStore.userId}`, JSON.stringify({
    ...target.result,
    fileUrl: target.fileUrl,
    fileName: target.fileName,
    sourceMaterialId: target.id
  }));
  router.push('/apply?from=ai');
};

/** 把一份 AI 审核结果转成申报单载荷（字段与申报页提交时完全一致） */
const buildPayload = (item) => {
  const level = item.result.awardLevel || null;
  return {
    semesterId: semesterId.value,
    moduleId: item.result.suggestedModuleId,
    title: item.result.title || item.fileName,
    eventDate: item.result.eventDate || undefined,
    score: item.result.scoreSuggestion,
    level,
    // 等级选「其他」时后端要求补充说明，这里用 AI 的成果说明兜底
    otherDescription: level === 'other'
      ? String(item.result.description || item.result.title || item.fileName).slice(0, 200)
      : null,
    description: item.result.description || undefined,
    certificateNo: item.result.certificateNo || null,
    proofUrl: item.fileUrl,
    extraData: { aiReview: { ...item.result, fileUrl: item.fileUrl, fileName: item.fileName } }
  };
};

const openBatchDialog = () => {
  if (!submittable.value.length) {
    ElMessage.warning('没有可提交的材料：需要先完成分析并匹配到申报模块');
    return;
  }
  if (!semesterId.value) {
    ElMessage.warning('当前没有开放申报的学期，请联系学院管理员开启后再提交');
    return;
  }
  batchVisible.value = true;
};

const confirmBatchSubmit = async () => {
  const list = submittable.value.slice();
  if (!list.length) { batchVisible.value = false; return; }
  batchSubmitting.value = true;
  batchProgress.value = { index: 0, total: list.length };
  let ok = 0;
  try {
    for (const item of list) {
      batchProgress.value = { index: batchProgress.value.index + 1, total: list.length };
      item.submitError = '';
      try {
        await createApplication(buildPayload(item));
        item.submitted = true;
        ok += 1;
      } catch (error) {
        item.submitError = error?.message || '提交失败';
      }
    }
  } finally {
    batchSubmitting.value = false;
  }
  const failed = list.length - ok;
  if (failed) {
    ElMessage.warning(`已提交 ${ok} 份，${failed} 份失败，可在材料清单里查看原因`);
  } else {
    ElMessage.success(`已提交 ${ok} 份加分申报，可在「我的申报」查看审批进度`);
    batchVisible.value = false;
  }
};

onMounted(async () => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(batchStorageKey) || 'null');
    if (Array.isArray(stored?.materials)) {
      materials.value = stored.materials.slice(0, MAX_BATCH).filter(item => item?.fileUrl?.startsWith('/uploads/'))
        .map(item => ({ ...item, status: item.status === 'analyzing' ? 'ready' : item.status }));
      seq = Math.max(0, ...materials.value.map(item => Number(item.id) || 0));
      activeId.value = stored.activeId;
      Object.assign(form, stored.form || {});
      semesterId.value = stored.semesterId || null;
    }
  } catch (_) { sessionStorage.removeItem(batchStorageKey); }
  try {
    const response = await listActiveModules();
    modules.value = Array.isArray(response) ? response : (response?.list || []);
  } catch (_error) {}
  if (canApply.value) {
    try {
      const list = await getMySemesters();
      semesters.value = Array.isArray(list) ? list : (list?.list || []);
      const started = semesters.value.find(s => s.applyStatus === 'started');
      if (!semesters.value.some(item => item.id === semesterId.value)) semesterId.value = started?.id || null;
    } catch (_error) {}
  }
});
</script>

<style lang="scss" scoped>
.ai-review-page { padding-bottom: 8px; }
.review-grid { display:grid; grid-template-columns:minmax(340px, .9fr) minmax(0, 1.1fr); align-items:stretch; gap:18px; margin-top:18px; height:clamp(480px, calc(100dvh - 350px), 840px); }
.form-card, .result-card { display:flex; flex-direction:column; min-width:0; min-height:0; padding:0; overflow:hidden; }
.review-grid .card-title { display:flex; align-items:center; justify-content:flex-start; gap:10px; flex:none; min-height:66px; padding:16px 20px; margin:0; }
.card-title > span:not(.card-caption), .card-title > .el-tag { flex-shrink:0; white-space:nowrap; }
.panel-body { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:20px; scrollbar-gutter:stable; scroll-padding-block:20px; }
.panel-body:focus-visible { outline:2px solid var(--el-color-primary-light-5); outline-offset:-3px; }
.review-form { display:flex; flex-direction:column; flex:1; min-height:0; }
.panel-footer { flex:none; display:flex; align-items:center; flex-wrap:wrap; gap:10px; min-height:78px; padding:16px 20px; border-top:1px solid $border-lighter; background:$bg-color; }
.panel-footer :deep(.el-button + .el-button) { margin-left:0; }
.result-body.is-empty { display:flex; align-items:center; justify-content:center; }
.review-empty { max-width:360px; text-align:center; }
.empty-hint { margin:-20px 0 24px; color:#8a9bae; font-size:12px; line-height:1.8; overflow-wrap:anywhere; }
.result-body > .ai-evidence { margin-bottom:16px; }
.card-caption { margin-left:auto; color:#9AA8BA; font-size:12px; font-weight:400; }
.step-label { color:var(--el-color-primary); font-size:11px; font-weight:800; letter-spacing:.12em; }
.form-card :deep(.el-form-item) { margin-bottom:16px; }
.form-card :deep(.el-form-item__label) { color:$text-regular; font-size:13px; font-weight:600; padding-bottom:6px; }
.material-upload { display:block; width:100%; }
.material-upload :deep(.el-upload) { display:block; width:100%; }
.upload-zone { display:flex; align-items:center; gap:12px; width:100%; min-height:72px; padding:12px 14px; border:1px dashed var(--el-color-primary-light-5); border-radius:12px; background:var(--el-color-primary-light-9); text-align:left; transition:.2s ease; }
.upload-zone:hover { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.upload-icon { width:38px; height:38px; display:flex; align-items:center; justify-content:center; flex:none; border-radius:10px; color:var(--el-color-primary); background:var(--el-color-primary-light-8); font-size:19px; }
.upload-zone strong { color:$text-primary; font-size:14px; }
.upload-zone p { margin:4px 0 0; color:#8A9BAE; font-size:11px; line-height:1.45; }
.upload-arrow { margin-left:auto; color:var(--el-color-primary); }
.upload-options { display:flex; flex-direction:column; gap:10px; width:100%; }
.folder-zone { border-style:solid; border-color:$border-light; background:$bg-color; }
.upload-tip { display:flex; align-items:center; gap:6px; margin-top:10px; color:#6B7A90; font-size:12px; }
.materials-empty { padding:12px 14px; border:1px dashed #E1E8F1; border-radius:10px; color:#93A1B3; font-size:12px; line-height:1.6; background:#FAFCFF; }
.material-list { display:flex; flex-direction:column; gap:8px; max-height:240px; overflow-y:auto; padding:2px; }
.material-item { flex-shrink:0; display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid $border-lighter; border-radius:10px; background:#fff; cursor:pointer; transition:.16s ease; }
.material-item:hover { border-color:var(--el-color-primary-light-5); background:var(--el-color-primary-light-9); }
.material-item.active { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); box-shadow:0 0 0 2px var(--el-color-primary-light-8); }
.mi-icon { flex:none; font-size:16px; color:#9AA8BA; }
.mi-icon.is-done { color:var(--el-color-success); }
.mi-icon.is-error { color:var(--el-color-danger); }
.mi-icon.is-analyzing { color:var(--el-color-primary); animation:mi-spin 1s linear infinite; }
@keyframes mi-spin { to { transform:rotate(360deg); } }
.mi-body { flex:1; min-width:0; }
.mi-name { font-size:13px; color:#2B3A4F; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mi-meta { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin-top:3px; font-size:11.5px; color:#7C899D; }
.mi-status { padding:0 6px; border-radius:6px; background:#EEF2F7; color:#7C899D; white-space:nowrap; }
.mi-status.is-done { background:var(--el-color-success-light-9); color:var(--el-color-success-dark-2); }
.mi-status.is-analyzing { background:var(--el-color-primary-light-9); color:var(--el-color-primary); }
.mi-status.is-error { background:var(--el-color-danger-light-9); color:var(--el-color-danger-dark-2); }
.mi-error { color:var(--el-color-danger); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.list-actions { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin:10px 0 2px; font-size:12px; color:#7C899D; }
.list-summary { color:#5B6B7C; }
.list-buttons { display:flex; align-items:center; gap:6px; }
.mi-submitted { padding:0 6px; border-radius:6px; background:var(--el-color-success-light-9); color:var(--el-color-success-dark-2); white-space:nowrap; }
.dialog-note { margin:10px 0 0; font-size:12px; color:#7C899D; line-height:1.6; }
.dialog-progress { float:left; font-size:12px; color:#5B6B7C; line-height:32px; }
.batch-table :deep(.el-table__cell) { padding:6px 0; }
.dialog-blocked { margin-top:12px; padding:10px 12px; border:1px solid #F0E0BC; border-radius:8px; background:#FDF8EC; }
.blocked-title { font-size:12px; font-weight:600; color:#8A6A1F; }
.dialog-blocked ul { margin:6px 0 0; padding-left:16px; }
.dialog-blocked li { font-size:12px; color:#6B5416; line-height:1.7; }
.blocked-name { margin-right:8px; }
.blocked-reason { color:#A8730F; }
.blocked-hint { margin-top:6px; font-size:12px; color:#8A6A1F; }
.review-actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.review-hint { font-size:12px; color:#7C899D; }
.current-name { min-width:0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.form-divider { display:flex; align-items:center; gap:10px; margin:20px 0 14px; color:#93A1B3; font-size:11px; letter-spacing:.08em; }
.form-divider i { height:1px; flex:1; background:#E7EDF4; }
.confidence-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; margin:0 0 16px; color:$text-secondary; font-size:12px; }
.confidence-row :deep(.el-progress) { flex:1; min-width:120px; }
.result-section { margin-top:18px; }
.section-title { margin-bottom:8px; font-weight:600; color:$text-primary; }
.result-section ul { margin:0; padding-left:20px; color:$text-regular; line-height:1.8; }
.risk-tag { margin:0 8px 8px 0; max-width:100%; height:auto; white-space:normal; padding:4px 10px; line-height:1.6; }
.risk-tag :deep(.el-tag__content) { white-space:normal; overflow-wrap:anywhere; }
.ownership-desc :deep(.el-descriptions__label) { width:104px; white-space:nowrap; color:#6b7a90; }
.ownership-desc :deep(.el-descriptions__content) { line-height:1.7; overflow-wrap:anywhere; }
.ownership-desc :deep(.el-descriptions__cell) { padding:8px 10px; }
/* 审核结果字段表：两列紧凑排布，避免每个字段独占一行把卡片拉得很长 */
.result-desc { margin-top:2px; }
.result-desc :deep(.el-descriptions__label) { white-space:nowrap; color:#6B7A90; }
.result-desc :deep(.el-descriptions__content) { line-height:1.55; word-break:break-word; }
.result-desc :deep(.el-descriptions__cell) { padding:6px 10px; }
.desc-text { margin:0; color:$text-regular; line-height:1.7; word-break:break-word; }
.review-button { min-width:168px; height:42px; border-radius:10px; }
.mb-12 { margin-bottom:12px; }

@media (max-width: 1180px) {
  .review-grid { grid-template-columns:1fr; height:auto; }
  .panel-body { overflow:visible; scrollbar-gutter:auto; }
  .result-body.is-empty { min-height:300px; }
}
@media (max-width: 600px) {
  .review-grid { gap:12px; margin-top:12px; }
  .card-caption { display:none; }
  .review-grid .card-title { padding:14px; min-height:58px; }
  .panel-body, .panel-footer { padding:16px 14px; }
  .upload-zone p { max-width:190px; }
  .confidence-row { align-items:flex-start; flex-direction:column; gap:6px; }
  .confidence-row :deep(.el-progress) { width:100%; }
  .result-desc :deep(.el-descriptions__table), .result-desc :deep(tbody),
  .result-desc :deep(.el-descriptions__row) { display:block; }
  .result-desc :deep(.el-descriptions__cell) { display:block; width:100%; }
  .result-actions > .el-button:first-child { flex-basis:100%; }
}
@media (prefers-reduced-motion: reduce) {
  .upload-zone, .material-item { transition:none; }
  .upload-zone:hover { transform:none; }
}
</style>
