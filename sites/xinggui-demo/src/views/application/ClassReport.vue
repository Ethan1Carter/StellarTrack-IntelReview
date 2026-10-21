<template>
  <div class="class-report-page">
    <WorkspaceHero
      eyebrow="CLASS ASSESSMENT REPORT"
      title="班级综合考评报表"
      description="按学年与学期汇总班级考评结果，完成生成、上报、审核与归档。"
    />

    <div class="card mt-16 report-workspace">
      <div class="report-filter-title"><strong>报表范围</strong><span>选择班级和统计周期后生成报表</span></div>
      <div class="filters">
        <el-select v-if="roleAboveCollege" v-model="filter.collegeId" placeholder="选择院系" clearable style="width:180px" @change="loadClasses">
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="filter.classId" placeholder="选择班级" style="width:240px" filterable :disabled="!classes.length" @change="loadReport">
          <el-option v-for="c in classes" :key="c.id"
            :label="`${c.name}${c.counselorName ? '（辅导员：'+c.counselorName+'）' : ''}${c.classAdminName ? '【班级管理员：'+c.classAdminName+'】' : ''}`"
            :value="c.id" />
        </el-select>
        <el-select v-model="filter.academicYear" placeholder="学年" style="width:140px" @change="loadReport">
          <el-option v-for="s in activeSemesters" :key="s.academicYear+'_'+s.semester" :label="s.academicYear" :value="s.academicYear" />
          <el-option v-for="y in years" :key="y" :label="`${y}-${y+1}学年`" :value="`${y}-${y+1}`" />
        </el-select>
        <el-select v-model="filter.semester" placeholder="学期" style="width:130px" clearable @change="loadReport">
          <el-option label="第一学期" value="first" />
          <el-option label="第二学期" value="second" />
          <el-option label="全学年" value="annual" />
        </el-select>
        <el-button v-if="canGenerate" type="primary" :loading="generating" @click="genReport"><Refresh /> 生成/刷新报表</el-button>

        <!-- 状态徽章 + 按钮组 -->
        <template v-if="report">
          <el-tag :type="REPORT_STATUS_TAG[report.status].type" effect="dark">{{ REPORT_STATUS_TAG[report.status].label }}</el-tag>
          <el-button type="success" v-if="canSubmit" :disabled="report.status!=='draft' && report.status!=='rejected'" @click="submitReport" :loading="submitting">
            <Upload /> {{ report.status==='rejected' ? '重新修订后上报辅导员' : '上报审批辅导员' }}
          </el-button>
          <el-button type="warning" v-if="canReviewCounselor && report.status==='submitted'" @click="openRejectDialog" :loading="rejecting"><Back /> 打回</el-button>
          <el-button type="primary" v-if="canReviewCounselor && report.status==='submitted'" @click="handleApproveReport" :loading="approving"><Finished /> 审批通过</el-button>
        </template>
      </div>

      <div v-if="loading || generating" class="empty-wrap"><el-icon class="loading-icon" :size="32"><Loading /></el-icon> 报表生成中...</div>

      <div v-else-if="report" class="report-body">
        <el-descriptions :column="3" border class="mb-16" size="default">
          <el-descriptions-item label="班级名称" :span="2"><b>{{ report.classInfo?.name }}</b></el-descriptions-item>
          <el-descriptions-item label="报表状态">
            <el-tag :type="REPORT_STATUS_TAG[report.status].type" effect="dark">{{ REPORT_STATUS_TAG[report.status].label }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="所属院系">{{ report.classInfo?.collegeName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="年级/专业">{{ (report.classInfo?.grade || '') + ' ' + (report.classInfo?.major || '') || '-' }}</el-descriptions-item>
          <el-descriptions-item label="辅导员">
            <span v-if="report.classInfo?.counselorName" style="font-weight:500;">{{ report.classInfo.counselorName }}</span>
            <span v-else style="color:#F56C6C;">未分配</span>
            <span v-if="report.classInfo?.counselor" style="color:#909399;margin-left:6px;">
              账号: {{ report.classInfo.counselor.username }} / {{ report.classInfo.counselor.phone || '无手机号' }} / {{ report.classInfo.counselor.email || '' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="班级管理员">
            <span v-if="report.classInfo?.classAdminName" style="font-weight:500;">{{ report.classInfo.classAdminName }}</span>
            <span v-else style="color:#F56C6C;">未分配</span>
            <span v-if="report.classInfo?.classAdmin" style="color:#909399;margin-left:6px;">
              账号: {{ report.classInfo.classAdmin.username }} / {{ report.classInfo.classAdmin.phone || '无手机号' }} / {{ report.classInfo.classAdmin.email || '' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="统计周期">{{ filter.academicYear }}学年{{ filter.semester ? (SEM_LABEL[filter.semester] || '') : '（全学年）' }}</el-descriptions-item>
          <el-descriptions-item label="打回次数" v-if="report.resubmitCount">{{ report.resubmitCount }}</el-descriptions-item>
        </el-descriptions>

        <!-- 流程状态/备注 -->
        <el-row :gutter="16" class="mb-16">
          <el-col :span="8">
            <div class="status-box">
              <div class="lbl">班级管理员备注</div>
              <div class="val">{{ report.classAdminRemark || '（无）' }}</div>
              <div class="sub" v-if="report.submittedAt">上报时间：{{ formatTime(report.submittedAt) }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="status-box warn">
              <div class="lbl">辅导员打回原因</div>
              <div class="val"><b v-if="report.rejectReason" style="color:#F56C6C;">{{ report.rejectReason }}</b><span v-else>（无）</span></div>
              <div class="sub" v-if="report.rejectedAt">打回时间：{{ formatTime(report.rejectedAt) }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="status-box success">
              <div class="lbl">辅导员审批</div>
              <div class="val">{{ report.counselorRemark || '（待辅导员处理）' }}</div>
              <div class="sub" v-if="report.approvedAt">通过时间：{{ formatTime(report.approvedAt) }}</div>
              <div class="sub" v-else-if="report.reviewedAt">处理时间：{{ formatTime(report.reviewedAt) }}</div>
            </div>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="mb-16">
          <el-col :span="6"><div class="stat-box info"><div class="label">班级人数</div><div class="val">{{ report.stats?.studentCount }}</div></div></el-col>
          <el-col :span="6"><div class="stat-box success"><div class="label">已获加分人数</div><div class="val">{{ report.stats?.submittedCount }}<span class="sub">（提交率 {{ rate(report.stats?.submittedCount, report.stats?.studentCount) }}%）</span></div></div></el-col>
          <el-col :span="6"><div class="stat-box warn"><div class="label">通过申报总数</div><div class="val">{{ report.stats?.approvedApps }}</div></div></el-col>
          <el-col :span="6"><div class="stat-box primary"><div class="label">平均分 / 最高分</div><div class="val">{{ report.stats?.classAvgScore }}<span class="sub"> / 最高 {{ report.stats?.classMaxScore }}（{{ report.stats?.topStudentName || '-' }}）</span></div></div></el-col>
        </el-row>

        <el-tabs v-model="tab" class="mt-20">
          <el-tab-pane label="学生得分明细" name="students">
            <el-table :data="report.rows" stripe border>
              <el-table-column type="index" label="排名" width="70" align="center" fixed />
              <el-table-column prop="studentNo" label="学号" width="140" fixed />
              <el-table-column prop="name" label="姓名" width="110" fixed />
              <el-table-column prop="username" label="账号" width="130" fixed />
              <el-table-column
                v-for="mid in moduleIds"
                :key="mid"
                :label="moduleName(mid)"
                :prop="'byModule.' + mid"
                width="120"
                align="center"
              >
                <template #default="{row}">
                  <span
                    v-if="row.byModule && row.byModule[mid] != null"
                    class="module-score-cell"
                    @click="openModuleDetail(row, mid)"
                  >{{ Number(row.byModule[mid]).toFixed(2) }}</span>
                  <span v-else class="zero-score">-</span>
                </template>
              </el-table-column>
              <el-table-column prop="appCount" label="申报项数" width="100" align="center" />
              <el-table-column prop="totalScore" label="总分" width="110" align="center" sortable fixed="right">
                <template #default="{row}"><b style="color:#409EFF;">{{ row.totalScore }}</b></template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="审批环节与申报明细（辅导员审核）" name="apps">
            <div class="tip mb-12"><el-icon><InfoFilled /></el-icon> 查看每位学生的申报情况与班级管理员的审批记录，辅导员在此基础上打回/通过报表。</div>
            <el-table :data="report.applications" stripe border>
              <el-table-column prop="id" label="ID" width="70" align="center" />
              <el-table-column label="学生" width="130">
                <template #default="{row}">{{ row.student?.realName }}（{{ row.student?.username }}）</template>
              </el-table-column>
              <el-table-column label="模块" width="130">
                <template #default="{row}"><el-tag v-if="row.module" :style="{background: row.module.color, border:'none'}" effect="dark" size="small">{{ row.module.name }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="title" label="申报标题" min-width="200" show-overflow-tooltip />
              <el-table-column label="申请分" width="80" align="center">{{ row.applyScore }}</el-table-column>
              <el-table-column label="最终分" width="80" align="center"><b v-if="row.finalScore!==null" style="color:#67C23A;">{{ row.finalScore }}</b><span v-else style="color:#909399;">-</span></el-table-column>
              <el-table-column label="状态" width="100" align="center"><StatusTag :status="row.status" /></el-table-column>
              <el-table-column label="审批环节（含班级管理员审批）" min-width="320">
                <template #default="{row}">
                  <el-steps v-if="(row.reviews||[]).length>0" :active="stepActive(row)" size="small" finish-status="success">
                    <el-step v-for="(r,idx) in row.reviews" :key="idx" :title="stepTitle(r,idx+1)" :description="stepDesc(r)" />
                  </el-steps>
                  <span v-else style="color:#909399;">暂无审批记录</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90" align="center" fixed="right">
                <template #default="{row}">
                  <el-button link type="primary" @click="openDetail(row)">详情</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>

      <el-empty v-else description="请先选择班级+学期并点击【生成/刷新报表】" />
    </div>

    <el-dialog v-model="rejectVisible" title="打回班级报表（班级管理员需修订后重新上报）" width="min(500px,92vw)">
      <el-form ref="rejectRef" :model="rejectForm" :rules="rejectRules" label-width="100px">
        <el-form-item label="打回原因" prop="rejectReason"><el-input v-model="rejectForm.rejectReason" type="textarea" :rows="4" placeholder="请详细说明需要班级管理员修订的地方（必填）" /></el-form-item>
        <el-form-item label="辅导员备注"><el-input v-model="rejectForm.counselorRemark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectVisible=false">取消</el-button>
        <el-button type="warning" :loading="rejecting" @click="confirmReject">确认打回</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="submitVisible" title="上报辅导员审批" width="min(500px,92vw)">
      <el-form :model="submitForm" label-width="100px">
        <el-form-item label="班级管理员备注"><el-input v-model="submitForm.classAdminRemark" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible=false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">确认上报</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="申报详情" width="min(860px, 92vw)" destroy-on-close>
      <ApplyDetailDialog v-if="current" v-model="subDetailVisible" :app="current" append-to-body />
    </el-dialog>

    <el-dialog v-model="moduleDetailVisible" :title="moduleDetailTitle" width="min(900px, 92vw)" destroy-on-close>
      <div v-if="moduleDetailLoading" class="empty-wrap"><el-icon class="loading-icon" :size="28"><Loading /></el-icon> 加载中...</div>
      <div v-else>
        <el-descriptions :column="3" border size="small" class="mb-16">
          <el-descriptions-item label="学生">{{ moduleDetailStudent.name }}（{{ moduleDetailStudent.studentNo }}）</el-descriptions-item>
          <el-descriptions-item label="模块">{{ moduleDetailStudent.moduleName }}</el-descriptions-item>
          <el-descriptions-item label="模块总分">
            <b style="color:#409EFF;font-size:16px;">{{ moduleDetailStudent.score }}</b> 分
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="moduleDetailApps" stripe border size="small">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="title" label="申报事项" min-width="200" show-overflow-tooltip />
          <el-table-column label="等级" width="90" align="center">
            <template #default="{row}">{{ levelLabel(row.level) }}</template>
          </el-table-column>
          <el-table-column prop="applyScore" label="申请分" width="80" align="center" />
          <el-table-column label="单项得分" width="90" align="center">
            <template #default="{row}"><b style="color:#67C23A;">{{ row.finalScore }}</b></template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center"><StatusTag :status="row.status" /></el-table-column>
          <el-table-column label="通过时间" width="150" align="center">
            <template #default="{row}">{{ row.approvedAt ? formatTime(row.approvedAt) : '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="moduleDetailApps.length === 0" style="text-align:center;color:#909399;padding:24px;">该模块下暂无审批通过的申报记录</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import dayjs from 'dayjs';
import StatusTag from '@/components/StatusTag.vue';
import ApplyDetailDialog from '@/components/ApplyDetailDialog.vue';
import { getClassReport as _oldGet } from '@/api/applications';
import { generateClassReport, getClassReport, submitReportToCounselor, rejectReport, approveReport as approveReportApi, listActiveSemesters } from '@/api/semesters';
import { listAllColleges } from '@/api/college';
import { getClassList, getMyClassInfo } from '@/api/classes';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { DocumentCopy, Refresh, Finished, Upload, Back, Loading, InfoFilled } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const roleAboveCollege = computed(() => ['college_admin','school_admin','super_admin'].includes(userStore.role));
const canSubmit = computed(() => ['class_admin'].includes(userStore.role));  // 班级管理员上报
const canGenerate = computed(() => userStore.role === 'class_admin');
const canReviewCounselor = computed(() => ['counselor','college_admin','school_admin','super_admin'].includes(userStore.role)); // 辅导员及以上审批
const SEM_LABEL = { first:'（第一学期）', second:'（第二学期）', annual:'（全学年）' };
const REPORT_STATUS_TAG = {
  draft:     { label:'草稿（可编辑）', type:'info' },
  submitted: { label:'已上报，等待辅导员审批', type:'warning' },
  rejected:  { label:'辅导员已打回，请修订后重报', type:'' },
  approved:  { label:'辅导员已通过，学校/学院可查看', type:'success' }
};

const tab = ref('students');
const classes = ref([]);
const colleges = ref([]);
const years = ref(Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i));
const activeSemesters = ref([]);
const filter = reactive({ collegeId:'', classId:null, academicYear:(() => { const y=new Date().getFullYear(); const m=new Date().getMonth()+1; if (m>=9) return `${y}-${y+1}`; return `${y-1}-${y}`; })(), semester:'first' });
const report = ref(null); const loading = ref(false); const generating = ref(false);
const submitting = ref(false); const rejecting = ref(false); const approving = ref(false);

const rate = (a, b) => b>0 ? Math.round(Number(a||0)/b*1000)/10 : 0;
const formatTime = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '';
const moduleName = (id) => report.value?.moduleNames ? (report.value.moduleNames[id] || '模块#'+id) : ('#'+id);
const levelLabel = (lv) => ({ international:'国际级', national:'国家级', provincial:'省部级', school:'市校级', college:'院系级' })[lv] || lv || '-';

// 动态模块列：从 report.moduleNames 提取所有 moduleId
const moduleIds = computed(() => {
  if (!report.value?.moduleNames) return [];
  return Object.keys(report.value.moduleNames).map(Number).sort((a, b) => a - b);
});

// 模块分数详情弹窗
const moduleDetailVisible = ref(false);
const moduleDetailLoading = ref(false);
const moduleDetailTitle = ref('');
const moduleDetailStudent = reactive({ name:'', studentNo:'', moduleName:'', score:0 });
const moduleDetailApps = ref([]);

const openModuleDetail = async (row, moduleId) => {
  const mName = moduleName(moduleId);
  moduleDetailStudent.name = row.name;
  moduleDetailStudent.studentNo = row.studentNo;
  moduleDetailStudent.moduleName = mName;
  moduleDetailStudent.score = row.byModule?.[moduleId] ? Number(row.byModule[moduleId]).toFixed(2) : '0.00';
  moduleDetailTitle.value = `${mName} - ${row.name} 的得分明细`;
  moduleDetailVisible.value = true;
  moduleDetailLoading.value = false;
  // 从 report.applications 中筛选该学生该模块的审批通过申报
  moduleDetailApps.value = (report.value?.applications || []).filter(a =>
    a.studentId === row.studentId &&
    a.moduleId === moduleId &&
    ['approved', 'final_review'].includes(a.status)
  );
};
const stepTitle = (r,i) => `第${i}级 ${r.action==='passed'?'通过':(r.action==='refused'?'驳回':'等待')}`;
const stepDesc  = (r) => `${r.reviewerName||'审批人'}：${r.comment||''}${r.time?'（'+formatTime(r.time)+'）':''}`;
const stepActive = (row) => (row.reviews||[]).findIndex(r => ['passed','refused','returned'].includes(r.action)) + 1;

const loadClasses = async () => {
  try {
    const p = { pageSize: 500 };
    if (filter.collegeId) p.collegeId = filter.collegeId;
    // 辅导员：仅显示自己的班级；班级管理员：仅显示自己管理的班级
    const raw = (await getClassList(p))?.list || [];
    classes.value = raw.map(c => ({
      id: c.id,
      name: c.name,
      counselorName: c.counselor?.realName || '',
      classAdminName: c.classAdmin?.realName || ''
    }));
    // 如果是班级管理员/辅导员：默认选第一个
    if (!filter.classId && classes.value.length === 1) { filter.classId = classes.value[0].id; }
  } catch (_) {}
};

const genReport = async () => {
  if (!filter.classId) { ElMessage.warning('请先选择班级'); return; }
  generating.value = true;
  try {
    const r = await generateClassReport(filter.classId, { academicYear: filter.academicYear, semester: filter.semester });
    report.value = { ...r };
    ElMessage.success('报表生成完成');
  } finally { generating.value = false; }
};

const loadReport = async () => {
  if (!filter.classId) { report.value = null; return; }
  loading.value = true;
  try {
    report.value = await getClassReport(filter.classId, { academicYear: filter.academicYear, semester: filter.semester });
  } finally { loading.value = false; }
};

// 上报
const submitVisible = ref(false); const submitForm = reactive({ classAdminRemark:'' });
const submitReport = () => { if (report.value?.id) { submitVisible.value = true; } };
const confirmSubmit = async () => {
  if (!report.value?.id) return;
  submitting.value = true;
  try {
    await submitReportToCounselor(report.value.id, submitForm);
    ElMessage.success('已上报给辅导员');
    submitVisible.value = false;
    await loadReport();
  } finally { submitting.value = false; }
};

// 打回
const rejectVisible = ref(false); const rejectRef = ref(); const rejectForm = reactive({ rejectReason:'', counselorRemark:'' });
const rejectRules = { rejectReason:[{ required:true, message:'请填写打回原因（必填）', trigger:'blur' }] };
const openRejectDialog = () => { rejectForm.rejectReason=''; rejectForm.counselorRemark=''; rejectVisible.value = true; };
const confirmReject = async () => {
  await rejectRef.value.validate();
  rejecting.value = true;
  try {
    await rejectReport(report.value.id, rejectForm);
    ElMessage.success('已打回');
    rejectVisible.value = false;
    await loadReport();
  } finally { rejecting.value = false; }
};

// 通过
const handleApproveReport = async () => {
  try {
    await ElMessageBox.confirm('确定审批通过？通过后学校、学院均可查看本报表', '确认', { type:'warning' });
  } catch { return; }
  approving.value = true;
  try {
    await approveReportApi(report.value.id, { counselorRemark:'' });
    ElMessage.success('审批通过');
    await loadReport();
  } finally { approving.value = false; }
};

// 详情
const detailVisible = ref(false); const subDetailVisible = ref(true); const current = ref(null);
const openDetail = (row) => { current.value = row; detailVisible.value = true; };

// 初始化：班级管理员/辅导员自动绑定自己管理的班级
onMounted(async () => {
  try { activeSemesters.value = await listActiveSemesters() || []; } catch (_) {}
  if (['school_admin','super_admin'].includes(userStore.role)) {
    try { colleges.value = await listAllColleges() || []; } catch (_) {}
  }
  // 班级管理员/辅导员：自动取自己的班级（/classes/my/info 接口返回）
  if (['class_admin','counselor'].includes(userStore.role)) {
    try {
      const info = await getMyClassInfo();
      if (info?.classInfo?.id) filter.classId = info.classInfo.id;
    } catch (_) {}
  }
  await loadClasses();
  if (filter.classId) await loadReport();
});
watch(()=>filter.classId, (n)=>{ if (n) loadReport(); else report.value = null; });
</script>

<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:0 16px 16px; align-items:center; }
.empty-wrap { display:flex; align-items:center; justify-content:center; color:#909399; padding:48px 0; }
.loading-icon { color:#409EFF; margin-right:8px; animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.stat-box { padding:16px; border-radius:6px; background:#f4f4f5; margin-bottom:8px;
  .label { color:#909399; font-size:12px; }
  .val { font-size:24px; font-weight:600; color:#303133; margin-top:6px;
    .sub { font-size:12px; color:#909399; font-weight:400; margin-left:6px; } }
  &.info { background:#ecf5ff; .val { color:#409EFF; } }
  &.success { background:#f0f9eb; .val { color:#67C23A; } }
  &.warn { background:#fdf6ec; .val { color:#E6A23C; } }
  &.primary { background:#f4f4ff; .val { color:#5D5DFF; } }
}
.status-box { padding:12px 16px; border-radius:6px; background:#f5f7fa; border:1px solid #ebeef5;
  .lbl { color:#909399; font-size:12px; margin-bottom:4px; }
  .val { color:#303133; min-height:24px; }
  .sub { margin-top:6px; font-size:12px; color:#909399; }
  &.warn { background:#fdf6ec; border-color:#faecd8; }
  &.success { background:#f0f9eb; border-color:#e1f3d8; }
}
.tip { color:#909399; }
.mb-12 { margin-bottom:12px; }
.mb-16 { margin-bottom:16px; }
.mt-16 { margin-top:16px; }
.mt-20 { margin-top:20px; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
.module-score-cell {
  cursor: pointer;
  font-weight: 600;
  color: #409EFF;
  transition: color 0.2s;
  display: inline-block;
  min-width: 100%;
  text-align: center;
}
.module-score-cell:hover {
  color: #66b1ff;
  text-decoration: underline;
}
.zero-score {
  color: #c0c4cc;
}
.report-workspace { padding: 0; overflow: hidden; border-radius: 18px; border-color: #DDE7F2; box-shadow: 0 12px 34px rgba(22,44,84,.06); }
.report-filter-title { padding: 17px 20px 8px; background: linear-gradient(90deg, #F8FAFD, #F5FAFF);
  strong { display: block; color: #17233B; font-size: 14px; }
  span { display: block; margin-top: 3px; color: #94A3B8; font-size: 11px; }
}
.filters { padding: 8px 20px 17px; background: linear-gradient(90deg, #F8FAFD, #F5FAFF); border-bottom: 1px solid #E7EEF6; }
:deep(.filters .el-select__wrapper) { min-height: 38px; background: #fff; }
.report-body { padding: 20px; }
:deep(.report-body .el-descriptions) { overflow: hidden; border-radius: 14px; }
:deep(.report-body .el-descriptions__label) { color: #66768D; background: #F4F8FC !important; font-weight: 650; }
.stat-box { min-height: 110px; padding: 18px; border: 1px solid #E0E9F3; border-radius: 15px; background: #fff !important; box-shadow: 0 8px 24px rgba(22,44,84,.045);
  .label { color: #7A899D; }
  .val { color: #17233B !important; font-size: 26px; }
  &.info { border-top: 3px solid #2563EB; }
  &.success { border-top: 3px solid #0F9F82; }
  &.warn { border-top: 3px solid #E99708; }
  &.primary { border-top: 3px solid #7C5CE5; }
}
.status-box { min-height: 104px; padding: 15px 17px; border-color: #E0E9F3; border-radius: 14px; background: #F8FAFD;
  &.warn { background: #FFF9EC; border-color: #F7E6BB; }
  &.success { background: #EDF9F5; border-color: #CBECE1; }
}
:deep(.report-body > .el-tabs > .el-tabs__header) { margin-top: 18px; }
.empty-wrap { min-height: 280px; background: linear-gradient(#fff, #FAFCFF); }
@include mobile {
  .filters { align-items: stretch; flex-direction: column; }
  :deep(.filters .el-select), .filters > .el-button { width: 100% !important; }
  .report-body { padding: 14px; }
}
</style>
