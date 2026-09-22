<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="SCORING FORMULA" title="综测公式配置" description="按学院配置五育计算参数和总分公式，修改前可测试，保存后统一用于综测计算。">
      <template #actions>
        <div class="hero-actions-group">
        <el-button v-if="isSchoolAbove" @click="loadColleges">
          <el-icon><Refresh /></el-icon> 刷新学院
        </el-button>
        <el-button @click="loadConfig" :loading="loading">
          <el-icon><Refresh /></el-icon> 重新加载
        </el-button>
        <el-button type="warning" @click="confirmReset" :disabled="!config.isCustom">
          重置为默认
        </el-button>
        <el-button type="primary" @click="saveConfig" :loading="saving">
          <el-icon><Check /></el-icon> 保存配置
        </el-button>
        </div>
      </template>
    </WorkspaceHero>

    <!-- 顶部状态提示 -->
    <el-alert
      :title="config.isCustom ? `当前使用自定义配置（${config.name || '未命名'}）` : '当前使用系统默认配置'"
      :type="config.isCustom ? 'success' : 'info'"
      :description="config.isCustom ? '本学院已配置自定义综测公式，将按本配置计算所有综测结果。' : '尚未为本学院创建自定义配置，所有综测结果按系统默认公式计算。'"
      show-icon
      :closable="false"
      class="mb-16"
    />

    <!-- 学校管理员选择学院 -->
    <div v-if="isSchoolAbove" class="card mb-16">
      <el-form inline>
        <el-form-item label="目标学院">
          <el-select v-model="selectedCollegeId" placeholder="请选择学院" style="width:280px" @change="loadConfig">
            <el-option
              v-for="c in collegeList"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <span style="color:#909399; font-size:12px;">
            学校管理员可为任意学院配置公式；院级管理员只能配置本学院
          </span>
        </el-form-item>
      </el-form>
    </div>

    <!-- 主表单 -->
    <div class="card mb-16" v-loading="loading">
      <el-form :model="config" label-width="140px" label-position="right">
        <el-form-item label="配置名称">
          <el-input v-model="config.name" placeholder="如：计算机学院2026综测公式" style="max-width:400px" />
        </el-form-item>

        <!-- ========== 模块参数 ========== -->
        <el-divider content-position="left">
          <el-icon><Trophy /></el-icon> 各模块参数
        </el-divider>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="德育 F1 满分">
              <el-input-number v-model="config.f1Max" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="德育基础分">
              <el-input-number v-model="config.f1Base" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="智育 F2 满分">
              <el-input-number v-model="config.f2Max" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="F2a 权重">
              <el-input-number v-model="config.f2aWeight" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="F2b 权重">
              <el-input-number v-model="config.f2bWeight" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="F2b 奖励分上限">
              <el-input-number v-model="config.f2bMax" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="智育映射系数">
              <el-input-number v-model="config.f2Scale" :min="0" :max="2" :step="0.05" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <div style="margin-left:140px; color:#909399; font-size:12px; margin-top:-10px; margin-bottom:10px;">
          提示：F2a 权重 + F2b 权重 应等于 1
        </div>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="体育 F3 满分">
              <el-input-number v-model="config.f3Max" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="体育基础分">
              <el-input-number v-model="config.f3Base" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="美育 F4 满分">
              <el-input-number v-model="config.f4Max" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="美育基础分">
              <el-input-number v-model="config.f4Base" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="劳育 F5 满分">
              <el-input-number v-model="config.f5Max" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="劳育基础分">
              <el-input-number v-model="config.f5Base" :min="0" :max="100" :precision="2" controls-position="right" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- ========== 自定义公式 ========== -->
        <el-divider content-position="left">
          <el-icon><EditPen /></el-icon> 自定义公式表达式
          <span style="font-size:12px; color:#909399; margin-left:8px;">（留空则使用默认公式）</span>
        </el-divider>

        <el-form-item label="德育 F1 公式">
          <div style="width:100%;">
            <el-input v-model="config.f1Formula" placeholder="例：F1_BASE + F1_BONUS - F1_DEDUCT" clearable />
            <div class="formula-vars">变量：F1_BASE（基础分）, F1_BONUS（加分）, F1_DEDUCT（扣分）</div>
          </div>
        </el-form-item>

        <el-form-item label="智育 F2 公式">
          <div style="width:100%;">
            <el-input v-model="config.f2Formula" placeholder="例：(F2A * F2A_W + F2B * F2B_W) * F2_SCALE" clearable />
            <div class="formula-vars">变量：F2A（学分加权平均）, F2B（奖励分）, F2A_W, F2B_W（权重）, F2_SCALE（映射系数）</div>
          </div>
        </el-form-item>

        <el-form-item label="体育 F3 公式">
          <div style="width:100%;">
            <el-input v-model="config.f3Formula" placeholder="例：F3_BASE + F3_BONUS - F3_DEDUCT" clearable />
            <div class="formula-vars">变量：F3_BASE, F3_BONUS, F3_DEDUCT</div>
          </div>
        </el-form-item>

        <el-form-item label="美育 F4 公式">
          <div style="width:100%;">
            <el-input v-model="config.f4Formula" placeholder="例：F4_BASE + F4_BONUS - F4_DEDUCT" clearable />
            <div class="formula-vars">变量：F4_BASE, F4_BONUS, F4_DEDUCT</div>
          </div>
        </el-form-item>

        <el-form-item label="劳育 F5 公式">
          <div style="width:100%;">
            <el-input v-model="config.f5Formula" placeholder="例：F5_BASE + F5_PRACTICE" clearable />
            <div class="formula-vars">变量：F5_BASE, F5_PRACTICE（实践分）</div>
          </div>
        </el-form-item>

        <el-form-item label="总分公式">
          <div style="width:100%;">
            <el-input v-model="config.totalFormula" placeholder="例：F1 + F2 + F3 + F4 + F5" clearable />
            <div class="formula-vars">变量：F1, F2, F3, F4, F5（各模块得分）</div>
          </div>
        </el-form-item>

        <el-form-item label="可用函数">
          <div class="formula-vars" style="line-height:1.8;">
            <el-tag size="small" type="info">min(a,b,...)</el-tag>
            <el-tag size="small" type="info">max(a,b,...)</el-tag>
            <el-tag size="small" type="info">abs(x)</el-tag>
            <el-tag size="small" type="info">round(x)</el-tag>
            <el-tag size="small" type="info">floor(x)</el-tag>
            <el-tag size="small" type="info">ceil(x)</el-tag>
            <el-tag size="small" type="info">sqrt(x)</el-tag>
            <el-tag size="small" type="info">pow(x,y)</el-tag>
            <el-tag size="small" type="info">clamp(v,lo,hi)</el-tag>
            <el-tag size="small" type="info">if(cond,a,b)</el-tag>
            <el-tag size="small" type="info">常量 PI, E</el-tag>
          </div>
        </el-form-item>

        <!-- ========== 公式测试 ========== -->
        <el-divider content-position="left">
          <el-icon><Cpu /></el-icon> 公式测试
        </el-divider>

        <el-form-item label="测试公式">
          <div style="width:100%;">
            <el-input v-model="testForm.formula" placeholder="输入要测试的公式，如 F1 + F2 * 0.7" />
          </div>
        </el-form-item>
        <el-form-item label="变量值 (JSON)">
          <div style="width:100%;">
            <el-input
              v-model="testForm.varsText"
              type="textarea"
              :rows="3"
              placeholder='{"F1": 14, "F2": 48.92}'
            />
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="runTest" :loading="testing">
            <el-icon><VideoPlay /></el-icon> 执行测试
          </el-button>
          <span v-if="testResult !== null" style="margin-left:16px;">
            结果：
            <el-tag v-if="testResult.ok" type="success">{{ testResult.result }}</el-tag>
            <el-tag v-else type="danger">错误：{{ testResult.error }}</el-tag>
          </span>
        </el-form-item>

        <!-- ========== category 映射 ========== -->
        <el-divider content-position="left">
          <el-icon><Connection /></el-icon> 加分模块 category 映射
          <span style="font-size:12px; color:#909399; margin-left:8px;">（将加分模块的 category 字段映射到综测5大模块）</span>
        </el-divider>

        <el-table :data="categoryRows" border size="small" style="margin-bottom:16px;">
          <el-table-column prop="category" label="Category" width="180" />
          <el-table-column label="映射到" width="180">
            <template #default="{row}">
              <el-select v-model="row.target" size="small" style="width:100%">
                <el-option label="德育 F1" value="F1" />
                <el-option label="智育奖励分 F2b" value="F2b" />
                <el-option label="体育 F3" value="F3" />
                <el-option label="美育 F4" value="F4" />
                <el-option label="劳育 F5" value="F5" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column prop="desc" label="说明" />
        </el-table>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getEvaluationConfig, saveEvaluationConfig, resetEvaluationConfig,
  testFormula, getFormulaDefaults
} from '@/api/evaluation';
import { getCollegeList } from '@/api/college';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const role = computed(() => userStore.userInfo?.role);
const isSchoolAbove = computed(() => ['school_admin', 'super_admin'].includes(role.value));

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const testResult = ref(null);

