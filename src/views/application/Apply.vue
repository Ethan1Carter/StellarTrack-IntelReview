<template>
  <div class="apply-page">
    <WorkspaceHero
      eyebrow="BONUS APPLICATION"
      title="提交加分申报"
      description="选择评价模块，补充成果信息与证明材料，提交后可在我的申报中追踪每一步。"
    >
      <template #actions>
        <el-button v-if="step !== 2" @click="$router.push('/my-applications')"><el-icon><Tickets /></el-icon> 我的申报</el-button>
        <el-button v-if="step === 2" plain @click="step = 1"><el-icon><ArrowLeft /></el-icon> 返回</el-button>
      </template>
    </WorkspaceHero>

    <el-steps :active="step - 1" align-center finish-status="success" simple class="apply-steps">
      <el-step title="选择模块" />
      <el-step title="填写信息" />
      <el-step title="提交完成" />
    </el-steps>
    <el-alert v-if="aiReviewPayload" :type="aiReviewPayload.ownership?.status === 'mismatch' ? 'error' : 'warning'"
      :closable="false" show-icon class="mb-16" title="AI 材料归属核对（最终由教师核验）"
      :description="aiReviewPayload.ownership?.message || '该材料尚未完成归属核验，请人工核对原件和申报人信息。'" />

    <!-- 步骤1：选择模块 -->
    <div v-if="step === 1" class="card">
      <div class="card-title">
        请选择要申报的加分模块
        <el-tag size="small">启用中的模块</el-tag>
        <el-tag v-if="!canApplyAny" size="small" type="danger" style="margin-left:8px;">
          暂无可申报学期，请等待学院管理员开启申报
        </el-tag>
      </div>
      <div class="modules-grid">
        <div v-for="m in activeModules" :key="m.id" class="module-card"
          :class="{ disabled: !canApplyAny }"
          @click="canApplyAny && selectModule(m)">
          <div class="m-icon" :style="{ background: m.color || '#409EFF' }">
            <template v-if="m.icon">{{ m.icon }}</template>
            <template v-else>{{ (m.name || '?').substring(0, 1) }}</template>
          </div>
          <div class="m-info">
            <h4>
              {{ m.name }}
              <el-tag v-if="m.isRequired" size="small" type="danger" style="margin-left:4px;">必选</el-tag>
            </h4>
            <p>{{ m.description || '暂无描述' }}</p>
            <div class="tags">
              <el-tag size="small">单次上限 {{ m.singleMaxScore }} 分</el-tag>
              <el-tag size="small" type="success">累计上限 {{ m.yearlyMaxScore }} 分</el-tag>
            </div>
          </div>
          <div class="arrow" v-if="canApplyAny"><Right /></div>
          <div class="arrow" v-else style="color:#F56C6C; font-size:12px;">未开启</div>
        </div>
      </div>
      <el-empty v-if="!activeModules.length" description="暂无可申报的模块，请联系管理员启用模块" />
    </div>

    <!-- 步骤2：填写信息 -->
    <div v-if="step === 2" class="card">
      <div class="card-title">
        填写「{{ selectedModule?.name }}」申报信息
        <span v-if="selectedModule?.isRequired" style="color:#F56C6C; margin-left:8px;">（必选模块）</span>
        <div class="title-right">
          <el-button link type="primary" @click="standardVisible = true">
            <el-icon><View /></el-icon> 加分标准
          </el-button>
        </div>
      </div>

      <!-- 当前模块本学期已得分数 -->
      <el-alert v-if="currentModuleScore" :type="overYearlyMax ? 'error' : 'success'" show-icon :closable="false" class="mb-16">
        <template #title>本学期该模块得分</template>
        <template #default>
          已得 <b style="color:#303133;">{{ currentModuleScore.approved }}</b> 分
          （待认定 {{ currentModuleScore.pending }} 分），
          累计上限 <b>{{ selectedModule?.yearlyMaxScore }}</b> 分
          <span v-if="overYearlyMax" style="color:#F56C6C; margin-left:8px;">
            · 本次申报后预计 {{ predictTotal }} 分，已超过上限！
          </span>
        </template>
      </el-alert>

      <!-- 模块分数上限提示 -->
      <el-alert v-if="overSingleMax || overYearlyMax" type="error" show-icon :closable="false" class="mb-16">
        <template #title>分数超限提示</template>
        <template #default>
          <div v-if="overSingleMax">本次申报分数 <b>{{ form.score }}</b> 超过单次上限 <b>{{ selectedModule?.singleMaxScore }}</b> 分</div>
          <div v-if="overYearlyMax">本次申报后预计总分 <b>{{ predictTotal }}</b> 超过累计上限 <b>{{ selectedModule?.yearlyMaxScore }}</b> 分</div>
        </template>
      </el-alert>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" style="max-width:760px; padding:8px 16px 16px;">
        <el-form-item label="选择学期" prop="semesterId">
          <el-select v-model="form.semesterId" placeholder="请选择要申报的学期" style="width:100%">
            <el-option
              v-for="s in semesters"
              :key="s.id"
              :label="formatSemesterLabel(s)"
              :value="s.id"
              :disabled="s.applyStatus !== 'started'"
            />
          </el-select>
          <div v-if="!semesters.length" style="color:#F56C6C; font-size:12px; margin-top:4px;">
            当前没有可申报的学期，请等待学院管理员开启申报
          </div>
          <div v-else-if="!canApplyAny" style="color:#E6A23C; font-size:12px; margin-top:4px;">
            所有学期申报均未开启，请耐心等待
          </div>
        </el-form-item>

        <el-form-item label="申报标题" prop="title">
          <el-input v-model="form.title" maxlength="80" show-word-limit placeholder="简要说明此次申报的事由" @blur="onTitleBlur" />
          <div v-if="dupCheck.duplicate" style="color:#F56C6C; font-size:12px; margin-top:4px;">
            <el-icon><WarningFilled /></el-icon>
            检测到重复申报：已存在相同标题的申报单 #{{ dupCheck.existingId }}
          </div>
        </el-form-item>

        <el-form-item label="申报日期" prop="eventDate">
          <el-date-picker v-model="form.eventDate" type="date" placeholder="事件发生日期" style="width:100%" value-format="YYYY-MM-DD" />
        </el-form-item>

        <el-form-item label="申请分数" prop="score">
          <el-input-number v-model="form.score" :min="0" :max="Number(selectedModule?.singleMaxScore) || 999" :step="0.5" @change="onScoreChange" />
          <div class="score-tip">
            <div>单次上限：<b>{{ selectedModule?.singleMaxScore }}</b> 分</div>
            <div>本学期已得：<b style="color:#67C23A;">{{ currentModuleScore?.approved || 0 }}</b> 分</div>
            <div>本次申报后预计：<b :style="{color: overYearlyMax ? '#F56C6C' : '#303133'}">{{ predictTotal }}</b> 分</div>
            <div>累计上限：<b>{{ selectedModule?.yearlyMaxScore }}</b> 分</div>
          </div>
        </el-form-item>

        <el-form-item label="等级奖项" prop="level">
          <el-select v-model="form.level" placeholder="若无等级请忽略" style="width:100%" clearable>
            <el-option label="国际级" value="international" />
            <el-option label="国家级" value="national" />
            <el-option label="省部级" value="provincial" />
            <el-option label="市校级" value="school" />
            <el-option label="院系级" value="college" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.level === 'other'" label="补充说明" prop="otherDescription">
          <el-input v-model="form.otherDescription" maxlength="200" show-word-limit
            placeholder="选「其他」时必填：请说明奖项/等级的具体名称" />
        </el-form-item>

        <el-form-item label="证书编号" v-if="selectedModule?.requireCertificateNo" prop="certificateNo">
          <el-input v-model="form.certificateNo" placeholder="请输入证书编号" />
        </el-form-item>

        <el-form-item label="说明描述" :prop="selectedModule?.requireDescription ? 'description' : ''">
          <el-input v-model="form.description" type="textarea" :rows="4" maxlength="500" show-word-limit
            :placeholder="selectedModule?.requireDescription ? '详细描述事项的参与情况、成果等（必填）' : '详细描述事项的参与情况、成果等（选填）'" />
        </el-form-item>

        <el-form-item label="相关链接">
          <el-input v-model="form.linkUrl" placeholder="赛事官网、新闻链接等（选填）" />
        </el-form-item>
        <el-form-item v-if="aiReviewPayload" label="人工核对说明">
          <el-input v-model="aiConfirmationReason" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="修改 AI 建议或归属未确认时，请说明依据，例如原件核对结果、计分规则或需教师核实的事项" />
        </el-form-item>

        <el-form-item :label="selectedModule?.requirePhoto ? `证明材料（至少${selectedModule?.minPhotoCount || 1}张）` : '证明材料'">
          <el-upload
            action="#"
            :auto-upload="false"
            :on-change="onFileChange"
            :on-remove="onFileRemove"
            list-type="picture-card"
            multiple
            :limit="10"
            accept="image/*,.pdf"
            v-model:file-list="fileList"
            :on-exceed="onExceed">
            <el-icon><Plus /></el-icon>
            <template #file="{ file }">
              <div class="upload-file-item">
                <img v-if="isImg(file.url || file.raw)" :src="file.url" class="upload-thumb" />
                <div v-else class="upload-pdf">
                  <el-icon size="32"><Document /></el-icon>
                  <span>{{ file.name }}</span>
                </div>
                <span class="upload-actions">
                  <el-icon v-if="file.url" @click="previewFile(file)"><ZoomIn /></el-icon>
                  <el-icon @click="removeFile(file)"><Delete /></el-icon>
                </span>
              </div>
            </template>
          </el-upload>
          <div class="upload-tip">
            支持图片/PDF，最多10个文件；提交审批后附件不可修改，仅编辑/草稿状态可增删附件
          </div>
        </el-form-item>

        <el-form-item label="同成果核对">
          <div style="width:100%;"><el-button :loading="dupCheck.checking" :disabled="pendingUploads>0" @click="onTitleBlur">核对材料与成果</el-button>
            <p style="font-size:12px;color:#63758b;line-height:1.8;">{{dupCheck.notice || '按本人申报核对文件内容、证书编号及成果信息；合理复用请说明原因，由教师复核。'}}</p>
            <el-alert v-if="dupCheck.error" type="error" :title="dupCheck.error" :closable="false"/>
            <el-alert v-if="dupCheck.incomplete" type="warning" title="部分历史材料未能完整核对，请人工检查。" :closable="false"/>
            <ul v-if="dupCheck.materialMatches.length" style="font-size:13px;line-height:1.8;"><li v-for="match in dupCheck.materialMatches" :key="match.id">申报 #{{match.id}} · {{match.title}}：{{match.reasons.join('、')}}</li></ul>
            <el-input v-if="dupCheck.materialMatches.length" v-model="duplicateReason" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="说明本次与已有成果的区别，或团队材料复用原因（至少 5 字）"/>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" :loading="submitting" :disabled="pendingUploads > 0 || fileList.some(file => file.status === 'fail') || !canApplyAny || overSingleMax || overYearlyMax || dupCheck.duplicate"
                     @click="submit(false)">
            提交申报
          </el-button>
          <el-button type="info" size="large" plain :loading="savingDraft" :disabled="pendingUploads > 0" @click="submit(true)">
            保存草稿
          </el-button>
          <el-button size="large" @click="step = 1">取消</el-button>
          <div v-if="!canApplyAny" style="color:#F56C6C; font-size:12px; margin-top:4px;">
            当前所有学期均未开启申报，无法提交，请等待学院管理员开启
          </div>
        </el-form-item>
      </el-form>
    </div>

    <!-- 步骤3：提交完成 -->
    <div v-if="step === 3" class="card success-card">
      <div class="big-success"><el-icon color="#67C23A" size="64"><CircleCheckFilled /></el-icon></div>
      <h3>{{ successTitle }}</h3>
      <p>{{ successDesc }}</p>
      <div class="btns">
        <el-button type="primary" @click="$router.push('/my-applications')">查看我的申报</el-button>
        <el-button @click="resetAll">继续提交新申报</el-button>
      </div>
    </div>

    <!-- 加分标准弹窗 -->
    <el-dialog v-model="standardVisible" title="加分标准" width="640px" destroy-on-close>
      <div class="rule-detail">
        <div class="rule-meta">
          <el-tag :style="{ background: selectedModule?.color || '#409EFF', border: 'none' }" effect="dark">
            {{ selectedModule?.name || '未知模块' }}
          </el-tag>
          <span style="color:#909399; margin-left:8px;">
            单次上限 {{ selectedModule?.singleMaxScore }} 分 · 累计上限 {{ selectedModule?.yearlyMaxScore }} 分
          </span>
        </div>
        <div class="rule-content">{{ selectedModule?.ruleDescription || '该模块未配置加分标准说明' }}</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="standardVisible = false">我已了解</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  createApplication, saveDraftApplication, uploadProof,
  getApplicationDetail, updateApplication,
  getMySemesters, getMyScoreSummary, checkDuplicate
} from '@/api/applications';
import { listActiveModules } from '@/api/modules';
import { EditPen, Right, Plus, CircleCheckFilled, View, Document, ZoomIn, Delete, ArrowLeft, WarningFilled, Tickets } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const userStore = useUserStore();

