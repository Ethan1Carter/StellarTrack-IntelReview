<template>
  <div class="ai-review-page">
    <WorkspaceHero
      eyebrow="AI MATERIAL REVIEW"
      title="AI 材料审核中心"
      description="上传成长证明材料，AI 自动提取信息、匹配五育模块并给出可解释的审核建议。最终结果仍由人工复核确认。"
    />

    <div class="review-grid">
      <section class="card form-card">
        <div class="card-title">
          <span class="step-label">01</span>
          <span>上传与补充材料</span>
          <span class="card-caption">先上传，再分析</span>
        </div>
        <el-form label-position="top">
          <el-form-item label="证明材料">
            <el-upload
              class="material-upload"
              action="#"
              :auto-upload="false"
              :show-file-list="false"
              accept="image/*,.pdf"
              :on-change="onFileChange">
              <div class="upload-zone">
                <div class="upload-icon"><el-icon><Upload /></el-icon></div>
                <div>
                  <strong>选择图片或 PDF</strong>
                  <p>支持 JPG、PNG、WEBP、PDF，单文件不超过 10MB</p>
                </div>
                <el-icon class="upload-arrow"><Right /></el-icon>
              </div>
            </el-upload>
            <div v-if="fileUrl" class="file-chip">
              <el-icon><DocumentChecked /></el-icon>
              <span>{{ fileName }}</span>
              <el-button link type="primary" @click="previewFile">预览</el-button>
            </div>
          </el-form-item>

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
          <el-button class="review-button" type="primary" size="large" :loading="reviewing" :disabled="!fileUrl" @click="handleReview">
            <el-icon><MagicStick /></el-icon> 开始 AI 分析
          </el-button>
        </el-form>
      </section>

      <section class="card result-card" v-loading="reviewing">
          <div class="card-title">
            <span class="step-label">02</span>
            <span>AI 审核建议</span>
            <el-tag v-if="result" :type="result.mode === 'model' ? 'success' : 'warning'" size="small">
              {{ result.mode === 'model' ? '模型分析' : '规则降级' }}
            </el-tag>
          </div>
          <el-empty v-if="!result" description="上传材料后开始分析" />
          <template v-else>
            <el-alert v-if="result.warning" type="warning" :closable="false" show-icon class="mb-12" :title="result.warning" />
            <div class="confidence-row">
              <span>综合置信度</span>
              <el-progress :percentage="Math.round((result.confidence || 0) * 100)" :color="result.confidence >= .7 ? '#67C23A' : '#E6A23C'" />
            </div>
            <el-descriptions :column="1" border>
              <el-descriptions-item label="成果标题">{{ result.title || '未识别' }}</el-descriptions-item>
              <el-descriptions-item label="建议模块">{{ result.suggestedModuleName || '请手动选择' }}</el-descriptions-item>
              <el-descriptions-item label="建议分值">{{ result.scoreSuggestion }} 分</el-descriptions-item>
              <el-descriptions-item label="获奖等级">{{ levelText(result.awardLevel) }}</el-descriptions-item>
              <el-descriptions-item label="发生日期">{{ result.eventDate || '未识别' }}</el-descriptions-item>
              <el-descriptions-item label="证书编号">{{ result.certificateNo || '未识别' }}</el-descriptions-item>
              <el-descriptions-item label="识别说明">{{ result.description }}</el-descriptions-item>
            </el-descriptions>

            <div class="result-section">
              <div class="section-title">判定依据</div>
              <ul><li v-for="item in result.evidence" :key="item">{{ item }}</li></ul>
            </div>
            <div class="result-section" v-if="result.riskFlags?.length">
              <div class="section-title">风险提示</div>
              <el-tag v-for="flag in result.riskFlags" :key="`${flag.code}-${flag.label}`" type="warning" class="risk-tag">{{ flag.label }}</el-tag>
            </div>
            <el-alert type="info" :closable="false" :title="result.nextAction" />
            <div class="result-actions">
              <el-button type="primary" @click="continueApplication">带结果去申报</el-button>
              <el-button @click="result = null">重新分析</el-button>
            </div>
          </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { DocumentChecked, MagicStick, Upload, Right } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { uploadProof } from '@/api/applications';
import { listActiveModules } from '@/api/modules';
import { reviewMaterial } from '@/api/ai-material';

const router = useRouter();
const modules = ref([]);
const fileUrl = ref('');
const fileName = ref('');
const fileMimeType = ref('');
const uploading = ref(false);
const reviewing = ref(false);
const result = ref(null);
const form = reactive({ moduleId: null, title: '', description: '' });

