<template>
  <el-dialog v-model="visible" title="申报详情" width="min(860px, 92vw)" destroy-on-close append-to-body>
    <!-- 异常兜底：app 为空时展示友好提示 -->
    <div v-if="!app" class="empty-page">
      <el-empty description="详情数据加载失败或不存在" />
    </div>

    <div v-else class="detail">
      <!-- 顶部状态 + 历史学期标签 -->
      <div class="status-bar">
        <span class="lbl">当前状态：</span>
        <StatusTag :status="safeStr(app.status)" />
        <el-tag v-if="app.isHistorySemester || isHistory" type="warning" effect="plain" size="small" style="margin-left:6px;">历史学期（只读）</el-tag>
        <el-tag v-if="app.appealCount > 0" type="danger" effect="light" size="small" style="margin-left:6px;">申诉 {{ app.appealCount }} 次</el-tag>
      </div>

      <!-- 基本信息 -->
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="审批单号">
          <el-tooltip v-if="app.approvalNo" content="全局唯一ID：AP+创建年月日+6位流水号" placement="top">
            <span style="font-family: monospace; letter-spacing: 0.3px;">{{ app.approvalNo }}</span>
          </el-tooltip>
          <span v-else style="color:#c0c4cc;">--</span>
        </el-descriptions-item>
        <el-descriptions-item label="申报ID">{{ safeNum(app.id) }}</el-descriptions-item>
        <el-descriptions-item label="申报学生">{{ safeStr(app.student?.realName) }}（{{ safeStr(app.student?.username) }}）</el-descriptions-item>
        <el-descriptions-item label="模块">
          <el-tag :style="{ background: app.module?.color || '#409EFF', border:'none' }" effect="dark">{{ safeStr(app.module?.name, '未知模块') }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="等级奖项">{{ levelText(app.awardLevel, app.otherDescription) }}</el-descriptions-item>
        <el-descriptions-item label="所属院系班级">{{ safeStr(app.college?.name || app.classInfo?.college?.name, '-') }} / {{ safeStr(app.classInfo?.name, '-') }}</el-descriptions-item>
        <el-descriptions-item label="申报标题" :span="2">{{ safeStr(app.title, '(未填写)') }}</el-descriptions-item>
        <el-descriptions-item label="申请分数">{{ safeNum(app.score) }}</el-descriptions-item>
        <el-descriptions-item label="最终分数">
          <span v-if="['approved','final_review'].includes(app.status)" style="color:#67C23A; font-weight:600;">+{{ safeNum(app.finalScore) }}</span>
          <span v-else style="color:#909399;">未通过</span>
        </el-descriptions-item>
        <el-descriptions-item label="事件日期">{{ formatDate(app.eventDate) }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatDateTime(app.submittedAt || app.createdAt) }}</el-descriptions-item>
        <el-descriptions-item v-if="app.certificateNo" label="证书编号" :span="2">{{ safeStr(app.certificateNo) }}</el-descriptions-item>
        <el-descriptions-item v-if="app.linkUrl" label="相关链接" :span="2">
          <a :href="app.linkUrl" target="_blank" style="color:#409EFF; word-break: break-all;">{{ safeStr(app.linkUrl) }}</a>
        </el-descriptions-item>
        <el-descriptions-item label="详细说明" :span="2">
          <div class="desc-block">{{ safeStr(app.description, '(未填写)') }}</div>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 驳回理由高亮 -->
      <div v-if="['rejected','returned'].includes(app.status) || app.rejectReason" class="reject-banner">
        <el-icon><WarningFilled /></el-icon>
        <div class="reject-content">
          <div class="reject-title">{{ app.status === 'returned' ? '退回补充' : '驳回理由' }}</div>
          <div class="reject-text">{{ safeStr(app.rejectReason, '无') }}</div>
        </div>
      </div>

      <!-- 证明材料（附件预览） -->
      <div class="section">
        <h4>证明材料（{{ proofFiles.length }}）</h4>
        <el-empty v-if="!proofFiles.length" description="暂无附件" :image-size="50" />
        <el-row v-else :gutter="12">
          <el-col v-for="(u, i) in proofFiles" :key="i" :xs="8" :sm="6" :md="4">
            <div class="proof-item">
              <a :href="u" target="_blank">
                <img v-if="isImg(u)" :src="u" class="proof-img" />
                <div v-else class="proof-file">
                  <el-icon size="32"><Document /></el-icon>
                  <span>{{ filename(u) }}</span>
                </div>
              </a>
            </div>
          </el-col>
        </el-row>
      </div>

      <!-- 加分标准展示 -->
      <div class="section">
        <h4>
          加分标准
          <el-button link type="primary" size="small" @click="standardVisible = true">
            <el-icon><View /></el-icon> 查看加分标准
          </el-button>
        </h4>
        <div class="rule-text">{{ safeStr(app.module?.ruleDescription, '该模块未配置加分标准说明') }}</div>
      </div>

      <!-- 完整审批流转记录 -->
      <div class="section">
        <h4>审批流转记录</h4>
        <el-timeline v-if="timelineItems.length">
          <el-timeline-item v-for="(it, i) in timelineItems" :key="i" :timestamp="it.time" :type="it.type" :hollow="it.hollow" placement="top">
            <div class="tl-card">
              <div class="tl-header">
                <span class="tl-name">{{ it.title }}</span>
                <el-tag v-if="it.tag" :type="it.tag.type" :effect="it.tag.effect" size="small">{{ it.tag.label }}</el-tag>
              </div>
              <div class="tl-content">
                <span v-if="it.operator">操作人：{{ it.operator }}<span v-if="it.role" style="color:#909399; margin-left:6px;">（{{ roleLabel(it.role) }}）</span></span>
                <div v-if="it.comment" class="tl-comment">{{ it.comment }}</div>
              </div>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无审批记录" :image-size="50" />
      </div>

      <!-- 辅导员终审信息（如有） -->
      <div v-if="app.finalReviewedBy || app.finalReviewComment" class="section">
        <h4>辅导员终审</h4>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="终审人">{{ safeStr(app.finalReviewedBy?.realName || app.finalReviewedByName) || '-' }}</el-descriptions-item>
          <el-descriptions-item label="终审时间">{{ formatDateTime(app.finalReviewedAt) }}</el-descriptions-item>
          <el-descriptions-item label="终审意见">{{ safeStr(app.finalReviewComment, '-') }}</el-descriptions-item>
          <el-descriptions-item label="终审动作">{{ finalActionText(app.finalReviewAction) }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 申诉记录区块（全部历史申诉） -->
      <div class="section">
        <h4>申诉记录（{{ appeals.length }}）</h4>
        <el-empty v-if="!appeals.length" description="暂无申诉记录" :image-size="50" />
        <div v-else class="appeal-list">
          <div v-for="ap in appeals" :key="ap.id" class="appeal-card">
            <div class="ap-header">
              <span class="ap-no">#{{ ap.id }}</span>
              <el-tag :type="appealTagType(ap.status)" :effect="ap.status === 'pending' ? 'dark' : 'plain'" size="small">
                {{ appealStatusText(ap.status) }}
              </el-tag>
              <span class="ap-time">提交：{{ formatDateTime(ap.createdAt) }}</span>
            </div>
            <div class="ap-body">
              <div class="ap-row"><span class="lbl">申诉理由：</span><div class="val">{{ safeStr(ap.reason, '-') }}</div></div>
              <div v-if="ap.attachments && ap.attachments.length" class="ap-row">
                <span class="lbl">佐证附件：</span>
                <div class="val ap-files">
                  <a v-for="(u, idx) in ap.attachments" :key="idx" :href="u" target="_blank" class="ap-file-link">
                    <el-icon><Document /></el-icon><span>{{ filename(u) }}</span>
                  </a>
                </div>
              </div>
              <div v-if="ap.status !== 'pending'" class="ap-row">
                <span class="lbl">处理结果：</span>
                <div class="val">
                  <strong>{{ appealStatusText(ap.status) }}</strong>
                  <span style="color:#909399; margin:0 8px;">·</span>
                  <span>处理人：{{ safeStr(ap.reviewer?.realName || ap.reviewedByName) || '-' }}</span>
                  <span style="color:#909399; margin:0 8px;">·</span>
                  <span>{{ formatDateTime(ap.reviewedAt) }}</span>
                </div>
              </div>
              <div v-if="ap.reply" class="ap-row">
                <span class="lbl">处理意见：</span>
                <div class="val">{{ safeStr(ap.reply, '-') }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible=false">关闭</el-button>
      <!-- 操作按钮（受历史学期 + 状态控制） -->
      <el-button v-if="canWithdraw" type="warning" plain @click="emit('withdraw', app)">撤回申报</el-button>
      <el-button v-if="canEdit" type="primary" plain @click="goEdit">编辑</el-button>
      <el-button v-if="canAppeal" type="danger" @click="emit('appeal', app)">发起申诉</el-button>
      <el-tooltip v-else-if="app?.status === 'final_review' && !isReadonly" content="已达最大申诉次数或存在待处理申诉" placement="top">
        <el-button type="info" disabled>发起申诉</el-button>
      </el-tooltip>
    </template>

    <!-- 加分标准弹窗 -->
    <el-dialog v-model="standardVisible" title="加分标准" width="640px" append-to-body destroy-on-close>
      <div class="rule-detail">
        <div class="rule-meta">
          <el-tag :style="{ background: app?.module?.color || '#409EFF', border: 'none' }" effect="dark">
            {{ safeStr(app?.module?.name, '未知模块') }}
          </el-tag>
          <span style="color:#909399; margin-left:8px;">
            单次上限 {{ safeNum(app?.module?.singleMaxScore) }} 分 · 累计上限 {{ safeNum(app?.module?.yearlyMaxScore) }} 分
          </span>
        </div>
        <div class="rule-content">{{ safeStr(app?.module?.ruleDescription, '该模块未配置加分标准说明') }}</div>
      </div>
      <template #footer>
        <el-button type="primary" @click="standardVisible = false">我已了解</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import StatusTag from './StatusTag.vue';
import { Document, View, WarningFilled } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: Boolean,
  app: Object,
  /** 历史学期标记（外部传入，主要用于按钮禁用） */
  isHistory: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'appeal', 'reapply', 'withdraw']);
