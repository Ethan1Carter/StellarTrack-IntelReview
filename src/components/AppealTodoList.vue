<template>
  <div class="appeals-todo">
    <div class="filters mb-16">
      <!-- 仅当 scope=''（全部）时才显示状态筛选下拉框；scope=pending/done 已固定范围 -->
      <el-select v-if="!scope" v-model="f.status" placeholder="全部状态" clearable style="width:140px" @change="go(1)">
        <el-option label="待处理" value="pending" />
        <el-option label="申诉通过" value="approved" />
        <el-option label="申诉驳回" value="rejected" />
      </el-select>
      <el-select v-if="role!=='class_admin'" v-model="f.classId" placeholder="按班级筛选" clearable style="width:220px" @change="go(1)">
        <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <el-input v-model="f.keyword" placeholder="搜索标题/申诉原因/学生姓名" clearable style="width:300px" @clear="go(1)" @keyup.enter="go(1)">
        <template #append><el-button @click="go(1)">搜索</el-button></template>
      </el-input>
      <el-tag v-if="scope!=='done'" type="warning" effect="dark" round style="margin-left:auto;">待处理 {{ pendingCount }}</el-tag>
    </div>

    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="id" label="申诉ID" width="80" />
      <el-table-column label="申诉学生" width="170">
        <template #default="{row}">
          <el-avatar style="vertical-align:middle; margin-right:8px;" :size="26">{{ (row.student?.realName||row.student?.username||'?').slice(0,1) }}</el-avatar>
          <span>{{ row.student?.realName || '-' }}</span>
          <div class="muted mt-4" style="padding-left:34px;">学号：{{ row.student?.username }} &nbsp;|&nbsp; {{ row.classInfo?.name }}</div>
        </template>
      </el-table-column>
      <el-table-column label="关联申报" min-width="260">
        <template #default="{row}">
          <div style="font-weight:500;">{{ row.application?.title }}</div>
          <div class="muted mt-4">模块：{{ row.application?.module?.name }} &nbsp;|&nbsp; 申请 {{ row.application?.score }} &nbsp;|&nbsp; 最终 {{ row.application?.finalScore ?? '未通过' }}</div>
          <StatusTag v-if="row.application?.status" :status="row.application.status" />
        </template>
      </el-table-column>
      <el-table-column label="申诉原因" min-width="260">
        <template #default="{row}"><el-tooltip :content="row.reason" placement="top"><span class="one-line">{{ row.reason }}</span></el-tooltip></template>
      </el-table-column>
      <el-table-column label="状态" width="110" align="center">
        <template #default="{row}">
          <el-tag v-if="row.status==='pending'" type="warning" effect="dark">待处理</el-tag>
          <el-tag v-else-if="row.status==='approved'" type="success" effect="dark">通过</el-tag>
          <el-tag v-else type="info" effect="dark">驳回</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="答复" min-width="220">
        <template #default="{row}">
          <span v-if="row.reply" class="one-line"><el-tooltip :content="row.reply">{{ row.reply }}</el-tooltip></span>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="申诉时间" width="160">
        <template #default="{row}">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right" align="center">
        <template #default="{row}">
          <el-button link type="primary" @click="open(row)">处理</el-button>
          <el-button link type="primary" @click="view(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="page-wrap">
      <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize"
                     @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
    </div>

    <el-dialog v-model="detailVisible" :title="'申诉 #'+cur?.id" width="720px" :close-on-click-modal="false">
      <el-descriptions v-if="cur" :column="1" border>
        <el-descriptions-item label="学生">
          <el-avatar style="vertical-align:middle; margin-right:8px;" :size="26">{{ (cur.student?.realName||cur.student?.username||'?').slice(0,1) }}</el-avatar>
          {{ cur.student?.realName }} &nbsp;<span class="muted">{{ cur.student?.username }} / {{ cur.classInfo?.name }} / {{ cur.college?.name }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="原申报">
          <div>标题：{{ cur.application?.title }} &nbsp; <StatusTag v-if="cur.application?.status" :status="cur.application.status" /></div>
          <div>模块：{{ cur.application?.module?.name }} &nbsp; 申请分：{{ cur.application?.score }} &nbsp; 最终分：{{ cur.application?.finalScore ?? '未通过' }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="申诉原因"><div style="white-space:pre-wrap;">{{ cur.reason }}</div></el-descriptions-item>
        <el-descriptions-item label="申诉附件" v-if="cur.attachments?.length">
          <el-row :gutter="10">
            <el-col :span="6" v-for="(p,i) in cur.attachments" :key="i">
              <el-image :src="p" :preview-src-list="cur.attachments" :initial-index="i" fit="cover" style="width:100%; height:120px; border-radius:6px;" />
            </el-col>
          </el-row>
        </el-descriptions-item>
      </el-descriptions>

      <div v-if="cur?.status==='pending' && allowReview" style="margin-top:18px;">
        <el-form label-width="90px" :model="rf">
          <el-form-item label="审批结果" required>
            <el-radio-group v-model="rf.action">
              <el-radio value="approved">申诉成立（学生可重评）</el-radio>
              <el-radio value="rejected">申诉驳回</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="答复" required>
            <el-input v-model="rf.reply" type="textarea" :rows="4" maxlength="800" show-word-limit placeholder="请填写答复理由（学生端可见）" />
          </el-form-item>
        </el-form>
      </div>
      <div v-else-if="cur?.status!=='pending'" style="margin-top:14px;">
        <el-alert :type="cur.status==='approved'?'success':'info'" :closable="false" show-icon>
          {{ cur.reviewedByName || '管理员' }} 于 {{ fmt(cur.reviewedAt) }} 给出答复：{{ cur.reply || '（无）' }}
          <el-link v-if="cur.reopenedAppId" type="primary" style="margin-left:8px;" @click="goReapply">已生成重新申请 #{{ cur.reopenedAppId }} →</el-link>
        </el-alert>
      </div>

      <template #footer>
        <el-button @click="detailVisible=false">关闭</el-button>
        <el-button v-if="cur?.status==='pending' && allowReview" type="primary" :loading="submitting" @click="submitReview">提交审批</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { getClassList } from '@/api/classes';
import { getAppeals, getAppealDetail, reviewAppeal } from '@/api/appeals';
import { ElMessage } from 'element-plus';
import StatusTag from '@/components/StatusTag.vue';
import dayjs from 'dayjs';

const props = defineProps({
  /** 筛选范围：pending(仅待处理) / done(仅已处理) / ''(全部) */
  scope: { type: String, default: '' }
});
const emit = defineEmits(['pending']);
const userStore = useUserStore();
const router = useRouter();
const route = useRoute();
const role = computed(() => userStore.role);
const allowReview = computed(() => ['class_admin','counselor','college_admin','school_admin','super_admin'].includes(role.value));
const fmt = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-';

const loading = ref(false);
const submitting = ref(false);
const classes = ref([]);
const list = ref([]);
const total = ref(0);
const pendingCount = ref(0);
// 按传入 scope 初始化默认状态：scope=pending → 仅待处理；scope=done → 仅已处理
const defaultStatus = props.scope === 'pending' ? 'pending' : (props.scope === 'done' ? 'done' : '');
const f = reactive({ page: 1, pageSize: 10, status: defaultStatus, classId: '', keyword: '' });
const detailVisible = ref(false);
const cur = ref(null);
const rf = reactive({ action: 'approved', reply: '' });

const go = async (p) => {
  f.page = p; loading.value = true;
  try {
    // scope=pending 固定仅待处理；scope=done 固定已处理(approved/rejected)
    let reqStatus = f.status || undefined;
    if (props.scope === 'pending') reqStatus = 'pending';
    else if (props.scope === 'done' && !f.status) reqStatus = ['approved', 'rejected'];
    // 关键词搜索由后端支持（匹配申报标题/申诉理由/学生姓名学号）
    const r = await getAppeals({
      page: f.page, pageSize: f.pageSize,
      status: reqStatus,
      classId: f.classId || undefined,
      keyword: f.keyword.trim() || undefined
    });
    list.value = r?.list || [];
    total.value = r?.total || 0;
  } finally { loading.value = false; }
  // 顺便拿 pending 计数（为 Tab 徽标展示用）
  try {
    const r2 = await getAppeals({ page: 1, pageSize: 1, status: 'pending' });
    pendingCount.value = r2?.total || 0;
    emit('pending', pendingCount.value);
  } catch (_) { pendingCount.value = 0; }
};
const open = async (row) => {
  cur.value = await getAppealDetail(row.id);
  rf.action = 'approved'; rf.reply = '';
  detailVisible.value = true;
};
const view = open;
const submitReview = async () => {
  if (!rf.reply.trim()) return ElMessage.warning('请填写答复');
  submitting.value = true;
  try {
    await reviewAppeal(cur.value.id, { status: rf.action, reply: rf.reply.trim() });
    ElMessage.success(rf.action === 'approved' ? '申诉通过，已生成重新申请并通知学生' : '已驳回');
    detailVisible.value = false;
    go(f.page);
  } finally { submitting.value = false; }
};
const goReapply = () => {
  if (!cur.value?.reopenedAppId) return;
  // 管理员跳去审批中心详情 / 申报查询页
  router.push({ path: '/approval', query: { applicationId: cur.value.reopenedAppId } });
};

onMounted(async () => {
  try {
    if (role.value !== 'class_admin') {
      const r = await getClassList({ pageSize: 300 });
      classes.value = r?.list || [];
    }
  } catch (_) {}
  go(1);
  // URL 参数自动打开申诉详情：支持 appealId
  const appealId = route.query.appealId;
  if (appealId) {
    await nextTick();
    const target = list.value.find(item => String(item.id) === String(appealId));
    if (target) {
      open(target);
    } else {
      // If not in current page, fetch and open directly
      try {
        const detail = await getAppealDetail(appealId);
        if (detail) {
          cur.value = detail;
          rf.action = 'approved'; rf.reply = '';
          detailVisible.value = true;
        }
      } catch (_) {}
    }
  }
});
// 暴露 pendingCount 给父 Approval.vue 做徽标
defineExpose({ pendingCount });
</script>
<style lang="scss" scoped>
.filters { display:flex; flex-wrap: wrap; gap: 10px; align-items:center; }
.mb-16 { margin-bottom: 16px; }
.muted { color: #909399; font-size: 12px; }
.mt-4 { margin-top: 4px; }
.page-wrap { display:flex; justify-content: flex-end; padding: 12px 0 0; }
.one-line { white-space: nowrap; overflow:hidden; text-overflow: ellipsis; display:block; }
</style>