const step = ref(1);
const activeModules = ref([]);
const semesters = ref([]);
const selectedModule = ref(null);
const formRef = ref();
const submitting = ref(false);
const savingDraft = ref(false);
const fileList = ref([]);
const uploadedUrls = ref([]);
const editingId = ref(null); // 编辑模式下的申报 ID
const currentModuleScore = ref(null); // 本学期已得分数
const dupCheck = reactive({ duplicate: false, existingId: null, checking: false,materialMatches:[],incomplete:false,notice:'',error:'' });
const duplicateReason=ref('');let duplicateVersion=0;
const standardVisible = ref(false);
const successTitle = ref('申报提交成功！');
const successDesc = ref('');
const aiReviewPayload = ref(null);
const aiConfirmationReason = ref('');
const pendingUploads = ref(0);

const form = reactive({
  semesterId: null, title: '', eventDate: '', score: 1, level: '',
  otherDescription: '', description: '', linkUrl: '', certificateNo: ''
});

const canApplyAny = computed(() => semesters.value.some(s => s.applyStatus === 'started'));

// 学期格式：2025-2026学年第1学期（阿拉伯数字，将后端 first/second 转为 1/2）
const SEMESTER_NUM = { first: 1, second: 2, '1': 1, '2': 2 };
const formatSemesterLabel = (s) => {
  if (!s) return '';
  const num = SEMESTER_NUM[s.semester] || (Number.isFinite(Number(s.semester)) ? Number(s.semester) : '');
  const numText = num !== '' ? String(num) : (s.semester || '');
  const base = s.name ? String(s.name).replace(/first/i, '1').replace(/second/i, '2') : `${s.academicYear || ''}学年第${numText}学期`;
  return base + (s.applyStatus === 'started' ? '（申报中）' : '');
};

