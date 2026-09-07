<template>
  <div>
    <!-- 页头 -->
    <div class="page-header">
      <h2 class="page-title" style="margin: 0;">
        <el-icon><MagicStick /></el-icon> AI 智能分析中心
      </h2>
      <div style="display: flex; gap: 8px;">
        <el-button
          type="primary"
          :icon="MagicStick"
          :loading="reportLoading"
          @click="handleGenerateReport"
        >生成分析报表</el-button>
        <el-button
          type="success"
          :icon="Download"
          :loading="exportLoading"
          @click="handleExportXLSX"
        >导出 XLSX 报表</el-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-items">
        <el-select
          v-model="filters.scope"
          placeholder="选择范围"
          style="width: 130px;"
          @change="onScopeChange"
        >
          <el-option
            v-for="s in allowedScopes"
            :key="s.value"
            :label="s.label"
            :value="s.value"
          />
        </el-select>

        <el-select
          v-if="allowedScopes.some(s => s.value === 'college')"
          v-model="filters.collegeId"
          placeholder="选择院系"
          clearable
          filterable
          style="width: 170px;"
          @change="onCollegeChange"
        >
          <el-option
            v-for="c in collegeList"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>

        <el-select
          v-model="filters.major"
          placeholder="选择专业"
          clearable
          filterable
          style="width: 150px;"
          :disabled="!filters.collegeId"
          @change="onMajorChange"
        >
          <el-option
            v-for="m in majorList"
            :key="m"
            :label="m"
            :value="m"
          />
        </el-select>

        <el-select
          v-model="filters.grade"
          placeholder="选择年级"
          clearable
          style="width: 110px;"
          :disabled="!filters.collegeId"
        >
          <el-option
            v-for="g in gradeList"
            :key="g"
            :label="g + '级'"
            :value="g"
          />
        </el-select>

        <el-select
          v-model="filters.classId"
          placeholder="选择班级"
          clearable
          filterable
          style="width: 160px;"
          :disabled="!filters.collegeId || filters.scope === 'student'"
          @change="onClassChange"
        >
          <el-option
            v-for="c in filteredClassList"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>

        <el-select
          v-model="filters.studentId"
          placeholder="选择学生"
          clearable
          filterable
          style="width: 180px;"
          :disabled="!filters.classId"
        >
          <el-option
            v-for="s in studentList"
            :key="s.id"
            :label="s.realName + '（' + s.studentNo + '）'"
            :value="s.id"
          />
        </el-select>

        <el-select
          v-model="filters.academicYear"
          placeholder="学年"
          clearable
          style="width: 130px;"
        >
          <el-option
            v-for="y in academicYearList"
            :key="y"
            :label="y + ' 学年'"
            :value="y"
          />
        </el-select>

        <el-select
          v-model="filters.semesterId"
          placeholder="学期"
          clearable
          filterable
          style="width: 160px;"
        >
          <el-option
            v-for="s in semesterList"
            :key="s.id"
            :label="s.name"
            :value="s.id"
          />
        </el-select>
      </div>

      <div class="filter-actions">
        <el-button type="primary" :icon="Search" :loading="loading" @click="onQuery">
          查询
        </el-button>
        <el-button :icon="Refresh" @click="resetFilters">重置</el-button>
      </div>
    </div>

    <!-- 加载态 -->
    <div v-loading="loading" element-loading-text="正在加载分析数据...">
      <template v-if="!hasAccess">
        <el-empty description="当前角色无 AI 分析页面访问权限" style="margin-top: 80px;">
          <template #image>
            <el-icon :size="64" color="#c0c4cc"><User /></el-icon>
          </template>
        </el-empty>
      </template>

      <template v-else-if="!hasData">
        <el-empty description="暂无分析数据，请调整筛选条件后重试" style="margin-top: 80px;" />
      </template>

      <template v-else>
        <!-- 汇总统计卡片 -->
        <el-row :gutter="16" class="mt-16">
          <el-col :xs="12" :sm="6">
            <div class="stat-card blue">
              <div class="flex-between">
                <span class="label">学生总数</span>
                <div class="icon"><User /></div>
              </div>
              <div class="value">{{ data.summary?.totalStudents ?? '--' }}</div>
              <div class="extra">参评学生规模</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card green">
              <div class="flex-between">
                <span class="label">班级总数</span>
                <div class="icon"><School /></div>
              </div>
              <div class="value">{{ data.summary?.totalClasses ?? '--' }}</div>
              <div class="extra">覆盖班级数量</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card orange">
              <div class="flex-between">
                <span class="label">平均加分</span>
                <div class="icon"><TrendCharts /></div>
              </div>
              <div class="value">{{ data.summary?.avgScore ?? '--' }}</div>
              <div class="extra">人均加分成绩</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card red">
              <div class="flex-between">
                <span class="label">申报总数</span>
                <div class="icon"><Document /></div>
              </div>
              <div class="value">{{ data.summary?.totalApplications ?? '--' }}</div>
              <div class="extra">累计申报记录</div>
            </div>
          </el-col>
        </el-row>

        <!-- 活动指标卡片 -->
        <el-row :gutter="12" class="mt-16">
          <el-col
            :xs="12"
            :sm="8"
            :md="6"
            :lg="4"
            v-for="(item, idx) in activityMetrics"
            :key="'act-' + idx"
          >
            <div class="stat-card" :class="item.color">
              <div class="flex-between">
                <span class="label">{{ item.label }}</span>
                <div class="icon"><el-icon><component :is="item.icon" /></el-icon></div>
              </div>
              <div class="value">{{ item.value }}</div>
              <div class="extra">{{ item.extra }}</div>
            </div>
          </el-col>
        </el-row>

        <!-- AI 洞察 / 风险预警 / 优化建议 -->
        <el-row :gutter="16" class="mt-16">
          <el-col :xs="24" :md="8">
            <div class="card ai-card ai-insight">
              <div class="card-title">
                <span class="card-title-inner">
                  <el-icon color="#409EFF"><DataAnalysis /></el-icon>
                  <span>AI 数据洞察</span>
                </span>
                <el-tag type="primary" effect="light" size="small">智能分析</el-tag>
              </div>
              <template v-if="data.insights?.length">
                <div class="ai-list">
                  <div v-for="(item, i) in data.insights" :key="'ins-' + i" class="ai-item insight">
                    <span class="ai-dot" />
                    <span>{{ item }}</span>
                  </div>
                </div>
              </template>
              <el-empty v-else description="暂无洞察数据" :image-size="80" />
            </div>
          </el-col>

          <el-col :xs="24" :md="8">
            <div class="card ai-card ai-risk">
              <div class="card-title">
                <span class="card-title-inner">
                  <el-icon color="#F56C6C"><Warning /></el-icon>
                  <span>风险预警</span>
                </span>
                <el-tag type="danger" effect="light" size="small">需关注</el-tag>
              </div>
              <template v-if="data.risks?.length">
                <div class="ai-list">
                  <div v-for="(item, i) in data.risks" :key="'risk-' + i" class="ai-item risk">
                    <span class="ai-dot" />
                    <span>{{ item }}</span>
                  </div>
                </div>
              </template>
              <el-empty v-else description="暂未检测到风险" :image-size="80" />
            </div>
          </el-col>

          <el-col :xs="24" :md="8">
            <div class="card ai-card ai-suggestion">
              <div class="card-title">
                <span class="card-title-inner">
                  <el-icon color="#67C23A"><CircleCheck /></el-icon>
                  <span>优化建议</span>
                </span>
                <el-tag type="success" effect="light" size="small">推荐方案</el-tag>
              </div>
              <template v-if="data.suggestions?.length">
                <div class="ai-list">
                  <div v-for="(item, i) in data.suggestions" :key="'sug-' + i" class="ai-item suggestion">
                    <span class="ai-dot" />
                    <span>{{ item }}</span>
                  </div>
                </div>
              </template>
              <el-empty v-else description="暂无优化建议" :image-size="80" />
            </div>
          </el-col>
        </el-row>

        <!-- 图表区域 -->
        <el-row :gutter="16" class="mt-16">
          <el-col :xs="24" :md="8">
            <div class="card">
              <div class="card-title">
                <span>模块申报占比</span>
                <el-icon color="#909399"><Trophy /></el-icon>
              </div>
              <BaseChart
                v-if="moduleAnalysisOption"
                :option="moduleAnalysisOption"
                height="320px"
              />
              <el-empty v-else description="暂无模块数据" />
            </div>
          </el-col>
          <el-col :xs="24" :md="16">
            <div class="card">
              <div class="card-title">
                <span>学生分数区间分布</span>
                <el-icon color="#909399"><TrendCharts /></el-icon>
              </div>
              <BaseChart
                v-if="scoreDistributionOption"
                :option="scoreDistributionOption"
                height="320px"
              />
              <el-empty v-else description="暂无分数分布数据" />
            </div>
          </el-col>
        </el-row>

        <div class="card mt-16">
          <div class="card-title">
            <span>同层级单位对比</span>
            <el-icon color="#909399"><DataAnalysis /></el-icon>
          </div>
          <BaseChart
            v-if="unitComparisonOption"
            :option="unitComparisonOption"
            height="360px"
          />
          <el-empty v-else description="暂无对比数据" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import BaseChart from '@/components/BaseChart.vue';
