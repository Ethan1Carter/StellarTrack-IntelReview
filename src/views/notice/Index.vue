<template>
  <div class="notice-center">
    <WorkspaceHero
      eyebrow="CAMPUS BULLETIN"
      title="公告通知"
      description="汇集校园重要通知、办事提醒与最新动态，及时掌握与你相关的信息。"
    />
    <div v-if="topList.length" class="pin-panel">
      <div class="section-heading">
        <div><span>IMPORTANT</span><h3>置顶公告</h3></div>
        <small>优先阅读的重要消息</small>
      </div>
      <div class="pin-list">
      <div v-for="n in topList" :key="n.id" class="pin-item" @click="openNotice(n)">
        <el-tag type="danger" effect="light" size="small"><el-icon><StarFilled /></el-icon> 置顶</el-tag>
        <strong>{{ n.title }}</strong>
        <span style="flex:1"></span>
        <span class="pin-date">{{ dayjs(n.createdAt).format('YYYY-MM-DD') }}</span>
      </div>
      </div>
    </div>

    <div class="card notice-list-card">
      <div class="section-heading list-heading">
        <div><span>MESSAGE ARCHIVE</span><h3>全部通知 <em>{{ total }}</em></h3></div>
        <small>点击任意一行查看完整内容</small>
      </div>
      <div class="filters">
        <el-select v-model="f.type" class="type-select" placeholder="通知类型" clearable @change="go(1)">
          <el-option label="普通通知" value="normal" />
          <el-option label="重要" value="important" />
          <el-option label="紧急" value="urgent" />
        </el-select>
        <el-input v-model="f.keyword" class="keyword-input" placeholder="搜索标题或内容" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">搜索</el-button>
      </div>
      <el-table class="notice-table" :data="list" v-loading="loading" stripe @row-click="openNotice">
        <el-table-column label="类型" width="100">
          <template #default="{row}"><el-tag size="small" :type="row.type==='urgent'?'danger':(row.type==='important'?'warning':'info')">{{ TYPE[row.type] || '通知' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="320">
          <template #default="{row}"><span v-if="!isRead(row)" class="unread-dot"></span>{{ row.title }}</template>
        </el-table-column>
        <el-table-column label="发布者" width="110">
          <template #default="{row}">{{ row.creator?.name || '--' }}</template>
        </el-table-column>
        <el-table-column label="发布时间" width="160">
          <template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{row}"><el-tag v-if="isRead(row)" size="small" type="info" effect="plain">已读</el-tag>
            <el-tag v-else size="small" type="primary" effect="dark">未读</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" />
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next" :total="total" :current-page="f.page" :page-size="10" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="dlgVisible" class="reader-dialog" :title="cur?.title" width="min(720px, 92vw)">
      <div v-if="cur" class="notice-detail">
        <div class="meta">
          <el-tag size="small" :type="cur.type==='urgent'?'danger':(cur.type==='important'?'warning':'info')">{{ TYPE[cur.type] || '通知' }}</el-tag>
          <span style="margin: 0 8px;">发布者：{{ cur.creator?.name || '--' }}</span>
          <span>发布时间：{{ dayjs(cur.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
        </div>
        <div class="content" v-html="cur.content"></div>
        <div v-if="cur.attachments?.length" style="margin-top: 16px;">
          <h5 style="margin: 0 0 8px;">附件：</h5>
          <div v-for="a in cur.attachments" :key="a.url" class="attach-item" @click="dl(a)">
            <el-icon color="#409EFF" size="18"><Paperclip /></el-icon>
            <span>{{ a.name }}</span>
            <el-icon style="margin-left:auto;"><Download /></el-icon>
          </div>
        </div>
      </div>
      <template #footer><el-button @click="dlgVisible=false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue';
import dayjs from 'dayjs';
import { useRoute } from 'vue-router';
import { myNoticeList, getNotice } from '@/api/notices';
import { BellFilled, StarFilled, Paperclip, Download } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
const TYPE = { normal: '普通通知', important: '重要通知', urgent: '紧急通知' };
const route = useRoute();

const list = ref([]);
const topList = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, type: '', keyword: '' });
const readIds = ref(new Set(JSON.parse(localStorage.getItem('notice_read') || '[]')));
const isRead = (n) => readIds.value.has(n.id);
const markRead = (id) => { readIds.value.add(id); localStorage.setItem('notice_read', JSON.stringify([...readIds.value])); };

const go = async (p) => { f.page = p; loading.value = true; try { const r = await myNoticeList(f); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value = false; } };
const loadTop = async () => { try { topList.value = (await myNoticeList({ page:1, pageSize: 5, pinTopOnly: 1 }))?.list || []; } catch (_) {} };

const dlgVisible = ref(false);
const cur = ref(null);
const openNotice = async (noticeOrId) => {
  const id = typeof noticeOrId === 'object' ? noticeOrId.id : noticeOrId;
  if (!id) return;
  try { cur.value = await getNotice(id); markRead(Number(id)); dlgVisible.value = true; } catch (_) {}
};
const dl = (a) => window.open(a.url, '_blank');

const openNoticeFromRoute = async () => {
  if (route.query.noticeId) await openNotice(route.query.noticeId);
};

onMounted(async () => {
  await Promise.all([go(1), loadTop()]);
  await openNoticeFromRoute();
});
watch(() => route.query.noticeId, openNoticeFromRoute);
</script>
<style lang="scss" scoped>
.notice-center { padding-bottom: 8px; }
.pin-panel, .notice-list-card { margin-top: 18px; border: 1px solid #E6EDF7; border-radius: 18px; background: #fff; box-shadow: 0 12px 32px rgba(23,43,77,.055); }
.pin-panel { padding: 20px 22px 22px; }
.section-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; margin-bottom:16px;
  span { color:#1876D2; font-size:10px; font-weight:800; letter-spacing:.16em; }
  h3 { margin:5px 0 0; color:#172B4D; font-size:18px; }
  h3 em { margin-left:5px; color:#1876D2; font-size:21px; font-style:normal; }
  small { color:#8A98AC; font-size:12px; }
}
.pin-list { display: flex; flex-direction: column; gap: 8px; }
.pin-item { display: flex; align-items: center; gap:10px; padding: 13px 15px; color:#263A58; background: linear-gradient(90deg, #FFF7F3, #fff);
  border: 1px solid #F9E5DC; border-radius: 11px; cursor: pointer; transition: all .18s;
  &:hover { transform:translateY(-1px); border-color:#F4CDBD; box-shadow: 0 7px 18px rgba(189,86,43,.08); }
}
.pin-date { color:#97A3B5; font-size:12px; }
.notice-list-card { padding:0; overflow:hidden; }
.list-heading { margin:0; padding:21px 22px 17px; border-bottom:1px solid #EAF0F7; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 22px; background:#FAFCFE; }
.type-select { width:150px; }
.keyword-input { width:280px; }
.unread-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #F05B68; margin-right: 7px; vertical-align: middle; box-shadow:0 0 0 3px rgba(240,91,104,.1); }
.page-wrap { display:flex; justify-content:flex-end; padding: 17px 22px; border-top:1px solid #EAF0F7; }
.notice-detail { padding: 4px 8px; }
.meta { color: #909399; font-size: 13px; padding-bottom: 12px; border-bottom: 1px dashed #ebeef5; margin-bottom: 14px; }
.content { padding:8px 2px; line-height: 1.9; font-size: 14px; color: #303133; :deep(img) { max-width: 100%; } }
.attach-item { display:flex; align-items:center; gap: 8px; padding: 10px 12px;
  border: 1px solid #E1E9F3; border-radius: 9px; margin-bottom: 7px; cursor: pointer; background: #F8FBFE;
  &:hover { background: #ECF5FF; border-color: #68A8ED; }
}
:deep(.notice-table) { cursor:pointer; --el-table-header-bg-color:#F5F8FC; --el-table-row-hover-bg-color:#F3F8FF; }
:deep(.notice-table th.el-table__cell) { height:48px; color:#52647E; font-weight:700; }
:global(.reader-dialog.el-dialog) { overflow:hidden; border-radius:18px; }
:global(.reader-dialog .el-dialog__header) { margin:0; padding:21px 24px; border-bottom:1px solid #E9EFF7; background:linear-gradient(90deg,#F4F8FD,#fff); }

@media (max-width:768px) {
  .section-heading { align-items:flex-start; flex-direction:column; gap:4px; }
  .section-heading small { display:none; }
  .pin-item { flex-wrap:wrap; }
  .pin-date { width:100%; padding-left:62px; }
  .type-select, .keyword-input { width:100%; }
  .filters :deep(.el-button) { width:100%; }
  .page-wrap { justify-content:center; overflow-x:auto; padding:15px 10px; }
}
</style>