// 上限校验
const overSingleMax = computed(() => {
  if (!selectedModule.value?.singleMaxScore) return false;
  return Number(form.score) > Number(selectedModule.value.singleMaxScore);
});
const overYearlyMax = computed(() => {
  if (!selectedModule.value?.yearlyMaxScore) return false;
  return predictTotal.value > Number(selectedModule.value.yearlyMaxScore);
});
const predictTotal = computed(() => {
  const approved = Number(currentModuleScore.value?.approved || 0);
  return Number((approved + Number(form.score || 0)).toFixed(2));
});

const rules = computed(() => {
  const r = {
    semesterId: [{ required: true, message: '请选择申报学期', trigger: 'change' }],
    title: [{ required: true, message: '请填写申报标题', trigger: 'blur' }],
    eventDate: [{ required: true, message: '请选择事件日期', trigger: 'change' }],
    score: [{ required: true, message: '请填写申请分数' }]
  };
  if (selectedModule.value?.requireDescription) {
    r.description = [{ required: true, message: '请填写详细说明', trigger: 'blur' }];
  }
  if (selectedModule.value?.requireCertificateNo) {
    r.certificateNo = [{ required: true, message: '请填写证书编号', trigger: 'blur' }];
  }
  // 「其他」等级：补充说明必填
  if (form.level === 'other') {
    r.otherDescription = [{ required: true, message: '选「其他」时必填补充说明', trigger: 'blur' }];
  }
  return r;
});

