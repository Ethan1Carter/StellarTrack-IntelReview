<template>
  <div class="organization-workspace">
    <WorkspaceHero
      eyebrow="ORGANIZATION MAP"
      title="组织架构"
      description="以院系、专业、班级三级结构管理学校组织信息，清晰查看归属关系与人员规模。"
    >
      <template #actions>
      <div class="org-actions">
        <el-button v-if="canManageCollege" type="primary" @click="openCollege(null)"><Plus /> 新增院系</el-button>
        <el-button v-if="canManage && colSel" type="success" @click="openMajor(null)"><Plus /> 新增专业</el-button>
        <el-button v-if="canCreateClass" type="warning" @click="openClass(null)"><Plus /> 新增班级</el-button>
        <el-dropdown v-if="canBatchOperate" trigger="click" @command="onBatchCmd">
          <el-button>批量操作 <el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="template">下载导入模板</el-dropdown-item>
              <el-dropdown-item command="import">批量导入院系班级</el-dropdown-item>
              <el-dropdown-item command="export">导出院系班级</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <input type="file" ref="importFileRef" accept=".xlsx,.xls" style="display:none" @change="onImportFile" />
      </div>
      </template>
    </WorkspaceHero>

    <el-row :gutter="16" class="org-grid">
      <!-- 左侧：院系列表 -->
      <el-col :xs="24" :md="6">
        <div class="card hierarchy-card college-panel">
          <div class="card-title">院系列表（{{ filteredColleges.length }}）</div>
          <el-table :data="filteredColleges" v-loading="loading" stripe height="calc(100% - 64px)" highlight-current-row @row-click="selectCollege">
            <el-table-column label="院系名称" min-width="140">
              <template #default="{row}">
                <div style="display:flex; align-items:center; gap:8px;">
                  <el-icon :size="16" color="#409EFF"><Folder /></el-icon>
                  <span style="font-weight:600;">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="code" label="编码" width="90" />
            <el-table-column label="操作" width="100" align="center">
              <template #default="{row}">
                <el-button v-if="canManageCollege" link type="primary" @click.stop="openCollege(row)">编辑</el-button>
                <el-popconfirm v-if="canManageCollege" title="确认删除？" @confirm="delCollege(row)">
                  <template #reference><el-button link type="danger" @click.stop>删除</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>

      <!-- 中间：专业列表 -->
      <el-col :xs="24" :md="6">
        <div class="card hierarchy-card major-panel">
          <div class="card-title">
            专业列表
            <span v-if="colSel" style="margin-left:8px;">
              <el-tag type="primary" effect="light" size="small">{{ colSel.name }}</el-tag>
            </span>
            <span v-else style="margin-left:8px; color:#909399; font-size:12px;">（选择院系）</span>
          </div>
          <el-table :data="majors" v-loading="loadingC" stripe height="calc(100% - 64px)" highlight-current-row @row-click="selectMajor">
            <el-table-column label="专业名称" min-width="140">
              <template #default="{row}">
                <div style="display:flex; align-items:center; gap:8px;">
                  <el-icon :size="14" color="#67C23A"><Reading /></el-icon>
                  <span>{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="班级数" width="70" align="center">
              <template #default="{row}"><el-tag size="small">{{ row.count }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{row}">
                <el-button v-if="canManage" link type="primary" @click.stop="openMajor(row)">编辑</el-button>
                <el-popconfirm v-if="canManage" title="确认删除该专业？" @confirm="delMajor(row)">
                  <template #reference><el-button link type="danger" @click.stop>删除</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>

      <!-- 右侧：班级列表 -->
      <el-col :xs="24" :md="12">
        <div class="card hierarchy-card class-panel">
          <div class="card-title">
            班级列表（{{ filteredClasses.length }}）
            <span v-if="majorSel" style="margin-left:8px;">
              <el-tag type="success" effect="light" size="small">{{ majorSel.name }}</el-tag>
            </span>
            <span v-else-if="colSel" style="margin-left:8px;">
              <el-tag type="primary" effect="light" size="small">{{ colSel.name }}</el-tag>
            </span>
            <span v-else style="margin-left:8px; color:#909399; font-size:12px;">（选择院系/专业查看班级）</span>
          </div>
          <el-table :data="filteredClasses" v-loading="loadingD" stripe height="calc(100% - 64px)">
            <el-table-column prop="name" label="班级名称" min-width="150" />
            <el-table-column prop="grade" label="年级" width="80" />
            <el-table-column prop="major" label="专业" width="150" show-overflow-tooltip />
            <el-table-column label="辅导员" width="110">
              <template #default="{row}">{{ row.counselor?.realName || row.counselor?.name || '未分配' }}</template>
            </el-table-column>
            <el-table-column label="班级管理员" width="110">
              <template #default="{row}">{{ row.classAdmin?.realName || row.classAdmin?.name || '未分配' }}</template>
            </el-table-column>
            <el-table-column label="学生数" width="80" align="center">
              <template #default="{row}"><el-tag size="small" type="success">{{ row.studentsCount || row.studentCount || 0 }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right" align="center">
              <template #default="{row}">
                <el-button link type="success" @click="openClassUsers(row)">用户</el-button>
                <el-button v-if="canEditClass(row)" link type="primary" @click="openClass(row)">编辑</el-button>
                <el-popconfirm v-if="canDeleteClass(row)" title="确认删除？" @confirm="delClass(row)">
                  <template #reference><el-button link type="danger">删除</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-col>
    </el-row>

    <!-- 院系编辑 -->
    <el-dialog v-model="collegeDlg" :title="editingC?.id ? '编辑院系' : '新增院系'" width="min(480px,92vw)">
      <el-form ref="collegeFormRef" :model="collegeFormData" :rules="collegeRules" label-width="80px">
        <el-form-item label="院系名" prop="name"><el-input v-model="collegeFormData.name" placeholder="如：信息工程学院" /></el-form-item>
        <el-form-item label="编码" prop="code"><el-input v-model="collegeFormData.code" placeholder="如：XXGC" /></el-form-item>
        <el-form-item label="院长"><el-select v-model="collegeFormData.deanId" filterable placeholder="可选填" style="width:100%" clearable>
          <el-option v-for="u in staffList" :key="u.id" :label="`${u.name}（${u.username}）`" :value="u.id" />
        </el-select></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="collegeFormData.sort" :min="0" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collegeDlg=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCollege">保存</el-button>
      </template>
    </el-dialog>

    <!-- 专业新增/编辑 -->
    <el-dialog v-model="majorDlg" :title="editingMajor ? '编辑专业' : '新增专业'" width="min(460px,92vw)">
      <el-form ref="majorFormRef" :model="majorFormData" :rules="majorRules" label-width="80px">
        <el-form-item label="所属院系">
          <el-input :model-value="colSel?.name || ''" disabled />
        </el-form-item>
        <el-form-item label="专业名" prop="name"><el-input v-model="majorFormData.name" placeholder="如：计算机科学与技术" /></el-form-item>
        <div v-if="editingMajor" style="color:#909399; font-size:12px; margin-left:80px;">
          修改专业名称将同步更新该专业下所有班级
        </div>
      </el-form>
      <template #footer>
        <el-button @click="majorDlg=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitMajor">保存</el-button>
      </template>
    </el-dialog>

    <!-- 班级编辑 -->
    <el-dialog v-model="classDlg" :title="editingCl?.id ? '编辑班级' : '新增班级'" width="min(520px,92vw)">
      <el-form ref="classFormRef" :model="classFormData" :rules="classRules" label-width="100px">
        <el-form-item v-if="canManageCollege" label="所属院系" prop="collegeId">
          <el-select v-model="classFormData.collegeId" style="width:100%" @change="onClassCollegeChange">
            <el-option v-for="c in filteredColleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canManage" label="专业">
          <el-select v-model="classFormData.major" style="width:100%" filterable allow-create default-first-option placeholder="选择或输入专业">
            <el-option v-for="m in majorOptions" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="班级名称" prop="name"><el-input v-model="classFormData.name" placeholder="如：计算机2班" /></el-form-item>
        <el-form-item label="年级" prop="grade">
          <el-select v-model="classFormData.grade" style="width:100%">
            <el-option v-for="y in gradeList" :key="y" :label="y+'级'" :value="String(y)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canManage" label="辅导员">
          <el-select v-model="classFormData.counselorId" filterable clearable placeholder="可选填，后续可修改" style="width:100%">
            <el-option v-for="u in counselorList" :key="u.id" :label="`${u.name}（${u.username}）`" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canManage" label="班级管理员">
          <el-select v-model="classFormData.classAdminId" filterable clearable placeholder="可选填，后续可修改" style="width:100%">
            <el-option v-for="u in classAdminList" :key="u.id" :label="`${u.name}（${u.username}）`" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="classDlg=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitClass">保存</el-button>
      </template>
    </el-dialog>

    <!-- 班级用户列表弹窗 -->
    <el-dialog v-model="classUsersVisible" :title="classUsersTitle" width="min(1000px, 92vw)" destroy-on-close>
      <div v-loading="classUsersLoading">
        <el-descriptions :column="4" border size="small" class="mb-16">
          <el-descriptions-item label="班级">{{ classUsersInfo.name || '--' }}</el-descriptions-item>
          <el-descriptions-item label="专业">{{ classUsersInfo.major || '--' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ classUsersInfo.grade || '--' }}</el-descriptions-item>
          <el-descriptions-item label="人数">{{ classUsersData.length }}</el-descriptions-item>
        </el-descriptions>

        <!-- 工具条：新增、批量导入、批量删除、批量停用 -->
        <div class="flex-between mb-16" style="flex-wrap:wrap; gap:8px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <el-button v-if="canCreateUserInClass" type="primary" @click="openUserForm(null)"><Plus /> 新增用户</el-button>
            <el-upload v-if="canCreateUserInClass" action="#" :show-file-list="false" accept=".xlsx,.xls" :http-request="onBatchImportUsers" :disabled="batchUserImporting">
              <el-button :loading="batchUserImporting"><Upload /> 批量导入</el-button>
            </el-upload>
            <el-button v-if="canCreateUserInClass" @click="onDownloadUserTemplate"><Download /> 下载导入模板</el-button>
          </div>
          <div v-if="classUsersSelectedIds.length > 0" style="display:flex; gap:8px; flex-wrap:wrap;">
            <span style="line-height:32px; color:#909399; font-size:12px;">已选 {{ classUsersSelectedIds.length }} 项</span>
            <el-button v-if="canBatchDeleteUser" type="danger" :loading="classUsersBatching" @click="onClassUsersBatchStatus('disabled')">批量停用</el-button>
            <el-button v-if="canBatchDeleteUser" type="success" :loading="classUsersBatching" @click="onClassUsersBatchStatus('active')">批量启用</el-button>
            <el-button v-if="canBatchDeleteUser" type="danger" :loading="classUsersBatching" @click="onClassUsersBatchDelete">批量删除</el-button>
          </div>
        </div>

        <el-table
          :data="classUsersData"
          stripe
          border
          size="small"
          max-height="480"
          ref="classUsersTableRef"
          @selection-change="onClassUsersSelectionChange"
          row-key="id"
        >
          <el-table-column v-if="canBatchDeleteUser" type="selection" width="42" align="center" reserve-selection />
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="username" label="账号" width="130" />
          <el-table-column prop="realName" label="姓名" width="100" />
          <el-table-column label="角色" width="110">
            <template #default="{row}">
              <el-tag :type="classUsersRoleTag(row.role).type" effect="plain" size="small">{{ classUsersRoleTag(row.role).label }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="studentNo" label="学号" width="130" />
          <el-table-column prop="phone" label="手机号" width="130" />
          <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{row}">
              <el-tag :type="row.status === 'active' || row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 'active' || row.status === 1 ? '正常' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="canManageUserInClass" label="操作" width="160" fixed="right" align="center">
            <template #default="{row}">
              <el-button v-if="canEditUserInClass(row)" link type="primary" @click="openUserForm(row)">编辑</el-button>
              <el-popconfirm v-if="canDeleteUserInClass(row)" title="确认删除该用户？" @confirm="onClassUsersDeleteOne(row)">
                <template #reference><el-button link type="danger">删除</el-button></template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="classUsersData.length === 0" style="text-align:center;color:#909399;padding:24px;">该班级暂无用户</div>
      </div>
    </el-dialog>

    <!-- 用户新增/编辑弹窗（组织架构内嵌） -->
    <el-dialog v-model="userFormVisible" :title="userFormEditing?.id ? '编辑用户' : '新增用户'" width="min(560px, 92vw)" destroy-on-close>
      <el-form ref="userFormRef" :model="userFormData" :rules="userFormRules" label-width="100px">
        <el-form-item v-if="userFormEditing?.uniqueId" label="系统ID">
          <el-tooltip content="系统自动生成，12位只读唯一ID，不可修改" placement="top">
            <el-input v-model="userFormData.uniqueId" disabled style="font-family: monospace;" />
          </el-tooltip>
        </el-form-item>
        <el-form-item label="所属班级" v-if="userFormEditing?.id">
          <el-input :model-value="classUsersInfo.name || '--'" disabled />
        </el-form-item>
        <el-form-item label="账号" prop="username">
          <el-input v-model="userFormData.username" placeholder="学号或工号（用于登录）" :disabled="!!userFormEditing?.id" />
          <div style="color:#909399; font-size:12px;">建议使用学号作为登录账号，便于学生记忆</div>
        </el-form-item>
        <el-form-item label="学号" prop="studentNo">
          <el-input v-model="userFormData.studentNo" placeholder="学生学号" :disabled="!['student','class_admin'].includes(userFormData.role)" />
        </el-form-item>
        <el-form-item label="姓名" prop="realName"><el-input v-model="userFormData.realName" /></el-form-item>
        <el-form-item v-if="!userFormEditing?.id" label="初始密码" prop="password">
          <el-input v-model="userFormData.password" show-password placeholder="默认123456" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="userFormData.role" style="width:100%" @change="onUserFormRoleChange">
            <el-option v-for="o in userFormRoleOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="userFormData.gender">
            <el-radio label="male">男</el-radio>
            <el-radio label="female">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="手机号"><el-input v-model="userFormData.phone" maxlength="11" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="userFormData.email" /></el-form-item>
        <el-form-item v-if="userFormData.role !== 'student'" label="工号"><el-input v-model="userFormData.employeeNo" placeholder="选填" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userFormVisible=false">取消</el-button>
        <el-button type="primary" :loading="userFormSaving" @click="submitUserForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { listAllColleges, createCollege, updateCollege, deleteCollege, getClassList, createClass, updateClass, deleteClass, downloadCollegeTemplate, importColleges, exportColleges } from '@/api/college';
import { getClassUsers } from '@/api/classes';
import { getStaffList, createUser, updateUser, deleteUser, batchDeleteUsers, batchToggleUserStatus, downloadUserTemplate, importUsers } from '@/api/users';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { OfficeBuilding, Plus, Folder, Reading, ArrowDown, Upload, Download } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const role = computed(() => userStore.role);
const colleges = ref([]);
const classes = ref([]);
const loading = ref(false);
const loadingC = ref(false);
const loadingD = ref(false);
const colSel = ref(null);
const majorSel = ref(null);
const staffList = ref([]);
const counselorList = ref([]);
const classAdminList = ref([]);
const saving = ref(false);
const gradeList = Array.from({length: 8}, (_, i) => new Date().getFullYear() - i);

// ============== 权限 ==============
const canManageCollege = computed(() => ['school_admin', 'super_admin'].includes(role.value));
const canManage = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(role.value));
// 批量导入导出：院系管理员也可操作（仅限本院系范围，后端已限制）
const canBatchOperate = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(role.value));
const canCreateClass = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(role.value));
const canEditClass = (row) => {
  if (['school_admin', 'super_admin'].includes(role.value)) return true;
  if (role.value === 'college_admin' && Number(row.collegeId) === Number(userStore.userInfo?.collegeId)) return true;
  if (role.value === 'counselor' && row.counselorId && Number(row.counselorId) === Number(userStore.userInfo?.id)) return true;
  if (role.value === 'class_admin' && row.classAdminId && Number(row.classAdminId) === Number(userStore.userInfo?.id)) return true;
  return false;
};
const canDeleteClass = (row) => ['school_admin', 'super_admin'].includes(role.value);

