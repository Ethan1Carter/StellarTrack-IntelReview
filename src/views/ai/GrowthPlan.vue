<template>
  <div class="growth-page">
    <WorkspaceHero eyebrow="GROWTH JOURNEY" title="成长行动计划"
      description="把评价结果变成可执行的行动，记录过程，由教师反馈后继续改进。" />
    <section class="growth-filters card">
      <el-select v-if="isReviewer" v-model="studentId" filterable remote :remote-method="searchStudents" :loading="searching"
        placeholder="搜索学生姓名" aria-label="选择学生" @change="loadPlan">
        <el-option v-for="student in students" :key="student.id" :value="student.id" :label="`${student.realName}（${student.studentNo || '无学号'}）`" />
      </el-select>
      <el-select v-model="academicYear" aria-label="学年" @change="loadPlan"><el-option v-for="year in years" :key="year" :value="year" :label="`${year} 学年`" /></el-select>
      <el-select v-model="semester" aria-label="学期" @change="loadPlan"><el-option label="第一学期" value="first" /><el-option label="第二学期" value="second" /><el-option label="年度" value="annual" /></el-select>
      <el-button @click="loadPlan" :loading="loading">刷新记录</el-button>
    </section>
    <section v-if="!isReviewer && !plan" class="card preference-panel">
      <div class="preference-heading"><div><h2>先确定适合自己的安排</h2><p>没有记录不等于没有参与，可选择补录已有经历或尝试新的实践。</p></div><el-button type="primary" plain :loading="previewing" :disabled="loading || saving" @click="previewChoices">预览我的计划</el-button></div>
      <el-form label-position="top" class="preference-form" :disabled="loading || saving">
        <el-form-item label="本期希望关注的方向"><el-select v-model="preferences.focusKey" aria-label="成长方向" placeholder="按当前记录提供起点"><el-option label="按当前记录提供起点" value="" /><el-option v-for="item in directionOptions" :key="item.key" :label="item.name" :value="item.key" /></el-select></el-form-item>
        <el-form-item label="这个方向的参与情况"><el-select v-model="preferences.recordStatus" aria-label="参与情况"><el-option label="先确认已有参与情况" value="unsure" /><el-option label="已经参与，主要补充记录" value="record_only" /><el-option label="希望尝试新的实践" value="new_practice" /></el-select></el-form-item>
        <el-form-item label="每周预计可投入时间"><el-select v-model="preferences.weeklyMinutes" aria-label="每周可投入时间"><el-option v-for="minutes in [30,60,120,180]" :key="minutes" :value="minutes" :label="`约 ${minutes} 分钟`" /></el-select></el-form-item>
        <el-form-item label="我的具体目标（选填）" class="personal-goal"><el-input v-model="preferences.goal" maxlength="200" show-word-limit placeholder="例如：整理已有志愿服务经历，并完成一次反思" /></el-form-item>
      </el-form>
      <p v-if="preferencesDirty" class="preference-hint">偏好已调整，请先预览，再保存正式计划。</p>
    </section>
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" class="growth-notice" />
    <el-empty v-if="isReviewer && !studentId" description="选择一名学生，查看行动进度与待核验证据" />
    <section v-else v-loading="loading" class="journey-layout">
      <aside class="journey-context card" v-if="snapshot">
        <div class="context-label">{{ isReviewer ? `${studentName}的成长方向` : '本期行动方向' }}</div>
        <h2>{{ snapshot.diagnosis?.focus?.name || '形成成长记录' }}</h2>
        <p>{{ snapshot.diagnosis?.explanation }}</p>
        <div class="context-source">规则辅助建议 · {{ academicYear }} {{ semesterLabel }}</div>
        <p v-if="snapshot.diagnosis?.focusReason" class="planning-context">{{ snapshot.diagnosis.focusReason }}</p>
        <p v-if="snapshot.diagnosis?.arrangement" class="planning-context">{{ snapshot.diagnosis.arrangement }}</p>
        <p v-if="plan?.diagnosis?.preferences" class="planning-context">保存时参与情况：{{ participationText(plan.diagnosis.preferences.recordStatus) }}</p>
        <div v-for="goal in snapshot.goals || []" :key="goal.title" class="growth-goal"><strong>{{ goal.title }}</strong><p>{{ goal.target }}</p></div>
        <el-button v-if="!plan && !isReviewer" type="primary" :loading="saving" :disabled="preferencesDirty || previewing || loading" @click="startPlan">保存并开始行动</el-button>
        <el-alert v-if="!plan && isReviewer" type="info" title="学生尚未保存本期计划，下方为建议预览" :closable="false" />
        <p class="quiet-note">任务核验用于记录成长过程，不会自动改变综测分数。</p>
      </aside>
      <div class="journey-tasks" v-if="snapshot">
        <div class="journey-heading"><h2>行动 · 证据 · 反馈</h2><span>{{ completedCount }} / {{ tasks.length }} 项已核验</span></div>
        <article class="growth-task card" v-for="(task, index) in tasks" :key="task.id">
          <div class="task-milestone"><span>{{ String(index + 1).padStart(2, '0') }}</span><time>{{ task.dueAt }} 前</time></div>
          <div class="task-main">
            <div class="task-heading"><h3>{{ task.title }}</h3><el-tag :type="statusType(task.status)">{{ statusText(task.status) }}</el-tag></div>
            <p v-if="task.notes" class="task-record">{{ task.notes }}</p>
            <div v-if="task.attachments?.length" class="task-proofs"><a v-for="(url, i) in task.attachments" :key="url" :href="url" target="_blank" rel="noopener noreferrer">证明材料 {{ i + 1 }}</a></div>
            <div v-if="task.feedback?.length" class="task-feedback"><div v-for="(feedback, i) in task.feedback" :key="i"><strong>{{ feedback.reviewerName }}的反馈</strong><p>{{ feedback.text }}</p><time>{{ formatTime(feedback.at) }}</time></div></div>
            <div v-if="plan" class="task-actions">
              <el-button v-if="!isReviewer && ['todo', 'in_progress', 'returned'].includes(task.status)" type="primary" plain @click="editTask(task)">{{ task.status === 'todo' ? '记录行动' : '补充记录' }}</el-button>
              <el-button v-if="isReviewer && task.status === 'submitted'" type="primary" @click="openReview(task)">核验证据并反馈</el-button>
              <el-button v-if="isReviewer && ['todo','in_progress','returned'].includes(task.status)" plain @click="openAdjustment(task)">调整任务与日期</el-button>
              <el-button v-if="task.history?.length" text @click="historyTask = task">查看过程记录</el-button>
            </div>
          </div>
        </article>
      </div>
    </section>
    <el-dialog v-model="editVisible" title="记录成长行动" width="min(620px, 94vw)" :close-on-click-modal="false">
      <el-form label-position="top"><el-form-item label="执行记录"><el-input v-model="draft.notes" type="textarea" :rows="5" maxlength="2000" show-word-limit placeholder="记录做了什么、完成情况和需要的帮助" /></el-form-item>
        <el-form-item label="证明材料（图片或 PDF，最多 5 份）"><el-upload action="#" :auto-upload="false" v-model:file-list="fileList" :limit="5" accept="image/*,.pdf" :on-change="uploadEvidence" :on-remove="removeEvidence" :on-exceed="onExceed"><el-button :loading="uploading">选择证明材料</el-button></el-upload></el-form-item></el-form>
      <template #footer><el-button :disabled="saving || uploading" @click="saveTask('in_progress')">保存进度</el-button><el-button type="primary" :loading="saving" :disabled="uploading || fileList.some(file => file.status === 'fail')" @click="saveTask('submitted')">提交教师核验</el-button></template>
    </el-dialog>
    <el-dialog v-model="adjustVisible" title="调整成长任务" width="min(580px, 94vw)" :close-on-click-modal="false">
      <p class="quiet-note">只调整任务内容与截止日期，已有执行记录和证明会继续保留。</p>
      <el-form label-position="top"><el-form-item label="任务名称"><el-input v-model="definition.title" maxlength="200" show-word-limit /></el-form-item><el-form-item label="截止日期"><el-date-picker v-model="definition.dueAt" type="date" value-format="YYYY-MM-DD" aria-label="任务截止日期" /></el-form-item><el-form-item label="调整原因"><el-input v-model="definition.reason" type="textarea" :rows="3" maxlength="1000" show-word-limit placeholder="说明如何结合学生目标与实际情况调整" /></el-form-item></el-form>
      <template #footer><el-button :disabled="saving" @click="adjustVisible=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAdjustment">保存调整并留痕</el-button></template>
    </el-dialog>
    <el-dialog v-model="reviewVisible" title="教师核验与反馈" width="min(580px, 94vw)" :close-on-click-modal="false">
      <p>请核对任务中的执行记录及证明，再给出反馈。</p><el-input v-model="feedback" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="填写核验意见；退回时说明需要补充什么" />
      <template #footer><el-button :disabled="saving" @click="sendReview('returned')">退回补充</el-button><el-button type="primary" :loading="saving" @click="sendReview('completed')">确认完成</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!historyTask" title="成长过程记录" width="min(600px, 94vw)" @close="historyTask = null">
      <el-timeline><el-timeline-item v-for="(event, i) in historyTask?.history || []" :key="i" :timestamp="formatTime(event.at)"><strong>{{ event.actorName }} · {{ statusText(event.status) }}</strong><p>{{ event.message }}</p><p v-if="event.previousDefinition">调整前：{{ event.previousDefinition.title }}（{{ event.previousDefinition.dueAt }} 前）</p><p v-if="event.definition">调整后：{{ event.definition.title }}（{{ event.definition.dueAt }} 前）</p><p v-if="event.notes">{{ event.notes }}</p><a v-for="(url, j) in event.attachments || []" :key="url" :href="url" target="_blank" rel="noopener noreferrer">当时的证明 {{ j + 1 }} </a></el-timeline-item></el-timeline>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { useUserStore } from '@/stores/user';
