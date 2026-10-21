<template>
  <div class="class-honors-page">
    <WorkspaceHero eyebrow="CLASS HONORS" title="班级荣誉" description="查看所带班级学生已认定的获奖荣誉，并按学生、等级和班级快速汇总。">
      <template #actions><el-button :loading="exporting" :disabled="loading" @click="exportExcel"><el-icon><Download /></el-icon> 导出 Excel</el-button></template>
    </WorkspaceHero>

    <section class="filter-panel card">
      <div class="filter-copy"><span>统计范围</span><strong>选择班级、学年或关键词</strong></div>
      <div class="filters">
        <el-select v-model="filters.classId" clearable placeholder="全部负责班级" @change="loadData"><el-option v-for="item in data.classes" :key="item.id" :label="item.name" :value="item.id" /></el-select>
        <el-select v-model="filters.academicYear" clearable placeholder="全部学年" @change="loadData"><el-option v-for="year in academicYears" :key="year" :label="`${year} 学年`" :value="year" /></el-select>
        <el-input v-model="filters.keyword" clearable placeholder="学生、荣誉或证书编号" @keyup.enter="loadData" @clear="loadData"><template #append><el-button :icon="Search" aria-label="查询" @click="loadData" /></template></el-input>
        <el-button :icon="Refresh" plain @click="resetFilters">重置</el-button>
      </div>
    </section>

    <section class="overview-grid" v-loading="loading">
      <div class="hero-stat"><div class="hero-stat-icon"><el-icon><Medal /></el-icon></div><div><span>已认定荣誉</span><strong>{{ data.total }}<small>项</small></strong></div><p>仅统计已通过或已终审的获奖申报</p></div>
      <div class="plain-stat"><span>获奖学生</span><strong>{{ data.coveredStudents }}</strong><small>名学生</small></div>
      <div class="plain-stat"><span>涉及班级</span><strong>{{ data.activeClassCount }}</strong><small>个班级</small></div>
      <div class="plain-stat"><span>证书材料</span><strong>{{ certificateCount }}</strong><small>份材料</small></div>
    </section>

    <section class="honor-workspace card" v-loading="loading">
      <div class="section-heading">
        <div><span>HONOR REGISTER</span><h2>学生荣誉明细 <em>{{ data.students.length }} 人</em></h2></div>
        <div class="level-summary"><span v-for="level in levels" :key="level.key" :style="{ '--level-color': level.color }"><i></i>{{ level.label }} <b>{{ data.levelCounts[level.key] || 0 }}</b></span></div>
      </div>
      <el-table ref="studentTableRef" :data="data.students" stripe class="student-table" empty-text="当前范围内暂无已认定的获奖荣誉">
        <el-table-column type="expand" width="50">
          <template #default="{ row }">
            <div class="honor-detail">
              <div class="detail-caption">{{ row.name }}的荣誉记录</div>
              <el-table :data="row.honors" size="small" border class="honor-detail-table">
                <el-table-column prop="title" label="荣誉名称" min-width="200" show-overflow-tooltip />
                <el-table-column label="等级" width="112"><template #default="{ row: honor }"><el-tag :style="levelStyle(honor.awardLevel)" effect="plain">{{ levelText(honor) }}</el-tag></template></el-table-column>
                <el-table-column label="模块" width="150"><template #default="{ row: honor }">{{ honor.module?.name || '-' }}</template></el-table-column>
                <el-table-column prop="eventDate" label="获奖日期" width="118" />
                <el-table-column prop="certificateNo" label="证书编号" min-width="150" show-overflow-tooltip />
                <el-table-column label="认定分值" width="100" align="center"><template #default="{ row: honor }">{{ formatScore(honor.finalScore) }}</template></el-table-column>
                <el-table-column label="获奖证书" width="150" align="center">
                  <template #default="{ row: honor }">
                    <el-popover v-if="proofs(honor).length" placement="left" :width="280" trigger="click">
                      <template #reference><el-button link type="primary"><el-icon><Picture /></el-icon> 证书 {{ proofs(honor).length }}</el-button></template>
                      <div class="certificate-list"><el-image v-for="url in proofs(honor)" :key="url" :src="url" fit="cover" :preview-src-list="proofs(honor)" preview-teleported /></div>
                    </el-popover>
                    <span v-else class="muted">未上传</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="studentNo" label="学号" width="160" />
        <el-table-column prop="name" label="学生姓名" width="130" />
        <el-table-column prop="className" label="班级" min-width="160" />
        <el-table-column prop="honorCount" label="荣誉数量" width="120" align="center"><template #default="{ row }"><b class="honor-count">{{ row.honorCount }}</b></template></el-table-column>
        <el-table-column prop="totalScore" label="认定总分" width="130" align="center"><template #default="{ row }">{{ formatScore(row.totalScore) }}</template></el-table-column>
        <el-table-column label="查看明细" width="120" align="center">
          <template #default="{ row }">
            <button type="button" class="expand-hint" @click="toggleStudentRow(row)">
              {{ isStudentExpanded(row) ? '收起' : '展开' }}
            </button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Download, Medal, Picture, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { exportCounselorHonors, getCounselorHonors } from '@/api/applications';

