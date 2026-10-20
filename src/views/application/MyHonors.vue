<template>
  <div class="my-honors">
    <WorkspaceHero
      eyebrow="MY HONORS"
      title="我的荣誉"
      description="集中展示自己的获奖证书与荣誉记录，点击证书可查看完整材料。"
    >
      <template #actions>
        <el-button @click="$router.push('/apply')">
          <el-icon><Plus /></el-icon> 申报新荣誉
        </el-button>
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
        <div class="total-caption">在校期间累计 · 已通过或已终审的获奖申报</div>
      </div>
      <div class="level-grid">
        <button
          v-for="item in levels"
          :key="item.key"
          class="level-card"
          :class="{ active: levelFilter === item.key }"
          :aria-pressed="levelFilter === item.key"
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
          <span>荣誉证书墙</span>
          <em>{{ filteredHonors.length }} 项 · {{ certificateCount }} 份材料</em>
        </div>
        <div class="filters">
          <el-input v-model="keyword" clearable placeholder="搜索荣誉或证书编号" :prefix-icon="Search" aria-label="搜索荣誉或证书编号" />
          <el-select v-model="academicYear" clearable placeholder="全部学年" aria-label="筛选学年">
            <el-option v-for="year in academicYears" :key="year" :label="year + ' 学年'" :value="year" />
          </el-select>
          <el-button v-if="hasFilters" plain @click="resetFilters">重置筛选</el-button>
          <el-button :icon="Refresh" :loading="loading" aria-label="刷新荣誉" title="刷新荣誉" @click="loadHonors" />
        </div>
      </div>

      <div v-loading="loading" class="gallery-body" aria-live="polite">
        <el-result v-if="loadError" icon="warning" title="荣誉加载失败" sub-title="请稍后重试，或检查网络连接。">
          <template #extra><el-button type="primary" @click="loadHonors">重新加载</el-button></template>
        </el-result>
        <div v-else-if="filteredHonors.length" class="certificate-grid">
          <article v-for="honor in filteredHonors" :key="honor.id" class="certificate-card">
            <button v-if="honor.attachments.length" type="button" class="certificate-cover"
              :aria-label="`查看${honor.title}的证书`" @click="openCertificate(honor)">
              <el-image v-if="honor.cover.kind === 'image'" :src="honor.cover.url" fit="contain" loading="lazy" :alt="`${honor.title}证书`">
                <template #error><div class="cover-placeholder"><el-icon><Picture /></el-icon><strong>证书图片暂时无法显示</strong><span>点击查看材料或打开原文件</span></div></template>
              </el-image>
              <div v-else class="cover-placeholder" :class="{ 'pdf-cover': honor.cover.kind === 'pdf' }">
                <span class="file-format">{{ honor.cover.kind === 'pdf' ? 'PDF' : '附件' }}</span>
                <el-icon><Document /></el-icon>
                <strong>{{ honor.cover.kind === 'pdf' ? '荣誉证书 · PDF' : '荣誉证明材料' }}</strong>
                <span>点击查看完整材料</span>
              </div>
              <span class="cover-action"><el-icon><ZoomIn /></el-icon> 查看证书</span>
              <span class="attachment-count">{{ honor.attachments.length }} 份材料</span>
            </button>
            <div v-else class="certificate-cover missing-cover">
              <div class="cover-placeholder"><el-icon><Medal /></el-icon><strong>已获荣誉，暂无证书附件</strong><span>可在对应申报记录中核对材料</span></div>
            </div>
            <div class="certificate-info">
              <div class="certificate-category">
                <el-tag :style="levelTagStyle(honor.awardLevel)" effect="plain" :title="honorLevelText(honor)">{{ honorLevelText(honor) }}</el-tag>
                <span>{{ honor.module?.name || '综合素质申报' }}</span>
              </div>
              <h2 :title="honor.title">{{ honor.title }}</h2>
              <div class="certificate-meta">
                <span v-if="honor.eventDate"><el-icon><Calendar /></el-icon>{{ honor.eventDate }}</span>
                <span v-if="honor.finalScore != null">认定 {{ formatScore(honor.finalScore) }} 分</span>
              </div>
              <p class="certificate-number">{{ honor.certificateNo ? `证书编号：${honor.certificateNo}` : '未登记证书编号' }}<a v-if="honor.relatedUrl" :href="honor.relatedUrl" target="_blank" rel="noopener noreferrer">相关链接</a></p>
              <div class="certificate-footer">
                <span>{{ honor.academicYear ? `${honor.academicYear} 学年` : '学年未记录' }}</span>
                <el-button v-if="honor.attachments.length" link type="primary" @click="openCertificate(honor)">查看证书 <el-icon><Right /></el-icon></el-button>
                <el-button v-else link type="primary" @click="$router.push('/my-applications')">查看申报</el-button>
              </div>
            </div>
          </article>
        </div>
        <el-empty v-else-if="!loading" :description="hasFilters ? '没有符合筛选条件的荣誉' : '还没有已认定的荣誉证书'" :image-size="100">
          <p class="empty-note">{{ hasFilters ? '试试其他学年、等级或关键词。' : '在申报中上传证书，通过认定后会自动展示在这里。' }}</p>
          <el-button v-if="hasFilters" plain @click="resetFilters">查看全部荣誉</el-button>
          <el-button v-else type="primary" @click="$router.push('/apply')">去申报荣誉</el-button>
        </el-empty>
      </div>
    </section>

    <el-dialog v-model="previewVisible" :title="activeHonor?.title || '荣誉证书'" width="min(1080px, 94vw)" destroy-on-close append-to-body class="certificate-dialog">
      <template v-if="activeHonor && activeAttachment">
        <div class="preview-heading">
          <el-tag :style="levelTagStyle(activeHonor.awardLevel)" effect="plain">{{ honorLevelText(activeHonor) }}</el-tag>
          <span>材料 {{ activeIndex + 1 }} / {{ activeHonor.attachments.length }}</span>
          <a :href="activeAttachment.url" target="_blank" rel="noopener noreferrer">打开原文件 <el-icon><TopRight /></el-icon></a>
        </div>
        <div class="certificate-stage">
          <el-image v-if="activeAttachment.kind === 'image'" :src="activeAttachment.url" fit="contain" :alt="`${activeHonor.title}证书`"
            :preview-src-list="previewImages" :initial-index="Math.max(0, previewImages.indexOf(activeAttachment.url))" preview-teleported>
            <template #error><div class="preview-fallback"><el-icon><Picture /></el-icon><p>图片暂时无法显示，请打开原文件查看。</p></div></template>
          </el-image>
          <iframe v-else-if="activeAttachment.kind === 'pdf'" :key="activeAttachment.url" :src="activeAttachment.url" :title="`${activeHonor.title} PDF 证书`" />
          <div v-else class="preview-fallback"><el-icon><Document /></el-icon><p>此格式暂不支持在线预览，请打开原文件查看。</p></div>
        </div>
        <p v-if="activeAttachment.kind === 'pdf'" class="preview-note">若浏览器未显示 PDF，请点击上方“打开原文件”。</p>
        <div v-if="activeHonor.attachments.length > 1" class="attachment-strip" aria-label="选择证书材料">
          <button v-for="(file, index) in activeHonor.attachments" :key="file.url" type="button" :class="{ selected: activeIndex === index }"
            :aria-pressed="activeIndex === index" :aria-label="`查看材料 ${index + 1}：${file.name}`" @click="activeIndex = index">
            <el-image v-if="file.kind === 'image'" :src="file.url" fit="contain" :alt="file.name"><template #error><el-icon><Picture /></el-icon></template></el-image>
            <el-icon v-else><Document /></el-icon>
            <span>{{ index + 1 }} · {{ file.kind === 'pdf' ? 'PDF' : file.kind === 'image' ? '图片' : '附件' }}</span>
          </button>
        </div>
        <div class="preview-meta">
          <span v-if="activeHonor.eventDate">获奖日期：{{ activeHonor.eventDate }}</span>
          <span v-if="activeHonor.certificateNo">证书编号：{{ activeHonor.certificateNo }}</span>
          <span v-if="activeHonor.academicYear">{{ activeHonor.academicYear }} 学年</span>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Calendar, CollectionTag, Document, Medal, Picture, Plus, Refresh, Right, Search, Tickets, TopRight, ZoomIn } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
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
const levelFilter = ref('');
const keyword = ref('');
const loadError = ref(false);
const data = ref({ total: 0, levelCounts: {}, honors: [] });
const previewVisible = ref(false);
const activeHonor = ref(null);
const activeIndex = ref(0);

