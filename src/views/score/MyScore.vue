<template>
  <div class="my-score-page">
    <WorkspaceHero
      eyebrow="PERSONAL SCOREBOOK"
      title="我的成绩"
      description="查看本学期加分构成、年度累计与排名情况，报表审核通过后可导出正式成绩单。"
    >
      <template #actions>
        <el-tooltip :content="exportTip" placement="top">
          <el-button :disabled="!data.reportApproved" :loading="exporting" @click="doExport"><el-icon><Download /></el-icon> 导出成绩</el-button>
        </el-tooltip>
      </template>
    </WorkspaceHero>

    <div class="card filter-bar">
      <div class="filter-copy"><span>成绩范围</span><strong>选择需要查看的学期</strong></div>
      <el-select v-model="selAcademicYear" style="width: 180px" @change="loadData">
        <el-option v-for="ay in academicYearOptions" :key="ay.value" :label="ay.label" :value="ay.value" />
      </el-select>
      <el-select v-model="selSemester" style="width: 140px" @change="loadData">
        <el-option v-for="s in semesterOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-button type="primary" @click="loadData" :loading="loading">查询</el-button>
      <el-button @click="resetFilter">重置</el-button>
    </div>

    <div class="card mt-16 score-metrics">
      <el-row :gutter="16">
        <el-col :xs="12" :sm="6"><div class="stat-card blue"><div class="flex-between"><span class="label">本学期总分</span><div class="icon"><Trophy /></div></div>
          <div class="value">{{ data.termScore || '0.00' }}</div><div class="extra">全部已通过加分项</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card green"><div class="flex-between"><span class="label">学年总分</span><div class="icon"><Coin /></div></div>
          <div class="value">{{ data.annualScore || '0.00' }}</div><div class="extra">{{ data.annualLabel || academicYearLabel }}</div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card orange"><div class="flex-between"><span class="label">班级排名</span><div class="icon"><Rank /></div></div>
          <div class="value"><span v-if="data.reportApproved">{{ data.classRank || '--' }}</span><span v-else style="font-size:14px;">-</span></div>
          <div class="extra"><template v-if="data.reportApproved">班级共 {{ data.classTotal || 0 }} 人</template><template v-else style="color:#e6a23c;">报表待审核，排名暂不可见</template></div></div></el-col>
        <el-col :xs="12" :sm="6"><div class="stat-card red"><div class="flex-between"><span class="label">专业排名</span><div class="icon"><Collection /></div></div>
          <div class="value"><span v-if="data.reportApproved">{{ data.majorRank || '--' }}</span><span v-else style="font-size:14px;">-</span></div>
          <div class="extra"><template v-if="data.reportApproved">专业共 {{ data.majorTotal || 0 }} 人</template><template v-else style="color:#e6a23c;">同年级同专业</template></div></div></el-col>
      </el-row>
    </div>

    <div class="card mt-16">
      <div class="card-title">各模块得分明细</div>
      <el-table :data="data.byModule || []" v-loading="loading" stripe>
        <el-table-column label="模块" width="160">
          <template #default="{row}"><el-tag :style="{background: row.color, border:'none'}" effect="dark">{{ row.name }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="count" label="项数" width="90" align="right" />
        <el-table-column prop="score" label="已获分数" width="120" align="right">
          <template #default="{row}"><span style="color:#67C23A; font-weight:600;">+{{ Number(row.score).toFixed(2) }}</span></template>
        </el-table-column>
        <el-table-column prop="maxScore" label="模块上限" width="120" align="right" />
        <el-table-column label="进度" width="260">
          <template #default="{row}">
            <el-progress :percentage="Math.min(100, Math.round(Number(row.score)/Math.max(row.maxScore,1)*100))" />
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!data.byModule?.length" description="暂无加分记录" />
    </div>

    <div class="card mt-16">
      <div class="card-title">所有加分记录 <span class="sub-title">（点击可查看申报详情）</span></div>
      <el-table :data="data.items || []" v-loading="loading" stripe highlight-current-row @row-click="openDetail">
        <el-table-column prop="approvedAt" label="通过时间" width="160">
          <template #default="{row}">{{ dayjs(row.approvedAt).format('YYYY-MM-DD HH:mm') }}</template>
        </el-table-column>
        <el-table-column label="模块" width="140">
          <template #default="{row}"><el-tag size="small" :style="{background: row.module?.color, border:'none'}" effect="dark">{{ row.module?.name }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="title" label="事项" min-width="240" show-overflow-tooltip />
        <el-table-column prop="level" label="等级" width="100">
          <template #default="{row}">{{ LEVEL[row.level] || '--' }}</template>
        </el-table-column>
        <el-table-column prop="finalScore" label="分值" width="90" align="right">
          <template #default="{row}"><span style="color:#67C23A; font-weight:600;">+{{ row.finalScore }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{row}">
            <el-button link type="primary" size="small" @click.stop="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!data.items?.length && !loading" description="暂无加分记录" />
    </div>

    <div class="card mt-16">
      <div class="card-title">班级排名 <span class="sub-title">（本学期 {{ data.semester === 'first' ? '第一学期' : (data.semester === 'second' ? '第二学期' : data.semester) }}）</span></div>
      <div v-if="!data.reportApproved" class="rank-locked">
        <el-empty description="班级报表尚未经辅导员审核通过，排名数据暂不展示，请耐心等待" />
      </div>
      <div v-else v-loading="rankingLoading">
        <el-table :data="rankingList" stripe :row-class-name="highlightMe">
          <el-table-column label="名次" width="100" align="center">
            <template #default="{ $index }">
              <el-tag v-if="$index === 0" type="danger" effect="dark" size="large" round>🏆 第1名</el-tag>
              <el-tag v-else-if="$index === 1" type="warning" effect="dark" size="large" round>🥈 第2名</el-tag>
              <el-tag v-else-if="$index === 2" type="success" effect="dark" size="large" round>🥉 第3名</el-tag>
              <span v-else style="font-weight:600; color:#606266;">第 {{ $index + 1 }} 名</span>
            </template>
          </el-table-column>
          <el-table-column label="姓名" width="140">
            <template #default="{ row }">{{ row.student?.realName || row.student?.username || '--' }}</template>
          </el-table-column>
          <el-table-column label="学号" width="140">
            <template #default="{ row }">{{ row.student?.studentNo || row.student?.username || '--' }}</template>
          </el-table-column>
          <el-table-column prop="totalScore" label="本学期总分" width="140" align="right">
            <template #default="{ row }">
              <span style="font-size:16px; font-weight:bold; color:#409EFF;">{{ Number(row.totalScore || 0).toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="applicationCount" label="加分项数" width="110" align="right">
            <template #default="{ row }">{{ row.applicationCount || 0 }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!rankingList.length && !rankingLoading" description="暂无排名数据" />
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-title">专业排名 <span class="sub-title">（同年级同专业 · 本学期 {{ data.semester === 'first' ? '第一学期' : (data.semester === 'second' ? '第二学期' : data.semester) }}）</span></div>
      <div v-if="!data.reportApproved" class="rank-locked">
        <el-empty description="班级报表尚未经辅导员审核通过，排名数据暂不展示，请耐心等待" />
      </div>
      <div v-else v-loading="majorRankingLoading">
        <el-table :data="majorRankingList" stripe :row-class-name="highlightMe">
          <el-table-column label="名次" width="100" align="center">
            <template #default="{ $index }">
              <el-tag v-if="$index === 0" type="danger" effect="dark" size="large" round>🏆 第1名</el-tag>
              <el-tag v-else-if="$index === 1" type="warning" effect="dark" size="large" round>🥈 第2名</el-tag>
              <el-tag v-else-if="$index === 2" type="success" effect="dark" size="large" round>🥉 第3名</el-tag>
              <span v-else style="font-weight:600; color:#606266;">第 {{ $index + 1 }} 名</span>
            </template>
          </el-table-column>
          <el-table-column label="姓名" width="140">
            <template #default="{ row }">{{ row.name || row.student?.realName || '--' }}</template>
          </el-table-column>
          <el-table-column label="学号" width="140">
            <template #default="{ row }">{{ row.studentNo || row.student?.studentNo || '--' }}</template>
          </el-table-column>
          <el-table-column label="班级" width="180">
            <template #default="{ row }">{{ row.className || row.student?.classInfo?.name || '--' }}</template>
          </el-table-column>
          <el-table-column prop="totalScore" label="本学期总分" width="140" align="right">
            <template #default="{ row }">
              <span style="font-size:16px; font-weight:bold; color:#409EFF;">{{ Number(row.totalScore || 0).toFixed(2) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!majorRankingList.length && !majorRankingLoading" description="暂无专业排名数据" />
      </div>
    </div>

    <ApplyDetailDialog v-model="detailVisible" :app="detailApp" />
  </div>
</template>

<script setup>
import { ref, onMounted, onActivated, computed, watch } from 'vue';
import dayjs from 'dayjs';
import { getMyScore, exportMyScore } from '@/api/scores';
import { getApplicationDetail } from '@/api/applications';
import { getRanking } from '@/api/stats';
import { getCurrentSemester } from '@/api/semesters';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { User, Trophy, Coin, Rank, Collection, Download } from '@element-plus/icons-vue';
import ApplyDetailDialog from '@/components/ApplyDetailDialog.vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const data = ref({});
const loading = ref(false);
const rankingList = ref([]);
const rankingLoading = ref(false);
const majorRankingList = ref([]);
const majorRankingLoading = ref(false);
const exporting = ref(false);

const LEVEL = { international: '国际级', national: '国家级', provincial: '省部级', school: '市校级', college: '院系级' };

// 学期筛选
const selAcademicYear = ref('');
const selSemester = ref('');
const academicYearOptions = ref([]);
const semesterOptions = ref([
  { label: '第一学期', value: 'first' },
  { label: '第二学期', value: 'second' }
]);

const academicYearLabel = computed(() => {
  const now = dayjs();
  return now.month() >= 8 ? `${now.year()}-${now.year()+1}` : `${now.year()-1}-${now.year()}`;
});

const exportTip = computed(() => {
  if (data.value.reportApproved) return '导出当前学期的成绩汇总、模块得分和明细';
  return '本学期班级报表尚未经辅导员审核通过，暂不可导出';
});

// 详情弹窗
const detailVisible = ref(false);
const detailApp = ref(null);

const openDetail = async (row) => {
  const appId = row?.id || row?.applicationId;
  if (!appId) return;
  detailApp.value = row;
  detailVisible.value = true;
  try {
    const app = await getApplicationDetail(appId);
    if (app) detailApp.value = app;
  } catch (_) {}
};

const highlightMe = ({ row }) => {
  const myId = userStore.userInfo?.id;
  const rowId = row.student?.id || row.studentId || row.id;
  return (rowId === myId) ? 'highlight-me' : '';
};

const resetFilter = async () => {
  const term = await getCurrentSemester();
  if (term) {
    selAcademicYear.value = term.academicYear;
    selSemester.value = term.semester;
  }
  await loadData();
};

const doExport = async () => {
  if (!data.value.reportApproved) {
    ElMessage.warning('本学期班级报表尚未经辅导员审核通过，暂不可导出');
    return;
  }
  exporting.value = true;
  try {
    const blob = await exportMyScore({
      academicYear: selAcademicYear.value,
      semester: selSemester.value
    });
    if (!blob || blob.size === 0) throw new Error('导出失败');
    // 文件名从响应头取
    let filename = `我的成绩_${selAcademicYear.value}_${selSemester.value}.xlsx`;
    const cd = blob?.headers?.['content-disposition'] || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (m) filename = decodeURIComponent(m[1]);
    const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    window.URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    const msg = e?.message || e?.data?.message || '导出失败';
    ElMessage.error(msg);
  } finally {
    exporting.value = false;
  }
};

const loadData = async () => {
  if (!selAcademicYear.value || !selSemester.value) return;
  loading.value = true;
  try {
    data.value = await getMyScore({
      academicYear: selAcademicYear.value,
      semester: selSemester.value
    }) || {};
    await loadRanking();
    await loadMajorRanking();
  } finally {
    loading.value = false;
  }
};

const loadRanking = async () => {
  if (!data.value.reportApproved) { rankingList.value = []; return; }
  rankingLoading.value = true;
  try {
    const r = await getRanking({
      scope: 'class',
      academicYear: selAcademicYear.value,
      semester: selSemester.value,
      page: 1,
      pageSize: 50
    });
    rankingList.value = r?.list || [];
  } catch (_) {
    rankingList.value = [];
  } finally {
    rankingLoading.value = false;
  }
};

const loadMajorRanking = async () => {
  if (!data.value.reportApproved) { majorRankingList.value = []; return; }
  majorRankingLoading.value = true;
  try {
    // 从后端请求专业排名（在 stats API 中扩展）
    // 若没有专门接口，则本地基于同年级同专业计算：先取自己班级同学年级和专业
    const r = await getRanking({
      scope: 'major',
      academicYear: selAcademicYear.value,
      semester: selSemester.value,
      page: 1,
      pageSize: 200
    });
    majorRankingList.value = r?.list || [];
  } catch (_) {
    majorRankingList.value = [];
  } finally {
    majorRankingLoading.value = false;
  }
};

// 初始化学期选项
const initSemesters = async () => {
  try {
    const current = await getCurrentSemester();
    if (current) {
      selAcademicYear.value = current.academicYear;
      selSemester.value = current.semester;
    }
    // 生成学年选项（当前和前一年）
    const now = dayjs();
    const ay1 = now.month() >= 8 ? `${now.year()}-${now.year()+1}` : `${now.year()-1}-${now.year()}`;
    const ay2 = now.month() >= 8 ? `${now.year()-1}-${now.year()}` : `${now.year()-2}-${now.year()-1}`;
    academicYearOptions.value = [
      { label: `${ay1}学年`, value: ay1 },
      { label: `${ay2}学年`, value: ay2 }
    ];
  } catch (_) {
    const term = dayjs().month() >= 8
      ? { academicYear: `${dayjs().year()}-${dayjs().year()+1}`, semester: 'first' }
      : { academicYear: `${dayjs().year()-1}-${dayjs().year()}`, semester: 'second' };
    selAcademicYear.value = term.academicYear;
    selSemester.value = term.semester;
    academicYearOptions.value = [
      { label: `${term.academicYear}学年`, value: term.academicYear }
    ];
  }
};

onMounted(async () => {
  await initSemesters();
  await loadData();
});

onActivated(async () => {
  await loadData();
});
</script>

<style lang="scss" scoped>
.my-score-page { padding-bottom:8px; }
.filter-bar { display:flex; gap:10px; margin-top:18px; padding: 18px 20px; align-items:center; flex-wrap:wrap; border:1px solid #E2EAF4; border-radius:18px; }
.filter-copy { min-width:210px; margin-right:auto;
  span { display:block; color:#2379D8; font-size:10px; font-weight:800; letter-spacing:.15em; }
  strong { display:block; margin-top:4px; color:#172B4D; font-size:15px; }
}
.score-metrics { padding:20px; border:1px solid #E2EAF4; border-radius:18px; background:linear-gradient(145deg,#fff,#F8FBFF); }
.score-metrics :deep(.stat-card) { min-height:136px; border:1px solid #E0E9F4; border-radius:16px; box-shadow:0 8px 22px rgba(20,52,96,.045); }
.my-score-page > .card:not(.filter-bar):not(.score-metrics) { border:1px solid #E2EAF4; border-radius:18px; box-shadow:0 10px 28px rgba(20,52,96,.05); }
.sub-title { color:#909399; font-size:13px; font-weight:normal; margin-left:8px; }
:deep(.highlight-me) { background: linear-gradient(90deg, #ecf5ff, #fdf6ec) !important; }
.rank-locked { padding: 40px 0; }
@media (max-width:768px) {
  .filter-copy { width:100%; }
  .filter-bar :deep(.el-select), .filter-bar :deep(.el-button) { width:100% !important; }
}
</style>
