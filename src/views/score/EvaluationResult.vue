<template>
  <div class="evaluation-page">
    <WorkspaceHero
      eyebrow="HOLISTIC ASSESSMENT"
      title="综测结果"
      description="汇总德、智、体、美、劳五育表现，从总分、模块得分与排名多维查看成长成果。"
    />
    <!-- 学期选择 + 筛选 -->
    <div class="card filter-panel">
      <div class="filter-heading">
        <div><span>测评范围</span><h3>选择学期与查看对象</h3></div>
        <small>切换条件后将自动更新结果</small>
      </div>
      <div class="filter-bar">
      <el-select v-model="selAcademicYear" style="width: 150px" @change="loadData">
        <el-option v-for="y in academicYearOptions" :key="y" :label="y" :value="y" />
      </el-select>
      <el-select v-model="selSemester" style="width: 120px; margin-left:8px;" @change="loadData">
        <el-option label="第一学期" value="first" />
        <el-option label="第二学期" value="second" />
      </el-select>

      <!-- 管理员：按班级/按个人切换 -->
      <template v-if="isAdmin">
        <template v-if="role === 'class_admin'">
          <el-tag type="warning" effect="plain" style="margin-left:8px;">仅可查看本班</el-tag>
        </template>
        <template v-else>
          <el-radio-group v-model="viewMode" @change="onViewModeChange" style="margin-left:12px;">
            <el-radio-button label="class">按班级查</el-radio-button>
            <el-radio-button label="student">按个人查</el-radio-button>
          </el-radio-group>
          <template v-if="viewMode === 'class'">
            <el-select v-model="selClassId" placeholder="选择班级" style="width: 220px; margin-left:8px;" filterable clearable @change="loadData">
              <el-option v-for="c in classOptions" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </template>
          <template v-else>
            <el-select v-model="selStudentId" placeholder="搜索学号/姓名" style="width: 260px; margin-left:8px;" filterable remote clearable :remote-method="searchStudents" :loading="studentLoading" @change="loadData">
              <el-option v-for="s in studentOptions" :key="s.id" :label="`${s.realName} (${s.username})`" :value="s.id" />
            </el-select>
          </template>
        </template>
      </template>

      <el-button style="margin-left:auto;" @click="resetFilter">重置</el-button>
      </div>
    </div>

    <!-- 学生视角：自己的综测结果 -->
    <template v-if="isStudent">
      <div class="card mt-16 score-summary" v-loading="loading">
        <div class="score-header">
          <div class="total-score">
            <div class="label">综合素质测评总分</div>
            <div class="value" :style="{ color: totalColor }">{{ result?.totalScore || 0 }}</div>
            <div class="max">/ 100</div>
          </div>
        </div>

        <!-- 5大模块得分卡片 -->
        <el-row :gutter="16" class="module-grid">
          <el-col :xs="12" :sm="8" :lg="4" v-for="m in moduleList" :key="m.key">
            <div class="module-card" :class="m.color">
              <div class="module-name">{{ m.name }}</div>
              <div class="module-score">{{ getModuleScore(m.key) }}</div>
              <div class="module-max">/ {{ m.max }}</div>
              <el-progress :percentage="Math.min(100, (getModuleScore(m.key) / m.max) * 100)" :color="m.progressColor" :show-text="false" :stroke-width="4" style="margin-top:8px;" />
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 智育明细 -->
      <div class="card mt-16">
        <div class="card-title">智育 F₂ 计算公式</div>
        <div class="formula-board">
          <div class="formula-copy">
            <span>本学期计分规则</span>
            <strong>(F₂a × 0.8 + F₂b × 0.2) × 0.7</strong>
            <small>课程表现占 80%，智育奖励占 20%，合成后计入综测总分。</small>
          </div>
          <div class="formula-values">
            <div><span>F₂a · 学分加权</span><strong>{{ f2Result.f2a }}</strong><small>满分 100</small></div>
            <div><span>F₂b · 智育奖励</span><strong>{{ f2Result.f2b }}</strong><small>满分 14</small></div>
            <div class="formula-result"><span>F₂ · 智育得分</span><strong>{{ f2Result.internalScore }}</strong><small>{{ f2Result.courseCount }} 门课 · {{ f2Result.totalCredit }} 学分</small></div>
          </div>
        </div>

        <div v-if="f2Result.f2aDetails?.length" style="margin-top:16px;">
          <div class="sub-title" style="margin-bottom:8px;">F₂a 课程成绩明细</div>
          <el-table :data="f2Result.f2aDetails" stripe size="small">
            <el-table-column type="index" label="#" width="50" align="center" />
            <el-table-column prop="courseName" label="课程名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="score" label="成绩" width="80" align="center" />
            <el-table-column prop="credit" label="学分" width="80" align="center" />
            <el-table-column prop="weighted" label="加权得分" width="100" align="center" />
          </el-table>
        </div>

        <div v-if="f2Result.f2bDetails?.length" style="margin-top:16px;">
          <div class="sub-title" style="margin-bottom:8px;">F₂b 奖励分明细</div>
          <el-table :data="f2Result.f2bDetails" stripe size="small">
            <el-table-column type="index" label="#" width="50" align="center" />
            <el-table-column prop="moduleName" label="加分模块" width="150" />
            <el-table-column prop="title" label="事项" min-width="200" show-overflow-tooltip />
            <el-table-column prop="score" label="得分" width="80" align="center">
              <template #default="{row}"><span style="color:#67C23A; font-weight:600;">+{{ row.score }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <!-- 其他模块明细 -->
      <div class="card mt-16" v-if="result">
        <div class="card-title">各模块加分明细</div>
        <el-tabs v-model="detailTab" style="margin-top:12px;">
          <el-tab-pane v-for="m in ['F1','F3','F4','F5']" :key="m" :label="`${result.modules[m].name} (${result.modules[m].score}分)`" :name="m">
            <el-empty v-if="!result.modules[m].details?.length" description="暂无加分记录" />
            <el-table v-else :data="result.modules[m].details" stripe size="small">
              <el-table-column type="index" label="#" width="50" align="center" />
              <el-table-column prop="moduleName" label="加分模块" width="150" />
              <el-table-column prop="title" label="事项" min-width="200" show-overflow-tooltip />
              <el-table-column prop="score" label="得分" width="80" align="center">
                <template #default="{row}">
                  <span :style="{color: row.score >= 0 ? '#67C23A' : '#F56C6C', fontWeight: 600}">{{ row.score >= 0 ? '+' : '' }}{{ row.score }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>

    <!-- 管理员视角：按班级查（排名表） -->
    <template v-else-if="isAdmin && (viewMode === 'class' || role === 'class_admin')">
      <div class="card mt-16 result-board" v-loading="loading">
        <div class="card-title">
          班级综测排名
          <span class="sub-title" v-if="classResult">（共 {{ classResult.count }} 人）</span>
        </div>
        <el-table v-if="classResult?.list?.length" :data="classResult.list" stripe>
          <el-table-column label="排名" width="70" align="center">
            <template #default="{row}">
              <span v-if="row.rank <= 3" style="font-size:18px;">{{ ['🥇','🥈','🥉'][row.rank-1] }}</span>
              <span v-else style="font-weight:600;">{{ row.rank }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="username" label="学号" width="130" />
          <el-table-column prop="realName" label="姓名" width="100" />
          <el-table-column label="总分" width="90" align="center">
            <template #default="{row}"><span style="font-weight:700; font-size:16px;" :style="{color: row.totalScore >= 80 ? '#67C23A' : row.totalScore >= 60 ? '#E6A23C' : '#F56C6C'}">{{ row.totalScore }}</span></template>
          </el-table-column>
          <el-table-column label="德育F₁" width="80" align="center"><template #default="{row}">{{ row.modules?.F1 || 0 }}</template></el-table-column>
          <el-table-column label="智育F₂" width="80" align="center"><template #default="{row}">{{ row.modules?.F2 || 0 }}</template></el-table-column>
          <el-table-column label="F₂a" width="70" align="center"><template #default="{row}">{{ row.modules?.F2a || 0 }}</template></el-table-column>
          <el-table-column label="F₂b" width="70" align="center"><template #default="{row}">{{ row.modules?.F2b || 0 }}</template></el-table-column>
          <el-table-column label="体育F₃" width="80" align="center"><template #default="{row}">{{ row.modules?.F3 || 0 }}</template></el-table-column>
          <el-table-column label="美育F₄" width="80" align="center"><template #default="{row}">{{ row.modules?.F4 || 0 }}</template></el-table-column>
          <el-table-column label="劳育F₅" width="80" align="center"><template #default="{row}">{{ row.modules?.F5 || 0 }}</template></el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{row}">
              <el-button type="primary" size="small" link @click="viewStudentDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无综测数据" />
      </div>
    </template>

    <!-- 管理员视角：按个人查 -->
    <template v-else-if="isAdmin && viewMode === 'student'">
      <div class="card mt-16 score-summary" v-loading="loading">
        <el-empty v-if="!result" description="请先搜索并选择学生" />
        <template v-else>
          <div class="score-header">
            <div class="total-score">
              <div class="label">{{ result.studentName || '' }} 综合素质测评总分</div>
              <div class="value" :style="{ color: totalColor }">{{ result.totalScore || 0 }}</div>
              <div class="max">/ 100</div>
            </div>
          </div>
          <el-row :gutter="16" class="module-grid">
            <el-col :xs="12" :sm="8" :lg="4" v-for="m in moduleList" :key="m.key">
              <div class="module-card" :class="m.color">
                <div class="module-name">{{ m.name }}</div>
                <div class="module-score">{{ getModuleScore(m.key) }}</div>
                <div class="module-max">/ {{ m.max }}</div>
              </div>
            </el-col>
          </el-row>
        </template>
      </div>
    </template>

    <!-- 学生详情抽屉 -->
    <el-drawer v-model="detailDrawer" :title="detailTitle" size="80%" :destroy-on-close="true">
      <div v-loading="detailLoading">
        <template v-if="detailResult">
          <div class="score-header">
            <div class="total-score">
              <div class="label">综合素质测评总分</div>
              <div class="value" :style="{ color: detailTotalColor }">{{ detailResult.totalScore || 0 }}</div>
              <div class="max">/ 100</div>
            </div>
          </div>
          <el-row :gutter="16" class="module-grid">
            <el-col :xs="12" :sm="8" :lg="4" v-for="m in moduleList" :key="m.key">
              <div class="module-card" :class="m.color">
                <div class="module-name">{{ m.name }}</div>
                <div class="module-score">{{ getDetailModuleScore(m.key) }}</div>
                <div class="module-max">/ {{ m.max }}</div>
              </div>
            </el-col>
          </el-row>

          <!-- 智育明细 -->
          <div v-if="detailResult.modules?.F2" style="margin-top:20px;">
            <div class="sub-title" style="margin-bottom:8px;">智育 F₂ 明细</div>
            <el-descriptions :column="3" border size="small">
              <el-descriptions-item label="F₂a 学分加权">{{ detailResult.modules.F2.f2a }}</el-descriptions-item>
              <el-descriptions-item label="F₂b 奖励分">{{ detailResult.modules.F2.f2b }}</el-descriptions-item>
              <el-descriptions-item label="智育得分">{{ detailResult.modules.F2.score }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { getMyEvaluation, getStudentEvaluation, getClassEvaluation } from '@/api/evaluation';
import request from '@/utils/request';
import dayjs from 'dayjs';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const role = computed(() => userStore.userInfo?.role || '');
const isStudent = computed(() => role.value === 'student');
const isAdmin = computed(() => !isStudent.value);

const loading = ref(false);
const result = ref(null);
const f2Result = computed(() => result.value?.modules?.F2 || {
  f2a: 0,
  f2b: 0,
  internalScore: 0,
  courseCount: 0,
  totalCredit: 0,
  f2aDetails: [],
  f2bDetails: []
});
const classResult = ref(null);

const selAcademicYear = ref('');
const selSemester = ref('first');
const academicYearOptions = computed(() => {
  const now = dayjs();
  const y = now.year();
  return [`${y-1}-${y}`, `${y}-${y+1}`, `${y-2}-${y-1}`];
});

// 管理员
const viewMode = ref('class');
const selClassId = ref(null);
const selStudentId = ref(null);
const classOptions = ref([]);
const studentOptions = ref([]);
const studentLoading = ref(false);

// 详情抽屉
const detailDrawer = ref(false);
const detailLoading = ref(false);
const detailTitle = ref('');
const detailResult = ref(null);
const detailTab = ref('F1');

const moduleList = [
  { key: 'F1', name: '德育', max: 15, color: 'red', progressColor: '#F56C6C' },
  { key: 'F2', name: '智育', max: 70, color: 'blue', progressColor: '#409EFF' },
  { key: 'F3', name: '体育', max: 5, color: 'green', progressColor: '#67C23A' },
  { key: 'F4', name: '美育', max: 5, color: 'orange', progressColor: '#E6A23C' },
  { key: 'F5', name: '劳育', max: 5, color: 'purple', progressColor: '#9B59B6' }
];

const totalColor = computed(() => {
  const s = Number(result.value?.totalScore || 0);
  if (s >= 90) return '#67C23A';
  if (s >= 75) return '#409EFF';
  if (s >= 60) return '#E6A23C';
  return '#F56C6C';
});

const detailTotalColor = computed(() => {
  const s = Number(detailResult.value?.totalScore || 0);
  if (s >= 90) return '#67C23A';
  if (s >= 75) return '#409EFF';
  if (s >= 60) return '#E6A23C';
  return '#F56C6C';
});

function getModuleScore(key) {
  return result.value?.modules?.[key]?.score || 0;
}
function getDetailModuleScore(key) {
  return detailResult.value?.modules?.[key]?.score || 0;
}

onMounted(async () => {
  // 默认当前学期
  try {
    const cur = await request({ url: '/semesters/current', method: 'GET' });
    const ay = cur?.academicYear || cur?.academic_year;
    const sm = cur?.semester;
    if (ay) { selAcademicYear.value = ay; selSemester.value = sm || 'first'; }
  } catch (_) {
    const now = dayjs();
    const m = now.month() + 1;
    if (m >= 9 || m <= 1) { selAcademicYear.value = m >= 9 ? `${now.year()}-${now.year()+1}` : `${now.year()-1}-${now.year()}`; selSemester.value = 'first'; }
    else { selAcademicYear.value = `${now.year()-1}-${now.year()}`; selSemester.value = 'second'; }
  }
  if (isAdmin.value) await loadClassOptions();
  await loadData();
});

onActivated(async () => { await loadData(); });

async function loadClassOptions() {
  try {
    const res = await request({ url: '/classes', method: 'GET', params: { pageSize: 500 } });
    classOptions.value = (res.list || res.data?.list || res.data || []).map(c => ({ id: c.id, name: c.name }));
  } catch (_) {}
}

function onViewModeChange() {
  selClassId.value = null;
  selStudentId.value = null;
  result.value = null;
  classResult.value = null;
}

async function searchStudents(query) {
  if (!query || query.length < 1) { studentOptions.value = []; return; }
  studentLoading.value = true;
  try {
    const res = await request({ url: '/users', method: 'GET', params: { keyword: query, role: 'student', pageSize: 30 } });
    studentOptions.value = (res.list || res.data?.list || res.data || []).map(u => ({ id: u.id, username: u.username, realName: u.realName }));
  } catch (_) { studentOptions.value = []; }
  finally { studentLoading.value = false; }
}

async function loadData() {
  if (isAdmin.value && role.value !== 'class_admin') {
    if (viewMode.value === 'class' && !selClassId.value) { classResult.value = null; result.value = null; return; }
    if (viewMode.value === 'student' && !selStudentId.value) { result.value = null; return; }
  }

  loading.value = true;
  try {
    if (isStudent.value) {
      const res = await getMyEvaluation({ academicYear: selAcademicYear.value, semester: selSemester.value });
      result.value = res;
    } else if (role.value === 'class_admin' || viewMode.value === 'class') {
      let classId = selClassId.value;
      if (role.value === 'class_admin') {
        try {
          const me = await request({ url: '/classes/my/info', method: 'GET' });
          classId = me?.id || me?.data?.id;
        } catch (_) { classResult.value = null; return; }
      }
      if (!classId) { classResult.value = null; return; }
      const res = await getClassEvaluation(classId, { academicYear: selAcademicYear.value, semester: selSemester.value });
      classResult.value = res;
    } else {
      // 按个人查
      const res = await getStudentEvaluation(selStudentId.value, { academicYear: selAcademicYear.value, semester: selSemester.value });
      result.value = res;
    }
  } catch (e) {
    ElMessage.error('查询失败：' + (e.message || ''));
  } finally {
    loading.value = false;
  }
}

async function viewStudentDetail(row) {
  detailDrawer.value = true;
  detailLoading.value = true;
  detailTitle.value = `${row.realName} 的综测详情`;
  detailResult.value = null;
  try {
    const res = await getStudentEvaluation(row.studentId, { academicYear: selAcademicYear.value, semester: selSemester.value });
    detailResult.value = res;
  } catch (e) {
    ElMessage.error('加载详情失败：' + (e.message || ''));
  } finally {
    detailLoading.value = false;
  }
}

function resetFilter() {
  selClassId.value = null;
  selStudentId.value = null;
  viewMode.value = 'class';
  result.value = null;
  classResult.value = null;
  loadClassOptions();
}
</script>

<style lang="scss" scoped>
.evaluation-page { padding-bottom:8px; }
.filter-panel { margin-top:18px; padding:0; overflow:hidden; }
.filter-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; padding:20px 23px 17px; border-bottom:1px solid #EAF0F7;
  span { color:#1876D2; font-size:10px; font-weight:800; letter-spacing:.16em; }
  h3 { margin:5px 0 0; color:#172B4D; font-size:17px; }
  small { color:#8997AB; font-size:12px; }
}
.filter-bar { display: flex; align-items: center; padding: 16px 22px 18px; flex-wrap: wrap; gap: 8px; background:#FAFCFE; }
.card { background: #fff; border:1px solid #E6EDF7; border-radius: 18px; padding: 22px; box-shadow: 0 11px 30px rgba(23,43,77,.055); }
.card-title { display:flex; align-items:center; font-size: 17px; font-weight: 700; color: #172B4D;
  &::before { content:''; width:4px; height:18px; margin-right:9px; border-radius:4px; background:linear-gradient(#1C7BEA,#13B9D5); }
}
.sub-title { font-size: 13px; color: #909399; }
.mt-16 { margin-top: 18px; }
.score-summary { position:relative; overflow:hidden; background:linear-gradient(135deg,#fff,#F8FBFF); }
.score-summary::after { content:''; position:absolute; width:250px; height:250px; right:-100px; top:-135px; border:1px solid rgba(24,118,210,.1); border-radius:50%; box-shadow:0 0 0 34px rgba(24,118,210,.025); pointer-events:none; }
.score-header { text-align: center; padding: 10px 0 5px; }
.total-score { display:inline-flex; align-items:baseline; justify-content:center; flex-wrap:wrap; min-width:245px; padding:17px 28px; border:1px solid #DFEAF7; border-radius:18px; background:#fff; box-shadow:0 8px 24px rgba(30,75,130,.07); }
.total-score .label { width:100%; margin-bottom:2px; font-size: 13px; font-weight:650; color: #687993; }
.total-score .value { font-size: 50px; font-weight: 800; line-height: 1.25; letter-spacing:-.05em; }
.total-score .max { margin-left:6px; font-size: 13px; color: #98A4B5; }
.module-grid { margin-top:20px; justify-content:center; row-gap:16px; }
.module-card { position:relative; min-height:125px; text-align: left; padding: 18px; overflow:hidden; border:1px solid #E5EDF7; border-radius: 15px; color:#1C355A; background:#fff; box-shadow:0 7px 20px rgba(28,53,90,.05); }
.module-card::after { content:''; position:absolute; width:68px; height:68px; right:-18px; bottom:-28px; border-radius:50%; background:currentColor; opacity:.08; }
.module-name { font-size: 13px; font-weight:650; color:#6D7D94; }
.module-score { font-size: 29px; font-weight: 800; margin: 5px 0 0; letter-spacing:-.04em; }
.module-max { font-size: 11px; color:#98A5B7; }
.module-card.red { color:#E25F70; border-top:3px solid #E25F70; }
.module-card.blue { color:#2379E5; border-top:3px solid #2379E5; }
.module-card.green { color:#16A69A; border-top:3px solid #16A69A; }
.module-card.orange { color:#E3A21A; border-top:3px solid #E3A21A; }
.module-card.purple { color:#7867DE; border-top:3px solid #7867DE; }
.formula-board { display:grid; grid-template-columns:minmax(240px,.9fr) minmax(0,1.6fr); gap:14px; margin-top:16px; }
.formula-copy { position:relative; min-height:154px; padding:20px; overflow:hidden; color:#fff; border-radius:16px; background:linear-gradient(135deg,#12306D,#17639F 70%,#0888AC); box-shadow:0 12px 28px rgba(18,63,119,.16);
  &::after { content:''; position:absolute; width:112px; height:112px; right:-45px; bottom:-58px; border:1px solid rgba(255,255,255,.3); border-radius:50%; box-shadow:0 0 0 20px rgba(255,255,255,.06); }
  span { display:block; color:#9EE6F1; font-size:10px; font-weight:800; letter-spacing:.15em; }
  strong { display:block; margin:17px 0 9px; font-size:20px; letter-spacing:.01em; }
  small { display:block; max-width:330px; color:#D4E9F2; line-height:1.6; }
}
.formula-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;
  > div { display:flex; flex-direction:column; justify-content:center; min-height:154px; padding:17px; border:1px solid #E2EAF4; border-radius:15px; background:linear-gradient(145deg,#fff,#F8FBFF); }
  span { color:#718198; font-size:12px; font-weight:700; }
  strong { margin:7px 0 4px; color:#1F6FC5; font-size:28px; line-height:1; letter-spacing:-.04em; }
  small { color:#9AA7B7; }
  .formula-result { border-color:#BCE7DD; background:linear-gradient(145deg,#F5FCFA,#E5F8F2); }
  .formula-result strong { color:#11957D; }
}
.sub { color: #909399; font-size: 12px; }
:deep(.el-table) { border-radius:12px; --el-table-header-bg-color:#F5F8FC; --el-table-row-hover-bg-color:#F3F8FF; }
:deep(.el-table th.el-table__cell) { color:#52647E; font-weight:700; }
:deep(.el-descriptions) { --el-descriptions-table-border:1px solid #E3EBF5; }

@media (max-width:768px) {
  .filter-heading { align-items:flex-start; flex-direction:column; padding:18px; }
  .filter-heading small { display:none; }
  .filter-bar { padding:15px 18px; }
  .filter-bar :deep(.el-select), .filter-bar :deep(.el-radio-group), .filter-bar :deep(.el-button) { width:100% !important; margin-left:0 !important; }
  .total-score { min-width:210px; }
  .module-card { min-height:116px; padding:16px; }
  .formula-board { grid-template-columns:1fr; }
  .formula-values { grid-template-columns:1fr; }
  .formula-values > div { min-height:104px; }
}
</style>
