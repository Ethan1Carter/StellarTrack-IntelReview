<template>
  <div class="manage-page">
    <WorkspaceHero
      eyebrow="CLASS DUTY"
      title="我带的班级"
      description="辅导员在这里维护自己负责的班级：可以直接新增班级，也可以认领本院系下还没有辅导员的班级。新增的班级会自动归到你名下。"
    >
      <template #actions>
        <el-button type="primary" @click="openCreate"><Plus /> 新增班级</el-button>
        <el-button type="success" @click="openClaim"><Link /> 认领已有班级</el-button>
      </template>
    </WorkspaceHero>

    <div class="card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="班级名称" min-width="180">
          <template #default="{row}">
            <div style="display:flex; align-items:center; gap:8px;">
              <el-icon :size="15" color="#409EFF"><School /></el-icon>
              <span style="font-weight:600;">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="grade" label="年级" width="90">
          <template #default="{row}">{{ row.grade || '--' }}</template>
        </el-table-column>
        <el-table-column prop="major" label="专业" min-width="140">
          <template #default="{row}">{{ row.major || '--' }}</template>
        </el-table-column>
        <el-table-column label="所属院系" min-width="140">
          <template #default="{row}">{{ row.college?.name || '--' }}</template>
        </el-table-column>
        <el-table-column label="班级管理员" width="130">
          <template #default="{row}">
            <span v-if="row.classAdmin?.realName">{{ row.classAdmin.realName }}</span>
            <el-tag v-else size="small" type="info" effect="plain">未设置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="学生数" width="90" align="center">
          <template #default="{row}"><el-tag size="small" effect="plain">{{ row.studentCount || 0 }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" @click="viewClass(row)">查看班级</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div style="padding:18px 0; color:#909399;">
            你名下还没有班级，点右上角「新增班级」或「认领已有班级」。
          </div>
        </template>
      </el-table>
    </div>

    <!-- 新增班级 -->
    <el-dialog v-model="createDlg" title="新增班级" width="min(480px,92vw)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="班级将创建在你所属院系下，并自动绑定你为辅导员"
        style="margin-bottom:14px"
      />
      <el-form ref="createFormRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="班级名称" prop="name">
          <el-input v-model="form.name" placeholder="如：2025级软件工程1班" />
        </el-form-item>
        <el-form-item label="年级">
          <el-input v-model="form.grade" placeholder="如：2025（留空则从班级名自动识别）" />
        </el-form-item>
        <el-form-item label="专业">
          <el-input v-model="form.major" placeholder="选填" />
        </el-form-item>
        <el-form-item label="班级代码">
          <el-input v-model="form.code" placeholder="选填，留空自动生成" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 认领班级 -->
    <el-dialog v-model="claimDlg" title="认领已有班级" width="min(680px,94vw)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="下面是本院系还没有辅导员、且状态为启用的班级"
        description="认领后该班的学生、申报审批都会归到你名下。已被其他辅导员认领的班级不会出现在这里。"
        style="margin-bottom:14px"
      />
      <el-table :data="available" v-loading="loadingAvailable" height="320" stripe>
        <el-table-column prop="name" label="班级名称" min-width="200" />
        <el-table-column prop="grade" label="年级" width="90">
          <template #default="{row}">{{ row.grade || '--' }}</template>
        </el-table-column>
        <el-table-column prop="major" label="专业" min-width="130">
          <template #default="{row}">{{ row.major || '--' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{row}">
            <el-button link type="primary" :loading="claimingId === row.id" @click="doClaim(row)">认领</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div style="padding:18px 0; color:#909399;">本院系暂时没有可认领的班级</div>
        </template>
      </el-table>
      <template #footer>
        <el-button @click="claimDlg = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Link, School } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { getClassList, createClass, getAvailableClasses, claimClass } from '@/api/classes';

const router = useRouter();

const list = ref([]);
const loading = ref(false);
const saving = ref(false);

const load = async () => {
  loading.value = true;
  try {
    const r = await getClassList({ pageSize: 100 });
    list.value = Array.isArray(r) ? r : (r?.list || []);
  } finally {
    loading.value = false;
  }
};

// ===== 新增班级 =====
const createDlg = ref(false);
const createFormRef = ref();
const form = reactive({ name: '', grade: '', major: '', code: '' });
const rules = {
  name: [{ required: true, message: '请填写班级名称', trigger: 'blur' }]
};

const openCreate = () => {
  Object.assign(form, { name: '', grade: '', major: '', code: '' });
  createDlg.value = true;
};

const submitCreate = async () => {
  await createFormRef.value.validate();
  saving.value = true;
  try {
    const payload = { name: form.name.trim() };
    if (form.grade.trim()) payload.grade = form.grade.trim();
    else {
      // 没填年级时，从班级名里的 4 位年份推断
      const m = /(20\d{2})/.exec(payload.name);
      if (m) payload.grade = m[1];
    }
    if (form.major.trim()) payload.major = form.major.trim();
    if (form.code.trim()) payload.code = form.code.trim();
    await createClass(payload);
    ElMessage.success('班级已创建并归到你名下');
    createDlg.value = false;
    load();
  } catch (_) { /* 拦截器已提示 */ } finally { saving.value = false; }
};

// ===== 认领班级 =====
const claimDlg = ref(false);
const available = ref([]);
const loadingAvailable = ref(false);
const claimingId = ref(null);

const openClaim = async () => {
  claimDlg.value = true;
  loadingAvailable.value = true;
  try {
    available.value = (await getAvailableClasses()) || [];
  } catch (_) {
    available.value = [];
  } finally { loadingAvailable.value = false; }
};

const doClaim = async (row) => {
  claimingId.value = row.id;
  try {
    await claimClass(row.id);
    ElMessage.success(`已认领「${row.name}」`);
    available.value = available.value.filter(c => c.id !== row.id);
    load();
  } catch (_) { /* 拦截器已提示 */ } finally { claimingId.value = null; }
};

const viewClass = (row) => router.push({ path: '/my-class', query: { classId: row.id } });

onMounted(load);
</script>
