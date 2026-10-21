<template>
  <div class="users-workspace">
    <WorkspaceHero
      eyebrow="IDENTITY DIRECTORY"
      title="用户管理"
      description="统一维护学生与教职工账户，快速完成组织筛选、状态管理和批量数据操作。"
    >
      <template #actions>
      <div class="hero-actions-group">
        <el-upload v-if="canImport" action="#" :show-file-list="false" accept=".xlsx,.xls" :http-request="onImportUser" style="margin-right:10px;">
          <el-button><Upload /> 批量导入</el-button>
        </el-upload>
        <el-button v-if="canImport" style="margin-right:10px;" @click="onExport"><Download /> 导出Excel</el-button>
        <el-button v-if="canBatchDelete && selectedIds.length > 0" type="danger" style="margin-right:10px;" :disabled="deleting" @click="onBatchDelete">
          <el-icon><Delete /></el-icon> 批量删除 ({{ selectedIds.length }})
        </el-button>
        <el-button type="primary" :disabled="!canCreate" @click="openEdit(null)"><Plus /> 新增用户</el-button>
      </div>
      </template>
    </WorkspaceHero>
    <div class="card user-board">
      <div class="board-heading">
        <div><span>USER DIRECTORY</span><h3>用户档案 <em>{{ total }}</em></h3></div>
        <small>按角色、院系、班级或状态快速定位</small>
      </div>
      <div class="filters">
        <el-select v-model="f.role" placeholder="角色" style="width:140px" clearable @change="go(1)">
          <el-option label="学生" value="student" />
          <el-option label="班级管理员" value="class_admin" />
          <el-option label="辅导员" value="counselor" />
          <el-option label="院系管理员" value="college_admin" />
          <el-option label="学校管理员" value="school_admin" />
        </el-select>
        <el-select v-if="userStore.role!=='counselor'" v-model="f.collegeId" placeholder="院系" style="width:200px" clearable @change="onCollegeChange">
          <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="f.classId" placeholder="班级" style="width:220px" clearable @change="go(1)">
          <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="f.status" placeholder="状态" style="width:120px" clearable @change="go(1)">
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="姓名/学号/工号/手机号" style="width:260px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>

      <el-table
        class="user-table"
        :data="list"
        v-loading="loading"
        stripe
        ref="tableRef"
        @selection-change="handleSelectionChange"
        row-key="id"
      >
        <el-table-column v-if="canBatchDelete" type="selection" width="50" align="center" reserve-selection />
        <el-table-column prop="uniqueId" label="系统ID" width="150">
          <template #default="{row}">
            <el-tooltip v-if="row.uniqueId" content="12位只读唯一ID：学校+学院+班级+流水号编码" placement="top">
              <span style="font-family: monospace; letter-spacing: 0.5px; color: #606266;">{{ row.uniqueId }}</span>
            </el-tooltip>
            <span v-else style="color:#c0c4cc;">--</span>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column label="角色" width="120">
          <template #default="{row}"><el-tag :type="ROLE_TAG[row.role]?.type || 'info'" effect="plain">{{ ROLE_TAG[row.role]?.label || row.role }}</el-tag></template>
        </el-table-column>
        <el-table-column label="院系" min-width="140" show-overflow-tooltip>
          <template #default="{row}">{{ row.college?.name || row.classInfo?.college?.name || '--' }}</template>
        </el-table-column>
        <el-table-column label="专业" min-width="120" show-overflow-tooltip>
          <template #default="{row}">{{ row.classInfo?.major || '--' }}</template>
        </el-table-column>
        <el-table-column label="班级" min-width="120" show-overflow-tooltip>
          <template #default="{row}">{{ row.classInfo?.name || row.class?.name || '--' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="联系电话" width="130" />
        <el-table-column prop="email" label="邮箱" width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{row}">
            <el-switch v-model="row.status" :active-value="1" :inactive-value="0" @change="(v)=>toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最近登录" width="160">
          <template #default="{row}">{{ row.lastLoginAt ? dayjs(row.lastLoginAt).format('MM-DD HH:mm') : '--' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="openDetail(row)">查看</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" @click="resetPwd(row)">重置密码</el-button>
            <el-popconfirm v-if="canDelete(row)" title="确认删除该用户？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editVisible" :title="editing?.id ? '编辑用户' : '新增用户'" width="min(560px, 92vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="100px">
        <el-form-item v-if="editing?.uniqueId" label="系统ID">
          <el-tooltip content="系统自动生成，12位只读唯一ID，不可修改" placement="top">
            <el-input v-model="mForm.uniqueId" disabled style="font-family: monospace;" />
          </el-tooltip>
        </el-form-item>
        <el-form-item label="账号" prop="username"><el-input v-model="mForm.username" placeholder="学号或工号" :disabled="!!editing?.id" /></el-form-item>
        <el-form-item label="姓名" prop="name"><el-input v-model="mForm.name" /></el-form-item>
        <el-form-item label="密码" v-if="!editing?.id" prop="password"><el-input v-model="mForm.password" show-password placeholder="默认123456" /></el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="mForm.role" style="width:100%" @change="resetRoleFields">
            <el-option v-for="o in ROLE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="['student','class_admin','counselor','college_admin'].includes(mForm.role)" label="所属院系" prop="collegeId">
          <el-select v-model="mForm.collegeId" style="width:100%" @change="loadClassesForEdit"><el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" /></el-select>
        </el-form-item>
        <!-- 用户明确：班级管理员 = 学生 + 管理本班权限，所以 role=class_admin 也必须选择所属班级 -->
        <el-form-item v-if="mForm.role==='student' || mForm.role==='class_admin'" :label="mForm.role==='class_admin' ? '管理班级' : '所属班级'" prop="classId">
          <el-select v-model="mForm.classId" style="width:100%" clearable filterable :placeholder="mForm.role==='class_admin' ? '必须选择：班级管理员本质是本班学生，仅能管理此班级' : '请选择所属班级'">
            <el-option v-for="c in classesForEdit" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="mForm.role!=='student'" label="工号">
          <el-input v-model="mForm.jobNo" placeholder="选填" />
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="mForm.phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="mForm.email" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 用户详情抽屉：基本信息 + 分数情况 -->
    <el-drawer v-model="detailVisible" :title="detailUser ? `用户详情 - ${detailUser.name || detailUser.username}` : '用户详情'" size="600px" destroy-on-close>
      <template v-if="detailUser">
        <el-descriptions title="基本信息" :column="2" border>
          <el-descriptions-item label="系统ID">
            <span v-if="detailUser.uniqueId" style="font-family: monospace;">{{ detailUser.uniqueId }}</span>
            <span v-else>--</span>
          </el-descriptions-item>
          <el-descriptions-item label="账号">{{ detailUser.username || '--' }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ detailUser.realName || detailUser.name || '--' }}</el-descriptions-item>
          <el-descriptions-item label="角色">
            <el-tag :type="ROLE_TAG[detailUser.role]?.type" effect="plain">{{ ROLE_TAG[detailUser.role]?.label || detailUser.role }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="院系">{{ detailUser.college?.name || detailUser.classInfo?.college?.name || '--' }}</el-descriptions-item>
          <el-descriptions-item label="专业">{{ detailUser.classInfo?.major || '--' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detailUser.classInfo?.name || '--' }}</el-descriptions-item>
          <el-descriptions-item label="学号/工号">{{ detailUser.studentNo || detailUser.jobNo || detailUser.employeeNo || '--' }}</el-descriptions-item>
          <el-descriptions-item label="性别">{{ genderText(detailUser.gender) }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ detailUser.phone || '--' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="detailUser.status === 1 ? 'success' : 'info'" effect="plain">{{ detailUser.status === 1 ? '正常' : '停用' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ detailUser.lastLoginAt ? dayjs(detailUser.lastLoginAt).format('YYYY-MM-DD HH:mm') : '--' }}</el-descriptions-item>
          <el-descriptions-item label="邮箱" :span="2">{{ detailUser.email || '--' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 分数情况：仅学生/班级管理员角色展示 -->
        <template v-if="isStudentLike(detailUser.role)">
          <div v-loading="scoreLoading" style="margin-top: 20px;">
            <template v-if="detailScore && (detailScore.semesters?.length || detailScore.annual?.length || detailScore.applications?.length)">
              <!-- 历史学期汇总（含各学期排名） -->
              <div class="flex-between" style="margin: 8px 0;">
                <span style="font-weight: 600;">历史学期汇总</span>
                <span style="color:#909399;font-size:12px;">按学期展示分数与排名</span>
              </div>
              <el-table :data="detailScore.semesters || []" size="small" border style="margin-bottom: 16px;">
                <el-table-column label="学期" min-width="150">
                  <template #default="{row}">{{ semesterLabel(row.academicYear, row.semester) }}</template>
                </el-table-column>
                <el-table-column label="总分" width="80" align="right">
                  <template #default="{row}">{{ Number(row.totalScore ?? 0).toFixed(2) }}</template>
                </el-table-column>
                <el-table-column label="班级排名" width="88" align="center">
                  <template #default="{row}">{{ row.classRank ? `第${row.classRank}名` : '--' }}</template>
                </el-table-column>
                <el-table-column label="专业排名" width="88" align="center">
                  <template #default="{row}">{{ row.majorRank ? `第${row.majorRank}名` : '--' }}</template>
                </el-table-column>
                <el-table-column label="院系排名" width="88" align="center">
                  <template #default="{row}">{{ row.collegeRank ? `第${row.collegeRank}名` : '--' }}</template>
                </el-table-column>
                <el-table-column label="申报项数" width="88" align="center">
                  <template #default="{row}">{{ row.applicationCount || 0 }}</template>
                </el-table-column>
              </el-table>

              <!-- 学年汇总（可选） -->
              <template v-if="detailScore.annual?.length">
                <div class="flex-between" style="margin: 8px 0;">
                  <span style="font-weight: 600;">学年汇总</span>
                </div>
                <el-table :data="detailScore.annual" size="small" border style="margin-bottom: 16px;">
                  <el-table-column label="学年" min-width="150">
                    <template #default="{row}">{{ row.academicYear }}学年</template>
                  </el-table-column>
                  <el-table-column label="总分" align="right">
                    <template #default="{row}">{{ Number(row.totalScore ?? 0).toFixed(2) }}</template>
                  </el-table-column>
                  <el-table-column label="申报项数" width="100" align="center">
                    <template #default="{row}">{{ row.applicationCount || 0 }}</template>
                  </el-table-column>
                </el-table>
              </template>

              <!-- 加分明细（体现每一条属于哪个学期） -->
              <div class="flex-between" style="margin: 8px 0;">
                <span style="font-weight: 600;">加分明细</span>
                <span style="color:#909399;font-size:12px;">共 {{ detailScore.applications?.length || 0 }} 项</span>
              </div>
              <el-table :data="detailScore.applications || []" size="small" border>
                <el-table-column label="学期" width="150">
                  <template #default="{row}">{{ semesterLabel(row.academicYear, row.semester) }}</template>
                </el-table-column>
                <el-table-column prop="module.name" label="模块" min-width="110" show-overflow-tooltip />
                <el-table-column prop="title" label="事项" min-width="160" show-overflow-tooltip />
                <el-table-column label="分值" width="75" align="right">
                  <template #default="{row}">{{ Number(row.finalScore || 0).toFixed(2) }}</template>
                </el-table-column>
              </el-table>
            </template>
            <el-alert v-else-if="!scoreLoading && detailScore?.__error" :title="detailScore.__error" type="warning" show-icon :closable="false" />
            <el-empty v-else-if="!scoreLoading" description="该学生暂无考评加分记录" />
          </div>
        </template>
        <el-empty v-else description="该用户为教职工/管理员角色，无考评加分记录" />
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, nextTick } from 'vue';
import dayjs from 'dayjs';
import { useUserStore } from '@/stores/user';
import { getUserList, createUser, updateUser, deleteUser, batchDeleteUsers, toggleUserStatus, resetUserPassword, exportUsers, importUsers } from '@/api/users';
import { getUserScoreHistory } from '@/api/scores';
import { listAllColleges, getClassList } from '@/api/college';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Avatar, Plus, Upload, Download, Delete } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const ROLE_TAG = {
  student: { label: '学生', type: 'info' },
  class_admin: { label: '班级管理员', type: '' },
  counselor: { label: '辅导员', type: 'success' },
  college_admin: { label: '院系管理员', type: 'warning' },
  school_admin: { label: '学校管理员', type: 'danger' },
  super_admin: { label: '超级管理员', type: 'danger' },
  developer: { label: '开发者', type: 'danger' }
};
// 角色下拉（按当前登录角色范围过滤，避免前端展示后端会拒绝的选项）
const ROLE_OPTIONS = computed(() => {
  const r = userStore.role;
  const ALLOW = {
    super_admin: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'],
    school_admin: ['student', 'class_admin', 'counselor', 'college_admin'],
    // 院管：用户明确规定——只能新建学生/辅导员/班级管理员
    college_admin: ['student', 'class_admin', 'counselor'],
    counselor: ['student', 'class_admin'],
    class_admin: ['student'],
    student: []
  };
  const list = ALLOW[r] || [];
  // 编辑模式下：如果当前用户的 role 不在 allow（比如超管改一个院管的字段，allow 不含 college_admin？不会），则补上去
  if (editing.value?.role && !list.includes(editing.value.role)) list.unshift(editing.value.role);
  return list.map(k => ({ value: k, label: ROLE_TAG[k]?.label || k }));
});

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const colleges = ref([]);
const classes = ref([]);
const classesForEdit = ref([]);
const f = reactive({ page: 1, pageSize: 20, role: '', collegeId: '', classId: '', status: '', keyword: '' });
const canImport = computed(() => ['school_admin', 'college_admin', 'super_admin'].includes(userStore.role));
const canCreate = computed(() => ['school_admin', 'college_admin', 'counselor', 'super_admin'].includes(userStore.role));
const canBatchDelete = computed(() => ['super_admin', 'school_admin', 'college_admin'].includes(userStore.role));
const canDelete = (row) => row.id !== userStore.userInfo?.id;

const tableRef = ref(null);
const selectedRows = ref([]);
const selectedIds = computed(() => selectedRows.value.map(r => r.id));
const deleting = ref(false);

// ===== 用户详情抽屉（查看用户信息 + 分数情况）=====
const detailVisible = ref(false);
const detailUser = ref(null);
const detailScore = ref(null);
const scoreLoading = ref(false);
const isStudentLike = (role) => ['student', 'class_admin'].includes(role);
const genderText = (g) => (g === 'male' ? '男' : (g === 'female' ? '女' : '--'));
const semesterLabel = (y, s) => {
  if (!y) return '--';
  if (s === 'annual') return `${y}学年汇总`;
  const n = s === 'first' ? '第一' : (s === 'second' ? '第二' : (s || ''));
  return `${y}学年${n}学期`;
};
const openDetail = async (row) => {
  detailUser.value = row;
  detailScore.value = null;
  detailVisible.value = true;
  if (!isStudentLike(row.role)) return; // 非学生角色无需拉取分数
  scoreLoading.value = true;
  try {
    detailScore.value = await getUserScoreHistory(row.id);
  } catch (e) {
    // 无权限等情况：静默处理，评分区显示提示即可
    detailScore.value = { semesters: [], annual: [], applications: [], __error: e?.message || '无权限查看该学生成绩' };
  } finally {
    scoreLoading.value = false;
  }
};

const handleSelectionChange = (rows) => {
  selectedRows.value = rows;
};

const go = async (p) => { f.page = p; loading.value = true;
  try { const r = await getUserList(f); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value = false; }
};
const onCollegeChange = () => { f.classId = ''; loadClasses(); go(1); };

const loadColleges = async () => {
  try { colleges.value = (await listAllColleges()) || []; } catch (_) {}
};
const loadClasses = async () => {
  try {
    const param = { pageSize: 500 };
    if (f.collegeId) param.collegeId = f.collegeId;
    classes.value = (await getClassList(param))?.list || [];
  } catch (_) {}
};
const loadClassesForEdit = async () => {
  mForm.classId = null;
  try {
    classesForEdit.value = (await getClassList({ collegeId: mForm.collegeId, pageSize: 500 }))?.list || [];
  } catch (_) {}
};

const editVisible = ref(false);
const editing = ref(null);
const formRef = ref();
const saving = ref(false);
const mForm = reactive({});
// name → realName，jobNo → employeeNo 的后端映射已经在服务端处理
const usernameRule = [{ required: true, message: '请输入账号（学号或工号）', trigger: 'blur' }];
const nameRule = [{ required: true, message: '请输入姓名', trigger: 'blur' }];
const passwordRule = [{ required: true, message: '请输入初始密码', trigger: 'blur' },
  { min: 4, message: '密码至少 4 位', trigger: 'blur' }];
const roleRule = [{ required: true, message: '请选择角色', trigger: 'change' }];
const collegeRule = [{ required: true, message: '请选择所属院系', trigger: 'change' }];
const classRule = [{ required: true, message: '请选择所属班级', trigger: 'change' }];

// 动态 rules：student/class_admin/counselor 才校验 collegeId；只有 student 必填 classId
const mRules = computed(() => {
  const base = {
    username: usernameRule,
    name: nameRule,
    role: roleRule
  };
  if (!editing.value?.id) base.password = passwordRule;
  if (['student','class_admin','counselor','college_admin'].includes(mForm.role)) base.collegeId = collegeRule;
  // 用户明确：班级管理员本质是本班学生（比普通学生多权限）→ 所以 class_admin 也必填所属班级
  if (mForm.role === 'student' || mForm.role === 'class_admin') base.classId = classRule;
  return base;
});

const openEdit = async (row) => {
  editing.value = row;
  // 解包 row.classId/class?.id/collegeId/college?.id 为纯 ID（接口 include 返回关联对象导致的回显空白 BUG）
  const parseIdSafe = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'object' && v.id != null) return parseIdSafe(v.id);
    const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // 新建时初始化所有字段为 null/空（避免上次残留导致校验误报）
  const init = row
    ? {
        ...row,
        collegeId: parseIdSafe(row.collegeId ?? row.college?.id) ?? null,
        classId: parseIdSafe(row.classId ?? row.class?.id) ?? null,
        counselorId: parseIdSafe(row.counselorId ?? row.counselor?.id) ?? null,
        deanId: parseIdSafe(row.deanId ?? row.dean?.id) ?? null,
        classAdminId: parseIdSafe(row.classAdminId ?? row.classAdmin?.id) ?? null
      }
    : {
        role: 'student',
        status: 1,
        username: '',
        name: '',
        password: '123456',
        collegeId: null,
        classId: null,
        phone: '',
        email: '',
        jobNo: '',
        gender: 'male'
      };
  // 清理上一次残留字段
  Object.keys(mForm).forEach(k => delete mForm[k]);
  Object.assign(mForm, init);
  if (mForm.collegeId) await loadClassesForEdit();
  editVisible.value = true;
  await nextTick();
  if (formRef.value) formRef.value.clearValidate();
};
const resetRoleFields = () => {
  mForm.collegeId = null; mForm.classId = null;
};
const submitEdit = async () => {
  try {
    await formRef.value.validate();
  } catch (e) {
    ElMessage.warning('请先完成必填项（红色星号）');
    return;
  }
  saving.value = true;
  try {
    // 提交前再次规范化所有 ID（避免 v-model 残留对象，或辅导员传错）
    const parseIdSafe = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'object' && v.id != null) return parseIdSafe(v.id);
      const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const payload = { ...mForm };
    delete payload.uniqueId; // 系统ID禁止前端修改
    payload.collegeId = parseIdSafe(payload.collegeId);
    payload.classId = parseIdSafe(payload.classId);
    payload.counselorId = parseIdSafe(payload.counselorId);
    payload.classAdminId = parseIdSafe(payload.classAdminId);
    // 辅导员创建/编辑用户时，即使前端显示 collegeId 下拉隐藏，也自动绑定用户所属学院（和后端一致）
    if (userStore.role === 'counselor') {
      const myCollegeId = parseIdSafe(userStore.userInfo?.collegeId);
      if (myCollegeId != null) payload.collegeId = myCollegeId;
    }
    if (editing.value?.id) {
      await updateUser(editing.value.id, payload);
      ElMessage.success('更新成功');
    } else {
      await createUser(payload);
      ElMessage.success('创建成功');
    }
    editVisible.value = false;
    // 保存后回到第一页（避免修改/新增的用户不在原筛选条件/原分页，用户误以为"没更新"），并刷新列表
    f.page = 1;
    await go(f.page);
  } catch (e) {
    // 兼容 axios 封装的 e.response.data.message 以及 AppError 返回的真实后端 message
    let msg = e?.message || '保存失败';
    try {
      if (e?.raw != null) msg = e.raw;
      else if (e?.response?.data != null) {
        const d = e.response.data;
        if (typeof d === 'string') msg = d;
        else if (d.message) msg = d.message;
        else if (d.data && Array.isArray(d.data) && d.data.join) msg = d.data.join('；');
        else if (d.error) msg = d.error;
      } else if (e?.errorFields && Array.isArray(e.errorFields)) {
        msg = '表单校验失败：' + e.errorFields.map(f => f.message).join('；');
      }
    } catch (_) {}
    ElMessage.error(msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
    if (typeof console !== 'undefined') console.error('[Users submitEdit] failed:', e);
  } finally { saving.value = false; }
};

const del = async (r) => { await deleteUser(r.id); ElMessage.success('已删除'); f.page = 1; go(f.page); };

const onBatchDelete = async () => {
  if (selectedIds.value.length === 0) return;
  const containsSelf = selectedIds.value.includes(userStore.userInfo?.id);
  const superAdminSelected = selectedRows.value.some(r => r.role === 'super_admin');
  const hasWarning = containsSelf || superAdminSelected;
  const warningText = [
    hasWarning ? '⚠️ 注意：' : '',
    containsSelf ? '所选内容包含您自己，将自动跳过；' : '',
    superAdminSelected ? '所选内容包含超级管理员，将自动跳过；' : ''
  ].filter(Boolean).join(' ');

  try {
    await ElMessageBox.confirm(
      `确定要批量删除选中的 <b style="color:#f56c6c;">${selectedIds.value.length}</b> 个用户吗？<br/>` +
      `<span style="color:#909399;font-size:12px;">此操作不可恢复，已删除的用户将无法找回。</span><br/>` +
      (warningText ? `<span style="color:#e6a23c;font-size:13px;">${warningText}</span>` : ''),
      '批量删除确认',
      {
        dangerouslyUseHTMLString: true,
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        showCancelButton: true
      }
    );
    deleting.value = true;
    const r = await batchDeleteUsers(selectedIds.value);
    const tip = r?.skippedReason ? `（${r.skippedReason}）` : '';
    ElMessage.success(`成功删除 ${r?.deleted || 0} 个用户${tip}`);
    if (tableRef.value) tableRef.value.clearSelection();
    selectedRows.value = [];
    go(f.page);
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败');
  } finally {
    deleting.value = false;
  }
};

const toggle = async (r, v) => { await toggleUserStatus(r.id, v); ElMessage.success(v ? '已启用' : '已停用'); };
const resetPwd = async (r) => {
  await ElMessageBox.confirm(`将用户「${r.name}」的密码重置为 123456？`, '重置密码', { type: 'warning' });
  await resetUserPassword(r.id);
  ElMessage.success('密码已重置为 123456');
};
const onExport = async () => {
  try {
    const blob = await exportUsers(f);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob], { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `用户列表_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { ElMessage.error('导出失败'); }
};
const onImportUser = async ({file}) => {
  try {
    const fd = new FormData(); fd.append('file', file);
    const r = await importUsers(fd);
    ElMessage.success(`导入成功：新增 ${r.added||0}，更新 ${r.updated||0}，失败 ${r.failed||0}`);
    go(f.page);
  } catch (e) { ElMessage.error(e.message || '导入失败'); }
};

onMounted(async () => {
  // 辅导员登录：自动锁定筛选条件为自己所属学院 + 只显示 student/class_admin 两种角色（因为他只能操作这两类）
  if (userStore.role === 'counselor') {
    const myCollegeId = userStore.userInfo?.collegeId ?? null;
    if (myCollegeId) f.collegeId = Number(myCollegeId);
    f.role = ''; // 默认不过滤角色，辅导员可以同时看到自己学院的学生和班级管理员
  }
  await loadColleges();
  await loadClasses();
  go(1);
});
</script>
<style lang="scss" scoped>
.users-workspace { padding-bottom:8px; }
.hero-actions-group { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.hero-actions-group :deep(.el-upload) { display:block; }
.hero-actions-group :deep(.el-button) { margin:0 !important; }
.user-board { margin-top:18px; padding:0; overflow:hidden; border:1px solid #E6EDF7; border-radius:18px; background:#fff; box-shadow:0 12px 32px rgba(23,43,77,.055); }
.board-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; padding:22px 24px 18px; border-bottom:1px solid #EAF0F7;
  span { color:#1876D2; font-size:10px; font-weight:800; letter-spacing:.16em; }
  h3 { margin:5px 0 0; color:#172B4D; font-size:18px; }
  h3 em { margin-left:5px; color:#1876D2; font-size:22px; font-style:normal; }
  small { color:#8997AB; font-size:12px; }
}
.filters { display:flex; flex-wrap:wrap; gap:10px; padding:16px 22px; border-bottom:1px solid #EAF0F7; background:#FAFCFE; }
.page-wrap { display:flex; justify-content:flex-end; padding:18px 22px; border-top:1px solid #EAF0F7; }
:deep(.user-table) { --el-table-header-bg-color:#F5F8FC; --el-table-row-hover-bg-color:#F3F8FF; }
:deep(.user-table th.el-table__cell) { height:50px; color:#52647E; font-weight:700; }
:deep(.user-table td.el-table__cell) { padding:12px 0; }

@media (max-width:768px) {
  .hero-actions-group { width:100%; }
  .hero-actions-group :deep(.el-button), .hero-actions-group :deep(.el-upload) { flex:1; width:100%; }
  .board-heading { align-items:flex-start; flex-direction:column; padding:19px; }
  .board-heading small { display:none; }
  .filters { padding:15px 18px; }
  .filters :deep(.el-select), .filters :deep(.el-input), .filters :deep(.el-button) { width:100% !important; }
  .page-wrap { justify-content:center; overflow-x:auto; padding:15px 10px; }
}
</style>
