<template>
  <div class="recycles-wrap">
    <WorkspaceHero eyebrow="DATA RECOVERY" title="数据回收" description="集中查看可恢复的数据记录，降低误操作风险并保留必要的业务追溯能力。" />
    <!-- 顶部概览 -->
    <el-row :gutter="16" style="margin:18px 0 16px">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-row">
            <el-icon :size="28" color="#7c3aed"><Delete /></el-icon>
            <div class="stat-text">
              <div class="stat-title">回收站合计</div>
              <div class="stat-num">{{ summary.total ?? 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-row">
            <el-icon :size="28" color="#2563eb"><Collection /></el-icon>
            <div class="stat-text">
              <div class="stat-title">已删除加分模块</div>
              <div class="stat-num">{{ summary.bonusModules ?? 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-row">
            <el-icon :size="28" color="#059669"><User /></el-icon>
            <div class="stat-text">
              <div class="stat-title">停用用户</div>
              <div class="stat-num">{{ summary.users ?? 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-row">
            <el-icon :size="28" color="#dc2626"><ChatDotRound /></el-icon>
            <div class="stat-text">
              <div class="stat-title">已办结归档申诉</div>
              <div class="stat-num">{{ summary.appeals ?? 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <!-- ============ 加分模块回收站 ============ -->
        <el-tab-pane label="加分模块回收站" name="modules">
          <div class="toolbar">
            <el-input v-model="moduleQuery.keyword" placeholder="按模块名称搜索" clearable style="width:260px" @keyup.enter="loadModules" />
            <el-button type="primary" @click="loadModules">查询</el-button>
            <el-button @click="reset('modules')">重置</el-button>
            <div class="spacer" />
            <el-button type="success" plain @click="loadSummary">刷新概览</el-button>
          </div>
          <el-table :data="moduleList" v-loading="loading.modules" border stripe style="margin-top:12px">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="模块名称" min-width="180" show-overflow-tooltip />
            <el-table-column prop="category" label="类别" width="110" />
            <el-table-column prop="singleMaxScore" label="单次上限" width="100" />
            <el-table-column label="所属院系" width="120">
              <template #default="{ row }">
                {{ row.collegeId ? '院级' : '全校通用' }}
              </template>
            </el-table-column>
            <el-table-column prop="deletedAt" label="删除时间" width="170" />
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="{ row }">
                <el-button type="success" size="small" link @click="restoreModule(row)">恢复模块</el-button>
                <el-button type="danger" size="small" link @click="purgeModule(row)">彻底删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <Pagination v-if="moduleTotal > 0"
            :total="moduleTotal" :page="moduleQuery.page" :page-size="moduleQuery.pageSize"
            @update:page="(p) => { moduleQuery.page = p; loadModules() }"
            @update:page-size="(s) => { moduleQuery.pageSize = s; moduleQuery.page = 1; loadModules() }" />
        </el-tab-pane>

        <!-- ============ 用户回收站 ============ -->
        <el-tab-pane label="用户回收站" name="users">
          <div class="toolbar">
            <el-input v-model="userQuery.keyword" placeholder="姓名/账号/唯一ID" clearable style="width:280px" @keyup.enter="loadUsers" />
            <el-button type="primary" @click="loadUsers">查询</el-button>
            <el-button @click="reset('users')">重置</el-button>
          </div>
          <el-table :data="userList" v-loading="loading.users" border stripe style="margin-top:12px">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="uniqueId" label="系统唯一ID" width="160" />
            <el-table-column prop="username" label="账号" width="220" />
            <el-table-column prop="realName" label="姓名" width="120" />
            <el-table-column prop="role" label="角色" width="130">
              <template #default="{ row }">
                <el-tag size="small" :type="roleTagType(row.role)">{{ roleLabel(row.role) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="账号状态" width="100" />
            <el-table-column prop="roleStatus" label="角色状态" width="100" />
            <el-table-column prop="updatedAt" label="最近更新" width="170" />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button type="success" size="small" link @click="restoreUser(row)">恢复用户</el-button>
              </template>
            </el-table-column>
          </el-table>
          <Pagination v-if="userTotal > 0"
            :total="userTotal" :page="userQuery.page" :page-size="userQuery.pageSize"
            @update:page="(p) => { userQuery.page = p; loadUsers() }"
            @update:page-size="(s) => { userQuery.pageSize = s; userQuery.page = 1; loadUsers() }" />
        </el-tab-pane>

        <!-- ============ 申诉回收站 ============ -->
        <el-tab-pane label="申诉回收站(已归档)" name="appeals">
          <div class="toolbar">
            <el-input v-model="appealQuery.keyword" placeholder="按申诉原因搜索" clearable style="width:280px" @keyup.enter="loadAppeals" />
            <el-checkbox v-model="appealQuery.archivedOnly" @change="loadAppeals">仅显示归档超过15天</el-checkbox>
            <el-button type="primary" @click="loadAppeals">查询</el-button>
            <el-button @click="reset('appeals')">重置</el-button>
          </div>
          <el-table :data="appealList" v-loading="loading.appeals" border stripe style="margin-top:12px">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="applicationId" label="关联申报ID" width="120" />
            <el-table-column prop="studentId" label="学生ID" width="100" />
            <el-table-column prop="reason" label="申诉原因" min-width="280" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'approved' ? 'success' : (row.status==='rejected'?'danger':'info')">
                  {{ {approved:'申诉通过',rejected:'申诉驳回',closed:'已关闭'}[row.status] || row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="handledAt" label="办结时间" width="170" />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button type="success" size="small" link @click="restoreAppeal(row)">重新激活处理</el-button>
              </template>
            </el-table-column>
          </el-table>
          <Pagination v-if="appealTotal > 0"
            :total="appealTotal" :page="appealQuery.page" :page-size="appealQuery.pageSize"
            @update:page="(p) => { appealQuery.page = p; loadAppeals() }"
            @update:page-size="(s) => { appealQuery.pageSize = s; appealQuery.page = 1; loadAppeals() }" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Collection, User, ChatDotRound } from '@element-plus/icons-vue';
import Pagination from '@/components/Pagination/index.vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import {
  getRecycleModules, restoreRecycleModule, purgeRecycleModule,
  getRecycleUsers, restoreRecycleUser,
  getRecycleAppeals, restoreRecycleAppeal,
  getRecycleSummary,
} from '@/api/recycles';

const activeTab = ref('modules');
const loading = reactive({ modules: false, users: false, appeals: false });
const summary = ref({ bonusModules: 0, users: 0, appeals: 0, total: 0 });

// ======== 加分模块 ========
const moduleQuery = reactive({ page: 1, pageSize: 10, keyword: '' });
const moduleList = ref([]);
const moduleTotal = ref(0);
async function loadModules() {
  loading.modules = true;
  try {
    const r = await getRecycleModules(moduleQuery);
    const d = r?.data || r || {};
    moduleList.value = d.list || d.rows || d.data || [];
    moduleTotal.value = Number(d.total || d.count || moduleList.value.length);
  } finally { loading.modules = false; }
}
async function restoreModule(row) {
  await ElMessageBox.confirm(`确认恢复加分模块「${row.name}」吗？恢复后前端会重新展示。`, '恢复确认', { type: 'warning' });
  await restoreRecycleModule(row.id);
  ElMessage.success('已恢复');
  await Promise.all([loadModules(), loadSummary()]);
}
async function purgeModule(row) {
  await ElMessageBox.confirm(`确认从数据库中彻底物理删除「${row.name}」吗？此操作不可恢复！（如仍有申报引用该模块将被禁止删除）`, '彻底删除确认', { type: 'error' });
  await purgeRecycleModule(row.id);
  ElMessage.success('已彻底删除');
  await Promise.all([loadModules(), loadSummary()]);
}

// ======== 用户 ========
const userQuery = reactive({ page: 1, pageSize: 10, keyword: '' });
const userList = ref([]);
const userTotal = ref(0);
async function loadUsers() {
  loading.users = true;
  try {
    const r = await getRecycleUsers(userQuery);
    const d = r?.data || r || {};
    userList.value = d.list || d.rows || d.data || [];
    userTotal.value = Number(d.total || d.count || userList.value.length);
  } finally { loading.users = false; }
}
async function restoreUser(row) {
  await ElMessageBox.confirm(`确认恢复用户 ${row.realName}(${row.username}) 为「激活」状态吗？`, '恢复确认', { type: 'warning' });
  await restoreRecycleUser(row.id);
  ElMessage.success('已恢复用户为激活状态');
  await Promise.all([loadUsers(), loadSummary()]);
}
function roleLabel(r) { return {student:'学生',class_admin:'班级管理员',counselor:'辅导员',college_admin:'学院管理员',school_admin:'学校管理员',super_admin:'超级管理员'}[r] || r; }
function roleTagType(r) { return {student:'',class_admin:'warning',counselor:'',college_admin:'',school_admin:'danger',super_admin:'danger'}[r] || ''; }

// ======== 申诉 ========
const appealQuery = reactive({ page: 1, pageSize: 10, keyword: '', archivedOnly: false });
const appealList = ref([]);
const appealTotal = ref(0);
async function loadAppeals() {
  loading.appeals = true;
  try {
    const params = { ...appealQuery };
    if (params.archivedOnly) params.archivedOnly = '1'; else delete params.archivedOnly;
    const r = await getRecycleAppeals(params);
    const d = r?.data || r || {};
    appealList.value = d.list || d.rows || d.data || [];
    appealTotal.value = Number(d.total || d.count || appealList.value.length);
  } finally { loading.appeals = false; }
}
async function restoreAppeal(row) {
  await ElMessageBox.confirm(`确认将申诉#${row.id}从归档恢复为「待处理」吗？`, '恢复确认', { type: 'warning' });
  await restoreRecycleAppeal(row.id);
  ElMessage.success('已重新激活为待处理状态（可重新走申诉审批）');
  await Promise.all([loadAppeals(), loadSummary()]);
}

// ======== 公共 ========
async function loadSummary() {
  try {
    const r = await getRecycleSummary();
    summary.value = { ...summary.value, ...(r?.data || r || {}) };
  } catch (_) { /* ignore */ }
}
function reset(kind) {
  if (kind === 'modules') { Object.assign(moduleQuery, { page: 1, pageSize: 10, keyword: '' }); loadModules(); }
  if (kind === 'users')   { Object.assign(userQuery,   { page: 1, pageSize: 10, keyword: '' }); loadUsers(); }
  if (kind === 'appeals') { Object.assign(appealQuery, { page: 1, pageSize: 10, keyword: '', archivedOnly: false }); loadAppeals(); }
}
function handleTabChange(t) {
  if (t === 'modules') loadModules();
  if (t === 'users') loadUsers();
  if (t === 'appeals') loadAppeals();
}
onMounted(() => {
  loadSummary();
  loadModules();
});
</script>

<style lang="scss" scoped>
.recycles-wrap {
  padding: 4px;
}
.stat-card {
  .stat-row {
    display: flex; align-items: center; gap: 14px;
    .stat-text { flex: 1; }
    .stat-title { font-size: 13px; color: #6b7280; margin-bottom: 6px; }
    .stat-num { font-size: 24px; font-weight: 700; color: #111827; line-height: 1.1; }
  }
}
.toolbar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  .spacer { flex: 1; }
}
</style>