import { getGrowthPlan, createGrowthPlan, getGrowthStudents, updateGrowthTask, reviewGrowthTask, previewGrowthPlan, adjustGrowthTask } from '@/api/growth-plans';
import { uploadProof } from '@/api/applications';
const userStore = useUserStore();
const route = useRoute();
const isReviewer = computed(() => ['counselor', 'college_admin', 'school_admin', 'super_admin', 'developer'].includes(userStore.role));
const now = new Date(); const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
const years = Array.from({ length: 7 }, (_, index) => `${startYear + 1 - index}-${startYear + 2 - index}`);
const academicYear = ref(`${startYear}-${startYear + 1}`);
const semester = ref(now.getMonth() >= 8 || now.getMonth() === 0 ? 'first' : 'second');
const semesterLabel = computed(() => ({ first: '第一学期', second: '第二学期', annual: '年度' })[semester.value]);
const studentId = ref(isReviewer.value ? Number(route.query.studentId) || null : userStore.userId);
const students = ref([]); const searching = ref(false); const loading = ref(false); const saving = ref(false); const error = ref('');
const plan = ref(null); const preview = ref(null); const studentName = ref('');
const preferences = reactive({ focusKey:'', goal:'', weeklyMinutes:60, recordStatus:'unsure' });
const directionOptions = [{key:'morality',name:'德育实践'},{key:'academy',name:'学习与创新'},{key:'sports',name:'体育健康'},{key:'arts',name:'美育实践'},{key:'labor',name:'劳动与志愿服务'}];
const previewing = ref(false);
const preferencesKey = () => JSON.stringify({ ...preferences, goal:preferences.goal.trim() });
const preferencesDirty = computed(() => preferencesKey() !== JSON.stringify(preview.value?.diagnosis?.preferences));
const participationText = value => ({unsure:'先确认已有参与情况',record_only:'已经参与，补充记录',new_practice:'尝试新的实践'})[value] || '未填写';
const adjustVisible = ref(false); const adjustingTask = ref(null);
const definition = reactive({ title:'', dueAt:'', reason:'' });
const snapshot = computed(() => plan.value || preview.value);
const tasks = computed(() => plan.value?.tasks || preview.value?.tasks || []);
const completedCount = computed(() => tasks.value.filter(task => task.status === 'completed').length);
const editVisible = ref(false); const reviewVisible = ref(false); const editingTask = ref(null); const historyTask = ref(null);
const draft = reactive({ notes: '' }); const feedback = ref(''); const fileList = ref([]); const uploading = ref(false);
let loadVersion = 0; let searchVersion = 0; let draftVersion = 0; let previewVersion = 0; let uploads = 0;
const statusText = status => ({ todo: '待开始', in_progress: '进行中', submitted: '待教师核验', completed: '已核验完成', returned: '待补充' })[status] || status;
const statusType = status => ({ completed: 'success', submitted: 'warning', returned: 'danger', todo: 'info' })[status] || 'primary';
const formatTime = value => value ? new Date(value).toLocaleString('zh-CN') : '';
const period = () => ({ academicYear: academicYear.value, semester: semester.value });
async function loadPlan() {
  const version = ++loadVersion; plan.value = null; preview.value = null; error.value = ''; editVisible.value = false; reviewVisible.value = false; adjustVisible.value = false; historyTask.value = null; draftVersion++; previewVersion++; previewing.value = false;
  Object.assign(preferences, { focusKey:'', goal:'', weeklyMinutes:60, recordStatus:'unsure' });
  if (!studentId.value) { loading.value = false; return; }
  loading.value = true;
  try { const data = await getGrowthPlan({ ...period(), studentId: studentId.value });
    if (version !== loadVersion) return;
    plan.value = data.plan; preview.value = data.preview; studentName.value = data.student.realName;
    const savedPreferences = (data.plan || data.preview)?.diagnosis?.preferences;
    if (savedPreferences) Object.assign(preferences, savedPreferences);
  } catch (err) { if (version === loadVersion) error.value = err.message || '读取计划失败，请重试'; }
  finally { if (version === loadVersion) loading.value = false; }
}
async function searchStudents(keyword = '') {
  const version = ++searchVersion; searching.value = true;
  try { const data = await getGrowthStudents({ keyword }); if (version === searchVersion) students.value = data.list; }
  catch (err) { ElMessage.error(err.message || '读取学生列表失败'); }
  finally { if (version === searchVersion) searching.value = false; }
}
async function startPlan() {
  if (saving.value || previewing.value || preferencesDirty.value || loading.value) return;
  const version = loadVersion; saving.value = true;
  try { const data = await createGrowthPlan({ ...period(), preferences:{...preferences} }); if (version === loadVersion) { plan.value = data; preview.value = null; ElMessage.success('成长计划已保存'); } }
  catch (err) { ElMessage.error(err.message || '保存计划失败'); } finally { saving.value = false; }
}
async function previewChoices() {
  if (plan.value || isReviewer.value || loading.value || saving.value) return;
  const version = loadVersion; const requestVersion = ++previewVersion; const key = preferencesKey();
  previewing.value = true; error.value = '';
  try { const data = await previewGrowthPlan({ ...period(), preferences:{...preferences} });
    if (version === loadVersion && requestVersion === previewVersion && key === preferencesKey()) preview.value = data;
  } catch (err) { if (version === loadVersion && requestVersion === previewVersion) error.value = err.message || '预览失败，请重试'; }
  finally { if (requestVersion === previewVersion) previewing.value = false; }
}
function openAdjustment(task) {
  adjustingTask.value = task; Object.assign(definition, {title:task.title,dueAt:task.dueAt,reason:''}); adjustVisible.value = true;
}
async function saveAdjustment() {
  if (!plan.value || !adjustingTask.value || saving.value) return;
  if (definition.title.trim().length < 2 || !definition.dueAt || definition.reason.trim().length < 2) return ElMessage.warning('请填写任务名称、截止日期及至少 2 字的调整原因');
  const version = loadVersion; saving.value = true;
  try { const data = await adjustGrowthTask(plan.value.id, adjustingTask.value.id, { revision:plan.value.revision, ...definition });
    if (version === loadVersion) { plan.value = data; adjustVisible.value = false; ElMessage.success('任务调整已保存，过程记录已保留'); }
  } catch (err) { if (version === loadVersion) ElMessage.error(err.message || '调整失败，请刷新后重试'); }
  finally { saving.value = false; }
}
function editTask(task) {
  draftVersion++; editingTask.value = task; draft.notes = task.notes || ''; uploads = 0; uploading.value = false;
  fileList.value = (task.attachments || []).map((url, index) => ({ uid: index, name: `证明材料 ${index + 1}`, url, status: 'success' })); editVisible.value = true;
}
function removeEvidence(file) { fileList.value = fileList.value.filter(item => item.uid !== file.uid); }
const onExceed = () => ElMessage.warning('最多上传 5 份证明材料');
async function uploadEvidence(file) {
  if (!file.raw) return;
  const version = draftVersion;
  if (file.size > 10 * 1024 * 1024 || !/\.(jpe?g|png|webp|gif|bmp|pdf)$/i.test(file.name)) { removeEvidence(file); return ElMessage.warning('请选择 10MB 以内的图片或 PDF'); }
  uploads++; uploading.value = true; file.status = 'uploading';
  try { const body = new FormData(); body.append('photos', file.raw); const data = await uploadProof(body);
    if (version !== draftVersion) return;
    const current = fileList.value.find(item => item.uid === file.uid); if (!current) return;
    if (!data.urls?.[0]) throw new Error('上传未返回材料地址'); current.url = data.urls[0]; current.status = 'success';
  } catch (err) { if (version === draftVersion) { const current = fileList.value.find(item => item.uid === file.uid); if (current) current.status = 'fail'; ElMessage.error(err.message || '上传失败，请重试'); } }
  finally { if (version === draftVersion) { uploads--; uploading.value = uploads > 0; } }
}
async function saveTask(status) {
  if (uploading.value || fileList.value.some(file => file.status !== 'success')) return ElMessage.warning('请等待上传完成，或移除失败的附件');
  const version = loadVersion; const currentPlan = plan.value; const taskId = editingTask.value?.id;
  if (!currentPlan || !taskId) return;
  saving.value = true;
  try { const data = await updateGrowthTask(currentPlan.id, taskId, { revision: currentPlan.revision, status, notes: draft.notes, attachments: fileList.value.map(file => file.url) });
    if (version === loadVersion) { plan.value = data; editVisible.value = false; ElMessage.success(status === 'submitted' ? '已提交教师核验' : '成长进度已保存'); }
  } catch (err) { if (err.response?.status === 409 || err.code === 409) { editVisible.value = false; await loadPlan(); } ElMessage.error(err.message || '保存失败'); }
  finally { saving.value = false; }
}
function openReview(task) { editingTask.value = task; feedback.value = ''; reviewVisible.value = true; }
async function sendReview(decision) {
  if (feedback.value.trim().length < 2) return ElMessage.warning('请填写核验意见');
  const version = loadVersion; const currentPlan = plan.value; if (!currentPlan || !editingTask.value) return;
  saving.value = true;
  try { const data = await reviewGrowthTask(currentPlan.id, editingTask.value.id, { revision: currentPlan.revision, decision, feedback: feedback.value });
    if (version === loadVersion) { plan.value = data; reviewVisible.value = false; ElMessage.success('核验意见已保存'); }
  } catch (err) { if (err.response?.status === 409 || err.code === 409) { reviewVisible.value = false; await loadPlan(); } ElMessage.error(err.message || '反馈保存失败'); }
  finally { saving.value = false; }
}
onMounted(async () => { if (isReviewer.value) await searchStudents(); await loadPlan(); });
</script>