const collegeList = ref([]);
const selectedCollegeId = ref(null);

// 默认 category 列表
const DEFAULT_CATEGORIES = [
  { category: 'moral',       target: 'F1',  desc: '德育（思想德育表现）' },
  { category: 'morality',    target: 'F1',  desc: '德育（品德表彰奖励）' },
  { category: 'attendance',  target: 'F1',  desc: '德育（日常考勤）' },
  { category: 'leadership',  target: 'F1',  desc: '德育（学生干部任职）' },
  { category: 'competition', target: 'F2b', desc: '智育奖励分（学科竞赛获奖）' },
  { category: 'certificate', target: 'F2b', desc: '智育奖励分（技能证书获取）' },
  { category: 'innovation',  target: 'F2b', desc: '智育奖励分（创新创业项目）' },
  { category: 'academic',    target: 'F2b', desc: '智育奖励分（论文/专利）' },
  { category: 'sports',      target: 'F3',  desc: '体育（文体活动参与）' },
  { category: 'sports_arts', target: 'F3',  desc: '体育/美育（文体活动获奖）' },
  { category: 'volunteer',   target: 'F5',  desc: '劳育（志愿服务活动）' }
];

const categoryRows = ref(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)));

const config = reactive({
  id: null,
  collegeId: null,
  name: '综测公式配置',
  // 模块上限
  f1Max: 15, f2Max: 70, f3Max: 5, f4Max: 5, f5Max: 5,
  // 基础分
  f1Base: 9, f3Base: 3, f4Base: 0, f5Base: 0,
  // 智育参数
  f2aWeight: 0.8, f2bWeight: 0.2, f2bMax: 14, f2Scale: 0.7,
  // 公式
  f1Formula: '', f2Formula: '', f3Formula: '', f4Formula: '', f5Formula: '', totalFormula: '',
  // 映射
  categoryMapping: null,
  isCustom: false,
  isDefault: true
});