import { ElMessage } from 'element-plus';
import {
  MagicStick,
  DataAnalysis,
  Clock,
  Bell,
  Warning,
  CircleCheck,
  Refresh,
  Download,
  Search,
  User,
  School,
  Document,
  TrendCharts,
  Trophy
} from '@element-plus/icons-vue';
import request from '@/utils/request';
import { getComprehensiveAnalysis, exportAIReportXLSX } from '@/api/ai-analysis';

const userStore = useUserStore();
const role = computed(() => userStore.role);

// ========== 权限与范围 ==========
const scopeLabelMap = {
  student: '个人分析',
  class: '班级分析',
  college: '院系分析',
  school: '全校分析'
};

const allowedScopes = computed(() => {
  const r = role.value;
  const list = [];
  if (r === 'student') {
    list.push({ value: 'student', label: scopeLabelMap.student });
  } else if (r === 'class_admin' || r === 'counselor') {
    list.push({ value: 'student', label: scopeLabelMap.student });
    list.push({ value: 'class', label: scopeLabelMap.class });
  } else if (r === 'college_admin') {
    list.push({ value: 'student', label: scopeLabelMap.student });
    list.push({ value: 'class', label: scopeLabelMap.class });
    list.push({ value: 'college', label: scopeLabelMap.college });
  } else if (r === 'school_admin' || r === 'super_admin') {
    list.push({ value: 'student', label: scopeLabelMap.student });
    list.push({ value: 'class', label: scopeLabelMap.class });
    list.push({ value: 'college', label: scopeLabelMap.college });
    list.push({ value: 'school', label: scopeLabelMap.school });
  }
  return list;
});

