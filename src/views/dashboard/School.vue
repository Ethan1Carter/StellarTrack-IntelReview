<template>
  <div>
    <h2 class="page-title"><el-icon><DataLine /></el-icon> 全校数据看板</h2>
    <el-row :gutter="16">
      <el-col :xs="12" :sm="6"><div class="stat-card blue"><div class="flex-between"><span class="label">院系数量</span><div class="icon"><School /></div></div>
        <div class="value">{{ data.totalColleges ?? '--' }}</div><div class="extra">全校</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card green"><div class="flex-between"><span class="label">覆盖学生</span><div class="icon"><UserFilled /></div></div>
        <div class="value">{{ totalStudents }}</div><div class="extra">参评人数估算</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card orange"><div class="flex-between"><span class="label">申报趋势</span><div class="icon"><TrendCharts /></div></div>
        <div class="value">{{ latestMonth }}</div><div class="extra">最新月度申报</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card red"><div class="flex-between"><span class="label">加分类别</span><div class="icon"><Collection /></div></div>
        <div class="value">{{ (data.moduleStats || []).length }}</div><div class="extra">已使用模块</div></div></el-col>
    </el-row>

    <el-row :gutter="16" class="mt-16">
      <el-col :xs="24" :md="14"><div class="card">
        <div class="card-title">各院系平均分对比</div>
        <BaseChart v-if="collegeOption" :option="collegeOption" height="340px" />
        <el-empty v-else />
      </div></el-col>
      <el-col :xs="24" :md="10"><div class="card">
        <div class="card-title">各模块申报量</div>
        <BaseChart v-if="moduleOption" :option="moduleOption" height="340px" />
        <el-empty v-else />
      </div></el-col>
    </el-row>

    <div class="card mt-16">
      <div class="card-title">全年各月申报量趋势</div>
      <BaseChart v-if="monthOption" :option="monthOption" height="300px" />
      <el-empty v-else />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getSchoolDashboard } from '@/api/stats';
import { DataLine, School, UserFilled, TrendCharts, Collection } from '@element-plus/icons-vue';

const data = ref({});

const totalStudents = computed(() => ((data.value.totalColleges || 0) * 8 * 30).toLocaleString());
const latestMonth = computed(() => {
  const d = data.value.monthlyTrend || [];
  const last = d[d.length - 1];
  return last ? `${last.count}件` : '--';
});
const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16'];

const collegeOption = computed(() => {
  const d = data.value.collegeCompare || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 50 },
    xAxis: { type: 'category', data: d.map(x => x.name) },
    yAxis: { type: 'value', name: '平均分' },
    series: [{
      type: 'bar', data: d.map(x => x.value), barWidth: '40%',
      itemStyle: {
        borderRadius: [8, 8, 0, 0],
        color: (p) => COLORS[p.dataIndex % COLORS.length]
      },
      label: { show: true, position: 'top' }
    }]
  };
});
const monthOption = computed(() => {
  const d = data.value.monthlyTrend || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: d.map(x => x.month), boundaryGap: false },
    yAxis: { type: 'value' },
    series: [{
      type: 'line', smooth: true, data: d.map(x => x.count), symbol: 'circle', symbolSize: 8,
      areaStyle: { color: 'rgba(103,194,58,0.2)' },
      lineStyle: { width: 3, color: '#67C23A' }, itemStyle: { color: '#67C23A' }
    }]
  };
});
const moduleOption = computed(() => {
  const d = data.value.moduleStats || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, type: 'scroll' },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '45%'],
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      data: d.map((x, i) => ({ ...x, itemStyle: { color: COLORS[i % COLORS.length] } }))
    }]
  };
});
onMounted(async () => { try { data.value = await getSchoolDashboard(); } catch (_) {} });
</script>