const selectModule = async (m) => {
  selectedModule.value = m;
  // 默认分数取较小值（单次上限）
  form.score = Math.min(Number(m.singleMaxScore) || 1, Number(m.yearlyMaxScore) || 999);
  step.value = 2;
  // 加载该模块本学期已得分数
  await loadCurrentModuleScore(m.id);
};

const loadCurrentModuleScore = async (moduleId) => {
  if (!form.semesterId) {
    // 默认选当前 started 学期
    const started = semesters.value.find(s => s.applyStatus === 'started');
    if (started) form.semesterId = started.id;
  }
  if (!form.semesterId) { currentModuleScore.value = null; return; }
  try {
    const r = await getMyScoreSummary(form.semesterId);
    const mods = r?.modules || [];
    const found = mods.find(x => Number(x.moduleId) === Number(moduleId));
    currentModuleScore.value = found ? {
      approved: Number(found.approvedScore || 0),
      pending: Number(found.pendingScore || 0)
    } : { approved: 0, pending: 0 };
  } catch (_) { currentModuleScore.value = null; }
};

watch(() => form.semesterId, async () => {
  if (selectedModule.value) await loadCurrentModuleScore(selectedModule.value.id);
});

const onScoreChange = () => {};
const onExceed = () => ElMessage.warning('最多上传10个文件');
const onTitleBlur = async () => {
  if (!selectedModule.value || pendingUploads.value>0) return;
  const version=++duplicateVersion;
  dupCheck.checking = true;
  dupCheck.error='';
  try {
    const r = await checkDuplicate({
      moduleId: selectedModule.value.id,
      title: form.title,
      eventDate: form.eventDate || undefined,certificateNo:form.certificateNo,proofUrl:[...uploadedUrls.value],excludeId:editingId.value||undefined
    });
    if(version!==duplicateVersion)return;
    dupCheck.duplicate = !!r?.duplicate;
    dupCheck.existingId = r?.existingId || null;
    dupCheck.materialMatches=r?.materialMatches||[];dupCheck.incomplete=!!r?.incomplete;dupCheck.notice=r?.notice||'';
  } catch (err) {if(version===duplicateVersion)dupCheck.error=err.message||'核对失败，请重试';} finally {if(version===duplicateVersion)dupCheck.checking = false;}
};
watch(()=>[form.title,form.eventDate,form.certificateNo,selectedModule.value?.id,uploadedUrls.value.join(',')],()=>{
  duplicateVersion++;Object.assign(dupCheck,{duplicate:false,existingId:null,materialMatches:[],incomplete:false,checking:false,error:'',notice:''});
},{flush:'sync'});

