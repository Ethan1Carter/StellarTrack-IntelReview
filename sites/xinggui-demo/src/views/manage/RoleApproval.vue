<template>
  <div class="manage-page">
    <WorkspaceHero
      eyebrow="ROLE GOVERNANCE"
      title="角色审批"
      description="处理「注册申请」与「角色晋升」：注册申请通过后账号才能登录；角色晋升通过后原账号升级为管理角色。只处理直属下级——班级管理员由本班辅导员审批，辅导员由院系管理员审批。"
    />

    <div class="card">
      <div class="filters">
        <el-select v-model="f.status" placeholder="审批状态" style="width:140px" clearable @change="go(1)">
          <el-option label="待审批" value="pending" />
          <el-option label="已通过" value="active" />
          <el-option label="已驳回" value="rejected" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="姓名/账号" style="width:200px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="realName" label="姓名" width="100" />
        <el-table-column label="来源" width="104" align="center">
          <template #default="{row}">
            <el-tag :type="row.fromRegistration ? 'success' : 'info'" size="small" effect="plain">
              {{ row.fromRegistration ? '注册申请' : '角色晋升' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前角色" width="120">
          <template #default="{row}">
            <span v-if="row.fromRegistration" style="color:#909399;font-size:12px;">新注册账号</span>
            <el-tag v-else :type="ROLE_TAG[row.role]?.type" size="small">{{ ROLE_TAG[row.role]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申请角色" width="120">
          <template #default="{row}"><el-tag type="warning" size="small">{{ ROLE_TAG[row.requestedRole]?.label || '历史数据缺失' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="学校 / 院系 / 班级" min-width="240">
          <template #default="{row}">
            {{ row.school?.name || '--' }} / {{ row.college?.name || '--' }}<template v-if="row.classInfo?.name"> / {{ row.classInfo.name }}</template>
          </template>
        </el-table-column>
        <el-table-column label="应审批人" min-width="190" show-overflow-tooltip>
          <template #default="{row}">{{ row.approvalRoute?.label || '审批人待配置' }}</template>
        </el-table-column>
        <el-table-column label="申请时间" width="160">
          <template #default="{row}">{{ row.roleAppliedAt ? formatTime(row.roleAppliedAt) : '--' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{row}">
            <el-tag :type="STATUS_TAG[row.roleStatus]" size="small">{{ STATUS_TEXT[row.roleStatus] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template #default="{row}">
            <template v-if="row.roleStatus==='pending'">
              <el-button link type="success" @click="openApprove(row, true)">通过</el-button>
              <el-button link type="danger" @click="openApprove(row, false)">驳回</el-button>
            </template>
            <span v-else style="color:#909399; font-size:12px;">已处理</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s;go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 审批弹窗 -->
    <el-dialog v-model="approveVisible" :title="approveData.approved ? '通过角色申请' : '驳回角色申请'" width="min(480px,92vw)">
      <div style="margin-bottom:16px;">
        <p><strong>申请人：</strong>{{ editing?.realName }}（{{ editing?.username }}）</p>
        <p><strong>申请来源：</strong>{{ editing?.fromRegistration ? '注册系统新建账号' : '已有账号角色晋升' }}</p>
        <p><strong>所属学校：</strong>{{ editing?.school?.name || '--' }}</p>
        <p><strong>当前角色：</strong>{{ ROLE_TAG[editing?.role]?.label }}</p>
        <p><strong>申请角色：</strong>{{ ROLE_TAG[editing?.requestedRole]?.label || '历史数据缺失' }}</p>
        <p><strong>审批范围：</strong>{{ editing?.approvalRoute?.label || '审批人待配置' }}</p>
      </div>
      <el-alert
        v-if="approveData.approved && editing?.fromRegistration"
        type="success"
        :closable="false"
        show-icon
        title="通过后该账号即可登录"
        style="margin-bottom:14px"
      />
      <el-form v-if="!approveData.approved" label-width="80px">
        <el-form-item label="驳回原因">
          <el-input v-model="approveData.rejectReason" type="textarea" :rows="3" placeholder="请输入驳回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveVisible=false">取消</el-button>
        <el-button :type="approveData.approved?'success':'danger'" :loading="approving" @click="submitApprove">确认{{ approveData.approved?'通过':'驳回' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import dayjs from 'dayjs';
import { getRoleApplications, approveRole } from '@/api/users';
import { ElMessage } from 'element-plus';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page:1, pageSize:20, status:'pending', keyword:'' });

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
const STATUS_TEXT = { active:'已通过', pending:'待审批', rejected:'已驳回' };

const go = async (p) => {
  f.page = p; loading.value = true;
  try { const r = await getRoleApplications(f); list.value = r?.list||[]; total.value = r?.total||0; } finally { loading.value=false; }
};

const formatTime = (t) => dayjs(t).format('YYYY-MM-DD HH:mm');

const approveVisible = ref(false);
const editing = ref(null);
const approving = ref(false);
const approveData = reactive({ approved:true, role:'', rejectReason:'' });

const openApprove = (row, approved) => {
  editing.value = row;
  approveData.approved = approved;
  approveData.role = row.requestedRole || '';
  approveData.rejectReason = '';
  approveVisible.value = true;
};

const submitApprove = async () => {
  if (!approveData.approved && !approveData.rejectReason.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  approving.value = true;
  try {
    await approveRole(editing.value.id, {
      approved: approveData.approved,
      role: approveData.role,
      rejectReason: approveData.rejectReason
    });
    ElMessage.success(approveData.approved ? '已通过' : '已驳回');
    approveVisible.value = false;
    go(f.page);
  } catch (e) { ElMessage.error(e.message||'操作失败'); } finally { approving.value = false; }
};

onMounted(() => go(1));
</script>

<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
</style>
