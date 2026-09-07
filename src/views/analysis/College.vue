<template>
  <div>
    <h2 class="page-title"><el-icon><MagicStick /></el-icon> AI智能分析 - 院系</h2>

    <div class="card mb-16" style="padding:12px 16px;">
      <el-select v-if="userStore.role==='school_admin' || userStore.role==='super_admin'" v-model="filters.collegeId" placeholder="选择院系" style="width:200px" @change="load">
        <el-option v-for="c in colleges" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-select v-model="filters.academicYear" placeholder="学年" style="width:160px; margin-left:10px;" @change="load">
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

      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">各班级平均分对比</div>
            <BaseChart v-if="barOption" :option="barOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">模块通过率</div>
            <BaseChart v-if="rateOption" :option="rateOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
      </el-row>

      <div class="card mt-16">
        <div class="card-title">TOP20 高分学生</div>
        <el-table :data="data.topStudents || []" stripe>
          <el-table-column prop="rank" label="排名" width="80" />
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="score" label="总分" width="120" />
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getCollegeAnalysis } from '@/api/ai-analysis';
import { listAllColleges } from '@/api/college';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { MagicStick, Refresh } from '@element-plus/icons-vue';

const userStore = useUserStore();
const loading = ref(false);
const data = ref({ classCount: 0, classAverageCompare: [], topStudents: [], modulePassRates: [], insights: [] });
const colleges = ref([]);

const now = new Date();
const yearOptions = [`${now.getFullYear()-1}-${now.getFullYear()}`, `${now.getFullYear()}-${now.getFullYear()+1}`];
const filters = ref({ collegeId: '', academicYear: now.getMonth() >= 8 ? yearOptions[1] : yearOptions[0], semester: now.getMonth() >= 8 ? 'first' : 'second' });

const barOption = computed(() => {
  const d = data.value.classAverageCompare || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name),axisLabel:{rotate:30}}, yAxis:{type:'value'}, series:[{type:'bar',data:d.map(x=>x.value),itemStyle:{color:'#409EFF'}}] };
});
const rateOption = computed(() => {
  const d = data.value.modulePassRates || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name),axisLabel:{rotate:30}}, yAxis:{type:'value',max:100,axisLabel:{formatter:'{value}%'}}, series:[{type:'bar',data:d.map(x=>x.rate),itemStyle:{color:'#67C23A'}}] };
});

const load = async () => {
  loading.value = true;
  try { data.value = await getCollegeAnalysis(filters.value); } catch (e) { ElMessage.error('加载失败'); } finally { loading.value = false; }
};

onMounted(async () => {
  if (userStore.role === 'school_admin' || userStore.role === 'super_admin') {
    try { colleges.value = (await listAllColleges()) || []; } catch (_) {}
  }
  load();
});
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
</style>