const isImg = (url) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url || '');
const onFileChange = async (uploadFile) => {
  if (!uploadFile.raw) return;
  pendingUploads.value += 1;
  uploadFile.status = 'uploading';
  try {
    const fd = new FormData();
    fd.append('photos', uploadFile.raw);
    const res = await uploadProof(fd);
    const url = res?.urls?.[0] || (Array.isArray(res) ? res[0]?.url : '') || '';
    if (!url) throw new Error('上传返回数据异常');
    if (!fileList.value.some(item => item.uid === uploadFile.uid)) return;
    uploadedUrls.value.push(url);
    uploadFile.url = url;
    uploadFile.status = 'success';
    ElMessage.success(`上传 ${uploadFile.name} 成功`);
  } catch (e) {
    ElMessage.error(`上传 ${uploadFile.name} 失败：${e.message || '网络异常'}`);
    uploadFile.status = 'fail';
  } finally {
    pendingUploads.value -= 1;
  }
};
const onFileRemove = (file) => { removeFile(file); };
const removeFile = (file) => {
  if (file.url) uploadedUrls.value = uploadedUrls.value.filter(u => u !== file.url);
  fileList.value = fileList.value.filter(x => x.uid !== file.uid);
};
const previewFile = (file) => {
  if (file.url) window.open(file.url, '_blank');
};