// ============== 工具 ==============
const parseIdSafe = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.id != null) return parseIdSafe(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ============== 院系列表过滤 ==============
const filteredColleges = computed(() => {
  if (['college_admin', 'counselor', 'class_admin'].includes(role.value) && userStore.userInfo?.collegeId) {
    return colleges.value.filter(c => Number(c.id) === Number(userStore.userInfo.collegeId));
  }
  return colleges.value;
});

// ============== 专业列表（合并 college.majors + 班级数据） ==============
const majors = computed(() => {
  if (!colSel.value) return [];
  const majorMap = {};
  // 1. 从 college.majors 字段加载
  (colSel.value.majors || []).forEach(m => {
    if (m && !majorMap[m]) majorMap[m] = { name: m, count: 0 };
  });
  // 2. 从班级数据聚合
  classes.value.forEach(c => {
    if (c.major) {
      if (!majorMap[c.major]) majorMap[c.major] = { name: c.major, count: 0 };
      majorMap[c.major].count++;
    }
  });
  return Object.values(majorMap).sort((a, b) => a.name.localeCompare(b.name));
});

// 专业选项（班级表单下拉用）
const majorOptions = computed(() => {
  if (!colSel.value) return [];
  const set = new Set();
  (colSel.value.majors || []).forEach(m => { if (m) set.add(m); });
  classes.value.forEach(c => { if (c.major) set.add(c.major); });
  return Array.from(set).sort();
});

// ============== 班级列表过滤 ==============
const filteredClasses = computed(() => {
  let list = classes.value;
  // 辅导员：只看自己带的班级
  if (role.value === 'counselor') {
    list = list.filter(c => Number(c.counselorId) === Number(userStore.userInfo?.id));
  }
  // 班级管理员：只看自己管理的班级
  if (role.value === 'class_admin') {
    list = list.filter(c => Number(c.classAdminId) === Number(userStore.userInfo?.id));
  }
  // 按选中专业过滤
  if (majorSel.value) {
    list = list.filter(c => c.major === majorSel.value.name);
  }
  return list;
});

// ============== 院系操作 ==============
const collegeDlg = ref(false);
const editingC = ref(null);
const collegeFormRef = ref();
const collegeFormData = reactive({});
const collegeRules = { name: [{ required: true, message: '请填写院系名称', trigger: 'blur' }] };

const loadColleges = async () => {
  loading.value = true;
  try {
    colleges.value = (await listAllColleges()) || [];
    if (!colSel.value && filteredColleges.value[0]) {
      await selectCollege(filteredColleges.value[0]);
    } else if (colSel.value) {
      // 刷新已选中院系的数据
      const updated = colleges.value.find(c => c.id === colSel.value.id);
      if (updated) colSel.value = updated;
    }
  } catch (e) {
    console.error('加载院系失败:', e);
  } finally { loading.value = false; }
};

const selectCollege = async (c) => {
  colSel.value = c;
  majorSel.value = null;
  reloadCounselorsByCollege();
  reloadClassAdminsByCollege();
  loadingD.value = true;
  try {
    const r = await getClassList({ collegeId: c.id, pageSize: 500 });
    classes.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (e) {
    console.error('加载班级失败:', e);
    classes.value = [];
  } finally { loadingD.value = false; }
};

const selectMajor = (row) => {
  majorSel.value = row;
};

const openCollege = (row) => {
  if (!canManageCollege.value) return;
  editingC.value = row;
  if (row) {
    const dean = row.deanName ? (staffList.value.find(u => u.realName === row.deanName || u.name === row.deanName)) : null;
    Object.assign(collegeFormData, {
      name: row.name || '',
      code: row.code || '',
      deanId: dean ? dean.id : (row.deanId || null),
      sort: row.sort ?? 0
    });
  } else {
    Object.assign(collegeFormData, { name: '', code: '', deanId: null, sort: 0 });
  }
  collegeDlg.value = true;
  nextTick(() => { collegeFormRef.value?.clearValidate?.(); });
};

const submitCollege = async () => {
  if (!collegeFormRef.value) return;
  try { await collegeFormRef.value.validate(); } catch (_) { return; }
  saving.value = true;
  try {
    const payload = { ...collegeFormData };
    if (editingC.value?.id) {
      await updateCollege(editingC.value.id, payload);
      ElMessage.success('已更新');
    } else {
      if (!payload.code) payload.code = 'COL_' + Date.now();
      await createCollege(payload);
      ElMessage.success('已创建');
    }
    collegeDlg.value = false;
    await loadColleges();
  } catch (err) {
    ElMessage.error(err?.message || '操作失败');
  } finally { saving.value = false; }
};

const delCollege = async (r) => {
  if (!canManageCollege.value) return;
  try {
    await ElMessageBox.confirm(`删除院系「${r.name}」将同时删除其下班级，确认？`, '危险操作', { type: 'error' });
    await deleteCollege(r.id);
    ElMessage.success('已删除');
    if (colSel.value?.id === r.id) colSel.value = null;
    await loadColleges();
  } catch (_) {}
};

// ============== 专业操作 ==============
const majorDlg = ref(false);
const majorFormRef = ref();
const majorFormData = reactive({});
const editingMajor = ref(null);
const majorRules = { name: [{ required: true, message: '请输入专业名称', trigger: 'blur' }] };

const openMajor = (row) => {
  if (!canManage.value) return;
  if (!colSel.value) { ElMessage.warning('请先选择院系'); return; }
  editingMajor.value = row;
  if (row) {
    Object.assign(majorFormData, { name: row.name });
  } else {
    Object.assign(majorFormData, { name: '' });
  }
  majorDlg.value = true;
  nextTick(() => { majorFormRef.value?.clearValidate?.(); });
};

const submitMajor = async () => {
  if (!majorFormRef.value) return;
  try { await majorFormRef.value.validate(); } catch (_) { return; }
  saving.value = true;
  try {
    const newName = majorFormData.name.trim();
    // 获取当前院系的专业列表
    const collegeMajors = [...(colSel.value.majors || [])];

    if (editingMajor.value) {
      // 编辑专业
      const oldName = editingMajor.value.name;
      if (oldName === newName) { ElMessage.info('名称未变更'); majorDlg.value = false; return; }
      // 更新 college.majors
      const idx = collegeMajors.indexOf(oldName);
      if (idx !== -1) collegeMajors[idx] = newName;
      else collegeMajors.push(newName);
      await updateCollege(colSel.value.id, { majors: collegeMajors });
      // 批量更新班级的 major 字段
      const targetClasses = classes.value.filter(c => c.major === oldName);
      for (const cls of targetClasses) {
        try { await updateClass(cls.id, { ...cls, major: newName }); } catch (_) {}
      }
      ElMessage.success(`专业已更新${targetClasses.length ? `，同步修改 ${targetClasses.length} 个班级` : ''}`);
    } else {
      // 新增专业
      if (collegeMajors.includes(newName)) { ElMessage.warning('该专业已存在'); saving.value = false; return; }
      collegeMajors.push(newName);
      await updateCollege(colSel.value.id, { majors: collegeMajors });
      ElMessage.success(`专业「${newName}」已添加`);
    }
    majorDlg.value = false;
    await loadColleges();
  } catch (err) {
    ElMessage.error(err?.message || '操作失败');
  } finally { saving.value = false; }
};

const delMajor = async (row) => {
  if (!canManage.value) return;
  try {
    const count = classes.value.filter(c => c.major === row.name).length;
    const tip = count > 0 ? `该专业下有 ${count} 个班级，删除后班级的专业字段将变为空，确认？` : '确认删除该专业？';
    await ElMessageBox.confirm(tip, '删除专业', { type: 'warning' });
    // 从 college.majors 中移除
    const collegeMajors = (colSel.value.majors || []).filter(m => m !== row.name);
    await updateCollege(colSel.value.id, { majors: collegeMajors });
    // 清空班级的 major 字段
    const targetClasses = classes.value.filter(c => c.major === row.name);
    for (const cls of targetClasses) {
      try { await updateClass(cls.id, { ...cls, major: null }); } catch (_) {}
    }
    ElMessage.success('专业已删除');
    if (majorSel.value?.name === row.name) majorSel.value = null;
    await loadColleges();
  } catch (_) {}
};

// ============== 班级操作 ==============
const classDlg = ref(false);
const editingCl = ref(null);
const classFormRef = ref();
const classFormData = reactive({});
const classRules = computed(() => {
  const rules = {
    name: [{ required: true, message: '请填写班级名', trigger: 'blur' }],
    grade: [{ required: true, message: '请选择年级', trigger: 'change' }]
  };
  if (['school_admin', 'super_admin'].includes(role.value)) {
    rules.collegeId = [{ required: true, message: '请选择所属院系', trigger: 'change' }];
  }
  return rules;
});

const openClass = (row) => {
  editingCl.value = row;
  const defaultCollegeId = (['college_admin', 'counselor'].includes(role.value))
    ? Number(userStore.userInfo?.collegeId)
    : (colSel.value?.id ?? Number(userStore.userInfo?.collegeId));

  if (row) {
    Object.assign(classFormData, {
      ...row,
      collegeId: parseIdSafe(row.collegeId ?? row.college?.id) ?? defaultCollegeId,
      major: row.major || '',
      name: row.name || '',
      grade: row.grade != null ? String(row.grade) : String(gradeList[0]),
      counselorId: parseIdSafe(row.counselorId ?? row.counselor?.id) || null,
      classAdminId: parseIdSafe(row.classAdminId ?? row.classAdmin?.id) || null,
      code: row.code || `CLS_${Date.now()}`
    });
  } else {
    Object.assign(classFormData, {
      collegeId: defaultCollegeId,
      major: majorSel.value?.name || '',
      name: '',
      grade: String(gradeList[0]),
      counselorId: null,
      classAdminId: null,
      code: `CLS_${Date.now()}`
    });
  }
  classDlg.value = true;
  nextTick(() => { classFormRef.value?.clearValidate?.(); });
};

const onClassCollegeChange = () => {
  // 切换院系时刷新辅导员/班级管理员下拉
  const c = colleges.value.find(c => c.id === classFormData.collegeId);
  if (c) {
    colSel.value = c;
    reloadCounselorsByCollege();
    reloadClassAdminsByCollege();
  }
};

const submitClass = async () => {
  if (!classFormRef.value) return;
  try { await classFormRef.value.validate(); } catch (_) { return; }
  saving.value = true;
  try {
    const payload = { ...classFormData };
    payload.collegeId = parseIdSafe(payload.collegeId);
    payload.counselorId = parseIdSafe(payload.counselorId);
    payload.classAdminId = parseIdSafe(payload.classAdminId);
    // 院系管理员强制绑定本院系
    if (role.value === 'college_admin') {
      payload.collegeId = Number(userStore.userInfo?.collegeId);
    }
    if (role.value === 'counselor') {
      payload.collegeId = Number(userStore.userInfo?.collegeId) || payload.collegeId;
    }
    if (!payload.name) { ElMessage.error('班级名称必填'); saving.value = false; return; }
    if (!payload.collegeId) { ElMessage.error('请选择所属院系'); saving.value = false; return; }
    if (!payload.code) payload.code = `CLS_${Date.now()}`;

    if (editingCl.value?.id) {
      await updateClass(editingCl.value.id, payload);
      ElMessage.success('班级已更新');
    } else {
      await createClass(payload);
      ElMessage.success('班级创建成功');
    }
    classDlg.value = false;
    // 刷新
    if (colSel.value) {
      await selectCollege(colleges.value.find(c => c.id === colSel.value.id) || colSel.value);
    } else if (filteredColleges.value[0]) {
      await selectCollege(filteredColleges.value[0]);
    }
  } catch (err) {
    ElMessage.error(err?.message || '保存失败');
  } finally { saving.value = false; }
};

const delClass = async (r) => {
  if (!canDeleteClass(r)) return;
  try {
    await ElMessageBox.confirm(`确认删除班级「${r.name}」？`, '危险操作', { type: 'error' });
    await deleteClass(r.id);
    ElMessage.success('已删除');
    if (colSel.value) await selectCollege(colleges.value.find(c => c.id === colSel.value.id) || colSel.value);
  } catch (_) {}
};

// ============== 班级用户列表 ==============
const classUsersVisible = ref(false);
const classUsersLoading = ref(false);
const classUsersTitle = ref('');
const classUsersInfo = reactive({ id: null, collegeId: null, name: '', major: '', grade: '' });
const classUsersData = ref([]);
const classUsersRoleTag = (r) => ({
  student:     { label: '学生', type: 'info' },
  class_admin: { label: '班级管理员', type: '' },
  counselor:   { label: '辅导员', type: 'success' },
  college_admin: { label: '院系管理员', type: 'warning' },
  school_admin:  { label: '学校管理员', type: 'danger' },
  super_admin:   { label: '超级管理员', type: 'danger' },
  developer:     { label: '开发者', type: 'danger' }
}[r] || { label: r || '-', type: 'info' });

const openClassUsers = async (row) => {
  classUsersTitle.value = `班级用户列表 - ${row.name}`;
  classUsersInfo.name = row.name;
  classUsersInfo.major = row.major || '-';
  classUsersInfo.grade = row.grade || '-';
  // 记录班级 id 和 collegeId 供新增/批量操作使用
  classUsersInfo.id = row.id;
  classUsersInfo.collegeId = row.collegeId;
  classUsersVisible.value = true;
  classUsersLoading.value = true;
  classUsersData.value = [];
  // 清空选中
  if (classUsersTableRef.value) classUsersTableRef.value.clearSelection();
  classUsersSelectedRows.value = [];
  try {
    const r = await getClassUsers(row.id);
    classUsersInfo.name = r?.classInfo?.name || row.name;
    classUsersInfo.major = r?.classInfo?.major || '-';
    classUsersInfo.grade = r?.classInfo?.grade || '-';
    classUsersInfo.id = r?.classInfo?.id || row.id;
    classUsersInfo.collegeId = r?.classInfo?.collegeId || row.collegeId;
    classUsersData.value = r?.users || [];
  } catch (e) {
    ElMessage.error(e?.message || '加载班级用户失败');
  } finally {
    classUsersLoading.value = false;
  }
};

// 选中行
const classUsersTableRef = ref(null);
const classUsersSelectedRows = ref([]);
const classUsersSelectedIds = computed(() => classUsersSelectedRows.value.map(r => r.id));
const onClassUsersSelectionChange = (rows) => { classUsersSelectedRows.value = rows; };

// 批量操作进行中标志
const classUsersBatching = ref(false);

// ============== 权限判断（用户操作）==============
// 学校/院系/辅导员（含 developer/super_admin）可在班级用户弹窗内新增/编辑/批量删除/批量停用
// 班级管理员只读
const canManageUserInClass = computed(() => ['developer', 'school_admin', 'super_admin', 'college_admin', 'counselor'].includes(role.value));
const canCreateUserInClass = canManageUserInClass;
const canBatchDeleteUser = computed(() => ['developer', 'school_admin', 'super_admin', 'college_admin'].includes(role.value));
const canEditUserInClass = (row) => {
  if (['developer', 'school_admin', 'super_admin'].includes(role.value)) return true;
  if (role.value === 'college_admin' && Number(row.collegeId) === Number(userStore.userInfo?.collegeId)) return true;
  if (role.value === 'counselor' && Number(classUsersInfo.collegeId) === Number(userStore.userInfo?.collegeId)) return true;
  return false;
};
const canDeleteUserInClass = (row) => {
  if (row.id === userStore.userInfo?.id) return false;
  return canEditUserInClass(row);
};

// ============== 用户新增/编辑表单 ==============
const userFormVisible = ref(false);
const userFormEditing = ref(null);
const userFormRef = ref();
const userFormSaving = ref(false);
const userFormData = reactive({
  username: '', studentNo: '', realName: '', password: '123456',
  role: 'student', gender: 'male', phone: '', email: '', employeeNo: '',
  uniqueId: ''
});

// 角色可选项（按当前登录角色范围过滤，避免前端展示后端会拒绝的选项）
const userFormRoleOptions = computed(() => {
  const ALLOW = {
    developer: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'],
    super_admin: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin'],
    school_admin: ['student', 'class_admin', 'counselor', 'college_admin'],
    college_admin: ['student', 'class_admin', 'counselor'],
    counselor: ['student', 'class_admin']
  };
  const list = ALLOW[role.value] || [];
  // 编辑模式下：当前用户角色不在 allow 中也补上去
  if (userFormEditing.value?.role && !list.includes(userFormEditing.value.role)) {
    list.unshift(userFormEditing.value.role);
  }
  return list.map(k => ({ value: k, label: classUsersRoleTag(k).label || k }));
});

// 动态表单校验规则
const userFormRules = computed(() => {
  const base = {
    username: [{ required: true, message: '请输入账号（学号或工号）', trigger: 'blur' }],
    realName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
    role: [{ required: true, message: '请选择角色', trigger: 'change' }]
  };
  if (!userFormEditing.value?.id) base.password = [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 4, message: '密码至少 4 位', trigger: 'blur' }
  ];
  if (['student', 'class_admin'].includes(userFormData.role)) {
    base.studentNo = [{ required: true, message: '请填写学号', trigger: 'blur' }];
  }
  return base;
});

// 学号唯一性校验（前端：在已加载用户列表中检查）
const isStudentNoDuplicated = (studentNo, excludeId = null) => {
  if (!studentNo) return false;
  return classUsersData.value.some(u => u.studentNo === studentNo && u.id !== excludeId);
};

// 账号唯一性校验
const isUsernameDuplicated = (username, excludeId = null) => {
  if (!username) return false;
  return classUsersData.value.some(u => u.username === username && u.id !== excludeId);
};

const onUserFormRoleChange = () => {
  // 非 student/class_admin 角色学号字段无需填写
  if (!['student', 'class_admin'].includes(userFormData.role)) {
    // 不清空，只放宽校验
  }
};

const openUserForm = (row) => {
  userFormEditing.value = row;
  // 清空表单
  Object.keys(userFormData).forEach(k => delete userFormData[k]);
  if (row) {
    Object.assign(userFormData, {
      username: row.username || '',
      studentNo: row.studentNo || '',
      realName: row.realName || row.name || '',
      role: row.role || 'student',
      gender: row.gender || 'male',
      phone: row.phone || '',
      email: row.email || '',
      employeeNo: row.employeeNo || row.jobNo || '',
      uniqueId: row.uniqueId || '',
      password: ''
    });
  } else {
    Object.assign(userFormData, {
      username: '',
      studentNo: '',
      realName: '',
      password: '123456',
      role: 'student',
      gender: 'male',
      phone: '',
      email: '',
      employeeNo: '',
      uniqueId: ''
    });
  }
  userFormVisible.value = true;
  nextTick(() => { userFormRef.value?.clearValidate?.(); });
};

const submitUserForm = async () => {
  if (!userFormRef.value) return;
  try { await userFormRef.value.validate(); } catch (_) {
    ElMessage.warning('请先完成必填项');
    return;
  }

  // 前端唯一性预校验（避免不必要的接口调用）
  if (['student', 'class_admin'].includes(userFormData.role)) {
    if (isStudentNoDuplicated(userFormData.studentNo, userFormEditing.value?.id)) {
      ElMessage.error(`学号「${userFormData.studentNo}」在该班级已存在`);
      return;
    }
  }
  if (!userFormEditing.value?.id && isUsernameDuplicated(userFormData.username)) {
    ElMessage.error(`账号「${userFormData.username}」已存在`);
    return;
  }

  userFormSaving.value = true;
  try {
    const classId = parseIdSafe(classUsersInfo.id);
    const collegeId = parseIdSafe(classUsersInfo.collegeId) || parseIdSafe(userStore.userInfo?.collegeId);
    const payload = { ...userFormData };
    // 绑定当前班级上下文
    payload.classId = classId;
    payload.collegeId = collegeId;
    // 后端字段映射：name → realName 已在服务端处理
    payload.name = userFormData.realName;

    // 安全：禁止前端修改 uniqueId
    delete payload.uniqueId;

    // 密码：编辑时未填则不修改
    if (userFormEditing.value?.id && !payload.password) delete payload.password;

    if (userFormEditing.value?.id) {
      await updateUser(userFormEditing.value.id, payload);
      ElMessage.success('用户信息已更新');
    } else {
      await createUser(payload);
      ElMessage.success('用户创建成功');
    }
    userFormVisible.value = false;
    // 重新加载班级用户列表
    if (classUsersInfo.id) {
      const cls = filteredClasses.value.find(c => c.id === classUsersInfo.id);
      if (cls) await openClassUsers(cls);
    }
  } catch (err) {
    let msg = err?.message || '保存失败';
    try {
      if (err?.raw != null) msg = err.raw;
      else if (err?.response?.data != null) {
        const d = err.response.data;
        if (typeof d === 'string') msg = d;
        else if (d.message) msg = d.message;
      }
    } catch (_) {}
    ElMessage.error(msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
  } finally {
    userFormSaving.value = false;
  }
};

// 删除单个用户
const onClassUsersDeleteOne = async (row) => {
  try {
    await deleteUser(row.id);
    ElMessage.success('用户已删除');
    // 重新加载
    if (classUsersInfo.id) {
      const cls = filteredClasses.value.find(c => c.id === classUsersInfo.id);
      if (cls) await openClassUsers(cls);
    }
  } catch (err) {
    ElMessage.error(err?.message || '删除失败');
  }
};

// 批量删除
const onClassUsersBatchDelete = async () => {
  if (classUsersSelectedIds.value.length === 0) return;
  const containsSelf = classUsersSelectedIds.value.includes(userStore.userInfo?.id);
  const superAdminSelected = classUsersSelectedRows.value.some(r => r.role === 'super_admin');
  const warningText = [
    containsSelf ? '所选内容包含您自己，将自动跳过；' : '',
    superAdminSelected ? '所选内容包含超级管理员，将自动跳过；' : ''
  ].filter(Boolean).join(' ');
  try {
    await ElMessageBox.confirm(
      `确定要批量删除选中的 <b style="color:#f56c6c;">${classUsersSelectedIds.value.length}</b> 个用户吗？<br/>` +
      `<span style="color:#909399;font-size:12px;">此操作不可恢复。</span><br/>` +
      (warningText ? `<span style="color:#e6a23c;font-size:13px;">${warningText}</span>` : ''),
      '批量删除确认',
      { dangerouslyUseHTMLString: true, type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    );
    classUsersBatching.value = true;
    const r = await batchDeleteUsers(classUsersSelectedIds.value);
    const tip = r?.skippedReason ? `（${r.skippedReason}）` : '';
    ElMessage.success(`成功删除 ${r?.deleted || 0} 个用户${tip}`);
    if (classUsersTableRef.value) classUsersTableRef.value.clearSelection();
    // 重新加载
    if (classUsersInfo.id) {
      const cls = filteredClasses.value.find(c => c.id === classUsersInfo.id);
      if (cls) await openClassUsers(cls);
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || '删除失败');
  } finally {
    classUsersBatching.value = false;
  }
};

// 批量启用/停用
const onClassUsersBatchStatus = async (targetStatus) => {
  if (classUsersSelectedIds.value.length === 0) return;
  const actionText = targetStatus === 'disabled' ? '停用' : '启用';
  const containsSelf = classUsersSelectedIds.value.includes(userStore.userInfo?.id);
  const warningText = containsSelf ? `所选内容包含您自己，将自动跳过；` : '';
  try {
    await ElMessageBox.confirm(
      `确定要批量${actionText}选中的 <b style="color:#${targetStatus === 'disabled' ? 'f56c6c' : '67c23a'};">${classUsersSelectedIds.value.length}</b> 个用户吗？<br/>` +
      (warningText ? `<span style="color:#e6a23c;font-size:13px;">${warningText}</span>` : ''),
      `批量${actionText}确认`,
      { dangerouslyUseHTMLString: true, type: targetStatus === 'disabled' ? 'warning' : 'success', confirmButtonText: `确认${actionText}`, cancelButtonText: '取消' }
    );
    classUsersBatching.value = true;
    const r = await batchToggleUserStatus(classUsersSelectedIds.value, targetStatus);
    const tip = r?.skippedReason ? `（${r.skippedReason}）` : '';
    ElMessage.success(`成功${actionText} ${r?.affected || 0} 个用户${tip}`);
    if (classUsersTableRef.value) classUsersTableRef.value.clearSelection();
    if (classUsersInfo.id) {
      const cls = filteredClasses.value.find(c => c.id === classUsersInfo.id);
      if (cls) await openClassUsers(cls);
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || `${actionText}失败`);
  } finally {
    classUsersBatching.value = false;
  }
};

// 批量导入用户（Excel）
const batchUserImporting = ref(false);
const onBatchImportUsers = async ({ file }) => {
  if (!file) return;
  batchUserImporting.value = true;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await importUsers(fd);
    const msg = `导入完成：新增 ${r.added || 0}，更新 ${r.updated || 0}，失败 ${r.failed || 0}`;
    if ((r.failed || 0) > 0 && r.failMsgs?.length) {
      ElMessageBox.alert(`导入完成但有失败行：\n${r.failMsgs.slice(0, 10).join('\n')}`, msg, { type: 'warning' });
    } else {
      ElMessage.success(msg);
    }
    // 重新加载
    if (classUsersInfo.id) {
      const cls = filteredClasses.value.find(c => c.id === classUsersInfo.id);
      if (cls) await openClassUsers(cls);
    }
  } catch (e) {
    ElMessage.error(e?.message || '导入失败');
  } finally {
    batchUserImporting.value = false;
  }
};

// 下载用户导入模板
const onDownloadUserTemplate = async () => {
  try {
    const blob = await downloadUserTemplate();
    downloadBlob(blob, `students_template_${Date.now()}.xlsx`);
    ElMessage.success('模板已下载');
  } catch (e) {
    ElMessage.error(e?.message || '下载模板失败');
  }
};

// ============== 数据加载 ==============
const loadStaff = async () => {
  try {
    const r = await getStaffList({ pageSize: 1000 });
    const arr = Array.isArray(r) ? r : (Array.isArray(r?.list) ? r.list : (Array.isArray(r?.rows) ? r.rows : []));
    staffList.value = arr;
    reloadCounselorsByCollege();
    reloadClassAdminsByCollege();
  } catch (e) {
    console.error('加载员工失败:', e);
  }
};

const reloadCounselorsByCollege = () => {
  const currentColId = colSel.value?.id || Number(userStore.userInfo?.collegeId);
  counselorList.value = staffList.value.filter(x => {
    if (x.role !== 'counselor' && x.role !== 'college_admin') return false;
    if (x.status === 0 || x.status === 'disabled') return false;
    if (currentColId && x.collegeId != null && Number(x.collegeId) !== Number(currentColId)) return false;
    return true;
  });
};

const reloadClassAdminsByCollege = () => {
  const currentColId = colSel.value?.id || Number(userStore.userInfo?.collegeId);
  classAdminList.value = staffList.value.filter(x => {
    if (x.role !== 'class_admin') return false;
    if (x.status === 0 || x.status === 'disabled') return false;
    if (currentColId && x.collegeId != null && Number(x.collegeId) !== Number(currentColId)) return false;
    return true;
  });
};

// ============== 批量导入导出 ==============
const importFileRef = ref(null);
const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(new Blob([blob]));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};
const onBatchCmd = async (cmd) => {
  try {
    if (cmd === 'template') {
      const blob = await downloadCollegeTemplate();
      downloadBlob(blob, `colleges_template_${Date.now()}.xlsx`);
      ElMessage.success('模板已下载');
    } else if (cmd === 'export') {
      const blob = await exportColleges();
      downloadBlob(blob, `colleges_${Date.now()}.xlsx`);
      ElMessage.success('导出完成');
    } else if (cmd === 'import') {
      importFileRef.value?.click();
    }
  } catch (_) {}
};
const onImportFile = async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await importColleges(fd);
    const msg = `导入学${r.collegeAdded || 0}/更新${r.collegeUpdated || 0}，班级新增${r.classAdded || 0}/更新${r.classUpdated || 0}，失败${r.failed || 0}`;
    if ((r.failed || 0) > 0 && r.failMsgs?.length) {
      ElMessageBox.alert(`导入完成但有失败行：\n${r.failMsgs.slice(0, 10).join('\n')}`, msg, { type: 'warning' });
    } else {
      ElMessage.success(msg);
    }
    await loadColleges();
  } catch (err) {
    ElMessage.error(err?.message || '导入失败');
  }
};

