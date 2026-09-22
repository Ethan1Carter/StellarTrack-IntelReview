<template>
  <div>
    <h2 class="page-title"><el-icon><Histogram /></el-icon> 院系数据看板</h2>
    <el-row :gutter="16">
      <el-col :xs="12" :sm="6"><div class="stat-card blue"><div class="flex-between"><span class="label">下辖班级</span><div class="icon"><OfficeBuilding /></div></div>
        <div class="value">{{ data.classCount ?? '--' }}</div><div class="extra">班级数量</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card green"><div class="flex-between"><span class="label">班级对比</span><div class="icon"><TrendCharts /></div></div>
        <div class="value">{{ classesCount }}</div><div class="extra">平均分对比分析</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card orange"><div class="flex-between"><span class="label">高分榜人数</span><div class="icon"><Cpu /></div></div>
        <div class="value">TOP20</div><div class="extra">本院系优秀学生</div></div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card red"><div class="flex-between"><span class="label">通过率分析</span><div class="icon"><CircleCheck /></div></div>
        <div class="value">{{ avgRate }}%</div><div class="extra">各模块平均通过率</div></div></el-col>
    </el-row>

    <el-row :gutter="16" class="mt-16">
      <el-col :xs="24" :md="14"><div class="card">
        <div class="card-title">各班级平均分对比</div>
        <BaseChart v-if="classCompareOption" :option="classCompareOption" height="340px" />
        <el-empty v-else />
      </div></el-col>
      <el-col :xs="24" :md="10"><div class="card">
        <div class="card-title">本院系高分榜 TOP20</div>
        <el-table :data="data.topStudents || []" size="small" stripe height="340">
          <el-table-column label="#" width="50" align="center"><template #default="{$index}">{{ $index+1 }}</template></el-table-column>
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="score" label="分数" width="80" align="right" />
        </el-table>
        <el-empty v-if="!data.topStudents?.length" />
      </div></el-col>
    </el-row>

    <div class="card mt-16">
      <div class="card-title">各模块申报通过率</div>
      <el-table :data="data.modulePassRates || []" stripe>
        <el-table-column prop="name" label="模块名称" />
        <el-table-column prop="total" label="申报总数" width="100" align="right" />
        <el-table-column prop="passed" label="通过数" width="100" align="right" />
        <el-table-column label="通过率" width="240">
          <template #default="{row}">
            <el-progress :percentage="row.rate" :status="row.rate>=80?'success':(row.rate>=50?'warning':'exception')" />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getCollegeDashboard } from '@/api/stats';
import { Histogram, OfficeBuilding, TrendCharts, CircleCheck, Cpu } from '@element-plus/icons-vue';

const data = ref({});
const classesCount = computed(() => (data.value.classAverageCompare || []).length);
const avgRate = computed(() => {
  const arr = data.value.modulePassRates || [];
  if (!arr.length) return '0';
  return (arr.reduce((s, x) => s + Number(x.rate || 0), 0) / arr.length).toFixed(1);
});

const classCompareOption = computed(() => {
  const d = data.value.classAverageCompare || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 60 },
    xAxis: { type: 'category', data: d.map(x => x.name), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '平均分' },
    series: [{
      type: 'bar', data: d.map(x => x.value), barWidth: '50%',
      itemStyle: {
        color: '#409EFF', borderRadius: [8, 8, 0, 0],
      },
      label: { show: true, position: 'top', fontSize: 12, color: '#409EFF', fontWeight: 600 }
    }]
  };
});

const load = async () => {
  try { data.value = await getCollegeDashboard(); } catch (_) {}
};
onMounted(load);
</script>
