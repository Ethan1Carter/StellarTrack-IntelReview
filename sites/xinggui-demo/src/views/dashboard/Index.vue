<template>
  <div class="dashboard-page">
    <section class="dashboard-header">
      <div class="dashboard-title">
        <div class="dashboard-kicker"><span></span> ORBIT ANALYTICS</div>
        <h1><el-icon><DataBoard /></el-icon> 智能数据看板</h1>
        <p>从院系、班级到学生，快速掌握考评进度与成长趋势。</p>
      </div>
      <div class="dashboard-actions">
        <el-button v-if="currentView === 'individual'" @click="$router.push({ path: '/growth-plan', query: appliedFilters.studentId ? { studentId: appliedFilters.studentId } : {} })">查看成长行动</el-button>
        <el-button
          v-if="currentView === 'individual'"
          type="warning"
          :icon="Download"
          @click="exportIndividualArchive"
        >导出考评档案</el-button>
        <el-button
          v-else
          type="primary"
          :icon="Download"
          @click="exportCurrentView"
        >导出当前视图</el-button>
      </div>
      <img class="dashboard-watermark" src="/branding/xinggui-symbol.png" alt="" />
    </section>

    <!-- 权限不足提示 -->
    <el-empty
      v-if="!hasAccess"
      description="当前角色无数据看板访问权限"
    >
      <template #image>
        <el-icon :size="64" color="#c0c4cc"><Lock /></el-icon>
      </template>
    </el-empty>

    <template v-else>
      <!-- 筛选栏：横向布局 + 确定按钮 -->
      <div class="filter-bar">
        <div class="filter-heading">
          <div class="filter-heading-icon"><el-icon><Search /></el-icon></div>
          <div><strong>数据范围</strong><span>按组织层级逐级筛选</span></div>
        </div>
        <div class="filter-control">
          <div class="filter-items">
          <el-select
            v-model="filters.collegeId"
            placeholder="选择学院"
            clearable
            filterable
            style="width: 160px;"
            :disabled="role === 'student' || role === 'class_admin'"
            @change="onCollegeChange"
          >
            <el-option
              v-for="c in collegeList"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>

          <el-select
            v-model="filters.major"
            placeholder="选择专业"
            clearable
            filterable
            style="width: 150px;"
            :disabled="!filters.collegeId || role === 'student' || role === 'class_admin'"
            @change="onMajorChange"
          >
            <el-option
              v-for="m in majorList"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>

          <el-select
            v-model="filters.grade"
            placeholder="选择年级"
            clearable
            style="width: 110px;"
            :disabled="!filters.collegeId || role === 'student' || role === 'class_admin'"
          >
            <el-option
              v-for="g in gradeList"
              :key="g"
              :label="g + '级'"
              :value="g"
            />
          </el-select>

          <el-select
            v-model="filters.classId"
            placeholder="选择班级"
            clearable
            filterable
            style="width: 160px;"
            :disabled="!filters.collegeId || role === 'student'"
            @change="onClassChange"
          >
            <el-option
              v-for="c in filteredClassList"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>

          <el-select
            v-model="filters.studentId"
            placeholder="选择学生"
            clearable
            filterable
            style="width: 180px;"
            :disabled="!filters.classId || role === 'student'"
          >
            <el-option
              v-for="s in studentList"
              :key="s.id"
              :label="s.realName + '（' + s.studentNo + '）'"
              :value="s.id"
            />
          </el-select>
          </div>
          <div class="filter-actions">
            <el-button type="primary" :icon="Search" @click="onConfirm" :loading="loading">
              查询
            </el-button>
            <el-button :icon="Refresh" @click="resetFilters">重置</el-button>
          </div>
        </div>
      </div>

      <!-- 个人维度详情 -->
      <template v-if="currentView === 'individual'">
        <!-- 学期筛选 -->
        <div class="semester-filter" v-if="semesterOptions.length > 0">
          <el-icon><Calendar /></el-icon>
          <span style="margin-left:4px;">学期：</span>
          <el-select v-model="selectedSemester" placeholder="选择学期" style="width:280px" @change="onSemesterChange">
            <el-option v-for="s in semesterOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </div>
        <el-row :gutter="16" class="mt-16 metric-grid">
          <el-col :xs="12" :sm="6">
            <div class="stat-card blue">
              <div class="flex-between">
                <span class="label">学期总分</span>
                <div class="icon"><Trophy /></div>
              </div>
              <div class="value">{{ individual.totalScore || '0' }}</div>
              <div class="extra">{{ individual.appCount || 0 }} 项加分申报</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card green">
              <div class="flex-between">
                <span class="label">通过/驳回</span>
                <div class="icon"><CircleCheck /></div>
              </div>
              <div class="value">
                <span style="color:#67C23A;">{{ individual.approvedCount || 0 }}</span>
                <span style="color:#909399; font-size:20px;"> / </span>
                <span style="color:#F56C6C;">{{ individual.rejectedCount || 0 }}</span>
              </div>
              <div class="extra">通过率 {{ individual.passRate || '0' }}%</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card orange">
              <div class="flex-between">
                <span class="label">申诉次数</span>
                <div class="icon"><Warning /></div>
              </div>
              <div class="value">{{ individual.appealCount || 0 }}</div>
              <div class="extra">申诉中 {{ individual.appealingCount || 0 }} 项</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card purple">
              <div class="flex-between">
                <span class="label">班级排名</span>
                <div class="icon"><Medal /></div>
              </div>
              <div class="value">
                {{ individual.classRank || '--' }}
                <span style="font-size: 16px; color:#909399; margin-left:4px;">
                  / {{ individual.classTotal || '--' }}
                </span>
              </div>
              <div class="extra">超越 {{ individual.beatPercent || '0' }}% 同学</div>
            </div>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="mt-16 metric-grid">
          <el-col :xs="24" :md="12">
            <div class="card">
              <div class="card-title">各加分模块得分</div>
              <BaseChart
                v-if="individual.moduleScores?.length"
                :option="moduleScoreOption"
                height="300px"
              />
              <el-empty v-else description="暂无加分记录" />
            </div>
          </el-col>
          <el-col :xs="24" :md="12">
            <div class="card">
              <div class="card-title">类别分布</div>
              <BaseChart
                v-if="individual.categoryData?.length"
                :option="categoryPieOption"
                height="300px"
              />
              <el-empty v-else description="暂无数据" />
            </div>
          </el-col>
        </el-row>

        <div class="card mt-16">
          <div class="card-title">个人申报明细</div>
          <el-table :data="individual.applications || []" stripe height="360">
            <el-table-column prop="module" label="模块" width="140" />
            <el-table-column prop="title" label="申报项目" min-width="180" show-overflow-tooltip />
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small">
                  {{ statusText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="finalScore" label="分值" width="80" align="right">
              <template #default="{ row }">
                <el-tag v-if="row.finalScore > 0" type="success" effect="dark">+{{ row.finalScore }}</el-tag>
                <span v-else-if="row.finalScore === 0" style="color:#909399;">--</span>
                <span v-else style="color:#F56C6C;">{{ row.finalScore }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="submittedAt" label="提交时间" width="170" />
          </el-table>
          <el-empty v-if="!individual.applications?.length" description="暂无申报记录" />
        </div>
      </template>

      <!-- 汇总统计 -->
      <template v-else>
        <el-row :gutter="16" class="mt-16">
          <el-col :xs="12" :sm="6">
            <div class="stat-card blue">
              <div class="flex-between">
                <span class="label">学生总数</span>
                <div class="icon"><User /></div>
              </div>
              <div class="value">{{ summary.totalStudents ?? '--' }}</div>
              <div class="extra">参评人数</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card green">
              <div class="flex-between">
                <span class="label">班级总数</span>
                <div class="icon"><School /></div>
              </div>
              <div class="value">{{ summary.totalClasses ?? '--' }}</div>
              <div class="extra">班级数量</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card orange">
              <div class="flex-between">
                <span class="label">申报总数</span>
                <div class="icon"><Document /></div>
              </div>
              <div class="value">{{ summary.totalApplications ?? '--' }}</div>
              <div class="extra">累计申报</div>
            </div>
          </el-col>
          <el-col :xs="12" :sm="6">
            <div class="stat-card red">
              <div class="flex-between">
                <span class="label">平均加分</span>
                <div class="icon"><TrendCharts /></div>
              </div>
              <div class="value">{{ summary.avgScore ?? '--' }}</div>
              <div class="extra">人均加分</div>
            </div>
          </el-col>
        </el-row>

        <!-- 活动指标度量 -->
        <el-row :gutter="12" class="mt-16 activity-grid">
          <el-col :xs="12" :sm="8" :md="6" :lg="4" v-for="(item, idx) in activityMetrics" :key="idx">
            <div class="stat-card" :class="item.color">
              <div class="flex-between">
                <span class="label">{{ item.label }}</span>
                <div class="icon"><el-icon><component :is="item.icon" /></el-icon></div>
              </div>
              <div class="value">{{ item.value }}</div>
              <div class="extra">{{ item.extra }}</div>
            </div>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="mt-16">
          <el-col :xs="24" :md="14">
            <div class="card">
              <div class="card-title">{{ compareChartTitle }}</div>
              <BaseChart
                v-if="compareOption"
                :option="compareOption"
                height="340px"
              />
              <el-empty v-else description="暂无数据" />
            </div>
          </el-col>
          <el-col :xs="24" :md="10">
            <div class="card">
              <div class="card-title">各模块申报量</div>
              <BaseChart
                v-if="moduleChartOption"
                :option="moduleChartOption"
                height="340px"
              />
              <el-empty v-else description="暂无数据" />
            </div>
          </el-col>
        </el-row>

        <!-- 新图表区域 -->
        <el-row :gutter="16" class="mt-16">
          <el-col :xs="24" :md="8">
            <div class="card">
              <div class="card-title">各加分模块申报占比</div>
              <BaseChart
                v-if="moduleProportionOption"
                :option="moduleProportionOption"
                height="320px"
              />
              <el-empty v-else description="暂无数据" />
            </div>
          </el-col>
          <el-col :xs="24" :md="16">
            <div class="card">
              <div class="card-title">学生分数区间分布</div>
              <BaseChart
                v-if="scoreDistributionOption"
                :option="scoreDistributionOption"
                height="320px"
              />
              <el-empty v-else description="暂无数据" />
            </div>
          </el-col>
        </el-row>

        <div class="card mt-16">
          <div class="card-title">同层级单位通过率对比</div>
          <BaseChart
            v-if="unitComparisonOption"
            :option="unitComparisonOption"
            height="360px"
          />
          <el-empty v-else description="暂无数据" />
        </div>

        <!-- AI智能分析模块 -->
        <div class="card mt-16 ai-hub-card" v-loading="aiLoading">
          <div class="card-title">
            <span>成长数据洞察 · 规则辅助</span>
            <el-button
              type="primary"
              size="small"
              :icon="MagicStick"
              @click="handleAIAnalysis"
              :loading="aiLoading"
            >
              生成分析报告
            </el-button>
          </div>

          <template v-if="aiInsights.length || aiRisks.length || aiSuggestions.length || aiCrossComparison.length || aiAnomalyNotes.length || aiCauseAnalysis.length || aiImprovementActions.length">
            <el-row :gutter="16">
              <el-col :xs="24" :md="8" v-if="aiInsights.length">
                <div class="ai-section">
                  <div class="ai-section-title">
                    <el-icon color="#409EFF"><DataAnalysis /></el-icon>
                    <span>数据洞察</span>
                  </div>
                  <div class="ai-list">
                    <div v-for="(item, i) in aiInsights" :key="'ins-'+i" class="ai-item insight">
                      <span class="ai-dot" />
                      {{ item }}
                    </div>
                  </div>
                </div>
              </el-col>
              <el-col :xs="24" :md="8" v-if="aiRisks.length">
                <div class="ai-section">
                  <div class="ai-section-title">
                    <el-icon color="#F56C6C"><Warning /></el-icon>
                    <span>风险预警</span>
                  </div>
                  <div class="ai-list">
                    <div v-for="(item, i) in aiRisks" :key="'risk-'+i" class="ai-item risk">
                      <span class="ai-dot" />
                      {{ item }}
                    </div>
                  </div>
                </div>
              </el-col>
              <el-col :xs="24" :md="8" v-if="aiSuggestions.length">
                <div class="ai-section">
                  <div class="ai-section-title">
                    <el-icon color="#67C23A"><CircleCheck /></el-icon>
                    <span>优化建议</span>
                  </div>
                  <div class="ai-list">
                    <div v-for="(item, i) in aiSuggestions" :key="'sug-'+i" class="ai-item suggestion">
                      <span class="ai-dot" />
                      {{ item }}
                    </div>
                  </div>
                </div>
              </el-col>
            </el-row>

            <!-- 新增：多维度横向对比 -->
            <div class="ai-section mt-16" v-if="aiCrossComparison.length">
              <div class="ai-section-title">
                <el-icon color="#E6A23C"><ScaleToOriginal /></el-icon>
                <span>多维度横向对比解读</span>
              </div>
              <el-table :data="aiCrossComparison" stripe size="small" class="ai-table">
                <el-table-column prop="dimension" label="对比维度" width="180">
                  <template #default="{ row }">
                    <el-tag size="small" type="warning">{{ row.dimension }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="content" label="现状说明" min-width="280" show-overflow-tooltip />
                <el-table-column prop="benchmark" label="管理基准" min-width="240" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span style="color: #67C23A;">{{ row.benchmark }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="gap" label="差距分析" min-width="240" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span :style="{ color: String(row.gap || '').includes('合理') || String(row.gap || '').includes('已达到') ? '#67C23A' : '#F56C6C' }">{{ row.gap }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 新增：异常数据标注说明 -->
            <div class="ai-section mt-16" v-if="aiAnomalyNotes.length">
              <div class="ai-section-title">
                <el-icon color="#F56C6C"><CircleCloseFilled /></el-icon>
                <span>异常数据标注说明</span>
              </div>
              <el-table :data="aiAnomalyNotes" stripe size="small" class="ai-table">
                <el-table-column label="级别" width="90" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.level === 'high' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'">
                      {{ row.level === 'high' ? '高风险' : row.level === 'warning' ? '警告' : '提示' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="category" label="异常类别" width="140" />
                <el-table-column prop="description" label="问题描述" min-width="260" show-overflow-tooltip />
                <el-table-column prop="impact" label="业务影响" min-width="240" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span style="color: #E6A23C;">{{ row.impact }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="recommendation" label="整改建议" min-width="260" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span style="color: #409EFF;">{{ row.recommendation }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 新增：问题成因推测 -->
            <div class="ai-section mt-16" v-if="aiCauseAnalysis.length">
              <div class="ai-section-title">
                <el-icon color="#909399"><Search /></el-icon>
                <span>问题成因推测</span>
              </div>
              <el-collapse>
                <el-collapse-item v-for="(c, idx) in aiCauseAnalysis" :key="'cause-'+idx" :name="idx">
                  <template #title>
                    <span class="cause-title">
                      <el-icon color="#909399"><QuestionFilled /></el-icon>
                      &nbsp;{{ c.problem }}
                      <el-tag size="small" effect="plain" style="margin-left: 12px;">
                        置信度：{{ c.confidence || '-' }}
                      </el-tag>
                    </span>
                  </template>
                  <div class="cause-content">
                    <div v-for="(cause, ci) in c.possibleCauses || []" :key="ci" class="cause-item">
                      <el-badge :value="ci + 1" class="cause-badge" />
                      <span class="cause-text">{{ cause }}</span>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>

            <!-- 新增：可落地参考改善举措 -->
            <div class="ai-section mt-16" v-if="aiImprovementActions.length">
              <div class="ai-section-title">
                <el-icon color="#67C23A"><List /></el-icon>
                <span>可落地参考改善举措</span>
              </div>
              <el-table :data="aiImprovementActions" stripe size="small" class="ai-table">
                <el-table-column prop="order" label="序号" width="60" align="center" />
                <el-table-column label="优先级" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.priority === 'P0' ? 'danger' : row.priority === 'P1' ? 'warning' : 'info'" effect="dark">
                      {{ row.priority }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="action" label="行动名称" width="260" show-overflow-tooltip />
                <el-table-column prop="detail" label="详细执行方案" min-width="380" show-overflow-tooltip />
                <el-table-column prop="expectedEffect" label="预期效果" width="220" show-overflow-tooltip>
                  <template #default="{ row }">
                    <span style="color: #67C23A;">{{ row.expectedEffect }}</span>
                  </template>
                </el-table-column>
                <el-table-column prop="timeEstimate" label="预计周期" width="220" show-overflow-tooltip />
              </el-table>
            </div>

            <div style="text-align: right; margin-top: 16px;">
              <el-button type="success" :icon="Download" @click="exportAIReport">
                导出报告
              </el-button>
            </div>
          </template>
          <el-empty v-else-if="!aiLoading" description="点击“生成分析报告”，按当前已记录数据生成规则辅助建议" />
        </div>

        <div class="card mt-16">
          <div class="card-title">
            学生高分榜
            <el-tag v-if="currentViewScope" type="primary" effect="light" size="small" style="margin-left: 8px;">
              {{ currentViewScope }}
            </el-tag>
          </div>
          <el-table
            :data="rankingList"
            v-loading="loading"
            stripe
            height="400"
            highlight-current-row
          >
            <el-table-column label="排名" width="70" align="center">
              <template #default="{ $index }">
                <el-tag
                  v-if="$index < 3"
                  :type="['danger', 'warning', 'info'][$index]"
                  effect="dark"
                  size="small"
                >{{ $index + 1 }}</el-tag>
                <span v-else style="color:#909399;">{{ $index + 1 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="realName" label="姓名" width="100" />
            <el-table-column prop="studentNo" label="学号" width="120" />
            <el-table-column prop="college" label="院系" width="140" show-overflow-tooltip />
            <el-table-column prop="class" label="班级" width="140" show-overflow-tooltip />
            <el-table-column prop="major" label="专业" width="140" show-overflow-tooltip />
            <el-table-column prop="totalScore" label="总分" width="90" align="right" sortable />
            <el-table-column prop="appCount" label="申报数" width="80" align="right" />
            <el-table-column label="操作" width="80" fixed="right" align="center">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="viewStudent(row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!rankingList.length && !loading" description="暂无数据" />
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useUserStore } from '@/stores/user';
import BaseChart from '@/components/BaseChart.vue';
import { ElMessage } from 'element-plus';
import {
  DataBoard,
  Download,
  Refresh,
  Search,
  Trophy,
  CircleCheck,
  Warning,
  Medal,
  User,
  School,
  Document,
  TrendCharts,
  Lock,
  MagicStick,
  DataAnalysis,
  Clock,
  Bell,
  CircleClose,
  ScaleToOriginal,
  CircleCloseFilled,
  QuestionFilled,
  List,
  Calendar
} from '@element-plus/icons-vue';
import request from '@/utils/request';
import { getMySemesters } from '@/api/applications';

const userStore = useUserStore();
const role = computed(() => userStore.role);

// ========== 权限 ==========
const hasAccess = computed(() =>
  ['school_admin', 'super_admin', 'college_admin', 'counselor', 'class_admin', 'student'].includes(role.value)
);

// ========== 角色默认筛选 ==========
function getDefaultFiltersByRole() {
  const r = role.value;
  const info = userStore.userInfo || {};
  const defaults = {
    collegeId: null,
    major: '',
    grade: '',
    classId: null,
    studentId: null
  };
  
  if (r === 'student') {
    // 学生：只看自己
    defaults.studentId = info.id || null;
  } else if (r === 'class_admin') {
    // 班级管理员：只看本班
    defaults.classId = info.classId || null;
    if (info.classId) {
      const cls = classList.value.find(c => c.id === info.classId);
      if (cls?.collegeId) defaults.collegeId = cls.collegeId;
    }
  } else if (r === 'counselor') {
    // 辅导员：看所带班级
    if (info.collegeId) defaults.collegeId = info.collegeId;
    // 如果只带一个班级，默认选中该班级
    if (classList.value.length === 1) {
      defaults.classId = classList.value[0].id;
    }
  } else if (r === 'college_admin') {
    // 学院管理员：看本学院
    if (info.collegeId) defaults.collegeId = info.collegeId;
  }
  // school_admin / super_admin: 看全校，全部为 null
  
  return defaults;
}

// ========== 筛选状态（用户操作的筛选） ==========
const filters = reactive({
  collegeId: null,
  major: '',
  grade: '',
  classId: null,
  studentId: null
});

// 已应用的筛选（点击确定后才更新）
const appliedFilters = reactive({
  collegeId: null,
  major: '',
  grade: '',
  classId: null,
  studentId: null
});

const collegeList = ref([]);
const classList = ref([]);
const studentList = ref([]);
const loading = ref(false);

const majorList = computed(() => {
  const set = new Set();
  classList.value.forEach(c => {
    if (!filters.collegeId || Number(c.collegeId) === Number(filters.collegeId)) {
      if (c.major) set.add(c.major);
    }
  });
  return Array.from(set).sort();
});

const gradeList = computed(() => {
  const set = new Set();
  classList.value.forEach(c => {
    if (!filters.collegeId || Number(c.collegeId) === Number(filters.collegeId)) {
      if (!filters.major || c.major === filters.major) {
        if (c.grade) set.add(String(c.grade));
      }
    }
  });
  return Array.from(set).sort().reverse();
});

const filteredClassList = computed(() => {
  return classList.value.filter(c => {
    if (filters.collegeId && Number(c.collegeId) !== Number(filters.collegeId)) return false;
    if (filters.major && c.major !== filters.major) return false;
    if (filters.grade && String(c.grade) !== String(filters.grade)) return false;
    return true;
  });
});

// ========== 数据 ==========
const summary = ref({});
const rankingList = ref([]);
const individual = ref({});
const currentView = ref('overview');

// 学期筛选（个人视图）—— value 使用 semesterId，避免不同学期配置的(academicYear,semester)相同导致option重复
const semesterOptions = ref([]);
const selectedSemester = ref(null); // 存 semesterId

const loadSemesterOptions = async () => {
  try {
    const list = await getMySemesters();
    const arr = Array.isArray(list) ? list : (list?.list || []);
    const SEM_MAP = { first: '1', second: '2', '1': '1', '2': '2' };
    semesterOptions.value = arr.map(s => ({
      label: s.name || `${s.academicYear} 第${SEM_MAP[s.semester] || s.semester}学期`,
      value: Number(s.id),
      academicYear: s.academicYear,
      semester: s.semester
    }));
    // 默认选中：匹配当前(学年,学期)，否则选第一项
    if (semesterOptions.value.length > 0) {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const curYear = month >= 9 ? `${year}-${year+1}` : `${year-1}-${year}`;
      const curSem = (month >= 9 || month <= 1) ? 'first' : 'second';
      const hit = semesterOptions.value.find(s => s.academicYear === curYear && s.semester === curSem);
      selectedSemester.value = hit ? hit.value : semesterOptions.value[0].value;
    }
  } catch (e) {
    semesterOptions.value = [];
    selectedSemester.value = null;
  }
};

const activityData = ref({});
const moduleProportionData = ref([]);
const scoreDistributionData = ref([]);
const unitComparisonData = ref([]);

const aiLoading = ref(false);
const aiInsights = ref([]);
const aiRisks = ref([]);
const aiSuggestions = ref([]);
const aiCrossComparison = ref([]);
const aiAnomalyNotes = ref([]);
const aiCauseAnalysis = ref([]);
const aiImprovementActions = ref([]);

function formatRate(val) {
  if (val == null || val === '-' || val === '') return '--';
  if (String(val).includes('%')) return String(val);
  return String(val) + '%';
}

const activityMetrics = computed(() => {
  const d = activityData.value || {};
  return [
    { label: '活跃用户规模', value: d.activeStudents ?? '--', extra: '活跃学生数', icon: User, color: 'blue' },
    { label: '申报参与率', value: formatRate(d.submissionRate), extra: '参与学生占比', icon: TrendCharts, color: 'green' },
    { label: '人均申报频次', value: d.avgSubmissions ?? '--', extra: '人均申报项数', icon: Document, color: 'orange' },
    { label: '审批平均处理时长', value: d.avgApprovalTime ?? '--', extra: '单位: 小时', icon: Clock, color: 'purple' },
    { label: '申诉总量', value: d.appealTotal ?? '--', extra: '累计申诉数', icon: Warning, color: 'orange' },
    { label: '申诉办结率', value: formatRate(d.appealResolveRate), extra: '已办结占比', icon: CircleCheck, color: 'green' },
    { label: '申报驳回率', value: formatRate(d.rejectionRate), extra: '驳回申报占比', icon: CircleClose, color: 'red' },
    { label: '草稿留存数量', value: d.draftCount ?? '--', extra: '未提交草稿', icon: Document, color: 'purple' },
    { label: '逾期待办单据', value: d.pendingCount ?? '--', extra: '逾期未处理', icon: Bell, color: 'red' }
  ];
});

const currentViewScope = computed(() => {
  if (appliedFilters.studentId) return '个人';
  if (appliedFilters.classId) return '班级';
  if (appliedFilters.collegeId) {
    const c = collegeList.value.find(x => x.id === appliedFilters.collegeId);
    return c ? c.name : '院系';
  }
  return '全校';
});

const compareChartTitle = computed(() => {
  if (appliedFilters.collegeId) return '各班级平均分对比';
  return '各院系平均分对比';
});

// ========== 图表配置 ==========
const COLORS = ['#2563EB', '#06B6D4', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#0EA5E9', '#F97316'];

const compareOption = computed(() => {
  const data = summary.value.compareData || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: 'category',
      data: data.map(x => x.name),
      axisLabel: { rotate: data.length > 8 ? 30 : 0 }
    },
    yAxis: { type: 'value', name: '平均分' },
    series: [{
      type: 'bar',
      data: data.map((x, i) => ({
        value: Number(x.value),
        itemStyle: { color: COLORS[i % COLORS.length] }
      })),
      barWidth: '50%',
      label: { show: true, position: 'top', fontSize: 11, fontWeight: 600 },
      borderRadius: [6, 6, 0, 0]
    }]
  };
});

const moduleChartOption = computed(() => {
  const data = summary.value.moduleStats || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 80 },
    xAxis: {
      type: 'category',
      data: data.map(x => x.name),
      axisLabel: { rotate: 30, fontSize: 11 }
    },
    yAxis: { type: 'value', name: '申报数' },
    series: [{
      type: 'bar',
      data: data.map(x => x.value),
      barWidth: '60%',
      itemStyle: {
        color: '#06B6D4',
        borderRadius: [4, 4, 0, 0]
      }
    }]
  };
});

const moduleScoreOption = computed(() => {
  const data = individual.value.moduleScores || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 80 },
    xAxis: {
      type: 'category',
      data: data.map(x => x.name),
      axisLabel: { rotate: 30, fontSize: 11 }
    },
    yAxis: { type: 'value', name: '得分' },
    series: [{
      type: 'bar',
      data: data.map(x => x.score),
      barWidth: '60%',
      itemStyle: { color: '#2563EB', borderRadius: [6, 6, 0, 0] },
      label: { show: true, position: 'top', fontSize: 11 }
    }]
  };
});

const categoryPieOption = computed(() => {
  const data = individual.value.categoryData || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { orient: 'vertical', right: 10, top: 'center' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      data: data.map(x => ({ name: x.name, value: x.value })),
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 }
    }]
  };
});

const moduleProportionOption = computed(() => {
  const data = moduleProportionData.value || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, left: 'center' },
    series: [{
      type: 'pie',
      radius: ['35%', '65%'],
      center: ['50%', '45%'],
      data: data.map(x => ({ name: x.name, value: x.value })),
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%' }
    }]
  };
});

const scoreDistributionOption = computed(() => {
  const data = scoreDistributionData.value || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 50, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: 'category',
      data: data.map(x => x.name),
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: 'value', name: '人数' },
    series: [{
      type: 'bar',
      data: data.map((x, i) => ({
        value: x.value,
        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [4, 4, 0, 0] }
      })),
      barWidth: '50%',
      label: { show: true, position: 'top', fontSize: 11 }
    }]
  };
});

