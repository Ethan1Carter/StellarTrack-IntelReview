<template>
  <div class="publicity-page">
    <WorkspaceHero
      eyebrow="ASSESSMENT PUBLICITY"
      title="考评公示"
      description="公开查看考评结果与公示周期；公示期内可提交异议，管理人员可统一跟进处理。"
    >
      <template #actions><el-button v-if="canCreate" @click="openPublish">发布公示</el-button></template>
    </WorkspaceHero>
    <div class="card publicity-panel">
      <div class="panel-heading"><div><span>公示目录</span><h3>查找与跟进公示</h3></div><small>支持按状态、日期和标题筛选</small></div>
      <div class="filters">
        <el-select v-model="f.status" placeholder="状态" style="width:140px" clearable @change="go(1)">
          <el-option label="草稿" value="draft" />
          <el-option label="公示中" value="publishing" />
          <el-option label="已结束" value="ended" />
        </el-select>
        <el-date-picker v-model="dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:300px" />
        <el-input v-model="f.keyword" placeholder="搜索公示标题" style="width:240px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="title" label="公示标题" min-width="260" />
        <el-table-column label="范围" width="110">
          <template #default="{row}">{{ scopeText(row) }}</template>
        </el-table-column>
        <el-table-column label="公示期" width="220">
          <template #default="{row}">{{ dayjs(row.startAt).format('MM-DD') }} ~ {{ dayjs(row.endAt).format('MM-DD') }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{row}"><StatusTag :status="statusOf(row)" /></template>
        </el-table-column>
        <el-table-column label="异议" width="80" align="center">
          <template #default="{row}">
            <el-badge v-if="row.objectionCount" :value="row.objectionCount" class="item" type="warning" />
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="openDetail(row)">查看详情</el-button>
            <el-button v-if="canSubmitObjection && isActive(row)" link type="warning" @click="openObjection(row)">提交异议</el-button>
            <el-button v-if="canCreate && row.objectionCount>0" link type="success" @click="handleObjection(row)">处理异议</el-button>
            <el-popconfirm v-if="canCreate && isActive(row)" title="提前结束公示？" @confirm="endEarly(row)">
              <template #reference><el-button link type="danger">提前结束</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="pubVisible" title="发布公示" width="min(560px,92vw)">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="标题" prop="title"><el-input v-model="form.title" maxlength="100" show-word-limit /></el-form-item>
        <el-form-item label="公示期" prop="range">
          <el-date-picker v-model="form.range" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" style="width:100%" />
        </el-form-item>
        <el-form-item label="公示范围">
          <el-tag>{{ userStore.role === 'college_admin' ? '本院系' : '全校' }}</el-tag>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="form.rule" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="公示规则、计算方法、异议联系方式等" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pubVisible=false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doPublish">立即发布</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="公示详情" width="min(860px,94vw)">
      <div v-loading="detailLoading">
        <el-descriptions v-if="detail.publicity" :column="2" border>
          <el-descriptions-item label="标题">{{ detail.publicity.title }}</el-descriptions-item>
          <el-descriptions-item label="状态"><StatusTag :status="statusOf(detail.publicity)" /></el-descriptions-item>
          <el-descriptions-item label="学期">{{ detail.publicity.academicYear }} {{ detail.publicity.semester === 'first' ? '第一学期' : '第二学期' }}</el-descriptions-item>
          <el-descriptions-item label="公示期">{{ dayjs(detail.publicity.startAt).format('YYYY-MM-DD') }} 至 {{ dayjs(detail.publicity.endAt).format('YYYY-MM-DD') }}</el-descriptions-item>
          <el-descriptions-item label="公示说明" :span="2">{{ detail.publicity.description || '无' }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.ranking?.list || []" style="margin-top:16px" max-height="420">
          <el-table-column prop="rank" label="排名" width="80" align="center" />
          <el-table-column prop="student.studentNo" label="学号" min-width="130" />
          <el-table-column prop="student.realName" label="姓名" min-width="100" />
          <el-table-column prop="student.classInfo.name" label="班级" min-width="150" />
          <el-table-column prop="student.college.name" label="院系" min-width="160" />
          <el-table-column prop="totalScore" label="综合分" width="100" align="right" />
        </el-table>
      </div>
    </el-dialog>

    <el-dialog v-model="objVisible" title="提交异议" width="min(500px,92vw)">
      <el-form ref="objRef" :model="objForm" :rules="objRules" label-width="90px">
        <el-alert type="warning" :closable="false" style="margin-bottom:12px;">请真实描述异议情况，管理员将在3个工作日内处理</el-alert>
        <el-form-item label="异议类型" prop="issueType">
          <el-select v-model="objForm.issueType" style="width:100%">
            <el-option label="分值错误" value="score" />
            <el-option label="数据遗漏" value="missing" />
            <el-option label="项目不符" value="item" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="异议说明" prop="content"><el-input v-model="objForm.content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请详细说明情况、附证据链接等" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="objVisible=false">取消</el-button>
        <el-button type="primary" :loading="objSubmit" @click="submitObj">提交异议</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="handleVisible" title="处理异议" width="min(900px,94vw)">
      <el-table :data="objections" v-loading="objectionLoading" max-height="480">
        <el-table-column prop="submitterName" label="提交人" width="110" />
        <el-table-column prop="reason" label="异议内容" min-width="280" show-overflow-tooltip />
        <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status === 'pending' ? 'warning' : 'success'">{{ row.status === 'pending' ? '待处理' : '已处理' }}</el-tag></template></el-table-column>
        <el-table-column prop="handleResult" label="处理结果" min-width="200" show-overflow-tooltip />
        <el-table-column label="操作" width="100" fixed="right"><template #default="{row}"><el-button v-if="row.status === 'pending'" link type="primary" @click="resolveObj(row)">处理</el-button></template></el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import dayjs from 'dayjs';
import StatusTag from '@/components/StatusTag.vue';
import { listPublicities, getPublicity, createPublicity, submitObjection, endPublicity, listObjections, resolveObjection } from '@/api/publicities';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Stamp } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const canCreate = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(userStore.role));
const canSubmitObjection = computed(() => userStore.role === 'student');

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, pageSize: 10, status: '', keyword: '' });
const dateRange = ref([]);
const go = async (p) => { f.page = p; loading.value = true; try { const r = await listPublicities({ ...f, startAt: dateRange.value?.[0], endAt: dateRange.value?.[1] ? dayjs(dateRange.value[1]).endOf('day').toDate() : undefined }); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value = false; } };

