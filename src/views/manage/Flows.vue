<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="APPROVAL DESIGN" title="审批流程" description="配置一至三级审批链和每级处理角色，为不同评价模块建立明确的流转规则。">
      <template #actions><el-button :disabled="!canEdit" @click="openEdit(null)"><Plus /> 新增流程</el-button></template>
    </WorkspaceHero>
    <div class="card">
      <el-alert title="流程用于加分模块配置的自定义审批链：可设置1-3级审批，及每级审批允许的角色" type="info" show-icon :closable="false" style="margin-bottom:16px;" />
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="流程名称" width="200" />
        <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column label="审批层级" width="280">
          <template #default="{row}">
            <el-steps :active="(row.nodes||[]).length" finish-status="success" size="small" simple>
              <el-step v-for="(n,i) in row.nodes" :key="i" :title="`${i+1}.${n.name||'第'+(i+1)+'级'}`" :description="roleLabel(n.approverType)" />
            </el-steps>
          </template>
        </el-table-column>
        <el-table-column label="关联模块数" width="120" align="center">
          <template #default="{row}"><el-tag type="info" size="small">{{ row.modulesCount || 0 }}</el-tag></template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm v-if="canEdit && !(row.modulesCount>0)" title="确认删除此流程？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
            <el-tooltip v-if="canEdit && row.modulesCount>0" content="该流程已被模块使用，无法删除"><span style="color:#c0c4cc;">删除</span></el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editVisible" :title="editing?.id ? '编辑流程' : '新增流程'" width="min(640px, 92vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="100px">
        <el-form-item label="流程名称" prop="name"><el-input v-model="mForm.name" maxlength="50" show-word-limit /></el-form-item>
        <el-form-item label="描述"><el-input v-model="mForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="审批步骤">
          <div class="step-list">
            <div v-for="(s,i) in mForm.steps" :key="i" class="step-item">
              <div class="step-title">
                <span class="badge">{{ i+1 }}</span>
                <el-input v-model="s.name" placeholder="步骤名，如：辅导员初审" size="small" style="width:220px; margin-right:12px;" />
                <el-checkbox v-model="s.required" :disabled="true" checked>必经</el-checkbox>
                <span style="flex:1"></span>
                <el-button link v-if="i>0" type="warning" @click="moveStep(i,-1)">上移</el-button>
                <el-button link v-if="i<mForm.steps.length-1" type="primary" @click="moveStep(i,1)">下移</el-button>
                <el-button link v-if="mForm.steps.length>1" type="danger" @click="removeStep(i)">删除</el-button>
              </div>
              <div style="margin-left:52px; padding: 6px 0 12px 12px; border-left:2px dashed #ebeef5;">
                <div style="margin-bottom:6px; color:#606266; font-size:13px;">可审批的角色（至少选一个）：</div>
                <el-checkbox-group v-model="s.roles">
                  <el-checkbox label="class_admin">班级管理员</el-checkbox>
                  <el-checkbox label="counselor">辅导员</el-checkbox>
                  <el-checkbox label="college_admin">院系管理员</el-checkbox>
                  <el-checkbox label="school_admin">学校管理员</el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
            <el-button v-if="mForm.steps.length<3" plain type="primary" style="width:100%; margin-top:8px;" @click="addStep">
              <Plus /> 增加一级审批（最多3级）
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import dayjs from 'dayjs';
import { listFlows, createFlow, updateFlow, deleteFlow } from '@/api/modules';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { Share, Plus } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const canEdit = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(userStore.role));
const list = ref([]);
const loading = ref(false);

// 角色类型映射为中文标签
const roleLabel = (role) => {
  const map = {
    class_admin: '班级管理员',
    auto_class_admin: '班级管理员',
    counselor: '辅导员',
    auto_counselor: '辅导员',
    college_admin: '院系管理员',
    auto_college: '院系管理员',
    school_admin: '学校管理员'
  };
  return map[role] || role || '未知';
};

const load = async () => { loading.value = true; try { const r = await listFlows({ pageSize: 100 }); list.value = r?.list || []; } finally { loading.value = false; } };

