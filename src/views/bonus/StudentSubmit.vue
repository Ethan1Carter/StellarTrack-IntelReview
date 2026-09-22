<template>
  <div class="bonus-submit">
    <WorkspaceHero
      eyebrow="LEGACY BONUS ENTRY"
      title="历史加分申请"
      description="用于兼容历史加分流程；新申请建议使用统一的“申报加分”入口，审批轨迹更完整。"
    >
      <template #actions><el-button @click="$router.push('/apply')">前往统一申报</el-button></template>
    </WorkspaceHero>

    <el-card class="form-card" shadow="never">
      <el-alert
        v-if="!semesterOpen"
        type="warning" show-icon :closable="false"
        title="当前没有处于开放申报状态的学期"
        description="请联系学院管理员开启申报学期，否则无法提交。" />
      <el-alert
        v-else-if="openSemesterText"
        type="success" show-icon :closable="false"
        :title="`本次申请将计入开放学期：${openSemesterText}`" />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" style="max-width:760px; margin-top:16px;">
        <el-form-item label="加分项" prop="moduleName">
          <el-select
            v-model="form.moduleName"
            filterable allow-create default-first-option
            placeholder="选择或输入加分项名称（如：学科竞赛获奖）"
            style="width:100%">
            <el-option v-for="m in modules" :key="m.id" :label="m.name" :value="m.name" />
          </el-select>
        </el-form-item>

        <el-form-item label="加分类别" prop="category">
          <el-input v-model="form.category" maxlength="50" placeholder="选填，如：学术科技、文体活动、志愿服务" />
        </el-form-item>

        <el-form-item label="五育归属">
          <el-select
            v-model="form.pillar"
            placeholder="留空则由系统自动识别"
            style="width:100%"
            clearable>
            <el-option label="系统自动识别（推荐）" value="" />
            <el-option v-for="p in pillars" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
          <span class="muted" style="margin-left:10px;">系统将按加分项/类别关键词归入 德育·智育·体育·美育·劳育，您也可手动指定</span>
        </el-form-item>

        <el-form-item label="申请分值" prop="score">
          <el-input-number v-model="form.score" :min="0.5" :max="200" :step="0.5" :precision="2" />
          <span class="muted" style="margin-left:10px;">分（上限 200）</span>
        </el-form-item>

        <el-form-item label="事件发生日期" prop="eventDate">
          <el-date-picker v-model="form.eventDate" type="date" value-format="YYYY-MM-DD" placeholder="选填" style="width:100%" />
        </el-form-item>

        <el-form-item label="说明描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="简要描述加分事由、参与情况或成果" />
        </el-form-item>

        <el-form-item label="证明材料">
          <el-upload
            action="#"
            :auto-upload="false"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
            list-type="picture-card"
            multiple
            :limit="10"
            accept="image/*,.pdf"
            :file-list="fileList">
            <el-icon><Plus /></el-icon>
            <template #file="{ file }">
              <div class="up-item">
                <img v-if="isImg(file.url || file.raw)" :src="file.url" class="up-thumb" />
                <div v-else class="up-pdf"><el-icon size="28"><Document /></el-icon></div>
                <span class="up-actions">
                  <el-icon v-if="file.url" @click="previewFile(file)"><ZoomIn /></el-icon>
                  <el-icon @click="removeFile(file)"><Delete /></el-icon>
                </span>
              </div>
            </template>
          </el-upload>
          <div class="muted" style="width:100%; margin-top:6px;">支持图片/PDF，最多10个；佐证材料越充分越容易通过审批</div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" :disabled="!semesterOpen" @click="submit">提交申请</el-button>
          <el-button size="large" @click="resetForm">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-dialog v-model="detailVisible" title="提交结果" width="520px" @close="afterClose">
      <el-result icon="success" :title="resultTitle" :sub-title="resultDesc">
        <template #extra>
          <el-button type="primary" @click="goMy">查看我的申报</el-button>
          <el-button @click="resetForm(); detailVisible = false">再提交一条</el-button>
        </template>
      </el-result>
    </el-dialog>

    <el-dialog v-model="previewVisible" title="预览" width="720px">
      <img v-if="previewUrl && isImg(previewUrl)" :src="previewUrl" style="width:100%" />
      <iframe v-else-if="previewUrl" :src="previewUrl" style="width:100%; height:70vh;" frameborder="0" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Promotion, Plus, Document, ZoomIn, Delete } from '@element-plus/icons-vue';
