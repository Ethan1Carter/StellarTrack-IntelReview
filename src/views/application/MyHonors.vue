<template>
  <div class="my-honors">
    <WorkspaceHero
      eyebrow="MY HONORS"
      title="我的荣誉"
      description="汇总在校期间已认定的获奖记录，清晰呈现每一份努力与成果。"
    >
      <template #actions>
        <el-button @click="$router.push('/my-applications')">
          <el-icon><Tickets /></el-icon> 查看申报
        </el-button>
      </template>
    </WorkspaceHero>

    <section class="honor-overview" v-loading="loading">
      <div class="total-panel">
        <div class="total-icon"><el-icon><Medal /></el-icon></div>
        <div>
          <div class="total-label">已获荣誉</div>
          <div class="total-value">{{ data.total }}<span>项</span></div>
        </div>
        <div class="total-caption">仅统计已通过或已终审的获奖申报</div>
      </div>
      <div class="level-grid">
        <button
          v-for="item in levels"
          :key="item.key"
          class="level-card"
          :class="{ active: levelFilter === item.key }"
          type="button"
          @click="toggleLevel(item.key)"
        >
          <span class="level-mark" :style="{ background: item.color }"></span>
          <span class="level-name">{{ item.label }}</span>
          <strong>{{ data.levelCounts[item.key] || 0 }}</strong>
        </button>
      </div>
    </section>

    <section class="honor-list card">
      <div class="toolbar">
        <div class="card-heading">
          <el-icon><CollectionTag /></el-icon>
          <span>荣誉明细</span>
          <em>{{ filteredHonors.length }} 项</em>
        </div>
        <div class="filters">
          <el-select v-model="academicYear" clearable placeholder="全部学年" @change="loadHonors">
            <el-option v-for="year in academicYears" :key="year" :label="year + ' 学年'" :value="year" />
          </el-select>
          <el-button v-if="levelFilter" plain @click="levelFilter = ''">清除等级筛选</el-button>
        </div>
      </div>

      <div v-if="filteredHonors.length" class="honor-items">
        <article v-for="honor in filteredHonors" :key="honor.id" class="honor-item">
          <div class="honor-badge" :style="{ color: getLevel(honor.awardLevel).color, background: getLevel(honor.awardLevel).soft }">
            <el-icon><Medal /></el-icon>
          </div>
          <div class="honor-content">
            <div class="honor-title-row">
              <h2>{{ honor.title }}</h2>
              <el-tag :style="levelTagStyle(honor.awardLevel)" effect="plain">
                {{ honorLevelText(honor) }}
              </el-tag>
            </div>
            <p>{{ honor.module?.name || '综合素质申报' }}</p>
            <div class="honor-meta">
              <span v-if="honor.eventDate"><el-icon><Calendar /></el-icon>{{ honor.eventDate }}</span>
              <span v-if="honor.academicYear"><el-icon><Reading /></el-icon>{{ honor.academicYear }} {{ honor.semester || '' }}</span>
              <span v-if="honor.certificateNo"><el-icon><DocumentChecked /></el-icon>证书编号：{{ honor.certificateNo }}</span>
              <span v-if="honor.finalScore != null"><el-icon><Coin /></el-icon>认定 {{ formatScore(honor.finalScore) }} 分</span>
            </div>
          </div>
          <a v-if="honor.linkUrl" class="honor-link" :href="honor.linkUrl" target="_blank" rel="noopener noreferrer" title="查看相关链接">
            <el-icon><Link /></el-icon>
          </a>
          <el-popover v-if="proofs(honor).length" placement="left" :width="260" trigger="click">
            <template #reference>
              <el-button class="proof-button" text title="查看证明材料"><el-icon><Picture /></el-icon></el-button>
            </template>
            <div class="proof-list">
              <el-image v-for="url in proofs(honor)" :key="url" :src="url" fit="cover" :preview-src-list="proofs(honor)" preview-teleported />
            </div>
          </el-popover>
        </article>
      </div>
      <el-empty v-else :description="levelFilter ? '该等级暂无已认定荣誉' : '暂无已认定的获奖荣誉'" :image-size="92" />
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Calendar, Coin, CollectionTag, DocumentChecked, Link, Medal, Picture, Reading, Tickets } from '@element-plus/icons-vue';
import { getMyHonors } from '@/api/applications';

const levels = [
  { key: 'international', label: '国际级', color: '#7C3AED', soft: '#F3E8FF' },
  { key: 'national', label: '国家级', color: '#D97706', soft: '#FFF4DE' },
  { key: 'provincial', label: '省部级', color: '#2563EB', soft: '#EAF2FF' },
  { key: 'school', label: '市校级', color: '#059669', soft: '#E7F8F1' },
  { key: 'college', label: '院系级', color: '#DB2777', soft: '#FCEAF3' },
  { key: 'other', label: '其他', color: '#64748B', soft: '#F1F5F9' }
];

const loading = ref(false);
const academicYear = ref('');
const academicYears = ref([]);
const levelFilter = ref('');
const data = ref({ total: 0, levelCounts: {}, honors: [] });

const filteredHonors = computed(() => {
  if (!levelFilter.value) return data.value.honors;
  return data.value.honors.filter(item => item.awardLevel === levelFilter.value);
});

const getLevel = (key) => levels.find(item => item.key === key) || levels[levels.length - 1];
const toggleLevel = (key) => { levelFilter.value = levelFilter.value === key ? '' : key; };
const formatScore = value => Number(value || 0).toFixed(2).replace(/\.00$/, '');
const proofs = honor => Array.isArray(honor.attachPhotos) ? honor.attachPhotos.filter(Boolean) : [];
const honorLevelText = honor => honor.awardLevel === 'other' && honor.otherDescription
  ? `其他：${honor.otherDescription}`
  : getLevel(honor.awardLevel).label;