const unitComparisonOption = computed(() => {
  const data = unitComparisonData.value || [];
  if (!data.length) return null;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 80, right: 30, top: 30, bottom: 30 },
    xAxis: { type: 'value', name: '通过率(%)' },
    yAxis: {
      type: 'category',
      data: data.map(x => x.name),
      inverse: true
    },
    series: [{
      type: 'bar',
      data: data.map((x, i) => ({
        value: Number(x.value),
        itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 4, 4, 0] }
      })),
      barWidth: '50%',
      label: { show: true, position: 'right', fontSize: 11, formatter: '{c}%' }
    }]
  };
});

// ========== 数据加载 ==========
async function loadColleges() {
  // 学生角色不需要加载学院列表（筛选器对学生禁用）
  if (role.value === 'student') { collegeList.value = []; return; }
  try {
    let list = await request({ url: '/colleges/all', method: 'GET' });
    if (['college_admin', 'counselor'].includes(role.value) && userStore.userInfo?.collegeId) {
      list = list.filter(c => Number(c.id) === Number(userStore.userInfo.collegeId));
    }
    collegeList.value = list || [];
  } catch (_) {
    collegeList.value = [];
  }
}

async function loadClasses() {
  // 学生角色不需要加载班级列表（筛选器对学生禁用，且 /classes 接口需要管理员权限）
  if (role.value === 'student') { classList.value = []; return; }
  try {
    const params = { pageSize: 1000 };
    if (role.value === 'college_admin' && userStore.userInfo?.collegeId) {
      params.collegeId = userStore.userInfo.collegeId;
    }
    const r = await request({ url: '/classes', method: 'GET', params });
    classList.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (_) {
    classList.value = [];
  }
}

async function loadStudents(classId) {
  try {
    const params = { pageSize: 500 };
    if (classId) params.classId = classId;
    const r = await request({ url: '/users', method: 'GET', params });
    const all = Array.isArray(r) ? r : (r?.list || []);
    studentList.value = all.filter(u => u.role === 'student');
  } catch (_) {
    studentList.value = [];
  }
}

async function loadSummary() {
  if (!hasAccess.value) return;
  loading.value = true;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/summary', method: 'GET', params });
    summary.value = r || {};
  } catch (e) {
    console.error('加载汇总数据失败:', e);
    summary.value = {};
  }
}

