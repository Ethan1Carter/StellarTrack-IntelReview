<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="BONUS MODULES" title="加分模块" description="统一维护评价项目、分值上限和适用院系，让各学院规则清楚且可追溯。">
      <template #actions><el-button :disabled="!canEdit" @click="openEdit(null)"><Plus /> 新增模块</el-button></template>
    </WorkspaceHero>
    <div class="card">
      <div class="filters">
        <el-select v-model="f.status" placeholder="状态" style="width:140px" clearable @change="go(1)">
          <el-option label="启用中" value="active" />
          <el-option label="已停用" value="disabled" />
        </el-select>
        <el-select v-model="f.category" placeholder="分类" style="width:140px" clearable @change="go(1)">
          <el-option v-for="(v,k) in CATE" :key="k" :label="v" :value="k" />
        </el-select>
        <el-select v-model="f.isRequired" placeholder="必选状态" style="width:140px" clearable @change="go(1)">
          <el-option label="必选" value="true" />
          <el-option label="非必选" value="false" />
        </el-select>
        <el-select v-if="userStore.role === 'super_admin' || userStore.role === 'school_admin'"
          v-model="f.collegeId" placeholder="学院" style="width:160px" clearable @change="go(1)">
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="搜索模块名" clearable style="width:220px" @keyup.enter="go(1)" />
      </div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="模块" min-width="240">
          <template #default="{row}">
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="m-ico" :style="{background: row.color || '#409EFF'}">
                {{ row.icon || (row.name || '?').substring(0,1) }}
              </div>
              <div>
                <div style="font-weight:600;">
                  {{ row.name }}
                  <el-tag v-if="row.isRequired" size="small" type="danger" style="margin-left:4px;">必选</el-tag>
                </div>
                <div style="font-size:12px; color:#909399;">
                  {{ row.college?.name || (row.collegeId ? '未知学院' : '全校通用') }}
                  · {{ row.description || '无描述' }}
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="110">
          <template #default="{row}"><el-tag size="small" type="info">{{ CATE[row.category] || '--' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="分数限制" width="180" align="center">
          <template #default="{row}">单次 {{ row.singleMaxScore }} 分 / 累计 {{ row.yearlyMaxScore }} 分</template>
        </el-table-column>
        <el-table-column label="排序" width="80" align="center">
          <template #default="{row}">{{ row.sort }}</template>
        </el-table-column>
        <el-table-column label="必选" width="80" align="center">
          <template #default="{row}">
            <el-switch v-model="row.isRequired" :disabled="!canEdit" @change="(v)=>toggleRequired(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{row}">
            <el-switch v-model="row.status" active-value="active" inactive-value="disabled" :disabled="!canEdit" @change="(v)=>toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-button link type="primary" :disabled="!canEdit" @click="copyMod(row)">复制</el-button>
            <el-popconfirm v-if="canEdit" title="删除后申报记录将保留标记，确认？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="editVisible" :title="editing?.id ? '编辑模块' : '新增模块'" width="min(640px, 94vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="130px">
        <el-form-item label="模块名称" prop="name"><el-input v-model="mForm.name" maxlength="100" show-word-limit /></el-form-item>
        <el-form-item label="模块编码"><el-input v-model="mForm.code" maxlength="50" placeholder="选填，用于系统标识" /></el-form-item>
        <el-form-item label="所属学院" v-if="userStore.role === 'super_admin' || userStore.role === 'school_admin'">
          <el-select v-model="mForm.collegeId" clearable placeholder="空为全校通用" style="width:100%">
            <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="mForm.category" style="width:100%">
            <el-option v-for="(v,k) in CATE" :key="k" :label="v" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item label="模块颜色">
          <el-color-picker v-model="mForm.color" show-alpha />
          <span style="margin-left:12px; color:#909399;">模块展示色块</span>
        </el-form-item>
        <el-form-item label="图标字">
          <el-input v-model="mForm.icon" maxlength="1" placeholder="一个汉字/字母" style="width:120px" />
          <span style="margin-left:12px; color:#909399;">不填则取名称首字</span>
        </el-form-item>
        <el-form-item label="模块说明"><el-input v-model="mForm.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="加分标准"><el-input v-model="mForm.ruleDescription" type="textarea" :rows="2" placeholder="详细加分规则说明" /></el-form-item>
        <el-form-item label="单次上限" prop="singleMaxScore">
          <el-input-number v-model="mForm.singleMaxScore" :min="0" :step="0.5" />
          <span style="margin-left:12px; color:#909399;">分</span>
        </el-form-item>
        <el-form-item label="累计上限" prop="yearlyMaxScore">
          <el-input-number v-model="mForm.yearlyMaxScore" :min="0" :step="1" />
          <span style="margin-left:12px; color:#909399;">分</span>
        </el-form-item>
        <el-form-item label="年次数上限">
          <el-input-number v-model="mForm.yearlyMaxCount" :min="0" :step="1" />
          <span style="margin-left:12px; color:#909399;">0表示不限</span>
        </el-form-item>
        <el-form-item label="必选模块">
          <el-switch v-model="mForm.isRequired" />
          <span style="margin-left:12px; color:#909399;">学生必须完成的模块</span>
        </el-form-item>
        <el-form-item label="需要照片">
          <el-switch v-model="mForm.requirePhoto" />
        </el-form-item>
        <el-form-item label="最少照片数" v-if="mForm.requirePhoto">
          <el-input-number v-model="mForm.minPhotoCount" :min="1" :step="1" />
        </el-form-item>
        <el-form-item label="需要说明">
          <el-switch v-model="mForm.requireDescription" />
        </el-form-item>
        <el-form-item label="需要证书编号">
          <el-switch v-model="mForm.requireCertificateNo" />
        </el-form-item>
        <el-form-item label="适用范围">
          <el-select v-model="mForm.applyScope" style="width:100%">
            <el-option label="全校" value="all" />
            <el-option label="指定年级" value="specific_grade" />
            <el-option label="指定专业" value="specific_major" />
            <el-option label="指定班级" value="specific_class" />
          </el-select>
        </el-form-item>
        <el-form-item label="审批流程"><el-tag type="info">班级管理员初审 → 辅导员终审</el-tag></el-form-item>
        <el-form-item label="显示排序"><el-input-number v-model="mForm.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="mForm.status" active-value="active" inactive-value="disabled" />
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
import { listModules, createModule, updateModule, deleteModule, toggleModuleStatus, toggleModuleRequired, copyModule as copyModApi } from '@/api/modules';
import { listAllColleges } from '@/api/college';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Collection, Plus } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const CATE = { academy: '学业表现', morality: '思想品德', sports: '身心素质', competition: '艺术美育', volunteer: '劳动实践', innovation: '创新创业', scholarship: '奖学金', attendance: '出勤', other: '其他' };
const canEdit = computed(() => ['super_admin', 'school_admin', 'college_admin'].includes(userStore.role));

