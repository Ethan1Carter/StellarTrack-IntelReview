<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="ACADEMIC CALENDAR" title="学期管理" description="管理学年学期、申报开放状态与院系适用范围，控制各阶段业务节奏。">
      <template #actions><el-button @click="openEdit(null)"><Plus /> 新增学期</el-button></template>
    </WorkspaceHero>

    <div class="card">
      <div class="filters">
        <el-input v-model="f.keyword" placeholder="学期名称/学年" style="width:260px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="学期名称" min-width="220" />
        <el-table-column prop="academicYear" label="学年" width="120" />
        <el-table-column label="学期" width="90">
          <template #default="{row}">{{ row.semester==='first' ? '第一学期' : '第二学期' }}</template>
        </el-table-column>
        <el-table-column label="适用范围" min-width="200">
          <template #default="{row}">
            <template v-if="isSchoolAbove">
              <template v-if="!row.collegeIds || !row.collegeIds.length">
                <el-tag type="info">全校通用</el-tag>
              </template>
              <template v-else>
                <el-tag v-for="cid in row.collegeIds.slice(0,3)" :key="cid" size="small" style="margin-right:4px;">
                  {{ collegeNameMap[cid] || ('院系#'+cid) }}
                </el-tag>
                <span v-if="row.collegeIds.length>3" style="color:#909399; font-size:12px;">+{{ row.collegeIds.length-3 }}</span>
              </template>
            </template>
            <template v-else>
              <el-tag type="success">本院系</el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="学期时间" min-width="200">
          <template #default="{row}">{{ (row.startDate||'--') }} ~ {{ (row.endDate||'--') }}</template>
        </el-table-column>
        <el-table-column label="申报状态" width="120" align="center">
          <template #default="{row}">
            <el-tag :type="STATUS_TAG[row.applyStatus].type">{{ STATUS_TAG[row.applyStatus].label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="410" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="success" size="small" @click="setApply(row,'started')" :disabled="row.applyStatus==='started'">开始申报</el-button>
            <el-button link type="warning" size="small" @click="setApply(row,'paused')" :disabled="row.applyStatus!=='started'">暂停申报</el-button>
            <el-button link type="info" size="small" @click="setApply(row,'ended')" :disabled="row.applyStatus==='ended'">结束申报</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除？" @confirm="del(row)">
              <template #reference><el-button link type="danger" size="small">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize"
          @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="editVisible" :title="editing?.id ? '编辑学期' : '新增学期'" width="min(520px,92vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="110px">
        <el-form-item label="学年" prop="academicYear"><el-input v-model="mForm.academicYear" placeholder="如 2024-2025" /></el-form-item>
        <el-form-item label="学期" prop="semester">
          <el-select v-model="mForm.semester" style="width:100%">
            <el-option label="第一学期" value="first" />
            <el-option label="第二学期" value="second" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示名称" prop="name"><el-input v-model="mForm.name" placeholder="如 2024-2025学年第一学期" /></el-form-item>
        <el-form-item label="面向学院" v-if="isSchoolAbove" prop="collegeIds">
          <el-select v-model="mForm.collegeIds" multiple collapse-tags collapse-tags-tooltip
            placeholder="不选=面向全校通用" style="width:100%">
            <el-option v-for="c in allColleges" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <div style="color:#909399; font-size:12px; margin-top:4px;">留空则该学期面向全校；学院管理员创建/编辑时会自动锁定为本院系</div>
        </el-form-item>
        <el-form-item label="面向学院" v-else>
          <el-tag type="success">{{ myCollegeName || '本院系' }}</el-tag>
          <div style="color:#909399; font-size:12px; margin-top:4px;">院系管理员创建的学期仅面向本院系，不可更改</div>
        </el-form-item>
        <el-form-item label="学期开始"><el-date-picker v-model="mForm.startDate" value-format="YYYY-MM-DD" type="date" style="width:100%" /></el-form-item>
        <el-form-item label="学期结束"><el-date-picker v-model="mForm.endDate" value-format="YYYY-MM-DD" type="date" style="width:100%" /></el-form-item>
        <el-form-item label="申报时段">
          <el-date-picker v-model="mForm.dateRange" type="datetimerange" value-format="x" start-placeholder="申报开始" end-placeholder="申报结束" style="width:100%" />
        </el-form-item>
        <el-form-item label="默认申请状态" prop="applyStatus">
          <el-select v-model="mForm.applyStatus" style="width:100%">
            <el-option label="未开始" value="not_started" />
            <el-option label="开始申报" value="started" />
            <el-option label="已暂停" value="paused" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="mForm.sort" :min="0" :max="9999" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="mForm.remark" type="textarea" :rows="2" /></el-form-item>
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
import { ElMessage } from 'element-plus';
import { Calendar, Plus } from '@element-plus/icons-vue';
import { getSemesterList, createSemester, updateSemester, deleteSemester, setSemesterApplyStatus } from '@/api/semesters';
import { listAllColleges } from '@/api/college';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const isSchoolAbove = computed(() => ['school_admin','super_admin'].includes(userStore.userInfo?.role));

const allColleges = ref([]);
const collegeNameMap = computed(() => {
  const m = {};
  (allColleges.value || []).forEach(c => { m[c.id] = c.name; });
  return m;
});
const myCollegeName = computed(() => {
  const cid = userStore.userInfo?.collegeId;
  if (cid != null) return collegeNameMap.value[cid] || null;
  return null;
});
const loadColleges = async () => {
  try {
    const r = await listAllColleges({ status: 1 });
    allColleges.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (_) { allColleges.value = []; }
};

const STATUS_TAG = {
  not_started: { label: '未开始', type: 'info' },
  started:     { label: '申报中', type: 'success' },
  paused:      { label: '已暂停', type: 'warning' },
  ended:       { label: '已结束', type: '' }
};
const list = ref([]); const total = ref(0); const loading = ref(false);
const f = reactive({ page:1, pageSize:20, keyword:'' });
const go = async (p) => { f.page = p; loading.value = true;
  try { const r = await getSemesterList(f); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value=false; }
};
const setApply = async (row, st) => {
  try { await setSemesterApplyStatus(row.id, st); ElMessage.success(`已切换为：${STATUS_TAG[st].label}`); go(f.page); }
  catch (e) { ElMessage.error(e.message || '操作失败'); }
};
const editVisible = ref(false); const editing = ref(null); const formRef = ref(); const saving = ref(false);
const mForm = reactive({});
const mRules = {
  academicYear:[{ required:true, message:'请输入学年（如 2024-2025）', trigger:'blur' }],
  semester:[{ required:true, message:'请选择学期', trigger:'change' }],
  name:[{ required:true, message:'请输入显示名称', trigger:'blur' }],
  applyStatus:[{ required:true, message:'请选择申请状态', trigger:'change' }]
};
const openEdit = (row) => {
  editing.value = row;
  const base = row ? { ...row } : { academicYear:'', semester:'first', name:'', startDate:null, endDate:null, dateRange:[], applyStatus:'not_started', sort:0, remark:'', collegeIds:[] };
  // collegeIds 回显：数组 or 空数组（保证 el-select 多选正常）
  if (!Array.isArray(base.collegeIds)) {
    if (base.collegeId != null) base.collegeIds = [Number(base.collegeId)];
    else base.collegeIds = [];
  } else {
    base.collegeIds = base.collegeIds.map(v => Number(v));
  }
  if (row?.applyStartAt || row?.applyEndAt) {
    base.dateRange = [row.applyStartAt ? new Date(row.applyStartAt).getTime() : null, row.applyEndAt ? new Date(row.applyEndAt).getTime() : null].filter(Boolean);
  } else {
    base.dateRange = [];
  }
  Object.assign(mForm, base);
  editVisible.value = true;
};
const submitEdit = async () => {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = { ...mForm };
    if (Array.isArray(payload.dateRange) && payload.dateRange.length === 2) {
      payload.applyStartAt = new Date(Number(payload.dateRange[0])).toISOString();
      payload.applyEndAt = new Date(Number(payload.dateRange[1])).toISOString();
    }
    delete payload.dateRange;
    // 院系管理员：不传 collegeIds → 让后端按角色自动锁定为本院系
    if (!isSchoolAbove.value) {
      delete payload.collegeIds;
      delete payload.collegeId;
    } else {
      // 学校管理员：空数组或 undefined → 全校通用（后端 normalizeCollegeIds 会处理为 null）
      if (Array.isArray(payload.collegeIds) && payload.collegeIds.length === 0) {
        payload.collegeIds = null; // null = 全校
      }
    }
    if (editing.value?.id) { await updateSemester(editing.value.id, payload); ElMessage.success('修改成功'); }
    else { await createSemester(payload); ElMessage.success('创建成功'); }
    editVisible.value = false; go(1);
  } finally { saving.value = false; }
};
const del = async (row) => { await deleteSemester(row.id); ElMessage.success('已删除'); go(1); };
onMounted(async () => { await loadColleges(); go(1); });
</script>
<style lang="scss" scoped>
.filters { display:flex; gap:10px; padding:0 16px 16px; flex-wrap:wrap; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
</style>