async function loadRanking() {
  if (!hasAccess.value) return;
  try {
    const params = { scope: 'all', pageSize: 100 };
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/ranking', method: 'GET', params });
    rankingList.value = Array.isArray(r) ? r : (r?.list || []);
  } catch (_) {
    rankingList.value = [];
  }
}

async function loadIndividual(studentId) {
  if (!studentId) {
    currentView.value = 'overview';
    return;
  }
  currentView.value = 'individual';
  try {
    const params = { studentId };
    if (selectedSemester.value != null) {
      params.semesterId = selectedSemester.value;
    }
    const r = await request({ url: '/stats/dashboard/individual', method: 'GET', params });
    individual.value = r || {};
  } catch (_) {
    individual.value = {};
  }
}

async function loadActivityMetrics() {
  if (!hasAccess.value) return;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/activity', method: 'GET', params });
    activityData.value = r || {};
  } catch (_) {
    activityData.value = {};
  }
}

async function loadModuleProportion() {
  if (!hasAccess.value) return;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/module-proportion', method: 'GET', params });
    moduleProportionData.value = r?.moduleProportion || [];
  } catch (_) {
    moduleProportionData.value = [];
  }
}

async function loadScoreDistribution() {
  if (!hasAccess.value) return;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/score-distribution', method: 'GET', params });
    scoreDistributionData.value = r?.distribution || [];
  } catch (_) {
    scoreDistributionData.value = [];
  }
}

