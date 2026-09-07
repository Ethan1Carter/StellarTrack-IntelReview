<template>
  <div>
    <h2 class="page-title"><el-icon><MagicStick /></el-icon> AI智能分析 - 班级</h2>

    <div class="card mb-16" style="padding:12px 16px;">
      <el-select v-model="filters.classId" placeholder="选择班级" style="width:200px" @change="load" v-if="classOptions.length">
        <el-option v-for="c in classOptions" :key="c.id" :label="c.name" :value="c.id" />
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
      <!-- AI 洞察 -->
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

      <!-- 统计 -->
      <el-row :gutter="16" class="mb-16">
        <el-col :xs="12" :sm="6"><div class="stat-card blue"><div class="label">学生人数</div><div class="value">{{ data.studentCount }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card green"><div class="label">平均分</div><div class="value">{{ data.avgScore }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card orange"><div class="label">通过申报</div><div class="value">{{ data.totalApproved }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card red"><div class="label">通过率</div><div class="value">{{ data.passRate }}</div></div></el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">分数分布</div>
            <BaseChart v-if="distOption" :option="distOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">模块参与度</div>
            <BaseChart v-if="moduleOption" :option="moduleOption" height="300px" />
            <el-empty v-else />
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="16" class="mt-16">
        <el-col :xs="24" :md="12">
          <div class="card"><div class="card-title">TOP10 高分学生</div>
            <el-table :data="data.topStudents || []" stripe>
              <el-table-column prop="rank" label="排名" width="80" />
              <el-table-column prop="name" label="姓名" />
              <el-table-column prop="score" label="分数" width="100" />
            </el-table>
          </div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="card">
            <div class="card-title">
              需关注学生（&lt;60分）
              <el-tag v-if="data.atRiskStudents?.length" type="danger" size="small">{{ data.atRiskStudents.length }}人</el-tag>
            </div>
            <el-table :data="data.atRiskStudents || []" stripe>
              <el-table-column prop="name" label="姓名" />
              <el-table-column prop="studentNo" label="学号" />
              <el-table-column prop="score" label="分数" width="100" />
            </el-table>
            <el-empty v-if="!data.atRiskStudents?.length" description="暂无需关注学生" />
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import BaseChart from '@/components/BaseChart.vue';
import { getClassAnalysis } from '@/api/ai-analysis';
import { getClassList } from '@/api/classes';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { MagicStick, Refresh } from '@element-plus/icons-vue';

const userStore = useUserStore();
const loading = ref(false);
const data = ref({ studentCount: 0, avgScore: '0.00', totalApproved: 0, passRate: '0%', scoreDistribution: [], moduleParticipation: [], topStudents: [], atRiskStudents: [], insights: [] });
const classOptions = ref([]);

const now = new Date();
const yearOptions = [`${now.getFullYear()-1}-${now.getFullYear()}`, `${now.getFullYear()}-${now.getFullYear()+1}`];
const filters = ref({ classId: '', academicYear: now.getMonth() >= 8 ? yearOptions[1] : yearOptions[0], semester: now.getMonth() >= 8 ? 'first' : 'second' });

const distOption = computed(() => {
  const d = data.value.scoreDistribution || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name)}, yAxis:{type:'value'}, series:[{type:'bar',data:d.map(x=>x.value),itemStyle:{color:'#409EFF'}}] };
});
const moduleOption = computed(() => {
  const d = data.value.moduleParticipation || [];
  if (!d.length) return null;
  return { tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d.map(x=>x.name),axisLabel:{rotate:30}}, yAxis:{type:'value'}, series:[{type:'bar',data:d.map(x=>x.count),itemStyle:{color:'#67C23A'}}] };
});

const load = async () => {
  loading.value = true;
  try { data.value = await getClassAnalysis(filters.value); } catch (e) { ElMessage.error('加载失败'); } finally { loading.value = false; }
};

const loadClasses = async () => {
  if (userStore.role === 'counselor') {
    try { const r = await getClassList({ pageSize: 100 }); classOptions.value = r?.list || []; if (classOptions.value[0]) filters.value.classId = classOptions.value[0].id; } catch (_) {}
  }
};

onMounted(async () => { await loadClasses(); load(); });
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
