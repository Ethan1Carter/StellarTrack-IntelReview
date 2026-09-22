<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="CLASS OPERATIONS" title="班级管理" description="维护班级档案、辅导员分配与成员范围，让组织关系和管理责任保持一致。">
      <template #actions><div class="hero-actions-group">
        <el-button @click="onExportClasses" style="margin-right:8px;" :disabled="userStore.role==='class_admin'"><Download /> 导出班级</el-button>
        <template v-if="userStore.role!=='class_admin'">
          <el-button type="primary" @click="tab='assign'" v-if="tab==='list'"><Connection /> 辅导员分配</el-button>
          <el-button type="primary" @click="tab='list'" v-else><List /> 班级列表</el-button>
        </template>
      </div></template>
    </WorkspaceHero>

    <!-- 班级列表 -->
    <div v-if="tab==='list'" class="card">
      <div class="filters">
        <el-select v-if="userStore.role!=='counselor'" v-model="f.collegeId" placeholder="院系" style="width:200px" clearable @change="go(1)">
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="班级名称" style="width:200px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
        <el-button type="success" v-if="canCreate" @click="openEdit(null)"><Plus /> 新增班级</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="班级名称" width="160" />
        <el-table-column label="院系" width="160">
          <template #default="{row}">{{ row.college?.name || '--' }}</template>
        </el-table-column>
        <el-table-column prop="grade" label="年级" width="80" />
        <el-table-column prop="major" label="专业" min-width="160" show-overflow-tooltip />
        <el-table-column label="班级管理员" width="100">
          <template #default="{row}">{{ row.classAdmin?.realName || '未分配' }}</template>
        </el-table-column>
        <el-table-column label="辅导员" width="100">
          <template #default="{row}">{{ row.counselor?.realName || '未分配' }}</template>
        </el-table-column>
        <el-table-column prop="studentCount" label="人数" width="70" align="center" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{row}"><el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status==='active'?'正常':'停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="openEdit(row)" v-if="canEditRow(row)">编辑</el-button>
            <el-popconfirm v-if="userStore.role==='school_admin'||userStore.role==='super_admin'" title="确认删除？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s;go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 辅导员分配 -->
    <div v-if="tab==='assign'">
      <el-row :gutter="16">
        <!-- 辅导员列表 -->
        <el-col :xs="24" :md="8">
          <div class="card">
            <div class="card-title">辅导员列表</div>
            <el-table :data="assignments.counselors || []" stripe @row-click="selectCounselor" highlight-current-row :row-class-name="counselorRowClass">
              <el-table-column prop="counselor.realName" label="姓名" width="100" />
              <el-table-column label="院系" min-width="120">
                <template #default="{row}">{{ row.counselor.college?.name || '--' }}</template>
              </el-table-column>
              <el-table-column prop="classCount" label="负责班级" width="80" align="center" />
              <el-table-column prop="totalStudents" label="总人数" width="70" align="center" />
            </el-table>
          </div>
        </el-col>

        <!-- 已分配班级 -->
        <el-col :xs="24" :md="8">
          <div class="card">
            <div class="card-title">
              {{ selectedCounselor ? `${selectedCounselor.counselor.realName} 的班级` : '已分配班级' }}
            </div>
            <el-table :data="selectedCounselor?.classes || []" stripe>
              <el-table-column prop="name" label="班级" min-width="120" />
              <el-table-column prop="grade" label="年级" width="70" />
              <el-table-column prop="studentCount" label="人数" width="60" align="center" />
              <el-table-column label="操作" width="80" align="center">
                <template #default="{row}">
                  <el-popconfirm title="取消分配？" @confirm="unassign(row)">
                    <template #reference><el-button link type="warning" size="small">取消</el-button></template>
                  </el-popconfirm>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="!selectedCounselor?.classes?.length" description="暂无分配班级" />
          </div>
        </el-col>

        <!-- 未分配班级 -->
        <el-col :xs="24" :md="8">
          <div class="card">
            <div class="card-title">
              未分配班级
              <el-button v-if="selectedCounselor && unselected.length" type="primary" size="small" @click="batchAssign">批量分配</el-button>
            </div>
            <el-table :data="assignments.unassignedClasses || []" stripe @selection-change="onUnassignedSelect">
              <el-table-column type="selection" width="40" />
              <el-table-column prop="name" label="班级" min-width="120" />
              <el-table-column prop="grade" label="年级" width="70" />
              <el-table-column prop="studentCount" label="人数" width="60" align="center" />
            </el-table>
            <el-empty v-if="!assignments.unassignedClasses?.length" description="全部班级已分配" />
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" :title="editing?.id ? '编辑班级' : '新增班级'" width="min(520px,92vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="110px">
        <el-form-item label="班级名称" prop="name"><el-input v-model="mForm.name" /></el-form-item>
        <el-form-item label="班级代码"><el-input v-model="mForm.code" /></el-form-item>
        <el-form-item label="院系" prop="collegeId">
          <el-select v-model="mForm.collegeId" style="width:100%"><el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" /></el-select>
        </el-form-item>
        <el-form-item label="年级" prop="grade"><el-input v-model="mForm.grade" placeholder="如 2024" /></el-form-item>
        <el-form-item label="专业" prop="major"><el-input v-model="mForm.major" /></el-form-item>
        <el-form-item label="班级管理员" v-if="!isClassAdminEdit">
          <el-select v-model="mForm.classAdminId" style="width:100%" clearable filterable placeholder="选择班级管理员（role=班级管理员）">
            <el-option v-for="c in classAdmins" :key="c.id" :label="`${c.realName}（${c.username}）`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="辅导员" v-if="!isClassAdminEdit">
          <el-select v-model="mForm.counselorId" style="width:100%" clearable filterable placeholder="选择辅导员">
            <el-option v-for="c in counselors" :key="c.id" :label="c.realName" :value="c.id" />
          </el-select>
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
import { ref, reactive, computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { getClassList, createClass, updateClass, deleteClass, getCounselorAssignments, assignCounselor, unassignCounselor, exportClasses } from '@/api/classes';
import { listAllColleges } from '@/api/college';
import { getStaffList } from '@/api/users';
import { ElMessage } from 'element-plus';
import { School, Download, Plus, Connection, List } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const parseIdSafe = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.id != null) return parseIdSafe(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const userStore = useUserStore();
const tab = ref('list');
const list = ref([]);
const total = ref(0);
const loading = ref(false);
const colleges = ref([]);
const counselors = ref([]);
const classAdmins = ref([]);
const assignments = ref({ counselors: [], unassignedClasses: [] });
const selectedCounselor = ref(null);
const unselected = ref([]);

const f = reactive({ page:1, pageSize:20, collegeId:'', keyword:'', counselorId:'' });
// 班级管理员编辑模式：隐藏班级管理员/辅导员/院系字段只读
const isClassAdminEdit = computed(() => userStore.role === 'class_admin');
// 新增/编辑权限：班级管理员只能编辑自己管理的那个班级（后端已限定不能改辅导员/院系/管理员字段）
const canCreate = computed(() => ['school_admin','super_admin','college_admin','counselor'].includes(userStore.role));
// 编辑按钮：班级管理员也允许编辑自己管理的班级
const canEditRow = (row) => canCreate.value || (userStore.role === 'class_admin' && parseIdSafe(row?.classAdminId) === Number(userStore.userInfo?.id));

const go = async (p) => {
  f.page = p; loading.value = true;
  try { const r = await getClassList(f); list.value = r?.list||[]; total.value = r?.total||0; } finally { loading.value=false; }
};

const loadAssignments = async () => {
  try { assignments.value = await getCounselorAssignments({ collegeId: f.collegeId }); } catch (_) {}
};

const selectCounselor = (row) => { selectedCounselor.value = row; };
const counselorRowClass = ({row}) => selectedCounselor.value?.counselor?.id === row.counselor?.id ? 'current-row' : '';

const onUnassignedSelect = (rows) => { unselected.value = rows; };

const batchAssign = async () => {
  if (!selectedCounselor.value) { ElMessage.warning('请先选择辅导员'); return; }
  try {
    await assignCounselor({ classIds: unselected.value.map(c=>c.id), counselorId: selectedCounselor.value.counselor.id });
    ElMessage.success('分配成功');
    await loadAssignments();
  } catch (e) { ElMessage.error(e.message||'分配失败'); }
};

const unassign = async (row) => {
  try { await unassignCounselor(row.id); ElMessage.success('已取消分配'); await loadAssignments(); } catch (e) { ElMessage.error('操作失败'); }
};

// 编辑
const editVisible = ref(false);
const editing = ref(null);
const formRef = ref();
const saving = ref(false);
const mForm = reactive({});
const mRules = { name:[{required:true,message:'请输入班级名称'}], collegeId:[{required:true,message:'请选择院系'}], grade:[{required:true,message:'请输入年级'}], major:[{required:true,message:'请输入专业'}] };

const openEdit = (row) => {
  editing.value = row;
  const base = row ? { ...row } : { status: 'active', studentCount: 0 };
  // 解包关联对象为纯 ID：接口 include 返回的 counselor/classAdmin/college 都是对象，el-select :value 是纯 id，不匹配会导致回显空白
  base.collegeId = parseIdSafe(row?.collegeId ?? row?.college?.id);
  base.counselorId = parseIdSafe(row?.counselorId ?? row?.counselor?.id);
  base.classAdminId = parseIdSafe(row?.classAdminId ?? row?.classAdmin?.id);
  // 辅导员新增班级：默认绑定辅导员自己和本院系；编辑班级时不能改成其他人负责的
  if (userStore.role === 'counselor') {
    const myCollegeId = parseIdSafe(userStore.userInfo?.collegeId);
    if (myCollegeId != null) base.collegeId = myCollegeId;
    base.counselorId = Number(userStore.userInfo?.id);
  }
  Object.assign(mForm, base);
  editVisible.value = true;
};

const submitEdit = async () => {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = { ...mForm };
    // 发送前再次规范化所有 ID（防止用户手动绑定、或 v-model 里残留的对象）
    payload.collegeId = parseIdSafe(payload.collegeId);
    payload.counselorId = parseIdSafe(payload.counselorId);
    payload.classAdminId = parseIdSafe(payload.classAdminId);
    payload.grade = payload.grade != null ? String(payload.grade).trim() : null;
    if (editing.value?.id) { await updateClass(editing.value.id, payload); ElMessage.success('更新成功'); }
    else { await createClass(payload); ElMessage.success('创建成功'); }
    editVisible.value = false;
    // 新增/修改后统一回到第1页，确保新记录可见（避免修改后不在原筛选/原分页，用户误以为"没更新"）
    f.page = 1;
    await go(f.page);
    // 刷新辅导员分配面板（classAdmin/counselor 变化后重新拉）
    if (tab.value === 'assign') await loadAssignments();
  } finally { saving.value = false; }
};

const del = async (row) => { await deleteClass(row.id); ElMessage.success('已删除'); go(1); };

const onExportClasses = async () => {
  try {
    const blob = await exportClasses(f);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob],{type:blob.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    a.download = `班级列表_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
    a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { ElMessage.error('导出失败'); }
};

onMounted(async () => {
  if (userStore.role === 'school_admin' || userStore.role === 'super_admin') {
    try { colleges.value = (await listAllColleges()) || []; } catch (_) {}
  }
  // 辅导员/班级管理员登录：锁定查询范围（班级管理员只显示自己管理的 1 个班级，后端 classes.js L36 已按 classAdminId 过滤）
  if (userStore.role === 'counselor') {
    const myCollegeId = parseIdSafe(userStore.userInfo?.collegeId);
    if (myCollegeId != null) f.collegeId = myCollegeId;
    f.counselorId = Number(userStore.userInfo?.id);
  }
  if (userStore.role === 'class_admin') {
    const myCollegeId = parseIdSafe(userStore.userInfo?.collegeId);
    if (myCollegeId != null) f.collegeId = myCollegeId;
  }
  try { const r = await getStaffList({ role:'counselor' }); counselors.value = r || []; } catch (_) {}
  try { const r = await getStaffList({ role:'class_admin' }); classAdmins.value = r || []; } catch (_) {}
  go(1);
  // 班级管理员不需要"辅导员分配"面板（仅分配给院管/学校管理员/辅导员看）
  if (userStore.role !== 'class_admin') loadAssignments();
});
</script>

<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
:deep(.current-row) { background-color: var(--el-color-primary-light-9) !important; }
</style>
