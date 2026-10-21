<template>
  <div class="bonus-review">
    <WorkspaceHero
      eyebrow="LEGACY REVIEW QUEUE"
      title="历史加分待办"
      description="处理旧版流程中的待审批和退回补充记录；统一申报的任务请前往考评审核中心。"
    >
      <template #actions>
        <el-tag :type="bonusStore.connected ? 'success' : 'info'" size="small" effect="light">
          <el-icon style="vertical-align:-2px;"><!-- --></el-icon>
          {{ bonusStore.connected ? '实时连接' : '轮询更新' }}
        </el-tag>
        <el-button :loading="loading" @click="load"><el-icon><Refresh /></el-icon> 刷新队列</el-button>
      </template>
    </WorkspaceHero>

    <div class="review-overview">
      <div><span>待审批</span><strong>{{ bonusStore.pendingCount }}</strong><small>需要立即处理</small></div>
      <div><span>退回补充</span><strong>{{ bonusStore.returnedCount }}</strong><small>等待学生补充</small></div>
      <div><span>当前列表</span><strong>{{ total }}</strong><small>符合筛选条件</small></div>
    </div>

    <el-card shadow="never" class="table-card">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="待审批" name="pending" />
        <el-tab-pane label="退回补充" name="returned" />
        <el-tab-pane label="全部" name="all" />
      </el-tabs>

      <el-table :data="rows" v-loading="loading" stripe style="width:100%" empty-text="暂无待处理申请">
        <el-table-column prop="applicantName" label="申请人" width="120" />
        <el-table-column prop="className" label="班级" width="160" show-overflow-tooltip />
        <el-table-column prop="moduleName" label="加分项" min-width="160" show-overflow-tooltip />
        <el-table-column prop="category" label="类别" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.category || '—' }}</template>
        </el-table-column>
        <el-table-column label="五育归属" width="110" align="center">
          <template #default="{ row }">
            <span class="pillar-tag" :style="{ color: pillarMeta(row.pillar).color }">{{ pillarMeta(row.pillar).label }}</span>
          </template>
        </el-table-column>
        <el-table-column label="分值" width="90" align="center">
          <template #default="{ row }">{{ Number(row.score).toFixed(1) }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmt(row.submittedAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">审核</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager" v-if="total > pageSize">
        <el-pagination
          layout="total, prev, pager, next"
          :total="total" :page-size="pageSize" :current-page="page"
          @current-change="onPage" />
      </div>
    </el-card>

    <!-- 审核抽屉 -->
    <el-drawer v-model="drawer" title="加分申请审核" size="460px" @closed="current = null">
      <div v-if="current">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="申请人">{{ current.applicantName }}（{{ current.applicantUsername }}）</el-descriptions-item>
          <el-descriptions-item label="班级">{{ current.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="加分项">{{ current.moduleName }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ current.category || '—' }}</el-descriptions-item>
          <el-descriptions-item label="五育归属">
            <span class="pillar-tag" :style="{ color: pillarMeta(current.pillar).color }">{{ pillarMeta(current.pillar).label }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="申请分值">{{ Number(current.score).toFixed(1) }}</el-descriptions-item>
          <el-descriptions-item label="事件发生日期">{{ current.eventDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学期">{{ formatSemester(current) }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmt(current.submittedAt) }}</el-descriptions-item>
          <el-descriptions-item label="说明">{{ current.description || '—' }}</el-descriptions-item>
          <el-descriptions-item label="证明材料" v-if="proofList(current).length">
            <div class="proof-list">
              <a v-for="(u, i) in proofList(current)" :key="i" :href="u" target="_blank" class="proof-link">材料{{ i + 1 }}</a>
            </div>
          </el-descriptions-item>
        </el-descriptions>

        <el-alert v-if="current.status === 'returned'" type="warning" :closable="false" style="margin:14px 0;">
          该申请属于历史流程，请通知学生改用统一“申报加分”入口提交。
        </el-alert>

        <div class="actions">
          <el-button type="danger" :loading="acting === 'reject'" @click="act('reject')">驳回</el-button>
          <el-button type="warning" :loading="acting === 'return'" @click="act('return')">退回补充</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import { Stamp, Refresh } from '@element-plus/icons-vue';
import {
  getBonusPending, getBonusDetail, rejectBonus, returnBonus
} from '@/api/bonus';
import { pillarMeta } from '@/utils/pillarMap';
import { useBonusStore } from '@/stores/bonus';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const bonusStore = useBonusStore();
const activeTab = ref('pending');
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const loading = ref(false);
const drawer = ref(false);
const current = ref(null);
const acting = ref('');

const STATUS = {
  pending: { label: '待审批', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  returned: { label: '退回补充', type: 'info' },
  withdrawn: { label: '已撤回', type: '' }
};
const statusMeta = (s) => STATUS[s] || { label: s, type: '' };
const fmt = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '—';
const formatSemester = (r) => (r.academicYear && r.semester) ? `${r.academicYear} ${r.semester}` : (r.academicYear || r.semester || '—');
const proofList = (r) => (r && Array.isArray(r.proofUrls)) ? r.proofUrls : [];

const load = async () => {
  loading.value = true;
  try {
    const data = await getBonusPending({ status: activeTab.value, page: page.value, pageSize: pageSize.value });
    rows.value = data?.list || [];
    total.value = data?.total || 0;
  } catch (_) { rows.value = []; total.value = 0; }
  finally { loading.value = false; }
};

const onTabChange = () => { page.value = 1; load(); };
const onPage = (p) => { page.value = p; load(); };

const openDetail = async (row) => {
  try {
    current.value = await getBonusDetail(row.id);
    drawer.value = true;
  } catch (e) { /* 拦截器提示 */ }
};

const act = async (action) => {
  if (!current.value) return;
  let comment;
  if (action === 'reject') {
    try {
      const { value } = await ElMessageBox.prompt('请填写驳回原因（必填）', '驳回申请', {
        confirmButtonText: '确定驳回', cancelButtonText: '取消', inputType: 'textarea', inputValidator: (v) => !!v && v.trim() || '请填写原因'
      });
      comment = value;
    } catch (_) { return; }
  } else if (action === 'return') {
    try {
      const { value } = await ElMessageBox.prompt('可填写退回补充说明（选填）', '退回补充', {
        confirmButtonText: '确定退回', cancelButtonText: '取消', inputType: 'textarea', inputPlaceholder: '如：请补充获奖证书照片'
      });
      comment = value;
    } catch (_) { return; }
  }
  acting.value = action;
  try {
    if (action === 'reject') await rejectBonus(current.value.id, comment);
    else await returnBonus(current.value.id, comment ? { comment } : {});
    ElMessage.success(action === 'reject' ? '已驳回' : '已退回补充');
    drawer.value = false;
    await Promise.all([load(), bonusStore.refresh()]);
  } catch (e) { /* 拦截器提示 */ }
  finally { acting.value = ''; }
};

// 实时：监听 SSE 事件，防抖刷新列表
let refreshTimer = null;
const onEvent = () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(), 800);
};
watch(() => bonusStore.lastEvent, onEvent);

onMounted(() => { load(); });
onBeforeUnmount(() => { if (refreshTimer) clearTimeout(refreshTimer); });
</script>

<style lang="scss" scoped>
.bonus-review { padding-bottom: 12px; }
.review-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:18px 0 14px;
  > div { padding:16px 18px; border:1px solid #E2EAF4; border-radius:15px; background:#fff; box-shadow:0 8px 22px rgba(20,52,96,.045); }
  span { display:block; color:#718198; font-size:12px; font-weight:700; }
  strong { display:block; margin:5px 0 2px; color:#173E75; font-size:28px; line-height:1; }
  > div:first-child strong { color:#E06A57; }
  > div:nth-child(2) strong { color:#D38E1D; }
  small { color:#9AA7B7; }
}
.table-card { border-radius:18px; }
.pager { display:flex; justify-content:flex-end; margin-top:12px; }
.actions { display:flex; gap:12px; margin-top:18px; }
.proof-list { display:flex; gap:10px; flex-wrap:wrap; .proof-link { color:#409EFF; } }
.pillar-tag { display:inline-flex; align-items:center; justify-content:center; min-width:40px; padding:1px 8px; font-size:12px; line-height:18px; border-radius:10px; border:1px solid currentColor; box-sizing:border-box; }
@media (max-width:768px) {
  .review-overview { grid-template-columns:1fr; gap:9px; }
}
</style>
