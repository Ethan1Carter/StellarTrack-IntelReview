<template>
  <div>
    <div class="flex-between" style="margin-bottom:16px;">
      <h2 class="page-title"><el-icon><DataBoard /></el-icon> 我的数据看板</h2>
      <div class="filter-bar">
        <el-select v-model="selectedSemester" placeholder="选择学期" style="width:200px" @change="load">
          <el-option v-for="s in semesterList" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="16">
      <el-col :xs="12" :sm="6"><div class="stat-card blue">
        <div class="flex-between"><span class="label">本学期总分</span><div class="icon"><Trophy /></div></div>
        <div class="value">{{ data.totalScore }}</div>
        <div class="extra">累计 {{ data.appCount }} 项加分</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card green">
        <div class="flex-between"><span class="label">年度总分</span><div class="icon"><Coin /></div></div>
        <div class="value">{{ data.annualTotal }}</div>
        <div class="extra">{{ semesterList.find(s => s.value === selectedSemester.value)?.academicYear || curAcademicYear }} 学年</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card orange">
        <div class="flex-between"><span class="label">班级排名</span><div class="icon"><Rank /></div></div>
        <div class="value">{{ data.classRank ?? '--' }}<span style="font-size:16px; color:#909399; margin-left:4px;">/ {{ data.classTotal }} 名</span></div>
        <div class="extra">超越 {{ beatPercent }}% 的同学</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card red">
        <div class="flex-between"><span class="label">待审批</span><div class="icon"><Clock /></div></div>
        <div class="value">{{ data.pendingCount || 0 }}</div>
        <div class="extra"><router-link to="/my-applications">查看待办 →</router-link></div>
      </div></el-col>
    </el-row>

    <!-- 图表区域 -->
    <el-row :gutter="16" class="mt-16">
      <el-col :xs="24" :md="12">
        <div class="card">
          <div class="card-title">各维度加分占比 <el-tag size="small" type="success">饼图</el-tag></div>
          <BaseChart v-if="pieOption" :option="pieOption" height="300px" @click="onPieClick" />
          <el-empty v-else description="暂无数据，快去申报加分吧~" />
        </div>
      </el-col>
      <el-col :xs="24" :md="12">
        <div class="card">
          <div class="card-title">本学期加分趋势 <el-tag size="small" type="primary">折线图</el-tag></div>
          <BaseChart v-if="lineOption" :option="lineOption" height="300px" />
          <el-empty v-else description="暂无数据" />
        </div>
      </el-col>
    </el-row>

    <div class="card mt-16 growth-card">
      <div class="card-title">
        <span><el-icon><MagicStick /></el-icon> AI 五育成长计划</span>
        <el-tag v-if="growthPlan" type="success" size="small">基于当前数据生成</el-tag>
        <router-link to="/ai-material-review">去做 AI 材料审核 →</router-link>
      </div>
      <el-skeleton v-if="growthLoading" :rows="3" animated />
      <template v-else-if="growthPlan">
        <el-alert :title="growthPlan.diagnosis?.weakest ? `当前优先提升：${growthPlan.diagnosis.weakest.name}（${growthPlan.diagnosis.weakest.value} 分 → ${growthPlan.diagnosis.weakest.target} 分）` : 'AI 正在根据你的成长记录生成建议'" type="info" :closable="false" show-icon />
        <el-row :gutter="12" class="goal-row">
          <el-col v-for="goal in growthPlan.goals" :key="goal.title" :xs="24" :sm="8">
            <div class="goal-item"><strong>{{ goal.title }}</strong><span>{{ goal.target }}</span><small>{{ goal.metric }}</small></div>
          </el-col>
        </el-row>
        <div class="action-list">
          <div v-for="action in growthPlan.actions" :key="action.order" class="action-item">
            <el-tag size="small" type="primary">{{ action.cycle }}</el-tag><span>{{ action.title }}</span><el-tag size="small" effect="plain">{{ action.status }}</el-tag>
          </div>
        </div>
      </template>
      <el-empty v-else description="暂时无法生成成长计划" :image-size="70" />
    </div>

    <!-- 最近通过的申报 -->
    <div class="card mt-16">
      <div class="card-title">
        最近通过的加分申报
        <router-link to="/my-applications">查看全部 →</router-link>
      </div>
      <el-table :data="data.recentApproved || []" stripe style="width: 100%">
        <el-table-column prop="module.name" label="模块" width="140" />
        <el-table-column prop="title" label="申报项目" />
        <el-table-column prop="finalScore" label="分值" width="80">
          <template #default="{row}"><el-tag type="success" effect="dark">+{{ row.finalScore }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="approvedAt" label="通过时间" width="180">
          <template #default="{row}">{{ formatTime(row.approvedAt) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!data.recentApproved?.length" description="暂无通过的申报记录" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import * as echarts from 'echarts';
import BaseChart from '@/components/BaseChart.vue';
import dayjs from 'dayjs';
import { getStudentDashboard } from '@/api/stats';
import { getMySemesters } from '@/api/applications';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { DataBoard, Trophy, Coin, Clock, Rank, MagicStick } from '@element-plus/icons-vue';
import { getGrowthPlan } from '@/api/ai-analysis';

