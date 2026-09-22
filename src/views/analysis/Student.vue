<template>
  <div>
    <h2 class="page-title"><el-icon><MagicStick /></el-icon> AI智能分析</h2>

    <!-- 学年学期选择 -->
    <div class="card mb-16" style="padding:12px 16px;">
      <el-select v-model="filters.academicYear" placeholder="学年" style="width:160px" @change="load">
        <el-option v-for="y in yearOptions" :key="y" :label="y + ' 学年'" :value="y" />
      </el-select>
      <el-select v-model="filters.semester" placeholder="学期" style="width:120px; margin-left:10px;" @change="load">
        <el-option label="第一学期" value="first" />
        <el-option label="第二学期" value="second" />
      </el-select>
      <el-button type="primary" style="margin-left:10px;" @click="load"><Refresh /> 刷新分析</el-button>
    </div>

    <div v-loading="loading">
      <!-- AI 洞察卡片 -->
      <el-row :gutter="16" class="mb-16">
        <el-col :xs="24" :sm="12" v-for="(ins, i) in data.insights" :key="i">
          <div class="insight-card" :class="ins.type">
            <div class="insight-icon"><el-icon><component :is="ins.icon" /></el-icon></div>
            <div class="insight-body">
              <div class="insight-title">{{ ins.title }}</div>
              <div class="insight-text">{{ ins.text }}</div>
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- 统计卡片 -->
      <el-row :gutter="16" class="mb-16">
        <el-col :xs="12" :sm="6"><div class="stat-card blue">
          <div class="label">我的总分</div>
          <div class="value">{{ data.totalScore }}</div>
        </div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card green">
          <div class="label">班级平均</div>
          <div class="value">{{ data.classAvg }}</div>
        </div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card orange">
          <div class="label">班级排名</div>
          <div class="value">{{ data.classRank ?? '--' }} / {{ data.classTotal }}</div>
        </div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card red">
          <div class="label">申报数</div>
          <div class="value">{{ data.appCount }}</div>
        </div></el-col>
      </el-row>

      <!-- 图表 -->
      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <div class="card">
            <div class="card-title">各维度加分占比</div>
            <BaseChart v-if="pieOption" :option="pieOption" height="300px" />
            <el-empty v-else description="暂无数据" />
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card">
            <div class="card-title">月度加分趋势</div>
            <BaseChart v-if="lineOption" :option="lineOption" height="300px" />
            <el-empty v-else description="暂无数据" />
          </div>
        </el-col>
      </el-row>

      <!-- 班级同学对比 -->
      <div class="card mt-16">
        <div class="card-title">班级同学对比</div>
        <el-table :data="data.peerComparison || []" stripe style="width:100%">
          <el-table-column prop="rank" label="排名" width="80" />
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="score" label="总分" width="120" />
          <el-table-column label="" width="80">
            <template #default="{row}"><el-tag v-if="row.isMe" type="success" size="small">我</el-tag></template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import * as echarts from 'echarts';
import BaseChart from '@/components/BaseChart.vue';
import { getStudentAnalysis } from '@/api/ai-analysis';
import { ElMessage } from 'element-plus';
import { MagicStick, Refresh } from '@element-plus/icons-vue';

const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];
const loading = ref(false);
const data = ref({ totalScore: '0.00', classAvg: '0.00', classRank: null, classTotal: 0, appCount: 0, categoryData: [], trend: [], peerComparison: [], insights: [] });

const now = new Date();
const yearOptions = [`${now.getFullYear()-1}-${now.getFullYear()}`, `${now.getFullYear()}-${now.getFullYear()+1}`];
const filters = ref({ academicYear: now.getMonth() >= 8 ? yearOptions[1] : yearOptions[0], semester: now.getMonth() >= 8 ? 'first' : 'second' });

const pieOption = computed(() => {
  const d = data.value.categoryData || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}分 ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center' },
    series: [{ type: 'pie', radius: ['40%', '70%'], center: ['35%', '50%'], data: d.map((x, i) => ({ ...x, itemStyle: { color: COLORS[i % COLORS.length] } })) }]
  };
});

const lineOption = computed(() => {
  const d = data.value.trend || [];
  if (!d.some(x => Number(x.score) > 0)) return null;
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: d.map(x => x.month) },
    yAxis: { type: 'value' },
    series: [{ name: '加分', type: 'line', smooth: true, areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(64,158,255,0.3)'},{offset:1,color:'rgba(64,158,255,0.02)'}]) }, data: d.map(x => Number(x.score)) }]
  };
});

const load = async () => {
  loading.value = true;
  try { data.value = await getStudentAnalysis(filters.value); } catch (e) { ElMessage.error('加载失败'); } finally { loading.value = false; }
};
onMounted(load);
</script>

<style lang="scss" scoped>
.insight-card { display:flex; gap:12px; padding:14px 16px; border-radius:10px; margin-bottom:12px; border-left:4px solid #ddd;
  &.positive { background:#f0f9eb; border-left-color:#67C23A; }
  &.warning { background:#fdf6ec; border-left-color:#E6A23C; }
  &.info { background:#ecf5ff; border-left-color:#409EFF; }
  &.suggestion { background:#fafafa; border-left-color:#909399; }
  .insight-icon { font-size:22px; padding-top:2px; }
  .insight-title { font-weight:600; font-size:14px; margin-bottom:4px; }
  .insight-text { font-size:13px; color:#606266; line-height:1.6; }
}
.stat-card { padding:16px; border-radius:10px; color:#fff; margin-bottom:12px;
  .label { font-size:13px; opacity:0.9; } .value { font-size:28px; font-weight:700; margin-top:4px; }
  &.blue { background:linear-gradient(135deg,#409EFF,#36cfc9); }
  &.green { background:linear-gradient(135deg,#67C23A,#95de64); }
  &.orange { background:linear-gradient(135deg,#E6A23C,#ffc53d); }
  &.red { background:linear-gradient(135deg,#F56C6C,#ff7875); }
}
</style>
