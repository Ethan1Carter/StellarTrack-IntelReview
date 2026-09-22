<template>
  <div class="score-import-page">
    <section class="import-hero">
      <div>
        <div class="eyebrow">DATA INGESTION · 成绩数据中心</div>
        <h1>批量导入成绩</h1>
        <p>统一录入课程成绩与加分记录，自动完成学生匹配、字段校验和综测数据更新。</p>
      </div>
      <div class="flow-track">
        <div class="flow-item active"><b>01</b><span>选择类型</span></div>
        <i></i>
        <div class="flow-item" :class="{ active: selectedFile }"><b>02</b><span>上传校验</span></div>
        <i></i>
        <div class="flow-item" :class="{ active: result }"><b>03</b><span>确认结果</span></div>
      </div>
    </section>

    <el-card shadow="never" class="import-card">
      <template #header>
        <div class="card-header">
          <div><span class="section-index">01</span><span>配置导入任务</span></div>
          <el-tag effect="plain">单批最多 500 条</el-tag>
        </div>
      </template>

      <!-- 导入模式切换 -->
      <el-radio-group v-model="importMode" class="mode-switch" @change="onModeChange">
        <el-radio-button label="course"><span>课程成绩导入</span><small>智育成绩 · 学分加权</small></el-radio-button>
        <el-radio-button label="bonus"><span>加分模块导入</span><small>竞赛荣誉 · 实践活动</small></el-radio-button>
      </el-radio-group>

      <!-- 模式说明 -->
      <el-alert
        :type="importMode === 'course' ? 'success' : 'warning'"
        :closable="false" show-icon class="mode-brief"
      >
        <template #title>
          <div v-if="importMode === 'course'" style="line-height:1.8;">
            <b>课程成绩导入（智育成绩）：</b>导入学生的课程考试成绩，作为综测计算的基础成绩。<br/>
            必填列：<b>学号、课程名称、成绩</b>；可选列：姓名、班级名称、院系名称、学分、学年、学期、课程性质、课程代码。<br/>
            <b>智能匹配</b>：系统自动匹配班级和学院（支持模糊匹配，如"电子信息工程2501"可匹配"电子信息工程2501班"）。<br/>
            <b>自动创建</b>：学号不存在时自动创建学生账号（默认密码 123456）；班级不存在时自动创建班级。<br/>
            同一学生同学期同课程重复导入将<b>自动更新</b>成绩，不会产生重复记录。
          </div>
          <div v-else style="line-height:1.8;">
            <b>加分模块导入（额外加分）：</b>导入学生的加分项申报记录（如比赛获奖、志愿服务等），直接进入终审通过状态。<br/>
            必填列：<b>学号、模块名称、申报标题、分数</b>；可选列：姓名、班级名称、院系名称、学年、学期。<br/>
            学号在系统中不存在时将<b>自动创建学生账号</b>。
          </div>
        </template>
      </el-alert>

      <!-- 上传区域 -->
      <el-upload
        ref="uploadRef"
        class="upload-area"
        drag
        :auto-upload="false"
        :limit="1"
        :on-change="handleFileChange"
        :on-exceed="handleExceed"
        accept=".xlsx,.xls"
      >
        <div class="upload-orbit"><el-icon><UploadFilled /></el-icon></div>
        <div class="upload-title">{{ selectedFile ? selectedFile.name : '拖放 Excel 文件到这里' }}</div>
        <div class="upload-subtitle">{{ selectedFile ? '文件已就绪，可以开始导入' : '或点击选择本地文件' }}</div>
        <template #tip>
          <div class="el-upload__tip">
            仅支持 .xlsx / .xls 格式文件，单次最多导入 500 条记录
          </div>
        </template>
      </el-upload>

      <!-- 加分模块导入的额外选项 -->
      <template v-if="importMode === 'bonus'">
        <div class="option-row">
          <span class="option-label">
            <el-tooltip content="如果Excel中没有模块名称列，所有成绩将归入此模块" placement="top">
              <span>默认加分模块 <el-icon style="color:#909399;"><QuestionFilled /></el-icon></span>
            </el-tooltip>：
          </span>
          <el-select v-model="defaultModuleId" placeholder="请选择模块" clearable>
            <el-option v-for="m in moduleList" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
          <span class="option-help">Excel 含模块列时自动忽略此项</span>
        </div>

        <div class="limit-option">
          <el-checkbox v-model="skipLimitCheck">
            跳过模块分数上限校验
            <el-tooltip content="勾选后忽略模块单次上限和学期累计上限校验" placement="top">
              <el-icon style="color:#909399; margin-left:4px;"><QuestionFilled /></el-icon>
            </el-tooltip>
          </el-checkbox>
        </div>
      </template>

      <!-- 课程成绩导入的额外选项 -->
      <template v-if="importMode === 'course'">
        <div class="calculation-note">
          <el-icon><InfoFilled /></el-icon>
          课程成绩将按课程明细独立存储，与加分模块分数分开管理。<br/>
          系统将自动计算<b>学分加权平均分</b>和<b>算术平均分</b>，供后续综测公式使用。
        </div>
      </template>

      <!-- 操作按钮 -->
      <div class="action-bar">
        <el-button type="primary" size="large" :loading="importing" :disabled="!selectedFile" @click="doImport">
          <el-icon style="margin-right:4px;"><Upload /></el-icon>
          开始导入
        </el-button>
        <el-button size="large" @click="downloadTemplate">
          <el-icon style="margin-right:4px;"><Download /></el-icon>
          下载模板
        </el-button>
        <el-button size="large" @click="reset">重置</el-button>
      </div>
    </el-card>

    <!-- 导入结果 -->
    <el-card v-if="result" shadow="never" class="result-card">
      <template #header>
        <span style="font-weight:600; font-size:16px;">
          导入结果
          <el-tag v-if="result.importBatch" size="small" type="info" style="margin-left:8px;">
            批次: {{ result.importBatch }}
          </el-tag>
        </span>
      </template>

      <!-- 统计卡片 -->
      <el-row :gutter="16" style="margin-bottom:20px;">
        <el-col :span="5">
          <div class="stat-card stat-total">
            <div class="stat-value">{{ result.total }}</div>
            <div class="stat-label">总记录数</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-card stat-success">
            <div class="stat-value">{{ result.imported }}</div>
            <div class="stat-label">成功导入</div>
          </div>
        </el-col>
        <el-col :span="5" v-if="result.created > 0">
          <div class="stat-card stat-created">
            <div class="stat-value">{{ result.created }}</div>
            <div class="stat-label">新建用户</div>
          </div>
        </el-col>
        <el-col :span="5" v-if="result.updated > 0">
          <div class="stat-card stat-updated">
            <div class="stat-value">{{ result.updated }}</div>
            <div class="stat-label">更新记录</div>
          </div>
        </el-col>
        <el-col :span="5">
          <div class="stat-card stat-fail">
            <div class="stat-value">{{ result.failed }}</div>
            <div class="stat-label">导入失败</div>
          </div>
        </el-col>
      </el-row>

      <!-- 成功列表 -->
      <el-tabs v-model="resultTab">
        <el-tab-pane :label="`成功列表（${result.imported}）`" name="success">
          <el-table :data="result.successList" stripe max-height="400" size="small">
            <el-table-column prop="row" label="行号" width="70" align="center" />
            <el-table-column prop="username" label="学号" width="140" />
            <el-table-column prop="realName" label="姓名" width="100" />
            <el-table-column v-if="importMode === 'course'" prop="courseName" label="课程" min-width="180" show-overflow-tooltip />
            <el-table-column v-else prop="module" label="模块" width="140" />
            <el-table-column v-if="importMode === 'bonus'" prop="title" label="申报标题" min-width="200" show-overflow-tooltip />
            <el-table-column prop="score" label="分数" width="80" align="center">
              <template #default="{row}">
                <span style="color:#10B981; font-weight:700;">{{ row.score }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="importMode === 'course'" prop="action" label="操作" width="90" align="center">
              <template #default="{row}">
                <el-tag :type="row.action === 'updated' ? 'warning' : 'success'" size="small">
                  {{ row.action === 'updated' ? '更新' : '新建' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane v-if="result.failMsgs && result.failMsgs.length" :label="`失败详情（${result.failed}）`" name="fail">
          <div class="fail-list">
            <div v-for="(msg, i) in result.failMsgs" :key="i" class="fail-item">
              <el-icon style="color:#F56C6C; margin-right:6px;"><WarningFilled /></el-icon>
              {{ msg }}
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { UploadFilled, Upload, Download, WarningFilled, QuestionFilled, InfoFilled } from '@element-plus/icons-vue';
import { downloadScoreImportTemplate, importScores } from '@/api/scores';
import { downloadCourseScoreTemplate, importCourseScores } from '@/api/courseScores';
import request from '@/utils/request';

const uploadRef = ref(null);
const selectedFile = ref(null);
const importing = ref(false);
const result = ref(null);
const resultTab = ref('success');
const importMode = ref('course'); // 默认课程成绩导入
const defaultModuleId = ref(null);
const moduleList = ref([]);
const skipLimitCheck = ref(false);

onMounted(async () => {
  try {
    const res = await request({ url: '/modules', method: 'GET', params: { pageSize: 200 } });
    moduleList.value = res.list || res.data?.list || res.data || [];
    if (moduleList.value.length && !defaultModuleId.value) {
      defaultModuleId.value = moduleList.value[0].id;
    }
  } catch (_) {}
});

function onModeChange() {
  // 切换模式时清空已选文件和结果
  selectedFile.value = null;
  result.value = null;
  uploadRef.value?.clearFiles();
}

function handleFileChange(file) {
  if (file) {
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (!isExcel) {
      ElMessage.error('请上传 .xlsx 或 .xls 格式的文件');
      uploadRef.value?.clearFiles();
      selectedFile.value = null;
      return;
    }
    selectedFile.value = file.raw;
  }
}

function handleExceed() {
  ElMessage.warning('只能上传一个文件，请先移除已有文件');
}

async function downloadTemplate() {
  try {
    const blob = importMode.value === 'course'
      ? await downloadCourseScoreTemplate()
      : await downloadScoreImportTemplate();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = importMode.value === 'course' ? '课程成绩导入模板.xlsx' : '加分模块导入模板.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error('下载模板失败：' + (e.message || '未知错误'));
  }
}

async function doImport() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择文件');
    return;
  }

  const confirmMsg = importMode.value === 'course'
    ? '确认导入该文件中的课程成绩数据？同一学生同学期同课程将自动更新。'
    : skipLimitCheck.value
      ? '确认导入该文件中的加分数据？\n⚠ 已勾选「跳过模块分数上限校验」，将允许导入超出模块上限的成绩，请确认数据无误。导入后将直接进入终审通过状态，不可撤销。'
      : '确认导入该文件中的加分数据？导入后将直接进入终审通过状态，不可撤销。';

  try {
    await ElMessageBox.confirm(confirmMsg, '确认导入', {
      type: 'warning', confirmButtonText: '确认导入', cancelButtonText: '取消'
    });
  } catch {
    return;
  }

  importing.value = true;
  result.value = null;
  try {
    const formData = new FormData();
    formData.append('file', selectedFile.value);

    let res;
    if (importMode.value === 'course') {
      res = await importCourseScores(formData);
    } else {
      if (defaultModuleId.value) formData.append('defaultModuleId', defaultModuleId.value);
      formData.append('skipLimitCheck', skipLimitCheck.value ? 'true' : 'false');
      res = await importScores(formData);
    }

    result.value = res;
    resultTab.value = res.imported > 0 ? 'success' : 'fail';
    if (res.imported > 0) {
      ElMessage.success(res.message || `成功导入 ${res.imported} 条记录`);
    } else {
      ElMessage.warning('未成功导入任何记录，请查看失败详情');
    }
  } catch (e) {
    ElMessage.error('导入失败：' + (e.message || '服务器错误'));
  } finally {
    importing.value = false;
  }
}

function reset() {
  selectedFile.value = null;
  result.value = null;
  uploadRef.value?.clearFiles();
}
</script>

<style lang="scss" scoped>
.score-import-page { max-width: 1120px; margin: 0 auto; }

.import-hero {
  min-height: 172px;
  margin-bottom: 18px;
  padding: 28px 30px;
  border-radius: 22px;
  color: #fff;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px),
    radial-gradient(circle at 88% 18%, rgba(45,212,191,.34), transparent 15rem),
    linear-gradient(118deg, #17234B 0%, #24205D 66%, #392379 100%);
  background-size: 28px 28px, 28px 28px, auto, auto;
  box-shadow: 0 20px 44px rgba(24, 32, 74, .2);
  &::after {
    content: '';
    position: absolute;
    width: 260px;
    height: 82px;
    border: 1px solid rgba(124,248,226,.34);
    border-radius: 50%;
    right: -62px;
    top: 22px;
    transform: rotate(-18deg);
  }
  h1 { margin: 8px 0 7px; font-size: 30px; line-height: 1.15; letter-spacing: -.04em; }
  p { margin: 0; max-width: 610px; color: #B9C5E1; font-size: 13px; line-height: 1.7; }
  .eyebrow { color: #88E7D9; font-size: 10px; font-weight: 800; letter-spacing: .18em; }
}

.flow-track { display: flex; align-items: center; min-width: 360px; margin-bottom: 5px; position: relative; z-index: 1; }
.flow-track > i { flex: 1; height: 1px; margin: 0 10px; background: rgba(255,255,255,.2); }
.flow-item { display: flex; flex-direction: column; gap: 4px; color: #7F8EB2; white-space: nowrap;
  b { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 9px; border: 1px solid rgba(255,255,255,.16); font-size: 10px; }
  span { font-size: 10px; }
  &.active { color: #fff; b { color: #10203F; background: #7CE8D8; border-color: #7CE8D8; box-shadow: 0 0 20px rgba(45,212,191,.35); } }
}

.import-card { overflow: visible; }
.card-header { display: flex; justify-content: space-between; align-items: center;
  > div { display: flex; align-items: center; gap: 10px; font-size: 16px; color: #17233B; font-weight: 750; }
}
.section-index { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: #EFEEFF; color: #4F46E5; font-size: 10px; font-weight: 800; }

.mode-switch { display: grid; grid-template-columns: 1fr 1fr; width: 100%; margin-bottom: 18px; padding: 5px; border-radius: 14px; background: #F3F5FA;
  :deep(.el-radio-button) { width: 100%; }
  :deep(.el-radio-button__inner) { width: 100%; height: 58px; display: flex; flex-direction: column; justify-content: center; gap: 4px; border: 0 !important; border-radius: 10px !important; background: transparent; box-shadow: none !important; color: #64748B; }
  :deep(.el-radio-button.is-active .el-radio-button__inner) { color: #312E81; background: #fff; box-shadow: 0 7px 18px rgba(23,35,59,.08) !important; }
  span { font-weight: 750; font-size: 14px; }
  small { font-size: 10px; color: #96A0B3; }
}

.mode-brief { margin-bottom: 18px; border: 0; border-radius: 14px; padding: 6px 8px; }
.mode-brief :deep(.el-alert__title) { color: #46566F; font-size: 12px; line-height: 1.9; }
.mode-brief :deep(.el-alert__title b) { color: #17233B; }

.upload-area { text-align: center; display: block; }
.upload-area :deep(.el-upload) { width: 100%; }
.upload-area :deep(.el-upload-dragger) {
  width: 100%;
  min-height: 210px;
  padding: 34px 22px 24px;
  border: 1.5px dashed #BBC6DA;
  border-radius: 16px;
  background: linear-gradient(180deg, #FBFCFF, #F6F8FC);
  transition: border-color .2s ease, background .2s ease, transform .2s ease;
  &:hover { border-color: #6366F1; background: #F7F7FF; transform: translateY(-1px); }
}
.upload-orbit { width: 64px; height: 64px; margin: 0 auto 16px; display: grid; place-items: center; position: relative; border-radius: 18px; color: #fff; background: linear-gradient(145deg, #6D6AF4, #4F46E5); box-shadow: 0 14px 28px rgba(79,70,229,.24);
  &::after { content: ''; position: absolute; width: 78px; height: 30px; border: 1px solid rgba(45,212,191,.72); border-radius: 50%; transform: rotate(-25deg); }
  .el-icon { font-size: 28px; }
}
.upload-title { color: #17233B; font-size: 16px; font-weight: 750; }
.upload-subtitle { color: #8A96AA; font-size: 12px; margin-top: 6px; }
.upload-area :deep(.el-upload__tip) { color: #8A96AA; margin-top: 11px; }

.option-row { margin-top: 16px; padding: 15px; display: flex; align-items: center; gap: 12px; border-radius: 13px; background: #F8F9FC;
  .option-label { white-space: nowrap; font-size: 13px; font-weight: 650; color: #42526B; }
  .el-select { width: 260px; }
  .option-help { font-size: 11px; color: #8E99AA; }
}
.limit-option { margin: 10px 4px 0; }
.calculation-note { margin-top: 16px; padding: 13px 15px; display: flex; align-items: center; gap: 9px; border-radius: 12px; color: #596A82; background: #F4F3FF; font-size: 12px; line-height: 1.7;
  .el-icon { color: #4F46E5; font-size: 17px; flex: none; }
}
.action-bar { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px;
  :deep(.el-button) { min-width: 112px; border-radius: 11px; }
}

.result-card { margin-top: 18px; }
.stat-card { text-align: center; padding: 18px; border-radius: 13px; color: #fff; border: 0; box-shadow: none; }
.stat-value { font-size: 27px; font-weight: 800; line-height: 1.3; font-family: 'DIN Alternate', 'Inter', sans-serif; }
.stat-label { font-size: 11px; opacity: .82; margin-top: 4px; }
.stat-total { background: linear-gradient(135deg, #64748B, #475569); }
.stat-success { background: linear-gradient(135deg, #34D399, #059669); }
.stat-created { background: linear-gradient(135deg, #8B5CF6, #6D28D9); }
.stat-updated { background: linear-gradient(135deg, #FBBF24, #D97706); }
.stat-fail { background: linear-gradient(135deg, #FB7185, #E11D48); }
.fail-list { max-height: 400px; overflow-y: auto; }
.fail-item { padding: 10px 12px; border-bottom: 1px solid #EEF1F6; font-size: 12px; display: flex; align-items: flex-start; color: #59677F;
  .el-icon { color: #EF4444; margin-right: 7px; margin-top: 2px; }
}

@media (max-width: 900px) {
  .import-hero { align-items: flex-start; flex-direction: column; }
  .flow-track { min-width: 0; width: 100%; }
}
@media (max-width: 640px) {
  .import-hero { padding: 22px 20px; border-radius: 18px; h1 { font-size: 25px; } }
  .mode-switch { grid-template-columns: 1fr; }
  .option-row { align-items: flex-start; flex-direction: column; .el-select { width: 100%; } }
  .action-bar { flex-wrap: wrap; :deep(.el-button) { flex: 1; margin: 0; } }
}
</style>