const userStore = useUserStore();
const now = dayjs();
const curAcademicYear = now.month() >= 8 ? `${now.year()}-${now.year()+1}` : `${now.year()-1}-${now.year()}`;
const curSemester = now.month() >= 8 || now.month() <= 0 ? 'first' : 'second';
const data = ref({ totalScore: '0.00', annualTotal: '0.00', appCount: 0, pendingCount: 0, classRank: null, classTotal: 0, categoryData: [], trend: [], recentApproved: [] });
const loading = ref(false);
const growthLoading = ref(false);
const growthPlan = ref(null);

// 学期列表从后端动态获取（value用 semesterId，避免不同学期配置但学年+学期相同导致option值重复）
const semesterList = ref([]);
const selectedSemester = ref(null); // 存 semesterId

const loadSemesters = async () => {
  try {
    const list = await getMySemesters();
    const arr = Array.isArray(list) ? list : (list?.list || []);
    const SEM_MAP = { first: '1', second: '2', '1': '1', '2': '2' };
    semesterList.value = arr.map(s => ({
      label: s.name || `${s.academicYear} 第${SEM_MAP[s.semester] || s.semester}学期`,
      value: Number(s.id),
      academicYear: s.academicYear,
      semester: s.semester
    }));
    // 默认选中：如果当前(学年,学期)匹配列表中的某一项，就选它，否则选第一个
    if (semesterList.value.length > 0) {
      const hit = semesterList.value.find(s => s.academicYear === curAcademicYear && s.semester === curSemester);
      selectedSemester.value = hit ? hit.value : semesterList.value[0].value;
    }
  } catch (e) {
    // 降级：使用当前学年学期的空列表
    semesterList.value = [];
    selectedSemester.value = null;
  }
};

const beatPercent = computed(() => {
  if (!data.value.classRank || !data.value.classTotal) return '--';
  const b = (1 - data.value.classRank / data.value.classTotal) * 100;
  return b < 0 ? 0 : b.toFixed(0);
});

const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];

const pieOption = computed(() => {
  const d = data.value.categoryData || [];
  if (d.length === 0) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}分 ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center', textStyle: { fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['45%', '72%'], center: ['35%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data: d.map((x, i) => ({ ...x, itemStyle: { color: COLORS[i % COLORS.length] } }))
    }]
  };
});

const lineOption = computed(() => {
  const d = data.value.trend || [];
  if (!d.some(x => Number(x.score) > 0)) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: d.map(x => x.month), axisLine: { lineStyle: { color: '#ebeef5' } } },
    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } } },
    series: [{
      name: '加分', type: 'line', smooth: true, symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 3, color: '#409EFF' },
      itemStyle: { color: '#409EFF', borderColor: '#fff', borderWidth: 2 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(64,158,255,0.3)' },
          { offset: 1, color: 'rgba(64,158,255,0.02)' }
        ])
      },
      data: d.map(x => Number(x.score))
    }]
  };
});

const load = async () => {
  loading.value = true;
  growthLoading.value = true;
  try {
    const params = {};
    if (selectedSemester.value) {
      params.semesterId = selectedSemester.value;
    } else {
      params.academicYear = curAcademicYear;
      params.semester = curSemester;
    }
    const [dashboardResult, planResult] = await Promise.allSettled([getStudentDashboard(params), getGrowthPlan(params)]);
    if (dashboardResult.status === 'fulfilled') data.value = dashboardResult.value;
    if (planResult.status === 'fulfilled') growthPlan.value = planResult.value;
  } catch (e) {
    ElMessage.warning('加载统计数据失败');
  } finally {
    loading.value = false;
    growthLoading.value = false;
  }
};

const formatTime = (t) => dayjs(t).format('YYYY-MM-DD HH:mm');
const onPieClick = (p) => ElMessage.info(`点击了 ${p.name}`);

onMounted(async () => {
  await loadSemesters();
  await load();
});
</script>

<style scoped>
.filter-bar { display: flex; gap: 12px; align-items: center; }
.mt-16 { margin-top: 16px; }
.growth-card .card-title { display:flex; align-items:center; gap:12px; }
.growth-card .card-title > span { display:flex; align-items:center; gap:6px; }
.growth-card .card-title a { margin-left:auto; color:#409EFF; font-size:13px; }
.goal-row { margin:12px 0; }
.goal-item { display:flex; flex-direction:column; gap:5px; min-height:76px; padding:12px; background:#f7fbff; border:1px solid #e6f0fa; border-radius:10px; }
.goal-item strong { color:#303133; font-size:14px; }
.goal-item span { color:#409EFF; font-size:13px; }
.goal-item small { color:#909399; font-size:12px; }
.action-list { display:flex; flex-direction:column; gap:8px; }
.action-item { display:flex; align-items:center; gap:10px; padding:9px 10px; background:#fafafa; border-radius:8px; color:#606266; font-size:13px; }
.action-item span { flex:1; }
</style>