const levels = [
  { key: 'international', label: '国际级', color: '#7C3AED', soft: '#F3E8FF' }, { key: 'national', label: '国家级', color: '#D97706', soft: '#FFF4DE' },
  { key: 'provincial', label: '省部级', color: '#2563EB', soft: '#EAF2FF' }, { key: 'school', label: '市校级', color: '#059669', soft: '#E7F8F1' },
  { key: 'college', label: '院系级', color: '#DB2777', soft: '#FCEAF3' }, { key: 'other', label: '其他', color: '#64748B', soft: '#F1F5F9' }
];
const filters = reactive({ classId: '', academicYear: '', keyword: '' });
const loading = ref(false);
const exporting = ref(false);
const studentTableRef = ref(null);
const expandedStudents = ref(new Set());
const data = ref({ classes: [], total: 0, coveredStudents: 0, activeClassCount: 0, levelCounts: {}, students: [], honors: [] });
const academicYears = computed(() => [...new Set(data.value.honors.map(item => item.academicYear).filter(Boolean))].sort().reverse());
const normalizeProofs = value => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
  } catch (_) { /* 兼容逗号分隔的历史数据 */ }
  return value.split(',').map(item => item.trim()).filter(Boolean);
};
const proofs = honor => normalizeProofs(honor?.attachPhotos ?? honor?.proofUrl);
const certificateCount = computed(() => data.value.honors.reduce((total, honor) => total + proofs(honor).length, 0));
const getLevel = key => levels.find(item => item.key === key) || levels[levels.length - 1];
const levelText = honor => honor.awardLevel === 'other' && honor.otherDescription ? `其他：${honor.otherDescription}` : getLevel(honor.awardLevel).label;
const levelStyle = key => { const level = getLevel(key); return { color: level.color, borderColor: `${level.color}55`, background: level.soft }; };
const formatScore = value => Number(value || 0).toFixed(2).replace(/\.00$/, '');
const requestParams = () => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value != null));
const studentKey = row => row?.studentId ?? row?.studentNo ?? row?.name;
const isStudentExpanded = row => expandedStudents.value.has(studentKey(row));
function toggleStudentRow(row) {
  studentTableRef.value?.toggleRowExpansion(row);
  const key = studentKey(row);
  const next = new Set(expandedStudents.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expandedStudents.value = next;
}
async function loadData() {
  loading.value = true;
  try {
    const result = await getCounselorHonors(requestParams());
    data.value = { classes: result?.classes || [], total: Number(result?.total || 0), coveredStudents: Number(result?.coveredStudents || 0), activeClassCount: Number(result?.activeClassCount || 0), levelCounts: result?.levelCounts || {}, students: result?.students || [], honors: result?.honors || [] };
    expandedStudents.value = new Set();
  } finally { loading.value = false; }
}
async function resetFilters() { filters.classId = ''; filters.academicYear = ''; filters.keyword = ''; await loadData(); }
async function exportExcel() {
  exporting.value = true;
  try {
    const blob = await exportCounselorHonors(requestParams());
    if (!blob || blob.size === 0) throw new Error('未收到导出文件');
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `班级荣誉汇总_${filters.academicYear || '全部学年'}.xlsx`;
    document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor); URL.revokeObjectURL(url);
    ElMessage.success('班级荣誉已导出');
  } catch (error) { ElMessage.error(error?.message || '导出失败'); } finally { exporting.value = false; }
}
onMounted(loadData);
</script>