const statusOf = (row) => row.status || 'draft';
const scopeText = (row) => ({ school: '全校', college: '院系', class: '班级' }[row.scope] || '未知');
const isActive = (row) => {
  const now = Date.now();
  return row.status === 'publishing' && now >= new Date(row.startAt).getTime() && now <= new Date(row.endAt).getTime();
};

const pubVisible = ref(false);
const submitting = ref(false);
const formRef = ref();
const form = reactive({ title: '', range: [], rule: '' });
const rules = {
  title: [{ required: true }],
  range: [{ required: true, message: '请选择公示期' }]
};
const openPublish = () => {
  Object.assign(form, { title: '', range: [new Date(), new Date(Date.now()+7*86400000)], rule: '' });
  pubVisible.value = true;
};
const doPublish = async () => {
  await formRef.value.validate();
  submitting.value = true;
  try {
    const isCollegeAdmin = userStore.role === 'college_admin';
    await createPublicity({
      title: form.title,
      startAt: form.range[0],
      endAt: form.range[1],
      description: form.rule,
      scope: isCollegeAdmin ? 'college' : 'school',
      scopeIds: isCollegeAdmin ? [Number(userStore.userInfo?.collegeId)].filter(Boolean) : [],
      status: 'publishing'
    });
    ElMessage.success('公示已发布'); pubVisible.value = false; go(1);
  } finally { submitting.value = false; }
};
const endEarly = async (r) => { await endPublicity(r.id); ElMessage.success('已提前结束'); go(1); };
const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref({ publicity: null, ranking: { list: [] } });
const openDetail = async (row) => {
  detailVisible.value = true;
  detailLoading.value = true;
  try { detail.value = await getPublicity(row.id); }
  finally { detailLoading.value = false; }
};

const objVisible = ref(false);
const objRef = ref();
const currentPub = ref(null);
const objSubmit = ref(false);
const objForm = reactive({ issueType: '', content: '' });
const objRules = { issueType: [{ required: true, message: '请选择异议类型' }], content: [{ required: true, message: '请详细说明异议情况', min: 10 }] };
const openObjection = (r) => { currentPub.value = r; objForm.issueType='score'; objForm.content=''; objVisible.value = true; };
const submitObj = async () => {
  await objRef.value.validate();
  objSubmit.value = true;
  try {
    const issueLabel = { score: '分值错误', missing: '数据遗漏', item: '项目不符', other: '其他' }[objForm.issueType] || '其他';
    await submitObjection(currentPub.value.id, { content: `【${issueLabel}】${objForm.content}` });
    ElMessage.success('异议已提交，将尽快处理'); objVisible.value = false; go(1);
  }
  finally { objSubmit.value = false; }
};
const handleVisible = ref(false);
const objectionLoading = ref(false);
const objections = ref([]);
const handleObjection = async (row) => {
  currentPub.value = row;
  handleVisible.value = true;
  objectionLoading.value = true;
  try { objections.value = (await listObjections(row.id))?.list || []; }
  finally { objectionLoading.value = false; }
};
const resolveObj = async (row) => {
  const { value } = await ElMessageBox.prompt('请输入处理结果', '处理异议', { inputType: 'textarea', inputValidator: (text) => !!String(text || '').trim() || '请填写处理结果' });
  await resolveObjection(currentPub.value.id, row.id, { status: 'resolved', handleResult: value });
  ElMessage.success('异议已处理');
  await handleObjection(currentPub.value);
};

onMounted(() => go(1));
</script>
<style lang="scss" scoped>
.publicity-page { padding-bottom:8px; }
.publicity-panel { margin-top:18px; padding:0; overflow:hidden; border:1px solid #E2EAF4; border-radius:18px; box-shadow:0 11px 30px rgba(20,52,96,.055); }
.panel-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding:20px 22px 16px; border-bottom:1px solid #EAF0F7;
  span { color:#2379D8; font-size:10px; font-weight:800; letter-spacing:.16em; }
  h3 { margin:5px 0 0; color:#172B4D; font-size:17px; }
  small { color:#8796AA; }
}
.filters { display:flex; flex-wrap:wrap; gap:10px; padding: 17px 20px; background:#FAFCFE; }
.page-wrap { display:flex; justify-content:flex-end; padding: 12px 16px; }
.desc { background:#F5F8FC; padding:14px; border:1px solid #E4EBF4; border-radius:10px; line-height:1.7; color:#303133; margin:0; }
h5 { margin: 0 0 8px; color: #303133; }
@media (max-width:768px) {
  .panel-heading { align-items:flex-start; flex-direction:column; padding:17px; }
  .panel-heading small { display:none; }
  .filters { padding:15px 16px; }
  .filters :deep(.el-select), .filters :deep(.el-date-editor), .filters :deep(.el-input), .filters :deep(.el-button) { width:100% !important; }
}
</style>
