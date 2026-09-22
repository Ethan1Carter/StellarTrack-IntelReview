<template>
  <div class="score-workspace">
    <WorkspaceHero
      eyebrow="ACADEMIC PERFORMANCE"
      :title="isAdmin ? '课程成绩管理' : '我的课程成绩'"
      :description="isAdmin ? '按学年、学期与管理范围查看课程表现，集中完成成绩查询、导入与导出。' : '查看每学期课程成绩、学分与平均分，清晰掌握个人学习表现。'"
    >
      <template #actions>
        <el-button :icon="Download" @click="exportData" :disabled="!list.length">导出成绩</el-button>
        <el-button v-if="isAdmin" :icon="Upload" @click="goImport">导入成绩</el-button>
      </template>
    </WorkspaceHero>

    <!-- 筛选栏 -->
    <div class="card filter-panel">
      <div class="panel-heading">
        <div>
          <span class="panel-kicker">成绩范围</span>
          <h3>选择要查看的学期与对象</h3>
        </div>
        <span class="panel-hint">支持按班级或学生快速定位</span>
      </div>
      <div class="filter-bar">
      <el-select v-model="selAcademicYear" class="year-select" @change="loadData" placeholder="学年">
        <el-option v-for="ay in academicYearOptions" :key="ay.value" :label="ay.label" :value="ay.value" />
      </el-select>
      <el-select v-model="selSemester" class="semester-select" @change="loadData" placeholder="学期">
        <el-option label="第1学期" value="first" />
        <el-option label="第2学期" value="second" />
      </el-select>

      <template v-if="isAdmin">
        <!-- 班级管理员只看本班，无需选择范围 -->
        <template v-if="role === 'class_admin'">
          <el-tag type="warning" effect="plain" style="margin-right:8px;">仅可查看本班</el-tag>
        </template>
        <!-- 辅导员/学院管理员/学校管理员可选范围 -->
        <template v-else>
          <el-radio-group v-model="viewMode" @change="onViewModeChange" style="margin-right:8px;">
            <el-radio-button label="class">按班级查</el-radio-button>
            <el-radio-button label="student">按个人查</el-radio-button>
          </el-radio-group>

          <!-- 按班级查：选择班级 -->
          <template v-if="viewMode === 'class'">
            <el-select v-model="selScopeId" placeholder="选择班级" style="width: 220px" filterable clearable @change="loadData">
              <el-option v-for="o in scopeOptions" :key="o.id" :label="o.name" :value="o.id" />
            </el-select>
          </template>

          <!-- 按个人查：搜索学生 -->
          <template v-else>
            <el-select
              v-model="selStudentId"
              placeholder="输入学号/姓名搜索学生"
              style="width: 260px"
              filterable
              remote
              clearable
              :remote-method="searchStudents"
              :loading="studentLoading"
              @change="loadData"
            >
              <el-option v-for="s in studentOptions" :key="s.id" :label="`${s.realName} (${s.username})`" :value="s.id" />
            </el-select>
          </template>
        </template>
      </template>

      <el-button type="primary" @click="loadData" :loading="loading">查询成绩</el-button>
      <el-button @click="resetFilter">重置</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="score-overview mt-16">
      <el-row :gutter="16">
        <el-col :xs="12" :sm="12" :lg="6">
          <div class="stat-card blue">
            <div class="flex-between"><span class="label">课程门数</span><div class="icon"><Reading /></div></div>
            <div class="value">{{ stats.courseCount || 0 }}</div>
            <div class="extra">本学期共修课程</div>
          </div>
        </el-col>
        <el-col :xs="12" :sm="12" :lg="6">
          <div class="stat-card green">
            <div class="flex-between"><span class="label">总学分</span><div class="icon"><Coin /></div></div>
            <div class="value">{{ stats.totalCredit || 0 }}</div>
            <div class="extra">本学期总学分</div>
          </div>
        </el-col>
        <el-col :xs="12" :sm="12" :lg="6">
          <div class="stat-card orange">
            <div class="flex-between"><span class="label">加权平均分</span><div class="icon"><Trophy /></div></div>
            <div class="value">{{ stats.weightedAvg || 0 }}</div>
            <div class="extra">按学分加权计算</div>
          </div>
        </el-col>
        <el-col :xs="12" :sm="12" :lg="6">
          <div class="stat-card red">
            <div class="flex-between"><span class="label">算术平均分</span><div class="icon"><Collection /></div></div>
            <div class="value">{{ stats.simpleAvg || 0 }}</div>
            <div class="extra">所有课程平均值</div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 学生场景：按课程展示 -->
    <div v-if="!isAdmin" class="card mt-16">
      <div class="card-title">课程成绩明细</div>
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column type="index" label="#" width="50" align="center" />
        <el-table-column prop="courseName" label="课程名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="courseCode" label="课程代码" width="120" />
        <el-table-column prop="category" label="性质" width="80" align="center">
          <template #default="{row}">
            <el-tag :type="row.category === 'required' ? 'danger' : row.category === 'elective' ? 'warning' : 'info'" size="small">
              {{ CATEGORY_MAP[row.category] || row.category }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="credit" label="学分" width="80" align="center" />
        <el-table-column prop="score" label="成绩" width="100" align="center">
          <template #default="{row}">
            <span :style="getScoreStyle(row.score)" style="font-weight:600;">{{ row.score }}</span>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="80" align="center">
          <template #default="{row}">{{ getScoreLevel(row.score) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" :description="isAdmin ? '当前学期暂无课程成绩数据，请点击右上角「导入成绩」按钮上传Excel' : '当前学期暂无课程成绩，请联系班级管理员导入'" />
    </div>

    <!-- 管理员场景 -->
    <div v-else class="card mt-16">
      <!-- 按班级查：显示学生名单，点击查看详情 -->
      <template v-if="viewMode === 'class' || role === 'class_admin'">
        <div class="card-title">
          班级学生成绩名单
          <span class="sub-title">（共 {{ studentList.length }} 名学生）</span>
        </div>
        <el-table :data="studentList" v-loading="loading" stripe @row-click="onStudentClick" style="cursor:pointer;">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column label="学号" width="140">
            <template #default="{row}">{{ row.student?.username || '--' }}</template>
          </el-table-column>
          <el-table-column label="姓名" width="120">
            <template #default="{row}">
              <el-link type="primary" :underline="false">{{ row.student?.realName || '--' }}</el-link>
            </template>
          </el-table-column>
          <el-table-column label="课程门数" width="100" align="center">
            <template #default="{row}">{{ row.courseCount || 0 }}</template>
          </el-table-column>
          <el-table-column label="总学分" width="100" align="center">
            <template #default="{row}">{{ row.totalCredit || 0 }}</template>
          </el-table-column>
          <el-table-column label="加权平均分" width="120" align="center">
            <template #default="{row}">
              <span :style="getScoreStyle(row.weightedAvg)" style="font-weight:600;">{{ row.weightedAvg || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="算术平均分" width="120" align="center">
            <template #default="{row}">
              <span :style="getScoreStyle(row.simpleAvg)" style="font-weight:600;">{{ row.simpleAvg || 0 }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{row}">
              <el-button type="primary" size="small" link @click.stop="onStudentClick(row)">查看详情</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!studentList.length && !loading" :description="adminEmptyText" />
      </template>

      <!-- 按个人查：直接显示课程成绩明细 -->
      <template v-else>
        <div class="card-title">
          课程成绩明细
          <span class="sub-title" v-if="total">（共 {{ total }} 条）</span>
          <span v-if="currentBatch" style="margin-left:16px;">
            <el-tag size="small" type="info">当前批次: {{ currentBatch }}</el-tag>
            <el-button type="danger" size="small" link @click="deleteBatch(currentBatch)" style="margin-left:8px;">
              删除此批次
            </el-button>
          </span>
        </div>
        <el-table :data="list" v-loading="loading" stripe>
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column label="学号" width="130">
            <template #default="{row}">{{ row.student?.username || '--' }}</template>
          </el-table-column>
          <el-table-column label="姓名" width="100">
            <template #default="{row}">{{ row.student?.realName || '--' }}</template>
          </el-table-column>
          <el-table-column label="班级" width="140">
            <template #default="{row}">{{ row.classInfo?.name || '--' }}</template>
          </el-table-column>
          <el-table-column prop="courseName" label="课程名称" min-width="180" show-overflow-tooltip />
          <el-table-column prop="category" label="性质" width="80" align="center">
            <template #default="{row}">
              <el-tag :type="row.category === 'required' ? 'danger' : row.category === 'elective' ? 'warning' : 'info'" size="small">
                {{ CATEGORY_MAP[row.category] || row.category }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="credit" label="学分" width="80" align="center" />
          <el-table-column prop="score" label="成绩" width="90" align="center">
            <template #default="{row}">
              <span :style="getScoreStyle(row.score)" style="font-weight:600;">{{ row.score }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{row}">
              <el-button type="danger" size="small" link @click="deleteOne(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="total > pageSize"
          style="margin-top:16px; text-align:right;"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next, jumper"
          @current-change="onPageChange"
        />
        <el-empty v-if="!list.length && !loading" :description="adminEmptyText" />
      </template>
    </div>

    <!-- 学生成绩详情抽屉 -->
    <el-drawer v-model="detailDrawer" :title="detailTitle" size="70%" :destroy-on-close="true">
      <div v-if="detailLoading" style="text-align:center; padding:40px;">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <div style="margin-top:8px; color:#909399;">加载中...</div>
      </div>
      <template v-else>
        <el-row :gutter="16" style="margin-bottom:16px;">
          <el-col :span="6">
            <div class="stat-card blue" style="padding:16px;">
              <div class="label">课程门数</div>
              <div class="value">{{ detailStats.courseCount || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card green" style="padding:16px;">
              <div class="label">总学分</div>
              <div class="value">{{ detailStats.totalCredit || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card orange" style="padding:16px;">
              <div class="label">加权平均分</div>
              <div class="value">{{ detailStats.weightedAvg || 0 }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card red" style="padding:16px;">
              <div class="label">算术平均分</div>
              <div class="value">{{ detailStats.simpleAvg || 0 }}</div>
            </div>
          </el-col>
        </el-row>
        <el-table :data="detailList" stripe>
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="courseName" label="课程名称" min-width="200" show-overflow-tooltip />
          <el-table-column prop="courseCode" label="课程代码" width="120" />
          <el-table-column prop="category" label="性质" width="80" align="center">
            <template #default="{row}">
              <el-tag :type="row.category === 'required' ? 'danger' : row.category === 'elective' ? 'warning' : 'info'" size="small">
                {{ CATEGORY_MAP[row.category] || row.category }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="credit" label="学分" width="80" align="center" />
          <el-table-column prop="score" label="成绩" width="100" align="center">
            <template #default="{row}">
              <span :style="getScoreStyle(row.score)" style="font-weight:600;">{{ row.score }}</span>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="80" align="center">
            <template #default="{row}">{{ getScoreLevel(row.score) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!detailList.length" description="该学生当前学期暂无课程成绩" />
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Reading, Coin, Trophy, Collection, Download, Upload, Loading } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { listCourseScores, getMyCourseScores, getClassStudents, deleteCourseScore, deleteCourseScoreByBatch } from '@/api/courseScores';
import request from '@/utils/request';
import dayjs from 'dayjs';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const router = useRouter();
const userStore = useUserStore();
const role = computed(() => userStore.userInfo?.role || '');
const isAdmin = computed(() => !['student'].includes(role.value));
const isStudent = computed(() => role.value === 'student');

const CATEGORY_MAP = { required: '必修', elective: '选修', public: '公共' };

const loading = ref(false);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const stats = ref({});
const currentBatch = ref('');

const selAcademicYear = ref('');
const selSemester = ref('first');
const selScopeId = ref(null);
const keyword = ref('');
const scopeOptions = ref([]);

// 管理员查询模式：按班级 / 按个人
const viewMode = ref('class');
const selStudentId = ref(null);
const studentOptions = ref([]);
const studentLoading = ref(false);

// 按班级查：学生名单
const studentList = ref([]);

// 学生成绩详情抽屉
const detailDrawer = ref(false);
const detailLoading = ref(false);
const detailTitle = ref('');
const detailList = ref([]);
const detailStats = ref({});

// 管理员空状态提示
const adminEmptyText = computed(() => {
  if (role.value === 'class_admin') {
    return '本班当前学期暂无课程成绩数据，请点击右上角「导入成绩」按钮上传Excel';
  }
  if (viewMode.value === 'class') {
    return selScopeId.value ? '该班级当前学期暂无课程成绩数据' : '请先选择班级，再查看课程成绩';
  } else {
    return selStudentId.value ? '该学生当前学期暂无课程成绩数据' : '请先搜索并选择学生，再查看课程成绩';
  }
});

const academicYearOptions = computed(() => {
  const current = dayjs().year();
  const opts = [];
  for (let y = current + 1; y >= current - 4; y--) {
    opts.push({ value: `${y-1}-${y}`, label: `${y-1}-${y}学年` });
  }
  return opts;
});

onMounted(async () => {
  // 从后端获取当前学期，确保与后端 resolveAcademicTerm() 一致
  try {
    const cur = await request({ url: '/semesters/current', method: 'GET' });
    const ay = cur?.academicYear || cur?.academic_year;
    const sm = cur?.semester;
    if (ay) {
      selAcademicYear.value = ay;
      selSemester.value = sm || 'first';
    }
  } catch (_) {
    // 兜底：前端本地计算（与后端 resolveAcademicTerm 一致）
    const now = dayjs();
    const month = now.month() + 1; // 1-12
    if (month >= 9) {
      // 9月-12月：第一学期
      selAcademicYear.value = `${now.year()}-${now.year() + 1}`;
      selSemester.value = 'first';
    } else if (month <= 1) {
      // 1月：第一学期
      selAcademicYear.value = `${now.year() - 1}-${now.year()}`;
      selSemester.value = 'first';
    } else {
      // 2月-8月：第二学期
      selAcademicYear.value = `${now.year() - 1}-${now.year()}`;
      selSemester.value = 'second';
    }
  }
  await loadScopeOptions();
  await loadData();
});

onActivated(async () => {
  await loadData();
});

async function loadScopeOptions() {
  if (!isAdmin.value) return;
  try {
    const res = await request({ url: '/classes', method: 'GET', params: { pageSize: 500 } });
    scopeOptions.value = (res.list || res.data?.list || res.data || []).map(c => ({ id: c.id, name: c.name }));
  } catch (_) {}
}

function onViewModeChange() {
  selScopeId.value = null;
  selStudentId.value = null;
  studentOptions.value = [];
  studentList.value = [];
  list.value = [];
  total.value = 0;
  stats.value = {};
  if (viewMode.value === 'class') {
    loadScopeOptions();
  }
}

async function searchStudents(query) {
  if (!query || query.length < 1) {
    studentOptions.value = [];
    return;
  }
  studentLoading.value = true;
  try {
    const res = await request({
      url: '/users',
      method: 'GET',
      params: { keyword: query, role: 'student', pageSize: 30 }
    });
    studentOptions.value = (res.list || res.data?.list || res.data || []).map(u => ({
      id: u.id,
      username: u.username,
      realName: u.realName
    }));
  } catch (_) {
    studentOptions.value = [];
  } finally {
    studentLoading.value = false;
  }
}

async function loadData() {
  // 管理员模式下，必须选择班级或学生才查询
  if (isAdmin.value && role.value !== 'class_admin') {
    if (viewMode.value === 'class' && !selScopeId.value) {
      studentList.value = []; list.value = []; total.value = 0; stats.value = {};
      return;
    }
    if (viewMode.value === 'student' && !selStudentId.value) {
      list.value = []; total.value = 0; stats.value = {};
      return;
    }
  }

  loading.value = true;
  try {
    if (isStudent.value) {
      // 学生查询自己的成绩
      const res = await getMyCourseScores({
        academicYear: selAcademicYear.value,
        semester: selSemester.value
      });
      list.value = res.list || [];
      stats.value = res.stats || {};
      total.value = list.value.length;
    } else if (role.value === 'class_admin' || viewMode.value === 'class') {
      // 班级管理员 或 按班级查：获取学生名单
      let classId = selScopeId.value;
      if (role.value === 'class_admin') {
        // 班级管理员自动获取本班ID
        try {
          const me = await request({ url: '/classes/my/info', method: 'GET' });
          classId = me?.id || me?.data?.id;
        } catch (_) {
          studentList.value = [];
          return;
        }
      }
      if (!classId) {
        studentList.value = [];
        return;
      }
      const res = await getClassStudents({
        classId,
        academicYear: selAcademicYear.value,
        semester: selSemester.value
      });
      studentList.value = Array.isArray(res) ? res : (res.data || []);
      total.value = studentList.value.length;
      // 统计信息（班级整体）
      const allStudents = studentList.value;
      stats.value = {
        courseCount: allStudents.reduce((s, r) => s + (r.courseCount || 0), 0),
        totalCredit: Number(allStudents.reduce((s, r) => s + Number(r.totalCredit || 0), 0).toFixed(2)),
        weightedAvg: allStudents.length ? Number((allStudents.reduce((s, r) => s + Number(r.weightedAvg || 0), 0) / allStudents.length).toFixed(2)) : 0,
        simpleAvg: allStudents.length ? Number((allStudents.reduce((s, r) => s + Number(r.simpleAvg || 0), 0) / allStudents.length).toFixed(2)) : 0
      };
    } else {
      // 按个人查：查询指定学生的成绩明细
      const params = {
        page: page.value,
        pageSize: pageSize.value,
        scope: 'class',
        academicYear: selAcademicYear.value,
        semester: selSemester.value,
        studentId: selStudentId.value
      };
      const res = await listCourseScores(params);
      list.value = res.list || res.data?.list || [];
      total.value = res.total || res.data?.total || 0;
      computeStats();
      if (list.value[0]?.importBatch) currentBatch.value = list.value[0].importBatch;
    }
  } catch (e) {
    ElMessage.error('查询失败：' + (e.message || ''));
  } finally {
    loading.value = false;
  }
}

// 点击学生查看成绩详情
async function onStudentClick(row) {
  if (!row?.studentId) return;
  detailDrawer.value = true;
  detailLoading.value = true;
  detailTitle.value = `${row.student?.realName || ''} 的课程成绩（${row.student?.username || ''}）`;
  detailList.value = [];
  detailStats.value = {};
  try {
    const res = await listCourseScores({
      page: 1,
      pageSize: 200,
      scope: 'class',
      academicYear: selAcademicYear.value,
      semester: selSemester.value,
      studentId: row.studentId
    });
    detailList.value = res.list || res.data?.list || [];
    // 计算统计
    const scores = detailList.value;
    const totalCredit = scores.reduce((s, r) => s + Number(r.credit || 0), 0);
    const weightedSum = scores.reduce((s, r) => s + Number(r.score || 0) * Number(r.credit || 0), 0);
    detailStats.value = {
      courseCount: scores.length,
      totalCredit: Number(totalCredit.toFixed(2)),
      weightedAvg: totalCredit > 0 ? Number((weightedSum / totalCredit).toFixed(2)) : 0,
      simpleAvg: scores.length ? Number((scores.reduce((s, r) => s + Number(r.score || 0), 0) / scores.length).toFixed(2)) : 0
    };
  } catch (e) {
    ElMessage.error('加载详情失败：' + (e.message || ''));
  } finally {
    detailLoading.value = false;
  }
}

// 从列表计算统计信息
function computeStats() {
  const allScores = list.value;
  const totalCredit = allScores.reduce((s, r) => s + Number(r.credit || 0), 0);
  const weightedSum = allScores.reduce((s, r) => s + Number(r.score || 0) * Number(r.credit || 0), 0);
  stats.value = {
    courseCount: total.value,
    totalCredit: Number(totalCredit.toFixed(2)),
    weightedAvg: totalCredit > 0 ? Number((weightedSum / totalCredit).toFixed(2)) : 0,
    simpleAvg: allScores.length ? Number((allScores.reduce((s, r) => s + Number(r.score || 0), 0) / allScores.length).toFixed(2)) : 0
  };
}

function onPageChange(p) {
  page.value = p;
  loadData();
}

function resetFilter() {
  selScopeId.value = null;
  selStudentId.value = null;
  studentOptions.value = [];
  studentList.value = [];
  viewMode.value = 'class';
  page.value = 1;
  list.value = [];
  total.value = 0;
  stats.value = {};
  loadScopeOptions();
}

function getScoreStyle(score) {
  const s = Number(score);
  if (s >= 90) return { color: '#67C23A' };
  if (s >= 80) return { color: '#409EFF' };
  if (s >= 60) return { color: '#E6A23C' };
  return { color: '#F56C6C' };
}

function getScoreLevel(score) {
  const s = Number(score);
  if (s >= 90) return '优';
  if (s >= 80) return '良';
  if (s >= 70) return '中';
  if (s >= 60) return '及格';
  return '不及格';
}

function goImport() {
  router.push('/score-import');
}

async function deleteOne(row) {
  try {
    await ElMessageBox.confirm(`确认删除该课程成绩？\n学生：${row.student?.realName}\n课程：${row.courseName}\n成绩：${row.score}`, '确认删除', { type: 'warning' });
    await deleteCourseScore(row.id);
    ElMessage.success('删除成功');
    loadData();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + (e.message || ''));
  }
}

async function deleteBatch(batch) {
  try {
    await ElMessageBox.confirm(`确认删除批次 "${batch}" 的所有课程成绩？此操作不可撤销。`, '批量删除确认', { type: 'warning' });
    const res = await deleteCourseScoreByBatch(batch);
    ElMessage.success(res.message || `已删除 ${res.count} 条`);
    currentBatch.value = '';
    loadData();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + (e.message || ''));
  }
}

async function exportData() {
  try {
    // 前端导出为Excel
    const XLSX = await import('xlsx');
    const data = list.value.map((r, i) => ({
      '序号': i + 1,
      '学号': r.student?.username || '',
      '姓名': r.student?.realName || '',
      '班级': r.classInfo?.name || '',
      '课程名称': r.courseName,
      '课程代码': r.courseCode || '',
      '课程性质': CATEGORY_MAP[r.category] || r.category,
      '学分': r.credit,
      '成绩': r.score,
      '等级': getScoreLevel(r.score),
      '学年': r.academicYear,
      '学期': r.semester === 'first' ? '第1学期' : '第2学期'
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '课程成绩');
    XLSX.writeFile(wb, `课程成绩_${selAcademicYear.value}_${selSemester.value === 'first' ? '第1学期' : '第2学期'}.xlsx`);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error('导出失败：' + (e.message || ''));
  }
}
</script>

<style lang="scss" scoped>
.score-workspace { padding-bottom: 8px; }
.filter-panel { margin-top: 18px; padding: 22px 24px; }
.panel-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid #E8EEF7;

  h3 { margin: 5px 0 0; color: #172B4D; font-size: 17px; }
}
.panel-kicker { color: #1876D2; font-size: 11px; font-weight: 800; letter-spacing: .16em; }
.panel-hint { color: #8A98AE; font-size: 12px; }
.filter-bar { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
.year-select { width: 180px; }
.semester-select { width: 140px; }
.card { background:#fff; border:1px solid #E8EEF7; border-radius:18px; padding:20px; box-shadow: 0 10px 30px rgba(23,43,77,.055); }
.mt-16 { margin-top:18px; }
.score-overview :deep(.el-row) { row-gap: 16px; }
.card-title {
  color: #172B4D;
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 18px;
  display: flex;
  align-items: center;

  &::before { content: ''; width: 4px; height: 18px; margin-right: 10px; border-radius: 4px; background: linear-gradient(#1C7BEA, #13B9D5); }
}
.sub-title {
  font-size: 13px;
  font-weight: 400;
  color: #909399;
  margin-left: 8px;
}
.stat-card {
  position: relative;
  min-height: 126px;
  padding: 20px 20px 18px;
  overflow: hidden;
  border: 1px solid #E5EDF7;
  border-radius: 17px;
  color: #172B4D;
  background: #fff;
  box-shadow: 0 9px 24px rgba(31, 55, 91, .055);

  &::after { content: ''; position: absolute; inset: auto -22px -32px auto; width: 86px; height: 86px; border-radius: 50%; opacity: .1; background: currentColor; }
}
.stat-card .label { color: #697A94; font-size: 13px; font-weight: 600; }
.stat-card .value { color: #142A52; font-size: 30px; font-weight: 800; margin-top: 9px; letter-spacing: -.04em; }
.stat-card .extra { color: #98A5B7; font-size: 12px; margin-top: 5px; }
.stat-card .icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; font-size: 19px; background: currentColor; }
.stat-card .icon :deep(svg) { color: #fff; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.stat-card.blue { color: #2478E5; border-top: 3px solid #2478E5; }
.stat-card.green { color: #16A6A1; border-top: 3px solid #16A6A1; }
.stat-card.orange { color: #E5A31A; border-top: 3px solid #E5A31A; }
.stat-card.red { color: #7567E8; border-top: 3px solid #7567E8; }
:deep(.el-table) { border-radius: 12px; --el-table-header-bg-color: #F5F8FC; --el-table-row-hover-bg-color: #F3F8FF; }
:deep(.el-table th.el-table__cell) { height: 48px; color: #52647E; font-weight: 700; }
:deep(.el-pagination) { justify-content: flex-end; padding-top: 16px; }

@media (max-width: 768px) {
  .filter-panel { padding: 18px; }
  .panel-heading { align-items: flex-start; flex-direction: column; }
  .panel-hint { display: none; }
  .year-select, .semester-select { width: 100%; }
  .filter-bar :deep(.el-select), .filter-bar :deep(.el-radio-group) { width: 100% !important; }
  .filter-bar :deep(.el-button) { flex: 1; }
  .stat-card { min-height: 116px; padding: 17px; }
}
</style>