const defaultScope = computed(() => {
  const r = role.value;
  if (r === 'student') return 'student';
  if (r === 'class_admin' || r === 'counselor') return 'class';
  if (r === 'college_admin') return 'college';
  if (r === 'school_admin' || r === 'super_admin') return 'school';
  return 'student';
});

const hasAccess = computed(() =>
  ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'].includes(role.value)
);

// ========== 状态 ==========
const loading = ref(false);
const reportLoading = ref(false);
const exportLoading = ref(false);

const data = ref({
  summary: null,
  activity: null,
  insights: [],
  risks: [],
  suggestions: [],
  moduleAnalysis: [],
  scoreDistribution: [],
  unitComparison: []
});

const filters = reactive({
  scope: defaultScope.value,
  collegeId: null,
  major: '',
  grade: '',
  classId: null,
  studentId: null,
  academicYear: '',
  semesterId: null
});

// ========== 下拉数据源 ==========
const collegeList = ref([]);
const classList = ref([]);
const studentList = ref([]);
const semesterList = ref([]);

const academicYearList = computed(() => {
  const set = new Set();
  semesterList.value.forEach(s => {
    if (s.academicYear) set.add(String(s.academicYear));
  });
  return Array.from(set).sort().reverse();
});

const majorList = computed(() => {
  const set = new Set();
  classList.value.forEach(c => {
    if (!filters.collegeId || Number(c.collegeId) === Number(filters.collegeId)) {
      if (c.major) set.add(c.major);
    }
  });
  return Array.from(set).sort();
});