const editVisible = ref(false);
const editing = ref(null);
const formRef = ref();
const saving = ref(false);
const mForm = reactive({ steps: [] });
const mRules = { name: [{ required: true, message: '请输入流程名' }] };

const openEdit = (row) => {
  editing.value = row;
  if (row) {
    // 从后端 nodes 格式转换为前端 steps 格式
    mForm.name = row.name || '';
    mForm.description = row.description || '';
    mForm.moduleId = row.moduleId;
    mForm.steps = (row.nodes || []).map(n => ({
      name: n.name || `第${n.level}级审批`,
      roles: mapApproverTypeToRoles(n.approverType),
      required: true
    }));
    if (mForm.steps.length === 0) {
      mForm.steps = [{ name: '一级审批', roles: ['class_admin'], required: true }];
    }
  } else {
    // 新增默认：一级审批为班级管理员
    mForm.name = '';
    mForm.description = '';
    mForm.moduleId = null;
    mForm.steps = [{ name: '班级管理员审核', roles: ['class_admin'], required: true }];
  }
  editVisible.value = true;
};

// 将后端 approverType 转换为前端 roles 数组
const mapApproverTypeToRoles = (approverType) => {
  if (!approverType) return ['class_admin'];
  if (approverType === 'auto_counselor') return ['counselor'];
  if (approverType === 'auto_college') return ['college_admin'];
  if (approverType === 'class_admin' || approverType === 'auto_class_admin') return ['class_admin'];
  if (approverType === 'school_admin') return ['school_admin'];
  return [approverType];
};

// 将前端 steps 转换为后端 nodes 格式
const mapStepsToNodes = (steps) => {
  return steps.map((s, i) => ({
    level: i + 1,
    name: s.name || `第${i + 1}级审批`,
    approverType: s.roles?.[0] || 'class_admin',
    approverIds: [],
    timeoutHours: 24
  }));
};

const addStep = () => {
  const defNames = ['二级审批', '三级审批'];
  const defaultRole = mForm.steps.length === 0 ? 'class_admin' : 'college_admin';
  mForm.steps.push({ name: defNames[mForm.steps.length - 1] || `第${mForm.steps.length + 1}级`, roles: [defaultRole], required: true });
};
const removeStep = (i) => mForm.steps.splice(i, 1);
const moveStep = (i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= mForm.steps.length) return;
  const tmp = mForm.steps[i]; mForm.steps[i] = mForm.steps[j]; mForm.steps[j] = tmp;
};
const validateSteps = () => {
  if (!mForm.steps.length) return '至少设置一级审批';
  for (let i = 0; i < mForm.steps.length; i++) {
    if (!mForm.steps[i].name) return `第 ${i+1} 级审批请填写名称`;
    if (!mForm.steps[i].roles || !mForm.steps[i].roles.length) return `第 ${i+1} 级审批请至少选择一个角色`;
  }
  return null;
};
const submitEdit = async () => {
  await formRef.value.validate();
  const err = validateSteps();
  if (err) { ElMessage.warning(err); return; }
  saving.value = true;
  try {
    // 将前端 steps 格式转换为后端 nodes 格式
    const payload = {
      name: mForm.name,
      description: mForm.description,
      nodes: mapStepsToNodes(mForm.steps)
    };
    if (mForm.moduleId) payload.moduleId = mForm.moduleId;

    if (editing.value?.id) {
      await updateFlow(editing.value.id, payload);
      ElMessage.success('已更新');
    } else {
      await createFlow(payload);
      ElMessage.success('已创建');
    }
    editVisible.value = false;
    load();
  } finally { saving.value = false; }
};
const del = async (r) => { await deleteFlow(r.id); ElMessage.success('已删除'); load(); };
onMounted(load);
</script>
<style lang="scss" scoped>
.step-list { padding: 4px; }
.step-item { background: #fafcff; border: 1px solid #ebeef5; border-radius: 10px; margin-bottom: 12px; padding: 10px 12px; }
.step-title { display:flex; align-items:center; gap:8px; padding: 4px 0;
  .badge { width: 28px; height:28px; border-radius:50%; background:#409EFF; color:#fff; font-weight:600; display:flex; align-items:center; justify-content:center; }
}
</style>