const testForm = reactive({
  formula: 'F1 + F2 + F3 + F4 + F5',
  varsText: '{"F1": 14, "F2": 48.92, "F3": 4.5, "F4": 0, "F5": 2}'
});

// 加载学院列表
async function loadColleges() {
  try {
    const res = await getCollegeList({ pageSize: 1000 });
    collegeList.value = res.list || res || [];
  } catch (e) {
    console.error('加载学院失败', e);
  }
}

// 加载配置
async function loadConfig() {
  loading.value = true;
  try {
    const params = {};
    if (isSchoolAbove.value && selectedCollegeId.value) {
      params.collegeId = selectedCollegeId.value;
    }
    const res = await getEvaluationConfig(params);

    // 写入 config
    Object.assign(config, {
      id: res.id || null,
      collegeId: res.collegeId || null,
      name: res.name || '综测公式配置',
      f1Max: Number(res.f1Max ?? 15),
      f2Max: Number(res.f2Max ?? 70),
      f3Max: Number(res.f3Max ?? 5),
      f4Max: Number(res.f4Max ?? 5),
      f5Max: Number(res.f5Max ?? 5),
      f1Base: Number(res.f1Base ?? 9),
      f3Base: Number(res.f3Base ?? 3),
      f4Base: Number(res.f4Base ?? 0),
      f5Base: Number(res.f5Base ?? 0),
      f2aWeight: Number(res.f2aWeight ?? 0.8),
      f2bWeight: Number(res.f2bWeight ?? 0.2),
      f2bMax: Number(res.f2bMax ?? 14),
      f2Scale: Number(res.f2Scale ?? 0.7),
      f1Formula: res.f1Formula || '',
      f2Formula: res.f2Formula || '',
      f3Formula: res.f3Formula || '',
      f4Formula: res.f4Formula || '',
      f5Formula: res.f5Formula || '',
      totalFormula: res.totalFormula || '',
      isCustom: !!res.isCustom,
      isDefault: !!res.isDefault
    });

    // 同步 category 映射
    const mapping = res.categoryMapping || {};
    const merged = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    merged.forEach(row => {
      if (mapping[row.category]) row.target = mapping[row.category];
    });
    categoryRows.value = merged;
  } catch (e) {
    ElMessage.error('加载配置失败：' + (e.message || e));
  } finally {
    loading.value = false;
  }
}