const router = useRouter();
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) });

// ====== 异常兜底工具 ======
const safeStr = (v, def = '-') => (v == null || v === '') ? def : String(v);
const ROLE_LABELS = { student: '学生', class_admin: '班级管理员', counselor: '辅导员', college_admin: '院系管理员', school_admin: '学校管理员', super_admin: '超级管理员' };
const roleLabel = (r) => ROLE_LABELS[r] || r || '';
const safeNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const formatDate = (t) => t ? dayjs(t).format('YYYY-MM-DD') : '-';
const formatDateTime = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
const isImg = (u) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(u || '');
const filename = (u) => (u || '').split('/').pop() || '文件';

const LEVEL = {
  international: '国际级', national: '国家级', provincial: '省部级',
  school: '市校级', college: '院系级', other: '其他'
};
const levelText = (lvl, otherDesc) => {
  if (!lvl) return '-';
  if (lvl === 'other') return otherDesc ? `其他（${otherDesc}）` : '其他';
  return LEVEL[lvl] || lvl;
};

// ====== 证明材料 ======
const proofFiles = computed(() => {
  const p = props.app?.proofUrl || props.app?.attachPhotos;
  if (!p) return [];
  if (Array.isArray(p)) return p.filter(Boolean);
  return String(p).split(',').map(s => s.trim()).filter(Boolean);
});