const submit = async (isDraft) => {
  if (aiReviewPayload.value?.ownership?.status === 'mismatch') return ElMessage.error('证书归属不符，请更换本人证明材料后重新分析');
  if (pendingUploads.value > 0) return ElMessage.warning('材料正在上传，请等待完成后再保存或提交');
  if (fileList.value.some(file => file.status === 'fail')) return ElMessage.warning('请移除上传失败的材料并重新上传');
  if (!isDraft) {
    await formRef.value.validate();
    if (selectedModule.value?.requirePhoto) {
      const minCount = selectedModule.value.minPhotoCount || 1;
      if (uploadedUrls.value.length < minCount) {
        ElMessage.warning(`请至少上传${minCount}张证明材料`);
        return;
      }
    }
    // 重复申报校验（提交前再次确认）
    {
      await onTitleBlur();
      if(dupCheck.error)return ElMessage.warning('材料核对尚未成功，请重新核对后提交');
      if(dupCheck.materialMatches.length && duplicateReason.value.trim().length<5)return ElMessage.warning('请补充至少 5 字的同成果情况说明');
      if (dupCheck.duplicate) {
        ElMessage.error('检测到重复申报，已存在相同标题的申报单 #' + dupCheck.existingId);
        return;
      }
    }
  }

  if (isDraft) { savingDraft.value = true; } else { submitting.value = true; }
  try {
    const payload = {
      semesterId: form.semesterId,
      moduleId: selectedModule.value.id,
      title: form.title || undefined,
      eventDate: form.eventDate || undefined,
      score: form.score,
      level: form.level || null,
      otherDescription: form.level === 'other' ? form.otherDescription : null,
      description: form.description || undefined,
      linkUrl: form.linkUrl || null,
      certificateNo: form.certificateNo || null,
      duplicateReason:duplicateReason.value,
      proofUrl: uploadedUrls.value.length > 0 ? uploadedUrls.value.join(',') : null,
      extraData: aiReviewPayload.value ? { aiReview: aiReviewPayload.value, aiConfirmation: { reason: aiConfirmationReason.value } } : undefined
    };

    let res;
    if (editingId.value) {
      // 编辑模式：调用 PUT /:id 更新
      res = await updateApplication(editingId.value, { ...payload, saveDraft: isDraft, replacePhotos: true });
    } else if (isDraft) {
      res = await saveDraftApplication(payload);
    } else {
      res = await createApplication(payload);
    }

    if (aiReviewPayload.value?.sourceMaterialId != null) {
      try {
        const key = `xinggui.aiBatch.${userStore.userId}`;
        const batch = JSON.parse(sessionStorage.getItem(key) || 'null');
        const item = batch?.materials?.find(material => material.id === aiReviewPayload.value.sourceMaterialId);
        if (item) {
          item.submitted = !isDraft;
          item.savedDraft = !!isDraft;
          sessionStorage.setItem(key, JSON.stringify(batch));
        }
      } catch (_) { /* 申报已成功，浏览器存储失败不改变提交结果。 */ }
    }
    if (isDraft) {
      ElMessage.success(res?.message || '草稿已保存，可在「我的申报」中继续编辑');
      step.value = 3;
      successTitle.value = '草稿已保存';
      successDesc.value = '草稿未进入审批流程，可在「我的申报」中编辑或提交。';
    } else {
      step.value = 3;
      successTitle.value = '申报提交成功！';
      successDesc.value = `您的「${selectedModule.value.name}」加分申报已提交，请耐心等待审批。`;
    }
  } catch (e) {
    if (e?.errors) { formRef.value?.value?.validate?.(); }
  } finally {
    submitting.value = false; savingDraft.value = false;
  }
};

const resetAll = () => {
  step.value = 1;
  selectedModule.value = null;
  duplicateReason.value='';
  editingId.value = null;
  Object.assign(form, { semesterId: null, title: '', eventDate: '', score: 1, level: '', otherDescription: '', description: '', linkUrl: '', certificateNo: '' });
  fileList.value = [];
  uploadedUrls.value = [];
  currentModuleScore.value = null;
  dupCheck.duplicate = false; dupCheck.existingId = null;
  aiReviewPayload.value = null;
  aiConfirmationReason.value = '';
};