const gradeList = computed(() => {
  const set = new Set();
  classList.value.forEach(c => {
    if (!filters.collegeId || Number(c.collegeId) === Number(filters.collegeId)) {
      if (!filters.major || c.major === filters.major) {
        if (c.grade) set.add(String(c.grade));
      }
    }
  });
  return Array.from(set).sort().reverse();
});

const filteredClassList = computed(() => {
  return classList.value.filter(c => {
    if (filters.collegeId && Number(c.collegeId) !== Number(filters.collegeId)) return false;
    if (filters.major && c.major !== filters.major) return false;
    if (filters.grade && String(c.grade) !== String(filters.grade)) return false;
    return true;
  });
});

// ========== 活动指标 ==========
const activityMetrics = computed(() => {
  const d = data.value.activity || {};
  return [
    { label: '活跃用户规模', value: d.activeStudents ?? '--', extra: '活跃学生数', icon: User, color: 'blue' },
    { label: '申报参与率', value: d.submissionRate != null ? d.submissionRate + '%' : '--', extra: '参与学生占比', icon: TrendCharts, color: 'green' },
    { label: '人均申报频次', value: d.avgSubmissions ?? '--', extra: '人均申报项数', icon: Document, color: 'orange' },
    { label: '审批平均处理时长', value: d.avgApprovalTime ?? '--', extra: '单位: 小时', icon: Clock, color: 'purple' },
    { label: '申诉总量', value: d.appealTotal ?? '--', extra: '累计申诉数', icon: Warning, color: 'orange' },
    { label: '申诉办结率', value: d.appealResolveRate != null ? d.appealResolveRate + '%' : '--', extra: '已办结占比', icon: CircleCheck, color: 'green' },
    { label: '申报驳回率', value: d.rejectionRate != null ? d.rejectionRate + '%' : '--', extra: '驳回申报占比', icon: Warning, color: 'red' },
    { label: '草稿留存', value: d.draftCount ?? '--', extra: '未提交草稿', icon: Document, color: 'purple' },
    { label: '逾期待办', value: d.pendingCount ?? '--', extra: '逾期未处理', icon: Bell, color: 'red' }
  ];
});

const hasData = computed(() => {
  const d = data.value;
  if (d.summary && (d.summary.totalStudents || d.summary.totalClasses || d.summary.totalApplications)) return true;
  if ((d.insights && d.insights.length) || (d.risks && d.risks.length) || (d.suggestions && d.suggestions.length)) return true;
  if ((d.moduleAnalysis && d.moduleAnalysis.length) || (d.scoreDistribution && d.scoreDistribution.length) || (d.unitComparison && d.unitComparison.length)) return true;
  if (d.activity) return true;
  return false;
});

// ========== 图表配置 ==========
const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];

const moduleAnalysisOption = computed(() => {
  const list = data.value.moduleAnalysis || [];
  if (!list.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, left: 'center' },
    series: [{
      type: 'pie',
      radius: ['35%', '65%'],
      center: ['50%', '45%'],
      data: list.map(x => ({ name: x.name, value: x.value })),
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%' }
    }]
  };
});

const scoreDistributionOption = computed(() => {
  const list = data.value.scoreDistribution || [];
  if (!list.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: 'category',
      data: list.map(x => x.name),
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: 'value', name: '人数' },
    series: [{
      type: 'bar',
      data: list.map((x, i) => ({
        value: x.value,
        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [4, 4, 0, 0] }
      })),
      barWidth: '50%',
      label: { show: true, position: 'top', fontSize: 11 }
    }]
  };
});