async function loadUnitComparison() {
  if (!hasAccess.value) return;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const r = await request({ url: '/stats/dashboard/unit-comparison', method: 'GET', params });
    unitComparisonData.value = r?.compareData || [];
  } catch (_) {
    unitComparisonData.value = [];
  }
}

let aiRequestVersion = 0;
function clearAIAnalysis() {
  aiRequestVersion += 1;
  aiLoading.value = false;
  aiInsights.value = [];
  aiRisks.value = [];
  aiSuggestions.value = [];
  aiCrossComparison.value = [];
  aiAnomalyNotes.value = [];
  aiCauseAnalysis.value = [];
  aiImprovementActions.value = [];
}

async function loadAIAnalysis() {
  if (!hasAccess.value) return;
  const requestVersion = ++aiRequestVersion;
  aiLoading.value = true;
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    if (appliedFilters.studentId) params.studentId = appliedFilters.studentId;
    params.scope = appliedFilters.studentId ? 'student' : appliedFilters.classId ? 'class' : appliedFilters.collegeId ? 'college' : undefined;
    const selected = semesterOptions.value.find(item => item.value === selectedSemester.value);
    if (selected) { params.academicYear = selected.academicYear; params.semester = selected.semester; }

    const r = await request({ url: '/ai-analysis/comprehensive', method: 'GET', params });
    if (requestVersion !== aiRequestVersion) return;
    // 处理洞察数据 - 将对象转换为字符串数组
    aiInsights.value = (r?.insights || []).map(i => i.content || i.text || String(i));
    aiRisks.value = (r?.risks || []).map(i => (i.title ? i.title + '：' : '') + (i.desc || i.content || String(i)));
    aiSuggestions.value = (r?.suggestions || []).map(s => typeof s === 'string' ? s : (s.content || String(s)));
    aiCrossComparison.value = r?.crossComparison || [];
    aiAnomalyNotes.value = r?.anomalyNotes || [];
    aiCauseAnalysis.value = r?.causeAnalysis || [];
    aiImprovementActions.value = r?.improvementActions || [];
  } catch (_) {
    if (requestVersion !== aiRequestVersion) return;
    aiInsights.value = [];
    aiRisks.value = [];
    aiSuggestions.value = [];
    aiCrossComparison.value = [];
    aiAnomalyNotes.value = [];
    aiCauseAnalysis.value = [];
    aiImprovementActions.value = [];
    ElMessage.error('成长数据洞察加载失败');
  } finally {
    if (requestVersion === aiRequestVersion) aiLoading.value = false;
  }
}

