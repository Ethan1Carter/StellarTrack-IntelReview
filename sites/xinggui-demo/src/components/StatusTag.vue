<template>
  <el-tag :type="tag.type" :effect="tag.effect" round size="small" class="status-tag">{{ tag.label }}</el-tag>
</template>
<script setup>
import { computed } from 'vue';
const props = defineProps({
  status: { type: String, default: '' },
  /** 申诉整体状态：pending / approved / rejected / closed（用于在申报行尾展示申诉进度） */
  appealState: { type: String, default: '' },
  /** 历史学期标记：true 时额外展示「历史学期」标签 */
  isHistory: { type: Boolean, default: false }
});
// 状态码 → 中文映射字典（禁止直接展示英文编码）
const MAP = {
  // 申报单据状态
  draft:        { label: '草稿',           type: 'info',    effect: 'plain' },
  pending:      { label: '待班级管理员审批', type: 'warning', effect: 'dark' },
  approving:    { label: '待班级管理员审批', type: 'warning', effect: 'dark' },
  returned:     { label: '待补充',         type: 'warning', effect: 'plain' },
  approved:     { label: '已通过',         type: 'success', effect: 'dark' },
  rejected:     { label: '已驳回',         type: 'danger',  effect: 'plain' },
  publishing:   { label: '公示中',         type: 'warning', effect: 'dark' },
  ended:        { label: '已结束',         type: 'info',    effect: 'plain' },
  published:    { label: '已公示',         type: 'success', effect: 'plain' },
  revoked:      { label: '已撤销',         type: 'info',    effect: 'plain' },
  // 辅导员终审/申诉相关
  final_review: { label: '辅导员终审',     type: 'success', effect: 'dark' },
  appealing:    { label: '申诉中',         type: 'danger',  effect: 'dark' },
  appeal_closed: { label: '申诉办结',      type: 'info',    effect: 'plain' },
  // 审批步骤状态
  waiting:      { label: '待处理',         type: 'warning', effect: 'dark' },
  processing:   { label: '处理中',         type: 'primary', effect: 'dark' },
  passed:       { label: '通过',           type: 'success', effect: 'dark' },
  refused:      { label: '驳回',           type: 'danger',  effect: 'dark' },
  skipped:      { label: '跳过',           type: 'info',    effect: 'plain' }
};
const tag = computed(() => {
  // 优先显示申诉整体状态
  if (props.appealState === 'pending')   return MAP.appealing;
  if (props.appealState === 'closed')    return MAP.appeal_closed;
  if (!props.status) return { label: '-', type: 'info', effect: 'plain' };
  return MAP[props.status] || { label: props.status, type: 'info', effect: 'plain' };
});
</script>
<style lang="scss" scoped>.status-tag{font-weight:500}</style>
