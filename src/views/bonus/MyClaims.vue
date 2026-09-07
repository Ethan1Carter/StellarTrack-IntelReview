<template>
  <div class="bonus-my">
    <WorkspaceHero
      eyebrow="LEGACY APPLICATIONS"
      title="历史加分申报"
      description="集中查看旧版加分记录、审批意见与证明材料；新的申报请使用统一申报入口。"
    >
      <template #actions><el-button @click="$router.push('/apply')">发起新申报</el-button></template>
    </WorkspaceHero>

    <div class="claim-overview">
      <div class="overview-item"><span>历史记录</span><strong>{{ claimStats.total }}</strong><small>全部旧流程单据</small></div>
      <div class="overview-item pending"><span>处理中</span><strong>{{ claimStats.pending }}</strong><small>待审批或待补充</small></div>
      <div class="overview-item approved"><span>已通过</span><strong>{{ claimStats.approved }}</strong><small>已完成认定</small></div>
    </div>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe style="width:100%" empty-text="暂无申报记录">
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
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmt(row.submittedAt) }}</template>
        </el-table-column>
        <el-table-column label="审批意见" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.rejectReason || (row.status === 'approved' ? '已通过' : '—') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
            <el-button v-if="['pending','returned'].includes(row.status)" link type="warning" @click="withdraw(row)">撤回</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="申报详情" width="600px" destroy-on-close>
      <el-descriptions :column="1" border v-if="current">
        <el-descriptions-item label="加分项">{{ current.moduleName }}</el-descriptions-item>
        <el-descriptions-item label="类别">{{ current.category || '—' }}</el-descriptions-item>
        <el-descriptions-item label="五育归属">
          <span class="pillar-tag" :style="{ color: pillarMeta(current.pillar).color }">{{ pillarMeta(current.pillar).label }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="申请分值">{{ Number(current.score).toFixed(1) }}</el-descriptions-item>
        <el-descriptions-item label="认定分值">{{ current.finalScore != null ? Number(current.finalScore).toFixed(1) : '—' }}</el-descriptions-item>
        <el-descriptions-item label="事件发生日期">{{ current.eventDate || '—' }}</el-descriptions-item>
        <el-descriptions-item label="学期">{{ formatSemester(current) }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusMeta(current.status).type" size="small">{{ statusMeta(current.status).label }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="说明">{{ current.description || '—' }}</el-descriptions-item>
        <el-descriptions-item label="证明材料" v-if="proofList(current).length">
          <div class="proof-list">
            <a v-for="(u, i) in proofList(current)" :key="i" :href="u" target="_blank" class="proof-link">材料{{ i + 1 }}</a>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="审批意见" v-if="current.rejectReason">{{ current.rejectReason }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import { Tickets } from '@element-plus/icons-vue';
import { getMyBonus, withdrawBonus } from '@/api/bonus';
import { pillarMeta } from '@/utils/pillarMap';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const list = ref([]);
const loading = ref(false);
const detailVisible = ref(false);
const current = ref(null);
const claimStats = computed(() => ({
  total: list.value.length,
  pending: list.value.filter(item => ['pending', 'returned'].includes(item.status)).length,
  approved: list.value.filter(item => item.status === 'approved').length
}));

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
    const data = await getMyBonus();
    list.value = Array.isArray(data) ? data : (data?.list || []);
  } catch (_) { list.value = []; }
  finally { loading.value = false; }
};

const openDetail = (row) => { current.value = row; detailVisible.value = true; };

const withdraw = async (row) => {
  try {
    await ElMessageBox.confirm('撤回后该申请将不再进入审批流程，确定撤回？', '提示', { type: 'warning' });
    await withdrawBonus(row.id);
    ElMessage.success('已撤回');
    await load();
  } catch (_) {}
};

onMounted(load);
</script>

<style lang="scss" scoped>
.bonus-my { padding-bottom: 12px; }
.claim-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin:18px 0 14px; }
.overview-item { position:relative; min-height:102px; padding:17px 19px; overflow:hidden; border:1px solid #E2EAF4; border-radius:16px; background:linear-gradient(145deg,#fff,#F8FBFF); box-shadow:0 9px 24px rgba(20,52,96,.05);
  &::after { content:''; position:absolute; width:70px; height:70px; right:-28px; top:-29px; border:1px solid #2C7FD5; border-radius:50%; opacity:.15; box-shadow:0 0 0 12px #2C7FD5; }
  span { display:block; color:#708299; font-size:12px; font-weight:700; }
  strong { display:block; margin:5px 0 1px; color:#173E75; font-size:29px; line-height:1; letter-spacing:-.04em; }
  small { color:#98A5B6; }
  &.pending strong { color:#D18A18; }
  &.approved strong { color:#13957F; }
}
.table-card { border-radius:18px; }
.muted { color:#909399; font-size:13px; }
.proof-list { display:flex; gap:10px; flex-wrap:wrap; .proof-link { color:#409EFF; } }
.pillar-tag { display:inline-flex; align-items:center; justify-content:center; min-width:40px; padding:1px 8px; font-size:12px; line-height:18px; border-radius:10px; border:1px solid currentColor; box-sizing:border-box; }
@media (max-width:768px) {
  .claim-overview { grid-template-columns:1fr; gap:9px; }
  .overview-item { min-height:82px; }
}
</style>
