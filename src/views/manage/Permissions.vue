<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="ACCESS CONTROL" title="权限管理" description="查看账号角色与审批状态，按组织职责调整系统访问权限。" />

    <div class="card">
      <div class="filters">
        <el-input v-model="f.keyword" placeholder="姓名/账号" style="width:200px" clearable @keyup.enter="go(1)" />
        <el-select v-model="f.role" placeholder="角色" style="width:140px" clearable @change="go(1)">
          <el-option label="学生" value="student" />
          <el-option label="辅导员" value="counselor" />
          <el-option label="院系管理员" value="college_admin" />
          <el-option label="学校管理员" value="school_admin" />
          <el-option label="超级管理员" value="super_admin" />
        </el-select>
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="realName" label="姓名" width="100" />
        <el-table-column label="当前角色" width="120">
          <template #default="{row}"><el-tag :type="ROLE_TAG[row.role]?.type" size="small">{{ ROLE_TAG[row.role]?.label }}</el-tag></template>
        </el-table-column>
        <el-table-column label="院系" min-width="160">
          <template #default="{row}">{{ row.college?.name || '--' }}</template>
        </el-table-column>
        <el-table-column label="审批状态" width="100" align="center">
          <template #default="{row}"><el-tag :type="STATUS_TAG[row.roleStatus]" size="small">{{ STATUS_TEXT[row.roleStatus] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="openRoleEdit(row)" :disabled="row.id===userStore.userInfo?.id && row.role==='super_admin'">修改角色</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s;go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 权限矩阵 -->
    <div class="card mt-16">
      <div class="card-title">角色权限矩阵</div>
      <el-table :data="permissions.roles || []" stripe>
        <el-table-column prop="name" label="角色" width="120" />
        <el-table-column label="可访问菜单" min-width="400">
          <template #default="{row}">
            <el-tag v-for="p in row.permissions" :key="p" size="small" style="margin:2px;" :type="p==='*'?'danger':'info'">
              {{ p==='*' ? '全部权限' : (menuMap[p] || p) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 修改角色弹窗 -->
    <el-dialog v-model="roleVisible" title="修改用户角色" width="min(440px,92vw)">
      <div style="margin-bottom:16px;">
        <p><strong>用户：</strong>{{ editing?.realName }}（{{ editing?.username }}）</p>
        <p><strong>当前角色：</strong>{{ ROLE_TAG[editing?.role]?.label }}</p>
      </div>
      <el-form label-width="80px">
        <el-form-item label="新角色">
          <el-select v-model="roleForm.role" style="width:100%">
            <el-option label="学生" value="student" />
            <el-option label="辅导员" value="counselor" />
            <el-option label="院系管理员" value="college_admin" />
            <el-option label="学校管理员" value="school_admin" />
            <el-option label="超级管理员" value="super_admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitRole">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { getUserList, getPermissions, updateUserRole } from '@/api/users';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page:1, pageSize:20, keyword:'', role:'' });
const permissions = ref({ roles:[], allMenus:[] });

const ROLE_TAG = {
  student: { label:'学生', type:'info' },
  class_admin: { label:'班级管理员', type:'' },
  counselor: { label:'辅导员', type:'success' },
  college_admin: { label:'院系管理员', type:'warning' },
  school_admin: { label:'学校管理员', type:'danger' },
  super_admin: { label:'超级管理员', type:'danger' },
  developer: { label:'开发者', type:'danger' }
};
const STATUS_TAG = { active:'success', pending:'warning', rejected:'danger' };
const STATUS_TEXT = { active:'正常', pending:'待审批', rejected:'已驳回' };

const menuMap = computed(() => {
  const m = {};
  for (const item of permissions.value.allMenus || []) { m[item.key] = item.name; }
  return m;
});

const go = async (p) => {
  f.page = p; loading.value = true;
  try { const r = await getUserList(f); list.value = r?.list||[]; total.value = r?.total||0; } finally { loading.value=false; }
};

const roleVisible = ref(false);
const editing = ref(null);
const saving = ref(false);
const roleForm = reactive({ role:'' });

const openRoleEdit = (row) => {
  editing.value = row;
  roleForm.role = row.role;
  roleVisible.value = true;
};

const submitRole = async () => {
  saving.value = true;
  try {
    await updateUserRole(editing.value.id, { role: roleForm.role });
    ElMessage.success('角色已更新');
    roleVisible.value = false;
    go(f.page);
  } catch (e) { ElMessage.error(e.message||'操作失败'); } finally { saving.value = false; }
};

onMounted(async () => {
  go(1);
  try { permissions.value = await getPermissions(); } catch (_) {}
});
</script>

<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
</style>