// ========== 事件 ==========
function onCollegeChange() {
  filters.major = '';
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  studentList.value = [];
}

function onMajorChange() {
  filters.grade = '';
  filters.classId = null;
  filters.studentId = null;
  studentList.value = [];
}

function onClassChange() {
  filters.studentId = null;
  loadStudents(filters.classId);
}

async function onConfirm() {
  clearAIAnalysis();
  loading.value = true;

  // 同步筛选条件到已应用的筛选
  appliedFilters.collegeId = filters.collegeId;
  appliedFilters.major = filters.major;
  appliedFilters.grade = filters.grade;
  appliedFilters.classId = filters.classId;
  appliedFilters.studentId = filters.studentId;

  // 如果选择了学生，加载个人数据；否则加载汇总和排名
  if (appliedFilters.studentId) {
    await loadIndividual(appliedFilters.studentId);
  } else {
    currentView.value = 'overview';
    await Promise.all([
      loadSummary(),
      loadRanking(),
      loadActivityMetrics(),
      loadModuleProportion(),
      loadScoreDistribution(),
      loadUnitComparison()
    ]);
  }

  loading.value = false;
}

function resetFilters() {
  const defaults = getDefaultFiltersByRole();
  filters.collegeId = defaults.collegeId;
  filters.major = defaults.major;
  filters.grade = defaults.grade;
  filters.classId = defaults.classId;
  filters.studentId = defaults.studentId;
  appliedFilters.collegeId = defaults.collegeId;
  appliedFilters.major = defaults.major;
  appliedFilters.grade = defaults.grade;
  appliedFilters.classId = defaults.classId;
  appliedFilters.studentId = defaults.studentId;
  studentList.value = [];
  currentView.value = appliedFilters.studentId ? 'individual' : 'overview';
  summary.value = {};
  rankingList.value = [];
  individual.value = {};
  activityData.value = {};
  moduleProportionData.value = [];
  scoreDistributionData.value = [];
  unitComparisonData.value = [];
  aiInsights.value = [];
  aiRisks.value = [];
  aiSuggestions.value = [];
  aiCrossComparison.value = [];
  aiAnomalyNotes.value = [];
  aiCauseAnalysis.value = [];
  aiImprovementActions.value = [];
  // 重置后自动加载数据
  onConfirm();
}