const levelTagStyle = key => {
  const level = getLevel(key);
  return { color: level.color, borderColor: level.color + '55', background: level.soft };
};

const loadHonors = async () => {
  loading.value = true;
  try {
    const result = await getMyHonors(academicYear.value);
    data.value = {
      total: Number(result?.total || 0),
      levelCounts: result?.levelCounts || {},
      honors: Array.isArray(result?.honors) ? result.honors : []
    };
    if (!academicYear.value) {
      academicYears.value = [...new Set(data.value.honors.map(item => item.academicYear).filter(Boolean))].sort().reverse();
    }
  } finally {
    loading.value = false;
  }
};

onMounted(loadHonors);
</script>

<style lang="scss" scoped>
.my-honors { padding-bottom: 12px; }
.honor-overview { margin-top: 18px; display: grid; grid-template-columns: minmax(230px, .85fr) minmax(0, 2.15fr); gap: 14px; }
.total-panel { min-height: 134px; padding: 22px; display: flex; align-items: center; gap: 14px; position: relative; overflow: hidden; color: #fff; border-radius: 8px; background: linear-gradient(125deg, #1E3A8A, #0F766E); box-shadow: 0 14px 28px rgba(15, 118, 110, .18); }
.total-panel::after { content: ''; position: absolute; width: 124px; height: 124px; right: -43px; top: -53px; border: 16px solid rgba(255,255,255,.11); border-radius: 50%; }
.total-icon { width: 48px; height: 48px; display: grid; place-items: center; flex: 0 0 auto; font-size: 25px; border-radius: 8px; background: rgba(255,255,255,.16); }
.total-label { font-size: 13px; color: rgba(255,255,255,.78); }
.total-value { margin-top: 3px; font-size: 33px; line-height: 1; font-weight: 800; }
.total-value span { margin-left: 4px; font-size: 14px; font-weight: 500; }
.total-caption { position: absolute; left: 22px; bottom: 16px; color: rgba(255,255,255,.7); font-size: 11px; }
.level-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.level-card { min-height: 62px; padding: 12px 14px; border: 1px solid #E2E8F0; border-radius: 8px; display: grid; grid-template-columns: 8px 1fr auto; gap: 9px; align-items: center; text-align: left; cursor: pointer; color: #475569; background: #fff; transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
.level-card:hover, .level-card.active { transform: translateY(-1px); border-color: #94A3B8; box-shadow: 0 8px 18px rgba(30, 41, 59, .08); }
.level-card.active { background: #F8FAFC; }
.level-mark { width: 8px; height: 28px; border-radius: 4px; }
.level-name { min-width: 0; font-size: 13px; white-space: nowrap; }
.level-card strong { font-size: 23px; line-height: 1; color: #1E293B; }
.honor-list { margin-top: 18px; padding-top: 0; overflow: hidden; }
.toolbar { min-height: 67px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #E8EEF6; }
.card-heading { display: flex; align-items: center; gap: 8px; font-size: 16px; color: #17233B; font-weight: 700; }
.card-heading .el-icon { color: #D97706; font-size: 19px; }
.card-heading em { padding: 2px 7px; border-radius: 4px; color: #64748B; background: #F1F5F9; font-size: 12px; font-style: normal; font-weight: 500; }
.filters { display: flex; align-items: center; gap: 8px; }
.filters :deep(.el-select) { width: 160px; }
.honor-items { padding: 2px 20px 14px; }
.honor-item { min-height: 102px; padding: 17px 2px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid #EDF2F7; }
.honor-item:last-child { border-bottom: 0; }
.honor-badge { width: 48px; height: 48px; display: grid; place-items: center; flex: 0 0 auto; font-size: 24px; border-radius: 8px; }
.honor-content { min-width: 0; flex: 1; }
.honor-title-row { display: flex; align-items: center; gap: 8px; }
.honor-title-row h2 { max-width: 100%; margin: 0; overflow: hidden; color: #1E293B; font-size: 15px; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.honor-title-row :deep(.el-tag) { max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; }
.honor-content p { margin: 4px 0 8px; color: #64748B; font-size: 12px; }
.honor-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #8492A6; font-size: 12px; }
.honor-meta span { display: inline-flex; align-items: center; gap: 4px; }
.honor-link, .proof-button { width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto; color: #4F46E5; border: 1px solid #E0E7FF; border-radius: 7px; background: #F5F7FF; }
.honor-link:hover { color: #3730A3; background: #EEF2FF; }
.proof-button { color: #0F766E; border-color: #CCFBF1; background: #F0FDFA; }
.proof-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.proof-list :deep(.el-image) { width: 74px; height: 74px; border-radius: 5px; }
@media (max-width: 960px) { .honor-overview { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .level-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar { padding: 14px 16px; align-items: flex-start; flex-direction: column; }
  .filters, .filters :deep(.el-select), .filters :deep(.el-button) { width: 100%; }
  .honor-items { padding: 2px 16px 10px; }
  .honor-item { align-items: flex-start; gap: 10px; }
  .honor-badge { width: 40px; height: 40px; font-size: 20px; }
  .honor-title-row { align-items: flex-start; flex-direction: column; gap: 4px; }
  .honor-title-row h2 { white-space: normal; }
  .honor-title-row :deep(.el-tag) { max-width: 100%; }
  .honor-link, .proof-button { width: 30px; height: 30px; }
}
</style>