<style lang="scss" scoped>
.class-honors-page { padding-bottom: 12px; }
.filter-panel { margin-top: 18px; padding: 16px 20px; display: flex; align-items: center; gap: 20px; }.filter-copy { min-width: 170px; display: grid; gap: 3px; }.filter-copy span, .section-heading > div > span { color: #64748B; font-size: 11px; }.filter-copy strong { color: #1E293B; font-size: 14px; }.filters { display: flex; flex: 1; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }.filters :deep(.el-select) { width: 180px; }.filters :deep(.el-input) { width: 260px; }
.overview-grid { margin-top: 14px; display: grid; grid-template-columns: minmax(240px, 1.35fr) repeat(3, minmax(145px, .75fr)); gap: 14px; }.hero-stat { min-height: 116px; padding: 20px; display: grid; grid-template-columns: 46px 1fr; align-items: center; gap: 13px; color: #fff; border-radius: 8px; background: linear-gradient(125deg, #1E3A5F, #0F766E); box-shadow: 0 12px 24px rgba(15, 118, 110, .16); }.hero-stat-icon { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 8px; background: rgba(255,255,255,.16); font-size: 24px; }.hero-stat span { display: block; color: rgba(255,255,255,.76); font-size: 13px; }.hero-stat strong { display: block; margin-top: 3px; font-size: 30px; line-height: 1; }.hero-stat strong small { margin-left: 4px; font-size: 13px; font-weight: 500; }.hero-stat p { grid-column: 1 / -1; margin: 1px 0 0; color: rgba(255,255,255,.7); font-size: 11px; }.plain-stat { min-height: 116px; padding: 20px; display: flex; flex-direction: column; justify-content: center; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; }.plain-stat span { color: #64748B; font-size: 13px; }.plain-stat strong { margin-top: 5px; color: #1E293B; font-size: 28px; line-height: 1; }.plain-stat small { margin-top: 6px; color: #94A3B8; font-size: 12px; }
.honor-workspace { margin-top: 18px; padding-top: 0; overflow: hidden; }.section-heading { min-height: 76px; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid #E8EEF6; }.section-heading h2 { margin: 3px 0 0; color: #17233B; font-size: 17px; }.section-heading h2 em { margin-left: 5px; padding: 2px 7px; border-radius: 4px; color: #64748B; background: #F1F5F9; font-size: 12px; font-style: normal; font-weight: 500; }.level-summary { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px 14px; }.level-summary span { display: inline-flex; align-items: center; gap: 5px; color: #64748B; font-size: 12px; }.level-summary i { width: 7px; height: 7px; border-radius: 50%; background: var(--level-color); }.level-summary b { color: #1E293B; }.student-table { width: 100%; }.honor-detail { padding: 12px 20px 20px 68px; background: #F8FAFC; }.detail-caption { margin-bottom: 10px; color: #334155; font-size: 13px; font-weight: 700; }.honor-detail-table { width: 100%; }.certificate-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }.certificate-list :deep(.el-image) { width: 78px; height: 78px; border-radius: 5px; }.honor-count { color: #0F766E; font-size: 16px; }.expand-hint, .muted { color: #94A3B8; font-size: 12px; }
@media (max-width: 960px) { .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.hero-stat { grid-column: span 2; }.filter-panel { align-items: flex-start; flex-direction: column; }.filters { justify-content: flex-start; }.level-summary { justify-content: flex-start; } } @media (max-width: 640px) { .overview-grid { grid-template-columns: 1fr; }.hero-stat { grid-column: auto; }.filters, .filters :deep(.el-select), .filters :deep(.el-input), .filters :deep(.el-button) { width: 100%; }.section-heading { align-items: flex-start; flex-direction: column; }.honor-detail { padding: 12px; } }
</style>
