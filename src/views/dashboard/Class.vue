<template>
  <div>
    <h2 class="page-title"><el-icon><DataAnalysis /></el-icon> 班级数据看板</h2>
    <el-select v-model="currentClassId" class="mb-16" style="width: 260px;" placeholder="选择班级" @change="load">
      <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
    </el-select>

    <el-row :gutter="16">
      <el-col :xs="12" :sm="6"><div class="stat-card blue">
        <div class="flex-between"><span class="label">班级人数</span><div class="icon"><User /></div></div>
        <div class="value">{{ data.studentCount }}</div><div class="extra">参评学生</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card green">
        <div class="flex-between"><span class="label">班级平均分</span><div class="icon"><TrendCharts /></div></div>
        <div class="value">{{ data.avgScore }}</div><div class="extra">本学期</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card orange">
        <div class="flex-between"><span class="label">通过申报</span><div class="icon"><CircleCheck /></div></div>
        <div class="value">{{ data.totalApproved }}</div><div class="extra">通过率 {{ data.passRate }}</div>
      </div></el-col>
      <el-col :xs="12" :sm="6"><div class="stat-card red">
        <div class="flex-between"><span class="label">最高分</span><div class="icon"><Trophy /></div></div>
        <div class="value">{{ topScore }}</div><div class="extra">{{ data.topStudents?.[0]?.name || '--' }}</div>
      </div></el-col>
    </el-row>

    <el-row :gutter="16" class="mt-16">
      <el-col :xs="24" :md="12"><div class="card">
        <div class="card-title">班级分数分布 <el-tag type="primary" size="small">柱状图</el-tag></div>
        <BaseChart v-if="distOption" :option="distOption" height="300px" />
        <el-empty v-else description="暂无数据" />
      </div></el-col>
      <el-col :xs="24" :md="12"><div class="card">
        <div class="card-title">各模块参与人数 <el-tag type="success" size="small">柱状图</el-tag></div>
        <BaseChart v-if="moduleOption" :option="moduleOption" height="300px" />
        <el-empty v-else description="暂无数据" />
      </div></el-col>
    </el-row>

    <div class="card mt-16">
      <div class="card-title">班级高分榜 TOP10</div>
      <el-table :data="data.topStudents || []" stripe>
        <el-table-column label="排名" width="80" align="center">
          <template #default="{ $index }">
            <el-tag :type="$index<3 ? 'danger' : 'info'" :effect="$index<3 ? 'dark' : 'plain'">{{ $index + 1 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" />
        <el-table-column prop="score" label="总分" />
      </el-table>
      <el-empty v-if="!data.topStudents?.length" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getClassList } from '@/api/college';
import { getClassDashboard } from '@/api/stats';
import { useUserStore } from '@/stores/user';
import { DataAnalysis, User, TrendCharts, Trophy, CircleCheck } from '@element-plus/icons-vue';

const userStore = useUserStore();
const classes = ref([]);
const currentClassId = ref(null);
const data = ref({});
const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399'];

const topScore = computed(() => data.value.topStudents?.[0]?.score || '--');

const distOption = computed(() => {
  const d = data.value.scoreDistribution || [];
  if (!d.length || !d.some(x => x.value > 0)) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 10, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: d.map(x => x.name + '分') },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar', data: d.map(x => x.value), barWidth: '50%',
      itemStyle: {
        color: (p) => ['#F56C6C', '#E6A23C', '#67C23A', '#409EFF', '#722ed1'][p.dataIndex],
        borderRadius: [8, 8, 0, 0]
      }
    }]
  };
});

const moduleOption = computed(() => {
  const d = data.value.moduleParticipation || [];
  if (!d.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 90, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: d.map(x => x.name) },
    series: [{ type: 'bar', data: d.map(x => x.value), itemStyle: { color: '#67C23A', borderRadius: [0, 6, 6, 0] }, barWidth: '50%' }]
  };
});

const loadClasses = async () => {
  try {
    const r = await getClassList({ pageSize: 100 });
    classes.value = r?.list || [];
    if (userStore.role === 'counselor' && classes.value[0]) currentClassId.value = classes.value[0].id;
    else if (classes.value[0]) currentClassId.value = classes.value[0].id;
    load();
  } catch (_) {}
};
const load = async () => {
  try {
    data.value = await getClassDashboard({ classId: currentClassId.value });
  } catch (_) {}
};
onMounted(loadClasses);
</script>