const unitComparisonOption = computed(() => {
  const list = data.value.unitComparison || [];
  if (!list.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 40, top: 30, bottom: 30 },
    xAxis: { type: 'value', name: '通过率(%)' },
    yAxis: {
      type: 'category',
      data: list.map(x => x.name),
      inverse: true
    },
    series: [{
      type: 'bar',
      data: list.map((x, i) => ({
        value: Number(x.value),
        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 4, 4, 0] }
      })),
      barWidth: '50%',
      label: { show: true, position: 'right', fontSize: 11, formatter: '{c}%' }
    }]
  };
});

// ========== 事件 ==========
function onScopeChange() {
  filters.collegeId = null;
  filters.major = '';
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  studentList.value = [];
}

function onCollegeChange() {
  filters.major = '';
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  studentList.value = [];
}

function onMajorChange() {
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  studentList.value = [];
}

function onClassChange() {
  filters.studentId = null;
  loadStudents(filters.classId);
}

function buildParams() {
  const params = {};
  if (filters.scope) params.scope = filters.scope;
  if (filters.collegeId) params.collegeId = filters.collegeId;
  if (filters.major) params.major = filters.major;
  if (filters.grade) params.grade = filters.grade;
  if (filters.classId) params.classId = filters.classId;
  if (filters.studentId) params.studentId = filters.studentId;
  if (filters.academicYear) params.academicYear = filters.academicYear;
  if (filters.semesterId) params.semesterId = filters.semesterId;
  return params;
}