onMounted(async () => {
  await Promise.all([loadColleges(), loadStaff()]);
});
</script>

<style lang="scss" scoped>
.organization-workspace { padding-bottom:8px; }
.org-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.org-actions :deep(.el-button) { margin:0; }
.org-grid { margin-top:18px; row-gap:16px; }
.hierarchy-card {
  height:68vh;
  min-height:520px;
  padding:0;
  overflow:hidden;
  border:1px solid #E5EDF7;
  border-radius:18px;
  background:#fff;
  box-shadow:0 12px 30px rgba(23,43,77,.055);
}
.card-title {
  min-height:64px;
  margin:0;
  padding:18px 18px 14px 22px;
  display:flex;
  align-items:center;
  justify-content:flex-start;
  flex-wrap:wrap;
  color:#172B4D;
  font-size:16px;
  font-weight:750;
  border-bottom:1px solid #EAF0F7;
  background:linear-gradient(90deg,#F7FAFD,#fff);

  &::before { content:''; width:4px; height:18px; margin-right:9px; border-radius:4px; }
}
.college-panel .card-title::before { background:linear-gradient(#1A79E5,#19B5D0); }
.major-panel .card-title::before { background:linear-gradient(#15A99D,#47C7A7); }
.class-panel .card-title::before { background:linear-gradient(#E7A520,#F1C44F); }
:deep(.hierarchy-card .el-table) { --el-table-header-bg-color:#F5F8FC; --el-table-row-hover-bg-color:#F3F8FF; }
:deep(.hierarchy-card .el-table th.el-table__cell) { color:#596A82; font-weight:700; }
:deep(.hierarchy-card .el-table__row.current-row > td.el-table__cell) { background:#EAF4FF; }

@media (max-width:992px) {
  .hierarchy-card { height:auto; min-height:300px; }
}
@media (max-width:768px) {
  .org-actions { width:100%; }
  .org-actions :deep(.el-button), .org-actions :deep(.el-dropdown) { flex:1; width:100%; }
  .hierarchy-card { min-height:300px; }
}
</style>