const loadAiReview = async () => {
  const storageKey = `xinggui.aiReview.${userStore.userId}`;
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;
  try {
    const review = JSON.parse(raw);
    if (review.ownership?.status === 'mismatch') {
      sessionStorage.removeItem(storageKey);
      ElMessage.error('该证书归属不符，未带入申报。请更换本人材料或联系老师核验。');
      return;
    }
    const module = activeModules.value.find(item => Number(item.id) === Number(review.suggestedModuleId));
    if (!module) {
      ElMessage.warning('AI 建议模块当前不可申报，请手动选择模块');
    }
    aiReviewPayload.value = review;
    if (module) await selectModule(module);
    Object.assign(form, {
      title: review.title || '',
      eventDate: review.eventDate || '',
      score: review.ownership?.status === 'matched' ? Number(review.scoreSuggestion ?? 0) : 0,
      level: review.awardLevel || '',
      description: review.description || '',
      certificateNo: review.certificateNo || ''
    });
    if (review.fileUrl) {
      uploadedUrls.value = [review.fileUrl];
      fileList.value = [{ uid: 90001, name: review.fileName || 'AI分析材料', url: review.fileUrl, status: 'success' }];
    }
    sessionStorage.removeItem(storageKey);
    ElMessage.info('已带入 AI 分析建议，请确认后再提交');
  } catch (_error) {
    ElMessage.warning('AI 分析结果读取失败，请重新分析');
  }
};

// 编辑模式：加载已有申报数据
const loadForEdit = async (id) => {
  try {
    const app = await getApplicationDetail(id);
    if (!app) { ElMessage.error('申报不存在'); return; }
    editingId.value = Number(id);
    aiReviewPayload.value = app.extraData?.aiReview || null;
    aiConfirmationReason.value = app.extraData?.aiConfirmation?.reason || '';
    duplicateReason.value=app.extraData?.duplicateReview?.reason||'';
    // 找到对应模块
    const mod = app.module;
    if (mod) {
      selectedModule.value = mod;
      // 兼容 activeModules 中没有该模块的情况
      if (!activeModules.value.some(m => m.id === mod.id)) {
        activeModules.value.unshift(mod);
      }
    }
    // 填充表单
    Object.assign(form, {
      semesterId: app.semesterId,
      title: app.title || '',
      eventDate: app.eventDate || '',
      score: Number(app.score) || 1,
      level: app.awardLevel || '',
      otherDescription: app.otherDescription || '',
      description: app.description || '',
      linkUrl: app.linkUrl || '',
      certificateNo: app.certificateNo || ''
    });
    // 加载附件
    const photos = app.attachPhotos || (app.proofUrl ? String(app.proofUrl).split(',') : []);
    uploadedUrls.value = Array.isArray(photos) ? [...photos] : photos;
    fileList.value = uploadedUrls.value.map((url, i) => ({
      uid: 10000 + i, name: url.split('/').pop() || `附件${i+1}`, url, status: 'success'
    }));
    step.value = 2;
    // 加载本学期已得分数
    if (form.semesterId) await loadCurrentModuleScore(selectedModule.value?.id);
    ElMessage.info('已加载申报数据，请修改后重新提交');
  } catch (e) {
    ElMessage.error('加载申报数据失败：' + (e.message || '网络异常'));
  }
};

onMounted(async () => {
  try {
    const [mods, sems] = await Promise.all([
      listActiveModules() || [],
      getMySemesters() || []
    ]);
    activeModules.value = Array.isArray(mods) ? mods : (mods?.list || []);
    semesters.value = Array.isArray(sems) ? sems : (sems?.list || []);
    // 默认选中第一个 started 学期
    const defaultSem = semesters.value.find(s => s.applyStatus === 'started');
    if (defaultSem) form.semesterId = defaultSem.id;
  } catch (_) {}

  // 处理 query.id 编辑模式
  const { id, submit: autoSubmit, reapply } = route.query;
  if (id) {
    await loadForEdit(id);
    // 若来自"重新提交"入口，则自动触发提交
    if (autoSubmit === '1') {
      ElMessage.info('已加载退回单据数据，正在为您提交...');
      setTimeout(() => submit(false), 300);
    }
  } else if (route.query.from === 'ai') {
    await loadAiReview();
  } else if (route.query.from === 'rule-guide' && route.query.moduleId) {
    const module = activeModules.value.find(item => Number(item.id) === Number(route.query.moduleId));
    if (module) {
      await selectModule(module);
      form.score = null;
      ElMessage.info('已选择对应模块，请核对适用学期、材料和分值后提交');
    } else ElMessage.warning('该模块已停用或不适用于本人，请重新选择申报模块');
  }
});
</script>

