<template>
  <div class="manage-page">
    <WorkspaceHero
      eyebrow="SCHOOL DIRECTORY"
      title="学校管理"
      description="学校是组织架构的顶层。学院管理员注册时先绑定学校，再由该校的学校管理员审批；院系也需要归属到某所学校。"
    >
      <template #actions>
        <el-button type="primary" @click="openDlg(null)"><Plus /> 新增学校</el-button>
      </template>
    </WorkspaceHero>

    <div class="card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="学校名称" min-width="180" />
        <el-table-column prop="code" label="学校代码" width="140">
          <template #default="{row}">{{ row.code || '--' }}</template>
        </el-table-column>
        <el-table-column label="院系数" width="100" align="center">
          <template #default="{row}"><el-tag size="small" effect="plain">{{ row.collegeCount || 0 }}</el-tag></template>
        </el-table-column>
        <el-table-column label="账号数" width="100" align="center">
          <template #default="{row}"><el-tag size="small" type="info" effect="plain">{{ row.userCount || 0 }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="80" align="center" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{row}">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="openDlg(row)">编辑</el-button>
            <el-popconfirm title="确认删除该学校？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dlg" :title="editing?.id ? '编辑学校' : '新增学校'" width="min(460px,92vw)">
      <el-form ref="formRef" :model="formData" :rules="rules" label-width="90px">
        <el-form-item label="学校名称" prop="name">
          <el-input v-model="formData.name" placeholder="如：西安文理学院" />
        </el-form-item>
        <el-form-item label="学校代码" prop="code">
          <el-input v-model="formData.code" placeholder="如：XAWL（可留空）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="formData.sort" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="formData.status" active-value="active" inactive-value="disabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { listSchools, createSchool, updateSchool, deleteSchool } from '@/api/schools';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const dlg = ref(false);
const editing = ref(null);
const formRef = ref();

const formData = reactive({ name: '', code: '', sort: 0, status: 'active' });
const rules = {
  name: [{ required: true, message: '请填写学校名称', trigger: 'blur' }]
};

const load = async () => {
  loading.value = true;
  try {
    list.value = await listSchools() || [];
  } finally {
    loading.value = false;
  }
};

const openDlg = (row) => {
  editing.value = row;
  formData.name = row?.name || '';
  formData.code = row?.code || '';
  formData.sort = row?.sort ?? 0;
  formData.status = row?.status || 'active';
  dlg.value = true;
};

const submit = async () => {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = { name: formData.name.trim(), code: formData.code.trim(), sort: formData.sort, status: formData.status };
    if (editing.value?.id) await updateSchool(editing.value.id, payload);
    else await createSchool(payload);
    ElMessage.success('已保存');
    dlg.value = false;
    load();
  } catch (_) { /* 拦截器已提示 */ } finally { saving.value = false; }
};

const del = async (row) => {
  try {
    await deleteSchool(row.id);
    ElMessage.success('已删除');
    load();
  } catch (_) { /* 拦截器已提示 */ }
};

onMounted(load);
</script>