async function onQuery() {
  if (!hasAccess.value) return;
  loading.value = true;
  try {
    const res = await getComprehensiveAnalysis(buildParams());
    data.value = {
      summary: res?.summary || null,
      activity: res?.activity || null,
      insights: res?.insights || [],
      risks: res?.risks || [],
      suggestions: res?.suggestions || [],
      moduleAnalysis: res?.moduleAnalysis || [],
      scoreDistribution: res?.scoreDistribution || [],
      unitComparison: res?.unitComparison || []
    };
  } catch (e) {
    console.error('加载 AI 综合分析失败:', e);
    ElMessage.error('加载 AI 综合分析失败');
    data.value = {
      summary: null, activity: null,
      insights: [], risks: [], suggestions: [],
      moduleAnalysis: [], scoreDistribution: [], unitComparison: []
    };
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  const r = role.value;
  const info = userStore.userInfo || {};
  filters.scope = defaultScope.value;
  filters.collegeId = null;
  filters.major = '';
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  filters.academicYear = '';
  filters.semesterId = null;

  if (r === 'student') {
    filters.studentId = info.id || null;
  } else if (r === 'class_admin') {
    filters.classId = info.classId || null;
    if (info.classId) {
      const cls = classList.value.find(c => c.id === info.classId);
      if (cls?.collegeId) filters.collegeId = cls.collegeId;
    }
  } else if (r === 'counselor') {
    if (info.collegeId) filters.collegeId = info.collegeId;
    if (classList.value.length === 1) filters.classId = classList.value[0].id;
  } else if (r === 'college_admin') {
    if (info.collegeId) filters.collegeId = info.collegeId;
  }

  if (filters.classId) loadStudents(filters.classId);
  onQuery();
}

async function handleGenerateReport() {
  reportLoading.value = true;
  try {
    const res = await getComprehensiveAnalysis({ ...buildParams(), generateReport: 1 });
    data.value = {
      summary: res?.summary || data.value.summary,
      activity: res?.activity || data.value.activity,
      insights: res?.insights || [],
      risks: res?.risks || [],
      suggestions: res?.suggestions || [],
      moduleAnalysis: res?.moduleAnalysis || data.value.moduleAnalysis,
      scoreDistribution: res?.scoreDistribution || data.value.scoreDistribution,
      unitComparison: res?.unitComparison || data.value.unitComparison
    };
    ElMessage.success('分析报表生成成功');
  } catch (e) {
    console.error('生成分析报表失败:', e);
    ElMessage.error('生成分析报表失败');
  } finally {
    reportLoading.value = false;
  }
}

async function handleExportXLSX() {
  exportLoading.value = true;
  try {
    const blob = await exportAIReportXLSX(buildParams());
    const url = window.URL.createObjectURL(new Blob([blob]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI分析报表_${filters.scope || 'all'}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    ElMessage.success('报表导出成功');
  } catch (e) {
    console.error('导出 XLSX 失败:', e);
    ElMessage.error('导出报表失败');
  } finally {
    exportLoading.value = false;
  }
}

// ========== 数据加载 ==========
async function loadColleges() {
  try {
    let list = await request({ url: '/colleges/all', method: 'GET' });
    if (['college_admin', 'counselor'].includes(role.value) && userStore.userInfo?.collegeId) {
      list = list.filter(c => Number(c.id) === Number(userStore.userInfo.collegeId));
    }
    collegeList.value = list || [];
  } catch (_) {
    collegeList.value = [];
  }
}

async function loadClasses() {
  try {
    const params = { pageSize: 1000 };
    if (role.value === 'college_admin' && userStore.userInfo?.collegeId) {
      params.collegeId = userStore.userInfo.collegeId;
    }
    const r = await request({ url: '/classes', method: 'GET', params });
    classList.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (_) {
    classList.value = [];
  }
}

async function loadStudents(classId) {
  try {
    const params = { pageSize: 500 };
    if (classId) params.classId = classId;
    const r = await request({ url: '/users', method: 'GET', params });
    const all = Array.isArray(r) ? r : (r?.list || []);
    studentList.value = all.filter(u => u.role === 'student');
  } catch (_) {
    studentList.value = [];
  }
}

async function loadSemesters() {
  try {
    const r = await request({ url: '/semesters', method: 'GET', params: { pageSize: 200 } });
    semesterList.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (_) {
    semesterList.value = [];
  }
}

// ========== 初始化 ==========
onMounted(async () => {
  if (!hasAccess.value) return;
  await Promise.all([loadColleges(), loadClasses(), loadSemesters()]);
  resetFilters();
});
</script>

<style lang="scss" scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 0;
  gap: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin: 12px 16px 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  flex-wrap: wrap;
  gap: 12px;
}

.filter-items {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.stat-card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  position: relative;
  overflow: hidden;
  border: 1px solid #ebeef5;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }

  .flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    color: #606266;
    font-size: 13px;
  }

  .value {
    font-size: 28px;
    font-weight: 700;
    margin: 8px 0 4px;
    line-height: 1.2;
  }

  .extra {
    color: #909399;
    font-size: 12px;
  }

  .icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.3);
  }

  &.blue {
    background: linear-gradient(135deg, #409EFF, #66b1ff);
    color: #fff;
  }
  &.green {
    background: linear-gradient(135deg, #67C23A, #85ce61);
    color: #fff;
  }
  &.orange {
    background: linear-gradient(135deg, #E6A23C, #ebb563);
    color: #fff;
  }
  &.red {
    background: linear-gradient(135deg, #F56C6C, #f78989);
    color: #fff;
  }
  &.purple {
    background: linear-gradient(135deg, #722ed1, #9254de);
    color: #fff;
  }
}

.mt-16 {
  margin: 16px;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #ebeef5;

  .card-title {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-title-inner {
    display: flex;
    align-items: center;
    gap: 6px;
  }
}

.ai-card {
  height: 100%;
  display: flex;
  flex-direction: column;

  &.ai-insight {
    border-top: 3px solid #409EFF;
    background: linear-gradient(180deg, #f0f7ff 0%, #ffffff 30%);
  }
  &.ai-risk {
    border-top: 3px solid #F56C6C;
    background: linear-gradient(180deg, #fff1f0 0%, #ffffff 30%);
  }
  &.ai-suggestion {
    border-top: 3px solid #67C23A;
    background: linear-gradient(180deg, #f0fff4 0%, #ffffff 30%);
  }
}

.ai-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.ai-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: #606266;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #ebeef5;

  &.insight {
    border-left: 3px solid #409EFF;
  }
  &.risk {
    border-left: 3px solid #F56C6C;
  }
  &.suggestion {
    border-left: 3px solid #67C23A;
  }
}

.ai-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 7px;
  background: #c0c4cc;
}

.ai-item.insight .ai-dot { background: #409EFF; }
.ai-item.risk .ai-dot { background: #F56C6C; }
.ai-item.suggestion .ai-dot { background: #67C23A; }
</style>