const onFileChange = async (uploadFile) => {
  if (!uploadFile.raw) return;
  uploading.value = true;
  try {
    const body = new FormData();
    body.append('photos', uploadFile.raw);
    const response = await uploadProof(body);
    fileUrl.value = response?.urls?.[0] || '';
    fileName.value = uploadFile.name;
    fileMimeType.value = uploadFile.raw.type || '';
    result.value = null;
    if (!fileUrl.value) throw new Error('上传返回数据异常');
    ElMessage.success('材料上传成功');
  } catch (error) {
    ElMessage.error(error.message || '材料上传失败');
  } finally {
    uploading.value = false;
  }
};

const handleReview = async () => {
  reviewing.value = true;
  try {
    result.value = await reviewMaterial({
      fileUrl: fileUrl.value,
      fileName: fileName.value,
      mimeType: fileMimeType.value,
      moduleId: form.moduleId,
      title: form.title,
      description: form.description
    });
  } catch (_error) {
    result.value = null;
  } finally {
    reviewing.value = false;
  }
};

const levelText = (level) => ({
  international: '国际级', national: '国家级', provincial: '省部级', school: '校级', college: '院系级', other: '其他'
}[level] || '未识别');

const previewFile = () => { if (fileUrl.value) window.open(fileUrl.value, '_blank'); };

const continueApplication = () => {
  sessionStorage.setItem('xinggui.aiReview', JSON.stringify({
    ...result.value,
    fileUrl: fileUrl.value,
    fileName: fileName.value
  }));
  router.push('/apply?from=ai');
};

onMounted(async () => {
  try {
    const response = await listActiveModules();
    modules.value = Array.isArray(response) ? response : (response?.list || []);
  } catch (_error) {}
});
</script>

<style lang="scss" scoped>
.ai-review-page { padding-bottom: 34px; }
.review-grid { display:grid; grid-template-columns:minmax(360px, .82fr) minmax(0, 1.18fr); align-items:start; gap:18px; margin-top:18px; }
.form-card, .result-card { min-width:0; padding-bottom:24px; }
.card-title { display:flex; align-items:center; justify-content:flex-start; gap:10px; }
.card-caption { margin-left:auto; color:#9AA8BA; font-size:12px; font-weight:400; }
.step-label { color:#2B7AC2; font-size:11px; font-weight:800; letter-spacing:.12em; }
.form-card :deep(.el-form) { padding:0 20px; }
.form-card :deep(.el-form-item) { margin-bottom:16px; }
.form-card :deep(.el-form-item__label) { color:#53657B; font-size:13px; font-weight:600; padding-bottom:6px; }
.material-upload { display:block; width:100%; }
.upload-zone { display:flex; align-items:center; gap:12px; width:100%; min-height:72px; padding:12px 14px; border:1px dashed #A9C9E8; border-radius:12px; background:linear-gradient(135deg,#F7FBFF,#F1F7FE); text-align:left; transition:.2s ease; }
.upload-zone:hover { border-color:#4B9DE0; background:#EEF7FF; transform:translateY(-1px); }
.upload-icon { width:38px; height:38px; display:flex; align-items:center; justify-content:center; flex:none; border-radius:10px; color:#2B84CE; background:#DDEFFF; font-size:19px; }
.upload-zone strong { color:#24527C; font-size:14px; }
.upload-zone p { margin:4px 0 0; color:#8A9BAE; font-size:11px; line-height:1.45; }
.upload-arrow { margin-left:auto; color:#6C9BC4; }
.form-divider { display:flex; align-items:center; gap:10px; margin:2px 0 14px; color:#93A1B3; font-size:11px; letter-spacing:.08em; }
.form-divider i { height:1px; flex:1; background:#E7EDF4; }
.file-chip { display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px 12px; border:1px solid #dcdfe6; border-radius:8px; color:#303133; }
.file-chip span { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.confidence-row { display:flex; align-items:center; gap:14px; margin:0 0 16px; color:#606266; font-size:13px; }
.confidence-row :deep(.el-progress) { flex:1; }
.result-section { margin-top:18px; }
.section-title { margin-bottom:8px; font-weight:600; color:#303133; }
.result-section ul { margin:0; padding-left:20px; color:#606266; line-height:1.8; }
.risk-tag { margin:0 8px 8px 0; }
.result-actions { margin-top:20px; display:flex; gap:10px; }
.review-button { min-width:168px; height:42px; border-radius:11px; }
.mb-12 { margin-bottom:12px; }

@media (max-width: 980px) {
  .review-grid { grid-template-columns:1fr; }
  .result-card { min-height:360px; }
}
@media (max-width: 600px) {
  .review-grid { gap:12px; margin-top:12px; }
  .card-caption { display:none; }
  .form-card :deep(.el-form) { padding:0 14px; }
  .upload-zone p { max-width:190px; }
  .confidence-row { align-items:flex-start; flex-direction:column; gap:6px; }
}
</style>
