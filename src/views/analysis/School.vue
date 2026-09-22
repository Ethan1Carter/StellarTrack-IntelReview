<template>
  <div>
    <h2 class="page-title"><el-icon><MagicStick /></el-icon> AI智能分析 - 全校</h2>

    <div class="card mb-16" style="padding:12px 16px;">
      <el-select v-model="filters.academicYear" placeholder="学年" style="width:160px" @change="load">
        <el-option v-for="y in yearOptions" :key="y" :label="y + ' 学年'" :value="y" />
      </el-select>
      <el-select v-model="filters.semester" placeholder="学期" style="width:120px; margin-left:10px;" @change="load">
        <el-option label="第一学期" value="first" />
        <el-option label="第二学期" value="second" />
      </el-select>
      <el-button type="primary" style="margin-left:10px;" @click="load"><Refresh /> 刷新</el-button>
    </div>

    <div v-loading="loading">
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

      <el-row :gutter="16" class="mb-16">
        <el-col :xs="12" :sm="8"><div class="stat-card blue"><div class="label">院系数</div><div class="value">{{ data.totalColleges }}</div></div></el-col>
        <el-col :xs="12" :sm="8"><div class="stat-card green"><div class="label">参评学生</div><div class="value">{{ data.totalStudents }}</div></div></el-col>
        <el-col :xs="12" :sm="8"><div class="stat-card orange"><div class="label">申报模块</div><div class="value">{{ data.moduleStats?.length || 0 }}</div></div></el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">各院系平均分对比</div>
            <BaseChart v-if="collegeOption" :option="collegeOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">全校分数分布</div>
            <BaseChart v-if="distOption" :option="distOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="mt-16">
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">月度申报趋势</div>
            <BaseChart v-if="trendOption" :option="trendOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">各模块申报量</div>
            <BaseChart v-if="moduleOption" :option="moduleOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getSchoolAnalysis } from '@/api/ai-analysis';
import { ElMessage } from 'element-plus';
import { MagicStick, Refresh } from '@element-plus/icons-vue';

const loading = ref(false);
const data = ref({ totalColleges: 0, totalStudents: 0, collegeCompare: [], monthlyTrend: [], moduleStats: [], scoreDistribution: [], insights: [] });

const now = new Date();
const yearOptions = [`${now.getFullYear()-1}-${now.getFullYear()}`, `${now.getFullYear()}-${now.getFullYear()+1}`];
const filters = ref({ academicYear: now.getMonth() >= 8 ? yearOptions[1] : yearOptions[0], semester: now.getMonth() >= 8 ? 'first' : 'second' });

const collegeOption = computed(() => {
  const d = data.value.collegeCompare || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name),axisLabel:{rotate:30}}, yAxis:{type:'value'}, series:[{type:'bar',data:d.map(x=>x.value),itemStyle:{color:'#409EFF'}}] };
});
const distOption = computed(() => {
  const d = data.value.scoreDistribution || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name)}, yAxis:{type:'value'}, series:[{type:'bar',data:d.map(x=>x.value),itemStyle:{color:'#67C23A'}}] };
});
const trendOption = computed(() => {
  const d = data.value.monthlyTrend || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.month)}, yAxis:{type:'value'}, series:[{type:'line',smooth:true,data:d.map(x=>x.count),areaStyle:{opacity:0.2}}] };
});
const moduleOption = computed(() => {
  const d = data.value.moduleStats || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'item'}, series:[{type:'pie',radius:['40%','70%'],data:d}] };
});

const load = async () => {
  loading.value = true;
  try { data.value = await getSchoolAnalysis(filters.value); } catch (e) { ElMessage.error('加载失败'); } finally { loading.value = false; }
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
}
</style>
