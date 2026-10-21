<template>
  <div class="my-applications">
    <WorkspaceHero
      eyebrow="MY APPLICATIONS"
      title="我的申报"
      description="按学期查看申报进度、认定分数与审批反馈，及时补充材料或发起申诉。"
    >
      <template #actions>
        <div class="header-actions">
        <el-tooltip content="存在未读审批/申诉结果消息时显示红点" placement="bottom">
          <el-badge :value="unreadCount" :hidden="unreadCount === 0" :max="99">
            <el-button :type="unreadCount > 0 ? 'danger' : 'default'" plain @click="goProfile">
              <el-icon><Bell /></el-icon> 消息
            </el-button>
          </el-badge>
        </el-tooltip>
        <el-button type="primary" :disabled="isHistorySemester" @click="$router.push('/apply')">
          <el-icon><Plus /></el-icon> 新增申报
        </el-button>
        </div>
      </template>
    </WorkspaceHero>

    <!-- 学期选择 + 分数汇总卡片 -->
    <div class="card semester-bar">
      <div class="semester-row">
        <span class="lbl"><el-icon><Calendar /></el-icon> 学期：</span>
        <el-select v-model="curSemesterId" placeholder="请选择学期" style="width:280px" @change="onSemesterChange">
          <el-option
            v-for="s in semesters"
            :key="s.id"
            :label="formatSemesterLabel(s)"
            :value="s.id">
            <span style="float:left">{{ formatSemesterLabel(s) }}</span>
            <el-tag v-if="s.applyStatus === 'started'" type="success" size="small" effect="dark" style="float:right; margin-top:8px;">申报中</el-tag>
            <el-tag v-else type="info" size="small" effect="plain" style="float:right; margin-top:8px;">历史</el-tag>
          </el-option>
        </el-select>
        <el-tag v-if="isHistorySemester" type="warning" effect="dark" size="default">
          历史学期（只读，不可新增/编辑/撤回/申诉）
        </el-tag>
      </div>

      <!-- 模块分数汇总 -->
      <div class="score-summary" v-loading="summaryLoading">
        <div class="summary-totals">
          <div class="total-card pending">
            <div class="lbl">待认定分数</div>
            <div class="val">{{ formatScore(summary.totalPending) }}</div>
          </div>
          <div class="total-card approved">
            <div class="lbl">已认定生效分数</div>
            <div class="val">{{ formatScore(summary.totalApproved) }}</div>
          </div>
        </div>
        <div class="summary-modules" v-if="summary.modules && summary.modules.length">
          <div v-for="m in summary.modules" :key="m.moduleId" class="module-summary">
            <div class="m-tag" :style="{ background: m.color || '#409EFF' }">{{ m.name }}</div>
            <div class="m-scores">
              <span class="ms pending">待认定 <b>{{ formatScore(m.pendingScore) }}</b></span>
              <span class="ms approved">已认定 <b>{{ formatScore(m.approvedScore) }}</b></span>
              <span class="ms count">{{ m.appCount }} 次</span>
            </div>
          </div>
        </div>
        <el-empty v-else description="该学期暂无申报记录" :image-size="50" />
      </div>
    </div>

    <!-- 筛选 + 列表 -->
    <div class="card">
      <div class="filters">
        <el-select v-model="f.status" placeholder="全部状态" style="width:160px" clearable @change="go(1)">
          <el-option label="草稿" value="draft" />
          <el-option label="待班级管理员审批" value="pending,approving" />
          <el-option label="待补充" value="returned" />
          <el-option label="辅导员终审" value="final_review" />
          <el-option label="已通过" value="approved" />
          <el-option label="已驳回" value="rejected" />
          <el-option label="申诉中" value="appealing" />
          <el-option label="已撤销" value="revoked" />
        </el-select>
        <el-select v-model="f.moduleId" placeholder="全部模块" style="width:180px" clearable filterable @change="go(1)">
          <el-option v-for="m in modules" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <el-date-picker v-model="f.dateRange" type="daterange" range-separator="至"
          start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px"
          value-format="YYYY-MM-DD" @change="go(1)" />
        <el-input v-model="f.keyword" placeholder="搜索标题/说明/ID" clearable style="width:220px" @clear="go(1)" @keyup.enter="go(1)">
          <template #append><el-button @click="go(1)">搜索</el-button></template>
        </el-input>
        <el-button @click="resetFilters" plain><el-icon><Refresh /></el-icon> 重置</el-button>
        <div class="filter-right">
          <el-button type="success" plain :loading="exporting" @click="exportList">
            <el-icon><Download /></el-icon> 导出 Excel
          </el-button>
        </div>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="id" label="序号" width="70" />
        <el-table-column prop="approvalNo" label="审批单号" width="190">
          <template #default="{row}">
            <el-tooltip v-if="row.approvalNo" content="全局唯一审批单ID（AP+创建年月日+6位流水号）" placement="top">
              <span style="font-family: monospace; letter-spacing: 0.3px; color: #606266;">{{ row.approvalNo }}</span>
            </el-tooltip>
            <span v-else style="color:#c0c4cc;">--</span>
          </template>
        </el-table-column>
        <el-table-column label="模块" width="160">
          <template #default="{row}">
            <el-tag :style="{background: row.module?.color, border: 'none'}" effect="dark">{{ row.module?.name || '-' }}</el-tag>
            <el-tag v-if="row.appealCount>0" style="margin-left:6px;" type="warning" effect="light" size="small">申诉 {{ row.appealCount }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column label="分数" width="110" align="center">
          <template #default="{row}">
            <span v-if="['approved','final_review'].includes(row.status)" style="color:#67C23A; font-weight:600;">+{{ row.finalScore ?? row.score }}</span>
            <span v-else-if="row.status==='revoked'" style="color:#909399; text-decoration: line-through;">已撤销</span>
            <span v-else style="color:#909399;">申请 {{ row.score }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单据状态" width="140" align="center">
          <template #default="{row}">
            <StatusTag :status="row.status" />
            <el-tag v-if="isHistorySemester" type="info" effect="plain" size="small" style="margin-left:4px;">历史学期</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申诉状态" width="140" align="center">
          <template #default="{row}">
            <el-tag v-if="row.appealState === 'pending'" type="danger" effect="dark" size="small">申诉中</el-tag>
            <el-tag v-else-if="row.appealState === 'closed'" type="info" effect="plain" size="small">申诉办结</el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="提交时间" width="160">
          <template #default="{row}">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="detail(row)">详情</el-button>
            <!-- 草稿：编辑、删除、提交 -->
            <el-button v-if="row.status==='draft' && !isHistorySemester" link type="primary" @click="toEdit(row)">编辑</el-button>
            <el-popconfirm v-if="row.status==='draft' && !isHistorySemester" title="确认删除该草稿？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
            <el-button v-if="row.status==='draft' && !isHistorySemester" link type="success" @click="toEdit(row)">提交申报</el-button>
            <!-- 待审批：撤回申报 -->
            <el-popconfirm v-if="['pending','approving'].includes(row.status) && !isHistorySemester" title="撤回后变为草稿状态，确定撤回？" @confirm="withdraw(row)">
              <template #reference><el-button link type="warning">撤回</el-button></template>
            </el-popconfirm>
            <!-- 退回（补充修改）：编辑、删除、重新提交 -->
            <el-button v-if="row.status==='returned' && !isHistorySemester" link type="primary" @click="toEdit(row)">编辑</el-button>
            <el-popconfirm v-if="row.status==='returned' && !isHistorySemester" title="确认删除该退回单据？删除后不可恢复" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
            <el-button v-if="row.status==='returned' && !isHistorySemester" link type="success" @click="submitReturned(row)">重新提交</el-button>
            <!-- 申诉窗口期：班级管理员已给出意见（通过/驳回） → 辅导员报表审核上报之前 -->
            <el-button v-if="canAppealByStatus(row.status) && !isHistorySemester && canAppeal(row)"
                       link type="danger" @click="openAppeal(row)">发起申诉</el-button>
            <el-tooltip v-if="canAppealByStatus(row.status) && !isHistorySemester && !canAppeal(row)"
                        content="已达最大申诉次数或存在待处理申诉" placement="top">
              <el-button link type="info" disabled>申诉</el-button>
            </el-tooltip>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="该学期暂无申报记录" />
        </template>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize"
                       @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 申诉表单弹窗 -->
    <el-dialog v-model="appealVisible" title="提交申诉（对班级管理员审批意见/分数有异议）" width="640px" :close-on-click-modal="false" destroy-on-close>
      <el-alert type="warning" show-icon :closable="false" class="mb-16">
        <template #title>提示</template>
        班级管理员给出明确处理意见后、辅导员审核班级报表上报之前可提交申诉。提交后班级管理员将重新审批该单据，请如实填写申诉理由，可上传照片/PDF附件补充证据。该申报最多申诉 {{ currentAppealMaxCount }} 次。
      </el-alert>
      <el-form label-width="100px" :model="af" ref="appealFormRef" :rules="appealRules">
        <el-form-item label="申诉对象">
          <el-descriptions :column="1" border size="small" style="width:100%">
            <el-descriptions-item label="申报标题">{{ af.target?.title || '-' }}</el-descriptions-item>
            <el-descriptions-item label="模块">{{ af.target?.module?.name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="当前状态"><StatusTag :status="af.target?.status" /></el-descriptions-item>
            <el-descriptions-item label="申请分 / 终审分">{{ af.target?.score ?? '-' }} / {{ af.target?.finalScore ?? '未通过' }}</el-descriptions-item>
            <el-descriptions-item label="已申诉次数">{{ af.target?.appealCount || 0 }} / {{ currentAppealMaxCount }}</el-descriptions-item>
          </el-descriptions>
        </el-form-item>
        <el-form-item label="申诉理由" prop="reason">
          <el-input v-model="af.reason" type="textarea" :rows="5" maxlength="800" show-word-limit
            placeholder="请说明对审批结果的异议（如：班级管理员驳回理由不成立、分数调整不合理等），并补充事实依据……（最多 800 字）" />
        </el-form-item>
        <el-form-item label="佐证附件">
          <el-upload
            action="#"
            :auto-upload="false"
            :on-change="onAppealFileChange"
            :on-remove="onAppealFileRemove"
            list-type="picture-card"
            multiple
            :limit="10"
            accept="image/*,.pdf"
            :file-list="af.fileList">
            <el-icon><Plus /></el-icon>
          </el-upload>
          <div style="color:#909399; font-size:12px; margin-top:6px;">支持图片/PDF，最多10个文件</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="appealVisible=false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitAppeal">提交申诉</el-button>
      </template>
    </el-dialog>

    <!-- 申报详情弹窗（整合申诉入口/申诉记录/审批流转） -->
    <ApplyDetailDialog
      v-if="detailVisible"
      v-model="detailVisible"
      :app="detailData"
      :is-history="isHistorySemester"
      @appeal="onDetailAppeal"
      @reapply="onDetailReapply"
      @withdraw="onDetailWithdraw" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import {
  getMyApplications, deleteApplication, getApplicationDetail,
  withdrawApplication, getMySemesters, getMyScoreSummary, exportMyApplications
} from '@/api/applications';
import { submitAppeal as apiSubmitAppeal } from '@/api/appeals';
import { listActiveModules } from '@/api/modules';
import { getUnreadCount } from '@/api/message';
import StatusTag from '@/components/StatusTag.vue';
import ApplyDetailDialog from '@/components/ApplyDetailDialog.vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { Tickets, Plus, Bell, Calendar, Refresh, Download } from '@element-plus/icons-vue';

const router = useRouter();
const route = useRoute();

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const modules = ref([]);
const f = reactive({ page: 1, pageSize: 10, status: '', moduleId: '', keyword: '', dateRange: null });
const fmt = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-';

// ====== 学期选择 ======
const semesters = ref([]);
const curSemesterId = ref(null);
const summary = ref({ modules: [], totalPending: 0, totalApproved: 0 });
const summaryLoading = ref(false);

const currentSemester = computed(() => semesters.value.find(s => s.id === curSemesterId.value) || null);
const isHistorySemester = computed(() => {
  const cur = currentSemester.value;
  if (!cur) return false;
  return cur.applyStatus !== 'started';
});

// 学期格式：2025-2026学年第1学期（阿拉伯数字，将后端 first/second 转为 1/2）
const SEMESTER_NUM = { first: 1, second: 2, '1': 1, '2': 2 };
const formatSemesterLabel = (s) => {
  if (!s) return '';
  const num = SEMESTER_NUM[s.semester] || (Number.isFinite(Number(s.semester)) ? Number(s.semester) : '');
  const numText = num !== '' ? String(num) : (s.semester || '');
  // 优先使用后端 name 字段（如已配置），但需把 "first/second" 替换为阿拉伯数字
  const base = s.name ? String(s.name).replace(/first/i, '1').replace(/second/i, '2') : `${s.academicYear || ''}学年第${numText}学期`;
  return base;
};

const loadSemesters = async () => {
  try {
    const data = await getMySemesters();
    semesters.value = Array.isArray(data) ? data : (data?.list || []);
    // 默认选中 applyStatus=started 的学期；若无则选第一个
    const started = semesters.value.find(s => s.applyStatus === 'started');
    curSemesterId.value = started?.id || semesters.value[0]?.id || null;
  } catch (e) {
    semesters.value = [];
  }
};

const onSemesterChange = async () => {
  f.page = 1;
  await Promise.all([go(1), loadSummary()]);
};

const loadSummary = async () => {
  if (!curSemesterId.value) {
    summary.value = { modules: [], totalPending: 0, totalApproved: 0 };
    return;
  }
  summaryLoading.value = true;
  try {
    const r = await getMyScoreSummary(curSemesterId.value);
    summary.value = {
      modules: r?.modules || [],
      totalPending: Number(r?.totalPending || 0),
      totalApproved: Number(r?.totalApproved || 0)
    };
  } catch (e) {
    summary.value = { modules: [], totalPending: 0, totalApproved: 0 };
  } finally { summaryLoading.value = false; }
};

const formatScore = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

// ====== 列表查询 ======
const go = async (p) => {
  f.page = p; loading.value = true;
  try {
    const params = {
      page: f.page, pageSize: f.pageSize,
      status: f.status || undefined,
      moduleId: f.moduleId || undefined,
      keyword: f.keyword || undefined,
      semesterId: curSemesterId.value || undefined
    };
    if (f.dateRange && f.dateRange.length === 2) {
      params.startDate = f.dateRange[0];
      params.endDate = f.dateRange[1];
    }
    const r = await getMyApplications(params);
    const rows = Array.isArray(r?.list) ? r : (Array.isArray(r) ? { list: r, total: r.length } : { list: [], total: 0 });
    const listRows = rows.list || [];
    // 注入申诉状态：pending=有未办结申诉；closed=所有申诉已办结
    for (const row of listRows) {
      const appeals = row.appeals || [];
      row.pendingAppeal = appeals.some(a => a.status === 'pending');
      row.lastAppeal = appeals.sort((a,b) => b.id - a.id)[0] || null;
      row.reopenedId = row.reopenedApps?.[0]?.id || null;
      row.appealState = appeals.length === 0 ? '' : (row.pendingAppeal ? 'pending' : 'closed');
    }
    list.value = listRows;
    total.value = rows.total || 0;
  } catch (e) {
    list.value = []; total.value = 0;
  } finally { loading.value = false; }
};

const resetFilters = () => {
  f.status = ''; f.moduleId = ''; f.keyword = ''; f.dateRange = null;
  go(1);
};

const del = async (r) => {
  try {
    await deleteApplication(r.id);
    ElMessage.success('已删除');
    go(f.page); loadSummary();
  } catch (e) {
    ElMessage.error('删除失败：' + (e.message || '请稍后重试'));
  }
};

const withdraw = async (r) => {
  try {
    await withdrawApplication(r.id);
    ElMessage.success('已撤回，回到草稿状态');
    go(f.page); loadSummary();
  } catch (_) {}
};

// ====== 详情 ======
const detailVisible = ref(false);
const detailData = ref(null);
const detail = async (r) => {
  try {
    detailData.value = await getApplicationDetail(r.id);
    detailVisible.value = true;
  } catch (e) {
    ElMessage.error('详情加载失败：' + (e.message || '网络异常'));
  }
};

const onDetailAppeal = (row) => { detailVisible.value = false; openAppeal(row); };
const onDetailReapply = async (row) => {
  detailVisible.value = false;
  router.push({ path: '/apply', query: { id: row.id, reapply: 1 } });
};
const onDetailWithdraw = (row) => { detailVisible.value = false; withdraw(row); };

const toEdit = (r) => { router.push({ path: '/apply', query: { id: r.id } }); };
const submitReturned = (r) => { router.push({ path: '/apply', query: { id: r.id, submit: 1 } }); };

// ====== 申诉表单 ======
const DEFAULT_MAX_APPEAL = 3; // 默认每条申报最多3次申诉（后端 Application.maxAppealCount 控制）
const currentAppealMaxCount = computed(() => Number(af.target?.maxAppealCount) || DEFAULT_MAX_APPEAL);
const appealVisible = ref(false);
const submitting = ref(false);
const appealFormRef = ref();
const af = reactive({ target: null, reason: '', fileList: [], uploadedUrls: [] });

const appealRules = {
  reason: [
    { required: true, message: '请填写申诉理由', trigger: 'blur' },
    { max: 800, message: '申诉理由不可超过 800 字', trigger: 'blur' }
  ]
};

// 申诉允许的状态窗口：班级管理员已给出明确意见（approved/rejected/final_review）
// pending/approving/returned/draft/appealing/revoked 均不允许前端显示申诉按钮（后端也会拦）
const canAppealByStatus = (st) => ['approved','rejected','final_review'].includes(st);

const canAppeal = (row) => {
  // canAppealByStatus 在模板里已做 AND 条件，这里只负责次数与 pending 判断
  if (row.pendingAppeal) return false;
  const max = Number(row.maxAppealCount) || DEFAULT_MAX_APPEAL;
  const closed = (row.appeals || []).filter(a => ['approved','rejected'].includes(a.status)).length;
  return closed < max;
};

const openAppeal = (r) => {
  af.target = r;
  af.reason = '';
  af.fileList = [];
  af.uploadedUrls = [];
  appealVisible.value = true;
};

const onAppealFileChange = async (uploadFile) => {
  try {
    // 直接走 applications 上传接口（复用 /applications/upload）
    const { uploadProof } = await import('@/api/applications');
    const fd = new FormData();
    fd.append('photos', uploadFile.raw);
    const res = await uploadProof(fd);
    const url = res?.urls?.[0] || (Array.isArray(res) ? res[0]?.url : '') || '';
    if (!url) throw new Error('上传返回数据异常');
    af.uploadedUrls.push(url);
    uploadFile.url = url;
    ElMessage.success(`上传 ${uploadFile.name} 成功`);
  } catch (e) {
    ElMessage.error(`上传 ${uploadFile.name} 失败：${e.message || '网络异常'}`);
    af.fileList = af.fileList.filter(x => x.uid !== uploadFile.uid);
  }
};

const onAppealFileRemove = (file) => {
  if (file.url) af.uploadedUrls = af.uploadedUrls.filter(u => u !== file.url);
};

const submitAppeal = async () => {
  await appealFormRef.value.validate();
  submitting.value = true;
  try {
    await apiSubmitAppeal({
      applicationId: af.target.id,
      reason: af.reason.trim(),
      attachments: af.uploadedUrls.length > 0 ? af.uploadedUrls : null
    });
    ElMessage.success('申诉已提交，等待班级管理员重新审批');
    appealVisible.value = false;
    go(f.page); loadSummary();
  } catch (_) {} finally { submitting.value = false; }
};

// ====== 导出 ======
const exporting = ref(false);
const exportList = async () => {
  exporting.value = true;
  try {
    const blob = await exportMyApplications(curSemesterId.value);
    if (!blob) { ElMessage.error('导出失败：未收到文件'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cur = currentSemester.value;
    a.download = `我的申报汇总_${cur ? formatSemesterLabel(cur) : '全部'}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || '网络异常'));
  } finally { exporting.value = false; }
};

// ====== 红点提醒 ======
const unreadCount = ref(0);
const loadUnread = async () => {
  try {
    const r = await getUnreadCount({ __suppressMsg: true });
    unreadCount.value = Number(r?.count || 0);
  } catch (_) {}
};
const goProfile = () => router.push('/profile');

// ====== URL query 处理（从消息中心跳转过来，自动打开详情） ======
const handleQuery = async () => {
  const { detailId, appealId } = route.query;
  if (detailId) {
    try {
      detailData.value = await getApplicationDetail(detailId);
      detailVisible.value = true;
    } catch (e) {
      ElMessage.error('详情加载失败');
    }
  } else if (appealId) {
    // 申诉详情跳转：先获取申诉，再加载关联申报
    try {
      const { getAppealDetail } = await import('@/api/appeals');
      const ap = await getAppealDetail(appealId);
      if (ap?.applicationId) {
        detailData.value = await getApplicationDetail(ap.applicationId);
        detailVisible.value = true;
      }
    } catch (e) {
      ElMessage.error('申诉详情加载失败');
    }
  }
};

onMounted(async () => {
  await Promise.all([
    loadSemesters(),
    listActiveModules().then(m => { modules.value = Array.isArray(m) ? m : (m?.list || []); }).catch(() => {})
  ]);
  await Promise.all([go(1), loadSummary(), loadUnread()]);
  handleQuery();
});

watch(() => route.query, () => handleQuery());
</script>

<style lang="scss" scoped>
.my-applications { padding-bottom: 12px; }
.header-actions { display:flex; gap: 10px; align-items:center; }
.semester-bar { margin-top:18px; padding: 0; overflow:hidden; border:1px solid #E3EBF5; border-radius:18px; }
.semester-row { display:flex; gap: 12px; align-items:center; margin-bottom: 0; padding:18px 21px; flex-wrap: wrap; border-bottom:1px solid #EAF0F7; background:#FAFCFE;
  .lbl { color:#536982; font-weight:700; display:inline-flex; align-items:center; gap: 6px; }
}
.score-summary {
  padding:18px 21px 21px; background:linear-gradient(145deg,#fff,#F8FBFF);
  .summary-totals { display:flex; gap: 16px; margin-bottom: 14px; }
  .total-card {
    position:relative; flex:1; min-height:92px; padding: 15px 19px; overflow:hidden; border-radius: 15px;
    &::after { content:''; position:absolute; width:76px; height:76px; right:-28px; top:-31px; border:1px solid currentColor; border-radius:50%; opacity:.12; box-shadow:0 0 0 14px currentColor; }
    &.pending { color:#D68D13; background:linear-gradient(135deg,#FFF9ED,#FFF2D5); border:1px solid #F3DCAC; }
    &.approved { color:#11967F; background:linear-gradient(135deg,#F0FBF8,#DFF7EF); border:1px solid #BEE9DD; }
    .lbl { color: #909399; font-size: 13px; margin-bottom: 6px; }
    .val { font-size: 30px; font-weight: 800; color:currentColor; letter-spacing:-.04em; }
  }
  .summary-modules { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .module-summary {
    padding: 12px 13px; border:1px solid #E4EBF4; border-radius: 12px; background:#fff;
    display:flex; align-items:center; gap: 12px;
    .m-tag { color:#fff; padding: 4px 10px; border-radius: 6px; font-size: 12px; flex-shrink: 0; }
    .m-scores { display:flex; flex-direction:column; gap: 2px; font-size: 12px;
      .ms { color: #606266; b { margin-left: 4px; color: #303133; } }
      .ms.pending b { color: #E6A23C; }
      .ms.approved b { color: #67C23A; }
      .ms.count { color: #909399; }
    }
  }
}
.my-applications > .card:last-of-type { margin-top:16px; padding-top:18px; border:1px solid #E3EBF5; border-radius:18px; overflow:hidden; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 20px 18px; align-items: center;
  .filter-right { margin-left: auto; }
}
.page-wrap { display: flex; justify-content: flex-end; padding: 12px 16px; }
.mb-16 { margin-bottom: 16px; }
.muted { color: #909399; }
.flex-between { display:flex; justify-content:space-between; align-items:center; }
@media (max-width:768px) {
  .header-actions { width:100%; }
  .header-actions :deep(.el-button) { flex:1; }
  .semester-row { padding:16px; }
  .semester-row :deep(.el-select) { width:100% !important; }
  .score-summary { padding:16px; }
  .score-summary .summary-totals { flex-direction:column; gap:10px; }
  .filters { padding:0 16px 16px; }
  .filters :deep(.el-select), .filters :deep(.el-date-editor), .filters :deep(.el-input) { width:100% !important; }
  .filters .filter-right { width:100%; margin-left:0; }
}
</style>