// ====== 申诉记录 ======
const appeals = computed(() => {
  const list = props.app?.appeals || [];
  return Array.isArray(list) ? list.sort((a, b) => b.id - a.id) : [];
});
const appealStatusText = (s) => ({ pending: '处理中', approved: '申诉通过', rejected: '申诉驳回' }[s] || s || '-');
const appealTagType = (s) => ({ pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info');

// ====== 审批流转 timeline ======
const timelineItems = computed(() => {
  const items = [];
  const app = props.app;
  if (!app) return items;

  // 学生提交
  if (app.submittedAt || app.createdAt) {
    items.push({
      time: formatDateTime(app.submittedAt || app.createdAt),
      type: 'primary', hollow: false,
      title: '学生提交申报',
      operator: app.student?.realName || '学生', role: 'student',
      comment: `标题：${app.title || '-'}，申请分：${safeNum(app.score)}`
    });
  }

  // 班级管理员 / 审批流程记录
  const records = app.approvalRecords || [];
  for (const r of records) {
    if (!r.action) {
      // 待办
      items.push({
        time: formatDateTime(r.assignedAt), type: 'warning', hollow: true,
        title: '待审批', operator: r.approverName || r.approver?.realName || '指定审批人',
        role: r.approverRole || r.approver?.role,
        tag: { type: 'warning', effect: 'dark', label: '待处理' }
      });
      continue;
    }
    let action = r.action, type = 'success', tag = { type: 'success', effect: 'dark', label: '通过' };
    if (action === 'reject' || action === 'rejected') { type = 'danger'; tag = { type: 'danger', effect: 'dark', label: '驳回' }; }
    else if (action === 'return' || action === 'returned') { type = 'warning'; tag = { type: 'warning', effect: 'dark', label: '退回' }; }
    items.push({
      time: formatDateTime(r.handledAt || r.assignedAt), type, hollow: false,
      title: '审批操作', operator: r.approverName || r.approver?.realName || '审批人',
      role: r.approverRole || r.approver?.role,
      comment: r.comment || '', tag
    });
  }

  // 辅导员终审
  if (app.finalReviewedAt) {
    let tag = { type: 'success', effect: 'dark', label: '终审通过' };
    if (app.finalReviewAction === 'reject') tag = { type: 'danger', effect: 'dark', label: '终审驳回' };
    else if (app.finalReviewAction === 'modify') tag = { type: 'warning', effect: 'dark', label: '终审修改' };
    items.push({
      time: formatDateTime(app.finalReviewedAt), type: tag.type, hollow: false,
      title: '辅导员终审', operator: app.finalReviewedBy?.realName || '辅导员', role: 'counselor',
      comment: app.finalReviewComment || '', tag
    });
  }

  // 申诉相关节点
  for (const ap of appeals.value) {
    items.push({
      time: formatDateTime(ap.createdAt), type: 'warning', hollow: false,
      title: `学生申诉 #${ap.id}`, operator: ap.student?.realName || '学生', role: 'student',
      comment: ap.reason || '', tag: { type: 'warning', effect: 'dark', label: '申诉提交' }
    });
    if (ap.status !== 'pending') {
      items.push({
        time: formatDateTime(ap.reviewedAt), type: ap.status === 'approved' ? 'success' : 'danger', hollow: false,
        title: `申诉处理 #${ap.id}`, operator: ap.reviewer?.realName || ap.reviewedByName || '审批人',
        role: ap.reviewer?.role,
        comment: ap.reply || '',
        tag: { type: ap.status === 'approved' ? 'success' : 'danger', effect: 'dark', label: ap.status === 'approved' ? '申诉通过' : '申诉驳回' }
      });
    }
  }

  // 最终状态
  if (app.status === 'approved' || app.status === 'final_review') {
    items.push({
      time: formatDateTime(app.approvedAt || app.updatedAt), type: 'success', hollow: false,
      title: '单据办结', operator: '', role: '',
      comment: `最终得分：${safeNum(app.finalScore)} 分`,
      tag: { type: 'success', effect: 'dark', label: '已生效' }
    });
  }

  return items;
});

const finalActionText = (a) => ({ approve: '通过', reject: '驳回', modify: '修改分数' }[a] || a || '-');

// ====== 按钮权限计算 ======
const isReadonly = computed(() => props.isHistory || props.app?.isHistorySemester);
const canWithdraw = computed(() => !isReadonly.value && ['pending','approving'].includes(props.app?.status));
const canEdit = computed(() => !isReadonly.value && ['draft','returned','rejected'].includes(props.app?.status));
const canAppeal = computed(() => {
  if (isReadonly.value) return false;
  if (props.app?.status !== 'final_review') return false;
  // 存在待处理申诉 → 不可再申诉
  const pending = (props.app?.appeals || []).some(a => a.status === 'pending');
  if (pending) return false;
  // 达到上限 → 不可再申诉（默认3次）
  const max = Number(props.app?.maxAppealCount) || 3;
  const closed = (props.app?.appeals || []).filter(a => ['approved','rejected'].includes(a.status)).length;
  return closed < max;
});

const goEdit = () => {
  if (!props.app?.id) return;
  router.push({ path: '/apply', query: { id: props.app.id } });
  visible.value = false;
};

// ====== 加分标准弹窗 ======
const standardVisible = ref(false);
</script>

<style lang="scss" scoped>
.detail { padding: 4px 0; }
.empty-page { padding: 40px 0; }
.status-bar { margin-bottom: 14px; padding: 8px 12px; background: #f5f7fa; border-radius: 6px; display:flex; align-items:center; gap: 6px;
  .lbl { color: #606266; font-size: 13px; }
}
.desc-block { white-space: pre-wrap; line-height: 1.7; color: #303133; padding: 6px 0; }
.section { margin-top: 22px;
  h4 { margin: 0 0 12px; color: #303133; font-size: 14px; padding-left: 8px; border-left: 3px solid #409EFF; display:flex; align-items:center; justify-content:space-between; }
}
.reject-banner { margin-top: 14px; padding: 12px 16px; background: #fef0f0; border: 1px solid #fbc4c4; border-radius: 8px;
  display: flex; gap: 10px; align-items: flex-start;
  .el-icon { color: #F56C6C; font-size: 18px; margin-top: 2px; }
  .reject-content { flex:1; min-width:0;
    .reject-title { color: #F56C6C; font-weight: 600; margin-bottom: 4px; font-size: 13px; }
    .reject-text { color: #606266; line-height: 1.6; word-break: break-all; }
  }
}
.proof-item { a { display: block; border: 1px solid #ebeef5; border-radius: 8px; overflow: hidden; background: #fafafa; text-align: center; } }
.proof-img { width: 100%; height: 90px; object-fit: cover; display: block; }
.proof-file { padding: 14px 6px; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  color: #606266; span { font-size: 11px; word-break: break-all; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
}
.rule-text { color: #606266; font-size: 13px; line-height: 1.8; padding: 8px 12px; background: #f5f7fa; border-radius: 6px;
  border-left: 3px solid #67C23A; word-break: break-all; }

// 审批 timeline
.tl-card { padding: 6px 0;
  .tl-header { display:flex; align-items:center; gap: 8px; margin-bottom: 4px;
    .tl-name { font-weight: 600; color: #303133; font-size: 14px; }
  }
  .tl-content { color: #606266; font-size: 13px; line-height: 1.7;
    .tl-comment { margin-top: 4px; padding: 6px 10px; background: #f5f7fa; border-radius: 4px; color: #303133; }
  }
}

// 申诉记录
.appeal-list { display: flex; flex-direction: column; gap: 12px; }
.appeal-card { padding: 12px; background: #fafafa; border: 1px solid #ebeef5; border-radius: 8px;
  .ap-header { display:flex; align-items:center; gap: 10px; margin-bottom: 8px;
    .ap-no { font-weight: 600; color: #303133; }
    .ap-time { color: #909399; font-size: 12px; margin-left: auto; }
  }
  .ap-body { font-size: 13px; line-height: 1.7;
    .ap-row { display: flex; gap: 8px; margin-bottom: 6px; align-items: flex-start;
      .lbl { color: #909399; flex-shrink: 0; min-width: 80px; }
      .val { color: #303133; flex: 1; word-break: break-all; }
    }
    .ap-files { display: flex; flex-wrap: wrap; gap: 8px; }
    .ap-file-link { display: inline-flex; align-items: center; gap: 4px; color: #409EFF; text-decoration: none;
      padding: 2px 8px; background: #ecf5ff; border-radius: 4px; font-size: 12px;
      span { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
    }
  }
}

// 加分标准弹窗
.rule-detail {
  .rule-meta { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed #ebeef5; }
  .rule-content { line-height: 1.8; color: #303133; padding: 12px; background: #f5f7fa; border-radius: 6px; white-space: pre-wrap; min-height: 80px; }
}
</style>