// 保存配置
async function saveConfig() {
  // 前端校验
  if (Math.abs(Number(config.f2aWeight) + Number(config.f2bWeight) - 1) > 0.001) {
    ElMessage.warning('智育 F2a 权重 + F2b 权重 必须等于 1');
    return;
  }

  // 构建 categoryMapping
  const categoryMapping = {};
  categoryRows.value.forEach(row => {
    categoryMapping[row.category] = row.target;
  });

  saving.value = true;
  try {
    const payload = {
      name: config.name,
      f1Max: config.f1Max, f2Max: config.f2Max, f3Max: config.f3Max, f4Max: config.f4Max, f5Max: config.f5Max,
      f1Base: config.f1Base, f3Base: config.f3Base, f4Base: config.f4Base, f5Base: config.f5Base,
      f2aWeight: config.f2aWeight, f2bWeight: config.f2bWeight, f2bMax: config.f2bMax, f2Scale: config.f2Scale,
      f1Formula: config.f1Formula, f2Formula: config.f2Formula, f3Formula: config.f3Formula,
      f4Formula: config.f4Formula, f5Formula: config.f5Formula, totalFormula: config.totalFormula,
      categoryMapping
    };
    if (isSchoolAbove.value && selectedCollegeId.value) {
      payload.collegeId = selectedCollegeId.value;
    }

    const res = await saveEvaluationConfig(payload);
    Object.assign(config, {
      id: res.id,
      isCustom: true,
      isDefault: false
    });
    ElMessage.success('配置保存成功');
  } catch (e) {
    ElMessage.error('保存失败：' + (e.message || e));
  } finally {
    saving.value = false;
  }
}

// 重置为默认
async function confirmReset() {
  try {
    await ElMessageBox.confirm(
      '确定要将本学院的综测公式重置为系统默认吗？已保存的自定义配置将被禁用。',
      '确认重置',
      { type: 'warning', confirmButtonText: '确认重置', cancelButtonText: '取消' }
    );
  } catch (_) {
    return;
  }

  try {
    const payload = {};
    if (isSchoolAbove.value && selectedCollegeId.value) {
      payload.collegeId = selectedCollegeId.value;
    }
    const res = await resetEvaluationConfig(payload);
    ElMessage.success(res.message || '已重置为默认配置');
    await loadConfig();
  } catch (e) {
    ElMessage.error('重置失败：' + (e.message || e));
  }
}

// 测试公式
async function runTest() {
  if (!testForm.formula) {
    ElMessage.warning('请输入测试公式');
    return;
  }
  let vars = {};
  try {
    vars = JSON.parse(testForm.varsText || '{}');
  } catch (e) {
    ElMessage.error('变量值 JSON 格式错误');
    return;
  }
  testing.value = true;
  try {
    const res = await testFormula({ formula: testForm.formula, vars });
    testResult.value = res;
  } catch (e) {
    testResult.value = { ok: false, error: e.message || String(e), result: null };
  } finally {
    testing.value = false;
  }
}

onMounted(async () => {
  if (isSchoolAbove.value) {
    await loadColleges();
    // 默认选第一个学院
    if (collegeList.value.length > 0) {
      selectedCollegeId.value = collegeList.value[0].id;
    }
  }
  await loadConfig();
});
</script>

<style scoped>
.formula-vars {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
  line-height: 1.6;
}
.mb-16 { margin-bottom: 16px; }
.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card {
  background: #fff;
  border-radius: 6px;
  padding: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.page-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 600;
}
</style>
