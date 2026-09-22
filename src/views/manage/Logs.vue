<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="AUDIT TRAIL" title="操作日志" description="按时间、类型与级别检索系统轨迹，为审批复核和异常排查提供依据。">
      <template #actions><el-button @click="exportExcel"><Download /> 导出日志</el-button></template>
    </WorkspaceHero>
    <div class="card">
      <div class="filters">
        <el-select v-model="f.type" placeholder="日志类型" style="width:150px" clearable @change="go(1)">
          <el-option label="登录日志" value="login" />
          <el-option label="操作日志" value="operation" />
          <el-option label="审批日志" value="approval" />
          <el-option label="导出日志" value="export" />
          <el-option label="系统日志" value="system" />
        </el-select>
        <el-select v-if="role!=='student'" v-model="f.level" placeholder="级别" style="width:120px" clearable @change="go(1)">
          <el-option label="INFO" value="info" />
          <el-option label="WARNING" value="warning" />
          <el-option label="ERROR" value="error" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="用户/内容/IP" style="width:220px" clearable @keyup.enter="go(1)" />
        <el-date-picker v-model="range" type="datetimerange" range-separator="至" start-placeholder="开始" end-placeholder="结束" style="width:340px" />
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="时间" width="160">
          <template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm:ss') }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{row}"><el-tag size="small" :type="typeColor(row.type)">{{ TYPE[row.type] || row.type }}</el-tag></template>
        </el-table-column>
        <el-table-column label="级别" width="100" align="center">
          <template #default="{row}">
            <span :style="{color: levelColor(row.level), fontWeight:600}">{{ (row.level || 'INFO').toUpperCase() }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作用户" width="180">
          <template #default="{row}">{{ row.user?.name || row.username || '--' }}（{{ row.userId || '--' }}）</template>
        </el-table-column>
        <el-table-column prop="action" label="操作内容" min-width="260" show-overflow-tooltip />
        <el-table-column prop="module" label="所属模块" width="130" />
        <el-table-column prop="ipAddress" label="IP地址" width="130" />
        <el-table-column label="执行耗时" width="100" align="right">
          <template #default="{row}">{{ row.durationMs != null ? row.durationMs + ' ms' : '--' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="viewDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="dlgVisible" title="日志详情" width="min(700px, 92vw)">
      <el-descriptions v-if="cur" :column="2" border size="small">
        <el-descriptions-item label="日志ID">{{ cur.id }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{ dayjs(cur.createdAt).format('YYYY-MM-DD HH:mm:ss.SSS') }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ TYPE[cur.type] || cur.type }}</el-descriptions-item>
        <el-descriptions-item label="级别">{{ cur.level }}</el-descriptions-item>
        <el-descriptions-item label="操作用户">{{ cur.user?.name || cur.username || '--' }}</el-descriptions-item>
        <el-descriptions-item label="用户ID">{{ cur.userId || '--' }}</el-descriptions-item>
        <el-descriptions-item label="IP地址">{{ cur.ipAddress || '--' }}</el-descriptions-item>
        <el-descriptions-item label="User-Agent">{{ cur.userAgent || '--' }}</el-descriptions-item>
        <el-descriptions-item label="执行耗时">{{ cur.durationMs != null ? cur.durationMs + ' ms' : '--' }}</el-descriptions-item>
        <el-descriptions-item label="状态码">{{ cur.statusCode || '--' }}</el-descriptions-item>
        <el-descriptions-item label="操作" :span="2">{{ cur.action }}</el-descriptions-item>
        <el-descriptions-item label="详细参数" :span="2">
          <pre class="detail-box">{{ detailStr(cur.params) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item v-if="cur.response" label="响应数据" :span="2">
          <pre class="detail-box">{{ detailStr(cur.response) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item v-if="cur.error" label="错误堆栈" :span="2">
          <pre class="detail-box error">{{ cur.error }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import dayjs from 'dayjs';
import { logList, exportLogs } from '@/api/logs';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { Document, Download } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const role = userStore.role;
const TYPE = { login: '登录', operation: '操作', approval: '审批', export: '导出', system: '系统' };
const typeColor = (t) => ({ login: 'primary', operation: 'success', approval: 'warning', export: 'info', system: 'danger' }[t] || 'info');
const levelColor = (l) => ({ info: '#909399', warning: '#E6A23C', error: '#F56C6C' }[l] || '#909399');

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, pageSize: 20, type: '', level: '', keyword: '' });
const range = ref([]);
const go = async (p) => { f.page = p; loading.value = true; try { const r = await logList({ ...f, startAt: range.value?.[0], endAt: range.value?.[1] }); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value = false; } };

const dlgVisible = ref(false);
const cur = ref(null);
const detailStr = (v) => { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch (_) { return String(v || ''); } };
const viewDetail = (r) => { cur.value = r; dlgVisible.value = true; };

const exportExcel = async () => {
  try {
    const blob = await exportLogs({ ...f, startAt: range.value?.[0], endAt: range.value?.[1] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob]));
    a.download = `系统日志_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
    a.click();
  } catch (_) { ElMessage.error('导出失败'); }
};

onMounted(() => go(1));
</script>
<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding: 0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding: 12px 16px; }
.detail-box { background: #f5f7fa; padding: 10px; border-radius: 6px; overflow-x: auto;
  font-size: 12px; font-family: Consolas, monospace; line-height: 1.6; margin: 0;
  max-height: 300px; color:#303133;
  &.error { background: #fef0f0; color: #F56C6C; }
}
</style>
