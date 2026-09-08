<template>
  <div class="approval-page">
    <WorkspaceHero
      eyebrow="APPROVAL WORKFLOW"
      title="考评审核中心"
      description="集中处理申报审批、抄送记录与学生申诉，让每一步都有清晰轨迹。"
    />

    <el-tabs v-model="tab" class="approval-tabs">
      <el-tab-pane label="待我审批" name="pending"><ApprovalList mode="pending" :key="'p'+tab" @switch-appeals="tab='appeals'" @approve-success="tab='done'" /></el-tab-pane>
      <el-tab-pane label="我已审批" name="done"><ApprovalList mode="done" :key="'d'+tab" /></el-tab-pane>
      <el-tab-pane label="抄送记录" name="copy">
        <el-tabs v-model="copySubTab" type="card" class="sub-tabs">
          <el-tab-pane label="我发起的抄送" name="from_me"><ApprovalList mode="copy_from_me" key="copy_from_me" /></el-tab-pane>
          <el-tab-pane label="抄送给我的" name="to_me"><ApprovalList mode="copy_to_me" key="copy_to_me" /></el-tab-pane>
        </el-tabs>
      </el-tab-pane>
      <el-tab-pane name="appeals">
        <template #label>
          <span>申诉待办</span>
          <el-badge v-if="appealPending>0" :value="appealPending" class="ml-8 badge-sm" />
        </template>
        <el-tabs v-model="appealSubTab" type="card" class="sub-tabs">
          <el-tab-pane name="pending">
            <template #label>
              <span>待处理</span>
              <el-badge v-if="appealPending>0" :value="appealPending" class="ml-8 badge-sm" />
            </template>
            <AppealTodoList ref="appealPendingRef" scope="pending" @pending="appealPending=$event" />
          </el-tab-pane>
          <el-tab-pane label="已处理" name="done">
            <AppealTodoList ref="appealDoneRef" scope="done" />
          </el-tab-pane>
        </el-tabs>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import ApprovalList from '@/components/ApprovalList.vue';
import AppealTodoList from '@/components/AppealTodoList.vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';
import { useRoute } from 'vue-router';
const tab = ref('pending');
const copySubTab = ref('from_me');
const appealSubTab = ref('pending');
const appealRef = ref(null);
const appealPendingRef = ref(null);
const appealDoneRef = ref(null);
const appealPending = ref(0);
const route = useRoute();

// 处理 URL 参数中的 applicationId / appealId
function handleQuery() {
  const appId = route.query.applicationId;
  const appealId = route.query.appealId;
  if (appealId) {
    tab.value = 'appeals';
    appealSubTab.value = 'pending';
  } else if (appId) {
    tab.value = 'pending';
  }
}

let syncTimer = null;
onMounted(async () => {
  handleQuery();
  await nextTick();
  if (appealPendingRef.value && typeof appealPendingRef.value.pendingCount !== 'undefined') appealPending.value = appealPendingRef.value.pendingCount;
  const sync = () => {
    if (appealPendingRef.value && typeof appealPendingRef.value.pendingCount !== 'undefined') appealPending.value = appealPendingRef.value.pendingCount;
  };
  syncTimer = setInterval(sync, 15000);
});
onBeforeUnmount(() => { if (syncTimer) clearInterval(syncTimer); });

watch(() => route.query, () => {
  handleQuery();
}, { deep: true });
</script>
<style lang="scss" scoped>
.ml-8 { margin-left: 8px; }
.badge-sm :deep(.el-badge__content) { font-size: 11px; padding: 0 6px; line-height: 16px; height: 16px; }
.sub-tabs { margin-top: 4px; }
.sub-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.approval-tabs {
  margin-top: 18px;
  padding: 0 20px 20px;
  border: 1px solid rgba(210, 222, 239, .88);
  border-radius: 18px;
  background: rgba(255,255,255,.98);
  box-shadow: 0 12px 34px rgba(22,44,84,.06);
  :deep(> .el-tabs__header) { margin: 0 -20px 18px; padding: 0 20px; border-bottom: 1px solid #E8EEF6; background: linear-gradient(90deg, #F8FAFD, #F4F9FF); border-radius: 18px 18px 0 0; }
  :deep(> .el-tabs__header .el-tabs__item) { height: 58px; color: #697991; font-weight: 650; }
  :deep(> .el-tabs__header .el-tabs__item.is-active) { color: #2563EB; }
  :deep(> .el-tabs__header .el-tabs__active-bar) { height: 3px; border-radius: 99px; background: linear-gradient(90deg, #2563EB, #06B6D4); }
}
@include mobile { .approval-tabs { padding: 0 12px 12px; :deep(> .el-tabs__header) { margin: 0 -12px 14px; padding: 0 12px; } } }
</style>
