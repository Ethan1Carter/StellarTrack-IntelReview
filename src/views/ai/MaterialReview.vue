<template>
  <div class="ai-review-page">
    <WorkspaceHero
      eyebrow="AI MATERIAL REVIEW"
      title="AI 材料审核中心"
      description="上传成长证明材料，AI 自动提取信息、匹配五育模块并给出可解释的审核建议。最终结果仍由人工复核确认。"
    />

    <el-row :gutter="16">
      <el-col :xs="24" :lg="10">
        <div class="card form-card">
          <div class="card-title">1. 上传与补充材料</div>
          <el-form label-position="top">
            <el-form-item label="证明材料">
              <el-upload
                action="#"
                :auto-upload="false"
                :show-file-list="false"
                accept="image/*,.pdf"
                :on-change="onFileChange">
                <el-button type="primary" plain :loading="uploading">
                  <el-icon><Upload /></el-icon> 选择图片或 PDF
                </el-button>
              </el-upload>
              <div v-if="fileUrl" class="file-chip">
                <el-icon><DocumentChecked /></el-icon>
                <span>{{ fileName }}</span>
                <el-button link type="primary" @click="previewFile">预览</el-button>
              </div>
              <div class="tip">支持 JPG、PNG、WEBP、PDF，单文件不超过 10MB。</div>
            </el-form-item>

            <el-form-item label="优先匹配模块">
              <el-select v-model="form.moduleId" clearable filterable placeholder="AI 自动判断，也可手动指定" style="width:100%">
                <el-option v-for="module in modules" :key="module.id" :label="module.name" :value="module.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="成果标题">
              <el-input v-model="form.title" maxlength="200" placeholder="可选，例如：全国大学生创新创业训练计划结项" />
            </el-form-item>
            <el-form-item label="补充说明">
              <el-input v-model="form.description" type="textarea" :rows="5" maxlength="500" show-word-limit placeholder="可补充赛事、时间、等级、成果等信息" />
            </el-form-item>
            <el-button type="primary" size="large" :loading="reviewing" :disabled="!fileUrl" @click="handleReview">
              <el-icon><MagicStick /></el-icon> 开始 AI 分析
            </el-button>
          </el-form>
        </div>
      </el-col>

      <el-col :xs="24" :lg="14">
        <div class="card result-card" v-loading="reviewing">
          <div class="card-title">
            2. AI 审核建议
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
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { DocumentChecked, MagicStick, Upload } from '@element-plus/icons-vue';
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
.ai-review-page { padding-bottom: 20px; }
.form-card, .result-card { min-height: 560px; }
.card-title { display:flex; align-items:center; gap:10px; }
.tip { color:#909399; font-size:12px; margin-top:8px; }
.file-chip { display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px 12px; border:1px solid #dcdfe6; border-radius:8px; color:#303133; }
.file-chip span { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.confidence-row { display:flex; align-items:center; gap:14px; margin:0 0 16px; color:#606266; font-size:13px; }
.confidence-row :deep(.el-progress) { flex:1; }
.result-section { margin-top:18px; }
.section-title { margin-bottom:8px; font-weight:600; color:#303133; }
.result-section ul { margin:0; padding-left:20px; color:#606266; line-height:1.8; }
.risk-tag { margin:0 8px 8px 0; }
.result-actions { margin-top:20px; display:flex; gap:10px; }
.mb-12 { margin-bottom:12px; }
</style>
