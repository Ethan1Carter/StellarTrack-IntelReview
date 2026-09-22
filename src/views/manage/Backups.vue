<template>
  <div class="manage-page">
    <WorkspaceHero eyebrow="SYSTEM ARCHIVE" title="数据备份" description="查看备份记录并创建安全快照；恢复属于高风险操作，请在确认数据范围后执行。" />
    <el-alert title="仅学校管理员可执行备份与恢复；恢复前请先备份当前数据，操作不可逆！" type="error" show-icon :closable="false" style="margin-bottom:16px;" />

    <el-row :gutter="16">
      <el-col :xs="24" :md="12">
        <div class="card">
          <div class="card-title"><el-icon size="18" color="#67C23A"><CircleCheckFilled /></el-icon> 快速操作</div>
          <div style="padding: 8px 16px 20px;">
            <div style="margin-bottom: 14px;"><strong>备份当前数据库：</strong> 生成 .sql 备份文件，可用于恢复。</div>
            <el-button type="primary" size="large" :loading="backing" @click="createBackup"><Download /> 立即备份</el-button>
            <div style="margin: 24px 0 14px;"><strong>上传备份恢复：</strong> 将系统恢复至备份文件的状态（清空现有数据）。</div>
            <el-upload action="#" :auto-upload="false" :show-file-list="false" accept=".sql,application/sql,.zip" :before-upload="confirmRestore">
              <el-button type="danger" size="large"><Upload /> 从备份恢复</el-button>
              <template #tip><div style="color:#F56C6C; font-size:12px; margin-top:6px;">支持 .sql / .zip 备份文件，恢复过程不可撤销！</div></template>
            </el-upload>
          </div>
        </div>
        <div class="card mt-16">
          <div class="card-title">系统数据总览</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="用户总数">{{ stats.users }}</el-descriptions-item>
            <el-descriptions-item label="加分模块数">{{ stats.modules }}</el-descriptions-item>
            <el-descriptions-item label="申报记录数">{{ stats.applications }}</el-descriptions-item>
            <el-descriptions-item label="已公示次数">{{ stats.publicities }}</el-descriptions-item>
            <el-descriptions-item label="系统日志数">{{ stats.logs }}</el-descriptions-item>
            <el-descriptions-item label="数据库大小">{{ stats.dbSize }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-col>
      <el-col :xs="24" :md="12">
        <div class="card">
          <div class="flex-between card-title">
            <div>备份历史（{{ files.length }}）</div>
            <el-button link type="primary" @click="refresh"><RefreshRight /> 刷新</el-button>
          </div>
          <el-table :data="files" v-loading="loading" stripe>
            <el-table-column label="文件名" min-width="200" show-overflow-tooltip>
              <template #default="{row}">
                <el-icon color="#409EFF" style="vertical-align:middle; margin-right:6px;"><Document /></el-icon>
                <span>{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="90" align="right">
              <template #default="{row}">{{ sizeFormat(row.size) }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="160">
              <template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200" fixed="right" align="center">
              <template #default="{row}">
                <el-button link type="primary" @click="download(row)">下载</el-button>
                <el-popconfirm title="确定从此备份恢复？当前数据将被清除！" confirm-button-text="确定恢复" cancel-button-text="取消" confirm-button-type="danger" @confirm="restore(row)">
                  <template #reference><el-button link type="warning">恢复</el-button></template>
                </el-popconfirm>
                <el-popconfirm title="确认删除此备份文件？" @confirm="remove(row)">
                  <template #reference><el-button link type="danger">删除</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!files.length && !loading" description="暂无备份文件，请点击上方按钮立即备份" />
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import dayjs from 'dayjs';
import { listBackups, createBackup as createBk, deleteBackup, downloadBackup, restoreFrom, uploadBackup, getBackupStats } from '@/api/backups';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Files, Download, Upload, Document, RefreshRight, CircleCheckFilled } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const files = ref([]);
const loading = ref(false);
const backing = ref(false);
const stats = ref({});

const refresh = async () => { loading.value = true; try {
  const [l, s] = await Promise.all([listBackups(), getBackupStats()]);
  files.value = l || []; stats.value = s || {};
} finally { loading.value = false; } };

const sizeFormat = (s) => {
  if (s == null) return '--';
  const u = ['B','KB','MB','GB']; let i = 0; let v = s;
  while (v >= 1024 && i < u.length-1) { v /= 1024; i++; }
  return v.toFixed(v<10 && i>0 ? 2 : 1) + ' ' + u[i];
};

const createBackup = async () => {
  backing.value = true; try {
    const r = await createBk(); ElMessage.success(`备份已创建：${r.name}`); await refresh();
  } finally { backing.value = false; }
};

const download = async (f) => {
  try {
    const blob = await downloadBackup(f.name);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob]));
    a.download = f.name; a.click();
  } catch (_) { ElMessage.error('下载失败'); }
};
const remove = async (f) => { await deleteBackup(f.name); ElMessage.success('已删除'); await refresh(); };
const restore = async (f) => {
  await ElMessageBox.confirm(`确认将系统从备份「${f.name}」恢复？当前所有数据将被覆盖！`, '二次确认', { type: 'error', confirmButtonText: '我已知风险，恢复', cancelButtonText: '取消' });
  try { await restoreFrom(f.name); ElMessage.success('恢复成功，请重新登录'); window.location.reload(); }
  catch (e) { ElMessage.error(e.message || '恢复失败'); }
};
const confirmRestore = async (f) => {
  try {
    await ElMessageBox.confirm(`将从备份文件「${f.name}」恢复系统，当前数据将被覆盖，且不可撤销。确定继续？`, '危险操作', { type: 'error' });
    const fd = new FormData(); fd.append('file', f);
    await uploadBackup(fd);
    ElMessage.success('恢复成功，请重新登录');
    setTimeout(() => window.location.reload(), 1200);
  } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '恢复失败'); return false; }
  return false; // 终止自动上传
};

onMounted(refresh);
</script>