<style lang="scss" scoped>
.apply-page { padding-bottom: 12px; }
.apply-steps { margin:18px 0; padding:14px 18px; border:1px solid #DFE8F4; border-radius:16px; background:rgba(255,255,255,.82); box-shadow:0 9px 28px rgba(20,51,96,.05); }
.modules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; padding: 3px 20px 22px; }
.module-card { position:relative; display: flex; align-items: center; gap: 15px; min-height:106px; padding: 17px; overflow:hidden; border: 1px solid #E3EBF5; border-radius: 15px;
  cursor: pointer; transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; background:linear-gradient(145deg,#fff 0%,#F9FBFE 100%);
  &::after { content:''; position:absolute; width:72px; height:72px; right:-34px; bottom:-38px; border:1px solid rgba(33,113,205,.15); border-radius:50%; box-shadow:0 0 0 14px rgba(33,113,205,.035); }
  &:hover { transform: translateY(-3px); border-color:#72A7E8; box-shadow: 0 13px 28px rgba(26,83,151,.11); }
  .m-icon { width: 52px; height: 52px; flex-shrink:0; border-radius: 14px; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 21px; font-weight: 800; box-shadow:0 9px 18px rgba(30,76,136,.16); }
  .m-info { flex: 1; min-width: 0;
    h4 { margin: 0 0 5px; color:#172B4D; font-size: 15px; }
    p { margin: 0 0 8px; font-size: 12px; color: #7B8CA3; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tags :deep(.el-tag) { height: 22px; padding: 0 6px; font-size: 11px; line-height: 20px; white-space: nowrap; }
  }
  .arrow { position:relative; z-index:1; color:#7694B6; }
}
.success-card { text-align: center; padding: 60px 20px; }
.module-card.disabled { opacity: 0.6; cursor: not-allowed; pointer-events: none; }
.big-success { margin-bottom: 18px; animation: pop .4s ease; }
@keyframes pop { from{transform:scale(.3); opacity:0} to{transform:scale(1); opacity:1} }
h3 { margin: 0 0 10px; color: #303133; }
p { color: #909399; margin-bottom: 24px; }
.btns { display: flex; justify-content: center; gap: 12px; }

.card { border:1px solid #E4ECF6; border-radius:18px; overflow:hidden; box-shadow:0 12px 32px rgba(20,52,96,.055); }
.card-title { padding: 19px 21px; border-bottom: 1px solid #EAF0F7; display:flex; align-items:center; gap: 8px; color:#172B4D; font-size:16px;
  &::before { content:''; width:4px; height:18px; border-radius:99px; background:linear-gradient(#1C7BEA,#13B9D5); }
  .title-right { margin-left: auto; }
}
.score-tip { display:flex; flex-direction: column; gap: 2px; margin-left: 12px; font-size: 12px; color: #909399;
  b { color: #303133; font-weight: 600; }
}
.upload-tip { color:#909399; font-size:12px; margin-top:6px; }
.upload-file-item { position: relative; width: 100%; height: 100%; border-radius: 6px; overflow: hidden; background: #fafafa;
  .upload-thumb { width: 100%; height: 100%; object-fit: cover; }
  .upload-pdf { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 4px; color: #606266;
    span { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; padding: 0 4px; }
  }
  .upload-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: 4px;
    .el-icon { background: rgba(0,0,0,0.5); color: #fff; padding: 4px; border-radius: 50%; cursor: pointer; font-size: 12px; }
  }
}
.rule-detail {
  .rule-meta { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed #ebeef5; }
  .rule-content { line-height: 1.8; color: #303133; padding: 12px; background: #f5f7fa; border-radius: 6px; white-space: pre-wrap; min-height: 80px; }
}
.mb-16 { margin-bottom: 16px; }
.flex-between { display:flex; justify-content:space-between; align-items:center; }
.mt-16 { margin-top: 16px; }
.mb-24 { margin-bottom: 24px; }
@media (max-width:768px) {
  .apply-steps { margin:14px 0; padding:12px 8px; }
  .modules-grid { grid-template-columns:1fr; padding:3px 14px 16px; }
  .module-card { min-height:96px; padding:14px; }
  .module-card .m-info .tags { flex-wrap:wrap; }
}
</style>