import { submitBonus, uploadBonusProof } from '@/api/bonus';
import { listActiveModules } from '@/api/modules';
import { PILLARS } from '@/utils/pillarMap';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const router = useRouter();
const formRef = ref();
const modules = ref([]);
const pillars = PILLARS;
const semesterOpen = ref(true);
const openSemesterText = ref('');
const submitting = ref(false);
const fileList = ref([]);
const uploadedUrls = ref([]);
const detailVisible = ref(false);
const previewVisible = ref(false);
const previewUrl = ref('');
const resultTitle = ref('');
const resultDesc = ref('');

const form = reactive({
  moduleName: '',
  category: '',
  pillar: '',
  score: 1,
  eventDate: '',
  description: ''
});

const rules = {
  moduleName: [{ required: true, message: '请填写加分项名称', trigger: 'blur' }],
  score: [{ required: true, message: '请填写申请分值', trigger: 'blur' }]
};

const isImg = (url) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url || '');
const previewFile = (file) => { previewUrl.value = file.url; previewVisible.value = true; };

const onFileChange = async (uploadFile) => {
  try {
    const fd = new FormData();
    fd.append('photos', uploadFile.raw);
    const res = await uploadBonusProof(fd);
    const url = res?.urls?.[0];
    if (!url) throw new Error('上传返回异常');
    uploadedUrls.value.push(url);
    uploadFile.url = url;
    ElMessage.success(`上传 ${uploadFile.name} 成功`);
  } catch (e) {
    ElMessage.error(`上传 ${uploadFile.name} 失败：${e.message || '网络异常'}`);
    fileList.value = fileList.value.filter(x => x.uid !== uploadFile.uid);
  }
};
const onFileRemove = (file) => removeFile(file);
const removeFile = (file) => {
  if (file.url) uploadedUrls.value = uploadedUrls.value.filter(u => u !== file.url);
  fileList.value = fileList.value.filter(x => x.uid !== file.uid);
};

const submit = async () => {
  await formRef.value.validate();
  if (!form.moduleName || !String(form.moduleName).trim()) {
    ElMessage.error('请填写加分项名称'); return;
  }
  submitting.value = true;
  try {
    const payload = {
      moduleName: String(form.moduleName).trim(),
      category: form.category || null,
      pillar: form.pillar || null,
      score: Number(form.score),
      eventDate: form.eventDate || null,
      description: form.description || null,
      proofUrls: uploadedUrls.value.length ? [...uploadedUrls.value] : []
    };
    const claim = await submitBonus(payload);
    resultTitle.value = '提交成功';
    resultDesc.value = `「${claim?.moduleName || form.moduleName}」已送达班级管理员，请等待审批。`;
    detailVisible.value = true;
    resetFormDataOnly();
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    submitting.value = false;
  }
};

const resetFormDataOnly = () => {
  Object.assign(form, { moduleName: '', category: '', pillar: '', score: 1, eventDate: '', description: '' });
  fileList.value = [];
  uploadedUrls.value = [];
};
const resetForm = () => {
  formRef.value?.resetFields();
  resetFormDataOnly();
};
const afterClose = () => {};
const goMy = () => router.push('/bonus-my');

onMounted(async () => {
  try {
    const mods = await listActiveModules();
    modules.value = Array.isArray(mods) ? mods : (mods?.list || []);
  } catch (_) { modules.value = []; }
  // 学期开放状态由后端在提交时校验；此处先用宽松提示，正式提交若被拒会给出明确错误
  semesterOpen.value = true;
});
</script>

<style lang="scss" scoped>
.bonus-submit { padding-bottom: 12px; }
.muted { color:#909399; font-size:13px; }
.form-card { margin-top:18px; border-radius:18px; }
.up-item { position: relative; width:100%; height:100%; .up-thumb { width:100%; height:100%; object-fit:cover; } .up-pdf { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#606266; } .up-actions { position:absolute; top:4px; right:4px; display:flex; gap:4px; .el-icon { background:rgba(0,0,0,.5); color:#fff; padding:4px; border-radius:50%; cursor:pointer; } } }
</style>