<style scoped>
.growth-page { --ink:#183047; --blue:#2563eb; --teal:#11796f; --muted:#64748b; --line:#dce5f2; color:var(--ink); }
.growth-filters { display:flex; gap:12px; flex-wrap:wrap; padding:16px; margin-bottom:20px; }
.growth-filters .el-select { width:185px; }.growth-notice { margin-bottom:16px; }
.journey-layout { display:grid; grid-template-columns:280px minmax(0,1fr); gap:24px; align-items:start; }
.journey-context { padding:24px; position:sticky; top:16px; border-top:4px solid var(--teal); }
.context-label,.context-source,.quiet-note { color:var(--muted); font-size:12px; line-height:1.7; }
.journey-context h2 { font-family:'STSong','SimSun',serif; font-size:27px; margin:12px 0; }
.journey-context p { font-size:13px; line-height:1.8; }.growth-goal { border-top:1px solid var(--line); padding:18px 0 8px; margin-top:16px; }
.growth-goal strong { font-size:14px; }.growth-goal p { color:var(--muted); margin-top:8px; }.quiet-note { margin-top:18px; }
.journey-heading { display:flex; justify-content:space-between; align-items:center; margin:0 0 16px; gap:12px; }
.journey-heading h2 { font-size:18px; margin:0; }.journey-heading span { font-size:13px; color:var(--muted); }
.growth-task { display:flex; margin-bottom:16px; overflow:hidden; padding:0; }
.task-milestone { flex:0 0 112px; padding:24px 12px; text-align:center; border-right:1px solid var(--line); background:#f3f7fc; }
.task-milestone span { display:block; font:600 30px/1.2 ui-monospace,Consolas,monospace; color:var(--teal); }
.task-milestone time { display:block; margin-top:12px; font:11px/1.7 ui-monospace,Consolas,monospace; color:var(--muted); }
.task-main { min-width:0; flex:1; padding:22px; }.task-heading { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; }
.task-heading h3 { font-size:16px; line-height:1.6; margin:0; }.task-record { white-space:pre-wrap; line-height:1.8; font-size:14px; }
.task-proofs { display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; }a { color:var(--blue); font-size:13px; text-decoration:underline; }
.task-feedback { border-left:3px solid var(--teal); padding:12px 16px; background:#f1f8f6; margin-top:16px; font-size:13px; }
.task-feedback p { white-space:pre-wrap; line-height:1.7; }.task-feedback time { font-size:11px; color:var(--muted); }.task-actions { margin-top:18px; }
@media(max-width:900px) { .journey-layout { grid-template-columns:1fr; }.journey-context { position:static; } }
@media(max-width:520px) { .growth-filters .el-select { width:100%; }.task-milestone { flex-basis:68px; padding:20px 8px; }.task-milestone time { font-size:10px; }.task-main { padding:16px; }.task-heading { flex-direction:column; }.journey-heading { align-items:flex-start; flex-direction:column; } }
a:focus-visible { outline:2px solid var(--blue); outline-offset:3px; }
.preference-panel { padding:22px; margin:16px 0; }.preference-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; }.preference-heading h2 { font-size:17px; margin:0; }.preference-heading p,.preference-hint,.planning-context { font-size:12px; color:var(--muted,#63758b); line-height:1.8; }.preference-form { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0 16px; margin-top:16px; }.preference-form .el-select { width:100%; }.personal-goal { grid-column:1/-1; }.preference-hint { color:#b45309; margin:0; }@media(max-width:700px) { .preference-heading { align-items:flex-start; flex-direction:column; }.preference-form { grid-template-columns:minmax(0,1fr); }.preference-panel { padding:18px 14px; } }
</style>