function attachmentsOf(honor) {
  let value = honor?.attachPhotos ?? honor?.proofUrl;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { value = value.split(','); }
  }
  if (!Array.isArray(value)) value = value ? [value] : [];
  const seen = new Set();
  return value.flatMap(item => {
    const rawUrl = typeof item === 'string' ? item : item?.url;
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url || seen.has(url) || !/^(\/uploads\/|https?:\/\/)/i.test(url)) return [];
    let pathname;
    try { pathname = new URL(url, 'https://local.invalid').pathname; } catch (_) { return []; }
    if (url.startsWith('/') && !pathname.startsWith('/uploads/')) return [];
    seen.add(url);
    let name = pathname.split('/').pop();
    try { name = decodeURIComponent(name); } catch (_) { /* 保留原文件名 */ }
    return [{ url, name: (typeof item === 'object' && item.name) || name || '证书材料',
      kind: /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(pathname) ? 'image' : /\.pdf$/i.test(pathname) ? 'pdf' : 'file' }];
  });
}

const honorCards = computed(() => data.value.honors.map(honor => {
  const attachments = attachmentsOf(honor);
  return { ...honor, attachments, cover: attachments.find(file => file.kind === 'image') || attachments[0],
    relatedUrl: /^https?:\/\//i.test(honor.linkUrl || '') ? honor.linkUrl : '' };
}));
const academicYears = computed(() => [...new Set(data.value.honors.map(item => item.academicYear).filter(Boolean))].sort().reverse());
const hasFilters = computed(() => Boolean(levelFilter.value || academicYear.value || keyword.value.trim()));

const filteredHonors = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase();
  return honorCards.value.filter(item => (!levelFilter.value || item.awardLevel === levelFilter.value)
    && (!academicYear.value || item.academicYear === academicYear.value)
    && (!query || [item.title, item.certificateNo, item.module?.name, item.otherDescription]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
});
const certificateCount = computed(() => filteredHonors.value.reduce((sum, honor) => sum + honor.attachments.length, 0));
const activeAttachment = computed(() => activeHonor.value?.attachments[activeIndex.value] || null);
const previewImages = computed(() => activeHonor.value?.attachments.filter(file => file.kind === 'image').map(file => file.url) || []);
const resetFilters = () => { academicYear.value = ''; levelFilter.value = ''; keyword.value = ''; };
function openCertificate(honor) {
  if (!honor?.attachments?.length) return;
  activeHonor.value = honor;
  activeIndex.value = Math.max(0, honor.attachments.indexOf(honor.cover));
  previewVisible.value = true;
}

const getLevel = (key) => levels.find(item => item.key === key) || levels[levels.length - 1];
const toggleLevel = (key) => { levelFilter.value = levelFilter.value === key ? '' : key; };
const formatScore = value => Number(value || 0).toFixed(2).replace(/\.00$/, '');
const honorLevelText = honor => honor.awardLevel === 'other' && honor.otherDescription
  ? `其他：${honor.otherDescription}`
  : getLevel(honor.awardLevel).label;
const levelTagStyle = key => {
  const level = getLevel(key);
  return { color: level.color, borderColor: level.color + '55', background: level.soft };
};

const loadHonors = async () => {
  loading.value = true;
  loadError.value = false;
  try {
    const result = await getMyHonors();
    data.value = {
      total: Number(result?.total || 0),
      levelCounts: result?.levelCounts || {},
      honors: Array.isArray(result?.honors) ? result.honors : []
    };
  } catch (_) {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
};

onMounted(loadHonors);
</script>

<style lang="scss" scoped>
.my-honors { padding-bottom: 8px; }
.honor-overview { margin-top: 18px; display: grid; grid-template-columns: minmax(230px, .85fr) minmax(0, 2.15fr); gap: 14px; }
.total-panel { min-height:136px; padding:20px; display:grid; grid-template-columns:48px minmax(0,1fr); align-items:center; gap:12px 14px; border:1px solid $border-light; border-radius:$card-radius; background:linear-gradient(145deg,#fff,$bg-color); box-shadow:0 8px 22px rgba(20,52,96,.045); }
.total-icon { width:48px; height:48px; display:grid; place-items:center; font-size:25px; border-radius:12px; color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.total-label { font-size:13px; color:$text-secondary; }
.total-value { margin-top:5px; font-size:28px; line-height:1; font-weight:700; color:$text-primary; }
.total-value span { margin-left: 4px; font-size: 14px; font-weight: 500; }
.total-caption { grid-column:1/-1; color:$text-secondary; font-size:12px; line-height:1.7; }
.level-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.level-card { min-height:62px; padding:12px 14px; border:1px solid $border-light; border-radius:12px; display:grid; grid-template-columns:8px 1fr auto; gap:9px; align-items:center; text-align:left; cursor:pointer; color:$text-regular; background:#fff; font-family:inherit; transition:border-color .18s ease,background .18s ease; }
.level-card:hover { border-color:var(--el-color-primary-light-5); }
.level-card.active { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.level-mark { width: 8px; height: 28px; border-radius: 4px; }
.level-name { min-width: 0; font-size: 13px; white-space: nowrap; }
.level-card strong { font-size:22px; line-height:1; color:$text-primary; }
.honor-list { margin-top: 18px; padding-top: 0; overflow: hidden; }
.toolbar { min-height: 76px; padding: 16px 20px; display: flex; flex-wrap:wrap; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #E8EEF6; }
.card-heading { display:flex; align-items:center; gap:8px; font-size:15px; color:$text-primary; font-weight:600; }
.card-heading .el-icon { color:var(--el-color-primary); font-size:19px; }
.card-heading em { padding:2px 8px; border-radius:999px; color:$text-secondary; background:$bg-color; font-size:12px; font-style:normal; font-weight:400; }
.filters { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.filters :deep(.el-button + .el-button) { margin-left:0; }
.filters :deep(.el-input) { width:210px; }
.filters :deep(.el-select) { width: 160px; }
.gallery-body { min-height:240px; }
.certificate-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; padding:20px; }
.certificate-card { min-width:0; display:flex; flex-direction:column; overflow:hidden; border:1px solid $border-light; border-radius:$card-radius; background:#fff; transition:border-color .18s,box-shadow .18s; }
.certificate-card:hover { border-color:var(--el-color-primary-light-5); box-shadow:0 8px 22px rgba(20,52,96,.06); }
.certificate-cover { position:relative; display:flex; align-items:center; justify-content:center; width:100%; aspect-ratio:4/3; padding:20px; border:0; border-bottom:1px solid $border-lighter; background:$bg-color; cursor:pointer; color:$text-regular; font-family:inherit; }
.certificate-cover > .el-image { display:block; width:100%; height:100%; background:#fff; box-shadow:0 4px 12px rgba(30,58,95,.1); }
.certificate-cover :deep(.el-image__inner) { padding:4px; }
.cover-placeholder { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; background:#fff; }
.cover-placeholder > .el-icon { font-size:44px; color:$text-placeholder; }
.cover-placeholder strong { color:$text-regular; font-size:14px; font-weight:600; }
.cover-placeholder > span:not(.file-format) { color:$text-secondary; font-size:12px; }
.pdf-cover { border:1px solid $border-lighter; border-radius:8px; }
.pdf-cover > .el-icon { color:var(--el-color-primary); }
.file-format { color:var(--el-color-primary); background:var(--el-color-primary-light-9); padding:3px 8px; border-radius:4px; font-size:10px; font-weight:700; letter-spacing:.1em; }
.cover-action { position:absolute; bottom:12px; left:12px; display:inline-flex; align-items:center; gap:5px; padding:6px 9px; border-radius:8px; color:var(--el-color-primary); background:rgba(255,255,255,.95); font-size:12px; box-shadow:0 2px 8px rgba(20,52,96,.06); }
.attachment-count { position:absolute; right:12px; top:12px; padding:4px 8px; border-radius:8px; color:$text-secondary; background:rgba(255,255,255,.95); font-size:11px; }
.missing-cover { cursor:default; }
.missing-cover .cover-placeholder { background:transparent; }
.certificate-info { flex:1; display:flex; flex-direction:column; padding:20px; }
.certificate-category { display:flex; align-items:center; gap:8px; min-width:0; }
.certificate-category > span { color:$text-secondary; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.certificate-category :deep(.el-tag) { flex-shrink:0; max-width:60%; overflow:hidden; }
.certificate-info h2 { margin:12px 0 10px; min-height:48px; color:$text-primary; font-size:16px; font-weight:600; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.certificate-meta { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; color:$text-secondary; font-size:12px; }
.certificate-meta span { display:inline-flex; align-items:center; gap:4px; }
.certificate-number { color:$text-secondary; font-size:11px; line-height:1.6; overflow-wrap:anywhere; }
.certificate-number a { margin-left:8px; white-space:nowrap; }
.certificate-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:auto; padding-top:12px; border-top:1px solid $border-lighter; }
.certificate-footer > span { color:$text-secondary; font-size:11px; }
.empty-note { margin:0 16px 16px; color:$text-secondary; font-size:13px; line-height:1.7; }
.preview-heading { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:14px; }
.preview-heading > span { color:$text-secondary; font-size:12px; }
.preview-heading a { display:inline-flex; align-items:center; gap:4px; margin-left:auto; font-size:13px; }
.certificate-stage { height:clamp(280px,60dvh,680px); background:$bg-color; border:1px solid $border-light; border-radius:10px; overflow:hidden; }
.certificate-stage > .el-image, .certificate-stage iframe { width:100%; height:100%; display:block; border:0; }
.preview-fallback { height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:$text-secondary; padding:20px; text-align:center; }
.preview-fallback > .el-icon { font-size:48px; }
.preview-note { color:$text-secondary; font-size:12px; line-height:1.7; }
.attachment-strip { display:flex; gap:10px; overflow-x:auto; padding:14px 2px 4px; }
.attachment-strip button { flex:none; display:flex; flex-direction:column; align-items:center; gap:6px; width:94px; padding:8px; border:1px solid $border-light; border-radius:10px; color:$text-secondary; background:#fff; cursor:pointer; font:inherit; font-size:11px; }
.attachment-strip button.selected { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); color:var(--el-color-primary); }
.attachment-strip .el-image { width:76px; height:52px; }
.attachment-strip button > .el-icon { height:52px; font-size:28px; }
.preview-meta { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:16px; font-size:12px; line-height:1.7; color:$text-secondary; overflow-wrap:anywhere; }
.certificate-cover:focus-visible, .attachment-strip button:focus-visible, .level-card:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-3px; }
@media (max-width: 960px) { .honor-overview { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  .level-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar { padding: 14px 16px; align-items: flex-start; flex-direction: column; }
  .filters { width:100%; }
  .filters :deep(.el-input) { width:100%; }
  .filters :deep(.el-select) { flex:1; min-width:120px; }
  .filters :deep(.el-button + .el-button) { margin-left:0; }
  .certificate-grid { grid-template-columns:minmax(0,1fr); gap:16px; padding:16px; }
  .certificate-card { border-radius:12px; }
  .card-heading { flex-wrap:wrap; }
  .certificate-info { padding:16px; }
  .preview-heading :deep(.el-tag) { max-width:100%; height:auto; white-space:normal; }
  .certificate-stage { height:min(48dvh,360px); min-height:240px; }
}
@media (prefers-reduced-motion:reduce) { .certificate-card, .level-card { transition:none; } .level-card:hover, .level-card.active { transform:none; } }
</style>