const list = ref([]);
const colleges = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, pageSize: 20, status: '', category: '', isRequired: '', keyword: '', collegeId: '' });

const go = async (p) => {
  f.page = p;
  loading.value = true;
  try {
    const params = { ...f };
    if (userStore.role === 'college_admin') {
      params.collegeId = userStore.collegeId;
    }
    const r = await listModules(params);
    list.value = r?.list || [];
    total.value = r?.total || 0;
  } finally {
    loading.value = false;
  }
};

const editVisible = ref(false);
const editing = ref(null);
const formRef = ref();
const saving = ref(false);
const mForm = reactive({});
const mRules = {
  name: [{ required: true, message: '请输入模块名', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
  singleMaxScore: [{ required: true, message: '请填写单次上限', trigger: 'blur' }],
  yearlyMaxScore: [{ required: true, message: '请填写累计上限', trigger: 'blur' }]
};

const defaultForm = () => ({
  name: '', code: '', category: 'other', collegeId: userStore.role === 'college_admin' ? userStore.collegeId : null,
  color: '#409EFF', icon: '', description: '', ruleDescription: '',
  singleMaxScore: 10, yearlyMaxScore: 50, yearlyMaxCount: 10,
  isRequired: false, requirePhoto: true, minPhotoCount: 1,
  requireDescription: true, requireCertificateNo: false,
  applyScope: 'all', sort: 0, status: 'active'
});

const openEdit = (row) => {
  editing.value = row;
  if (row) {
    const data = JSON.parse(JSON.stringify(row));
    Object.assign(mForm, data);
  } else {
    Object.assign(mForm, defaultForm());
  }
  editVisible.value = true;
};

const submitEdit = async () => {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = { ...mForm };
    if (userStore.role === 'college_admin') {
      payload.collegeId = userStore.collegeId;
    }
    if (editing.value?.id) {
      await updateModule(editing.value.id, payload);
      ElMessage.success('已更新');
    } else {
      await createModule(payload);
      ElMessage.success('已创建');
    }
    editVisible.value = false;
    go(f.page);
  } finally {
    saving.value = false;
  }
};

const del = async (r) => {
  await ElMessageBox.confirm(`确认删除模块「${r.name}」？删除后相关申报记录将保留。`, '提示', { type: 'warning' });
  await deleteModule(r.id);
  ElMessage.success('已删除');
  go(f.page);
};

const toggle = async (r, v) => {
  await toggleModuleStatus(r.id, v);
  r.status = v;
  ElMessage.success(v === 'active' ? '已启用' : '已停用');
};

const toggleRequired = async (r, v) => {
  await toggleModuleRequired(r.id, v);
  r.isRequired = v;
  ElMessage.success(v ? '已设为必选' : '已取消必选');
};

const copyMod = async (r) => {
  await copyModApi(r.id);
  ElMessage.success('已复制');
  go(f.page);
};

onMounted(async () => {
  try {
    if (['super_admin', 'school_admin'].includes(userStore.role)) {
      colleges.value = await listAllColleges();
    }
  } catch (_) {}
  go(1);
});
</script>
<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding: 12px 16px; }
.m-ico { width:36px; height:36px; border-radius:10px; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0; }
</style>