function viewStudent(row) {
  clearAIAnalysis();
  if (row.studentId) {
    filters.studentId = row.studentId;
    onConfirm();
  }
}

function onSemesterChange() {
  clearAIAnalysis();
  if (appliedFilters.studentId) {
    loadIndividual(appliedFilters.studentId);
  }
}

// ========== 导出 ==========
async function exportCurrentView() {
  try {
    const params = {};
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    const blob = await request({
      url: '/stats/dashboard/export',
      method: 'GET',
      params,
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([blob]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `数据看板_${currentViewScope.value}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error('导出失败');
  }
}

async function exportIndividualArchive() {
  if (!appliedFilters.studentId) {
    ElMessage.warning('请先选择学生');
    return;
  }
  try {
    const blob = await request({
      url: '/stats/dashboard/individual/export',
      method: 'GET',
      params: { studentId: appliedFilters.studentId },
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([blob]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `考评档案_${individual.value.studentName || '学生'}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (_) {
    ElMessage.error('导出失败');
  }
}

function handleAIAnalysis() {
  loadAIAnalysis();
}

async function exportAIReport() {
  try {
    const params = { format: 'xlsx' };
    if (appliedFilters.collegeId) params.collegeId = appliedFilters.collegeId;
    if (appliedFilters.major) params.major = appliedFilters.major;
    if (appliedFilters.grade) params.grade = appliedFilters.grade;
    if (appliedFilters.classId) params.classId = appliedFilters.classId;

    if (appliedFilters.studentId) params.studentId = appliedFilters.studentId;
    params.scope = appliedFilters.studentId ? 'student' : appliedFilters.classId ? 'class' : appliedFilters.collegeId ? 'college' : undefined;
    const selected = semesterOptions.value.find(item => item.value === selectedSemester.value);
    if (selected) { params.academicYear = selected.academicYear; params.semester = selected.semester; }

    const blob = await request({
      url: '/ai-analysis/report',
      method: 'GET',
      params,
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([blob]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `成长数据分析报告_${currentViewScope.value}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    ElMessage.success('报告导出成功');
  } catch (_) {
    ElMessage.error('报告导出失败');
  }
}

// ========== 辅助 ==========
function statusTagType(status) {
  const map = {
    approved: 'success',
    final_review: '',
    rejected: 'danger',
    revoked: 'info',
    appealing: 'warning',
    draft: 'info'
  };
  return map[status] || 'info';
}

function statusText(status) {
  const map = {
    draft: '草稿',
    submitted: '待审批',
    approved: '已通过',
    final_review: '辅导员终审',
    rejected: '已驳回',
    revoked: '已撤回',
    appealing: '申诉中',
    appeal_closed: '申诉办结',
    returned: '已退回'
  };
  return map[status] || status || '--';
}

// ========== 初始化 ==========
onMounted(async () => {
  if (!hasAccess.value) return;
  await Promise.all([loadColleges(), loadClasses(), loadSemesterOptions()]);

  // 根据角色设置默认筛选条件
  const defaults = getDefaultFiltersByRole();
  filters.collegeId = defaults.collegeId;
  filters.major = defaults.major;
  filters.grade = defaults.grade;
  filters.classId = defaults.classId;
  filters.studentId = defaults.studentId;

  // 默认加载数据
  await onConfirm();
});
</script>

<style lang="scss" scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 0;
  gap: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  margin: 12px 16px 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  flex-wrap: wrap;
  gap: 12px;
}

.filter-items {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.filter-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.stat-card {
  border-radius: 10px;
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  border: none;

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }

  .flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .label {
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    opacity: 0.9;
    letter-spacing: 0.5px;
  }

  .value {
    font-size: 32px;
    font-weight: 700;
    margin: 10px 0 6px;
    line-height: 1.2;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .extra {
    color: #fff;
    font-size: 12px;
    opacity: 0.85;
  }

  .icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(4px);
    color: #fff;
  }

  &.blue {
    background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }
  &.green {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }
  &.orange {
    background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
    box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
  }
  &.red {
    background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
  }
  &.purple {
    background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
  }
}

.mt-16 {
  margin-top: 16px;
}

.semester-filter {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px 0;
  font-size: 14px;
  color: #606266;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #ebeef5;

  .card-title {
    font-size: 15px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}

.ai-section {
  padding: 12px;
  background: #f8f9fb;
  border-radius: 8px;
  height: 100%;

  .ai-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 14px;
    color: #303133;
    margin-bottom: 10px;
  }

  .ai-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: #606266;
    padding: 8px 10px;
    border-radius: 6px;
    background: #fff;
    border: 1px solid #ebeef5;

    &.insight {
      border-left: 3px solid #409EFF;
    }
    &.risk {
      border-left: 3px solid #F56C6C;
    }
    &.suggestion {
      border-left: 3px solid #67C23A;
    }
  }

  .ai-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 7px;
    background: #c0c4cc;
  }

  .ai-item.insight .ai-dot { background: #409EFF; }
  .ai-item.risk .ai-dot { background: #F56C6C; }
  .ai-item.suggestion .ai-dot { background: #67C23A; }

  .ai-table {
    margin-top: 8px;
    background: #fff;
    border-radius: 6px;
    overflow: hidden;
    :deep(.el-table__header th) {
      background: #f5f7fa;
    }
  }

  .cause-title {
    display: inline-flex;
    align-items: center;
    font-weight: 500;
    font-size: 14px;
    color: #303133;
  }

  .cause-content {
    padding: 8px 4px 4px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cause-item {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 10px 14px;
    background: #fff;
    border: 1px solid #ebeef5;
    border-radius: 6px;
    border-left: 3px solid #909399;

    .cause-badge {
      flex-shrink: 0;
      margin-top: 2px;
      :deep(.el-badge__content) {
        background-color: #909399;
      }
    }

  .cause-text {
      flex: 1;
      font-size: 13px;
      line-height: 1.7;
      color: #606266;
    }
  }
}

.dashboard-page { min-width: 0; }
.dashboard-header {
  min-height: 176px; padding: 28px 32px; border-radius: 24px; overflow: hidden; position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 28px; color: #fff;
  background:
    radial-gradient(circle at 78% 4%, rgba(31,211,238,.32), transparent 20rem),
    linear-gradient(118deg, #10265F 0%, #164B9A 58%, #087FB6 100%);
  box-shadow: 0 20px 48px rgba(12,45,105,.19);
  &::after { content: ''; position: absolute; width: 430px; height: 142px; right: 50px; top: 14px; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; transform: rotate(-16deg); }
}
.dashboard-title { position: relative; z-index: 2; }
.dashboard-kicker {
  display: flex; align-items: center; gap: 8px; color: #A7EAF5; font-size: 10px; font-weight: 800; letter-spacing: .18em;
  span { width: 22px; height: 2px; border-radius: 99px; background: #FFBE0B; box-shadow: 0 0 12px rgba(255,190,11,.7); }
}
.dashboard-title h1 {
  display: flex; align-items: center; gap: 11px; margin: 12px 0 8px; font-size: 30px; line-height: 1.2; letter-spacing: -.035em;
  .el-icon { color: #6DE6F2; }
}
.dashboard-title p { margin: 0; color: #CBE6F2; font-size: 13px; }
.dashboard-actions {
  position: relative; z-index: 3; display: flex; gap: 9px;
  :deep(.el-button) { min-height: 40px; padding: 0 17px; border-radius: 11px; border-color: rgba(255,255,255,.34); background: rgba(255,255,255,.13); color: #fff; box-shadow: none; backdrop-filter: blur(9px); }
  :deep(.el-button:hover) { background: rgba(255,255,255,.22); border-color: rgba(255,255,255,.55); transform: translateY(-1px); }
}
.dashboard-watermark { position: absolute; z-index: 1; width: 184px; height: 184px; object-fit: contain; right: 20%; top: -10px; opacity: .13; filter: grayscale(1) brightness(3); pointer-events: none; }

.filter-bar { margin: 18px 0 0; padding: 18px 20px; background: rgba(255,255,255,.97); border: 1px solid rgba(210,222,239,.9); border-radius: 18px; box-shadow: 0 12px 32px rgba(22,44,84,.06); }
.filter-heading {
  display: flex; align-items: center; gap: 11px; margin-bottom: 15px;
  strong { display: block; color: #17233B; font-size: 14px; }
  span { display: block; margin-top: 2px; color: #94A3B8; font-size: 11px; }
}
.filter-heading-icon { width: 36px; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; color: #2563EB; background: #EAF2FF; }
.filter-control { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.filter-items { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; }
.filter-actions { display: flex; gap: 8px; margin-left: auto; flex-shrink: 0; }
:deep(.filter-items .el-select__wrapper) { min-height: 38px; background: #F6F9FD; box-shadow: 0 0 0 1px #E2EAF4 inset; }
:deep(.filter-actions .el-button) { min-height: 38px; border-radius: 10px; }

.mt-16 { margin-top: 18px; }
.semester-filter { display: flex; align-items: center; gap: 7px; margin-top: 18px; padding: 14px 17px; color: #52647E; font-size: 13px; background: #fff; border: 1px solid #DCE6F2; border-radius: 14px; }

.stat-card {
  --accent: #2563EB; --soft: #EAF2FF; --glow: rgba(37,99,235,.16);
  min-height: 142px; margin-bottom: 0; padding: 20px 21px; border-radius: 17px; position: relative; overflow: hidden;
  background: rgba(255,255,255,.98); border: 1px solid rgba(210,222,239,.88);
  box-shadow: 0 12px 30px rgba(22,44,84,.06); transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
  &::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg, var(--accent), transparent 78%); }
  &::after { content: ''; position: absolute; width: 112px; height: 112px; right: -42px; bottom: -52px; border: 18px solid var(--soft); border-radius: 50%; opacity: .72; }
  &:hover { transform: translateY(-3px); border-color: var(--glow); box-shadow: 0 18px 40px rgba(22,44,84,.1); }
  .flex-between { display: flex; justify-content: space-between; align-items: center; }
  .label { color: #64748B; font-size: 12px; font-weight: 650; letter-spacing: .04em; opacity: 1; }
  .value { position: relative; z-index: 1; margin: 10px 0 5px; color: #17233B; font-size: 30px; line-height: 1.2; font-weight: 780; letter-spacing: -.03em; text-shadow: none; }
  .extra { position: relative; z-index: 1; color: #98A6B9; font-size: 11px; opacity: 1; }
  .icon { width: 39px; height: 39px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--accent); background: var(--soft); backdrop-filter: none; }
  &.blue { --accent: #2563EB; --soft: #EAF2FF; --glow: rgba(37,99,235,.16); background: #fff; box-shadow: 0 12px 30px rgba(22,44,84,.06); }
  &.green { --accent: #0F9F82; --soft: #E5F8F3; --glow: rgba(15,159,130,.17); background: #fff; box-shadow: 0 12px 30px rgba(22,44,84,.06); }
  &.orange { --accent: #E99708; --soft: #FFF4D9; --glow: rgba(233,151,8,.18); background: #fff; box-shadow: 0 12px 30px rgba(22,44,84,.06); }
  &.red { --accent: #E34F6F; --soft: #FFEAF0; --glow: rgba(227,79,111,.16); background: #fff; box-shadow: 0 12px 30px rgba(22,44,84,.06); }
  &.purple { --accent: #7C5CE5; --soft: #F0ECFF; --glow: rgba(124,92,229,.17); background: #fff; box-shadow: 0 12px 30px rgba(22,44,84,.06); }
}
.activity-grid .stat-card {
  min-height: 124px; padding: 17px 18px;
  .value { font-size: 25px; margin-top: 7px; }
  .icon { width: 34px; height: 34px; border-radius: 10px; }
}

.card { padding: 20px; border: 1px solid rgba(210,222,239,.86); border-radius: 18px; background: rgba(255,255,255,.98); box-shadow: 0 12px 34px rgba(22,44,84,.06), 0 2px 7px rgba(22,44,84,.03); }
.card .card-title {
  min-height: 30px; margin: 0 0 14px; padding-left: 13px; position: relative; display: flex; align-items: center; justify-content: space-between; color: #1B2B47; font-size: 15px; font-weight: 750;
  &::before { content: ''; position: absolute; left: 0; top: 50%; width: 4px; height: 16px; border-radius: 99px; background: linear-gradient(#2563EB, #06B6D4); transform: translateY(-50%); }
}
.ai-hub-card { border-color: rgba(99,102,241,.18); background: linear-gradient(180deg, #FFFFFF, #FBFCFF); }
.ai-hub-card > .card-title { margin: -20px -20px 18px; padding: 17px 20px 17px 34px; background: linear-gradient(90deg, #F2F5FF, #F5FCFF); border-bottom: 1px solid #E4EAF7; }
.ai-hub-card > .card-title::before { left: 20px; }

.ai-section {
  height: 100%; padding: 15px; border: 1px solid #E5ECF5; border-radius: 14px; background: #F7F9FC;
  .ai-section-title { display: flex; align-items: center; gap: 7px; margin-bottom: 11px; color: #263752; font-size: 13px; font-weight: 750; }
  .ai-list { display: flex; flex-direction: column; gap: 8px; }
  .ai-item {
    display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; color: #55657E; font-size: 12px; line-height: 1.65; border: 1px solid #E6ECF4; border-radius: 10px; background: #fff;
    &.insight { border-left: 3px solid #2563EB; }
    &.risk { border-left: 3px solid #E34F6F; }
    &.suggestion { border-left: 3px solid #0F9F82; }
  }
  .ai-dot { width: 6px; height: 6px; margin-top: 7px; border-radius: 50%; flex-shrink: 0; background: #94A3B8; }
  .ai-item.insight .ai-dot { background: #2563EB; }
  .ai-item.risk .ai-dot { background: #E34F6F; }
  .ai-item.suggestion .ai-dot { background: #0F9F82; }
  .ai-table { margin-top: 8px; border-radius: 10px; overflow: hidden; }
  .cause-title { display: inline-flex; align-items: center; color: #33435D; font-size: 13px; font-weight: 650; }
  .cause-content { padding: 8px 4px 4px; display: flex; flex-direction: column; gap: 9px; }
  .cause-item { display: flex; align-items: flex-start; gap: 14px; padding: 11px 13px; border: 1px solid #E5ECF5; border-left: 3px solid #94A3B8; border-radius: 10px; background: #fff; }
  .cause-badge { flex-shrink: 0; margin-top: 2px; :deep(.el-badge__content) { background-color: #64748B; } }
  .cause-text { flex: 1; color: #596980; font-size: 12px; line-height: 1.7; }
}

@include tablet {
  .filter-control { align-items: stretch; flex-direction: column; }
  .filter-actions { margin-left: 0; }
}
@include mobile {
  .dashboard-header { min-height: 0; padding: 24px 20px; border-radius: 18px; align-items: flex-start; flex-direction: column; }
  .dashboard-title h1 { font-size: 24px; }
  .dashboard-actions { width: 100%; :deep(.el-button) { flex: 1; } }
  .dashboard-watermark { width: 130px; height: 130px; right: -8px; top: 8px; }
  .filter-bar { padding: 16px; }
  .filter-items { align-items: stretch; flex-direction: column; }
  :deep(.filter-items .el-select) { width: 100% !important; }
  .filter-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .metric-grid .el-col, .activity-grid .el-col { margin-bottom: 12px; }
  .stat-card { min-height: 126px; padding: 17px; .value { font-size: 25px; } }
  .card { padding: 16px; }
}
</style>
