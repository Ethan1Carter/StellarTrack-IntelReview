<template>
  <div class="notice-workspace">
    <WorkspaceHero
      eyebrow="CAMPUS COMMUNICATION"
      title="公告通知"
      description="集中管理校园通知与重要提醒，让不同角色及时接收清晰、准确的信息。"
    >
      <template #actions>
        <el-button :disabled="!canEdit" @click="openEdit(null)"><Plus /> 发布公告</el-button>
      </template>
    </WorkspaceHero>

    <div class="card notice-board">
      <div class="notice-heading">
        <div>
          <span class="notice-kicker">通知列表</span>
          <h3>已发布公告 <em>{{ total }}</em></h3>
        </div>
        <div class="notice-guide"><span></span>点击左侧箭头可展开查看公告正文</div>
      </div>
      <el-table class="notice-table" :data="list" v-loading="loading" stripe>
        <el-table-column type="expand">
          <template #default="{row}">
            <div class="expand-content" v-html="row.content"></div>
          </template>
        </el-table-column>
        <el-table-column label="标题" min-width="260">
          <template #default="{row}">
            <div class="notice-title-cell">
              <el-tag v-if="row.pinTop" type="danger" size="small" effect="dark">置顶</el-tag>
              <el-tag v-if="row.type" size="small" :type="row.type==='urgent'?'danger':(row.type==='important'?'warning':'info')">{{ TYPE[row.type] || '通知' }}</el-tag>
              <strong>{{ row.title }}</strong>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="发布范围" width="140" align="center">
          <template #default="{row}"><template v-if="row.targets?.length"><el-tag size="small" v-for="t in row.targets.slice(0,2)" :key="t" type="primary" effect="plain" style="margin-right:4px;">{{ SCOPE[t] || t }}</el-tag><span v-if="row.targets.length>2">等</span></template></template>
        </el-table-column>
        <el-table-column label="发布者" width="110">
          <template #default="{row}">{{ row.creator?.name || '--' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{row}"><el-switch v-model="row.status" :disabled="!canEdit" :active-value="1" :inactive-value="0" @change="(v)=>toggle(row, v)" /></template>
        </el-table-column>
        <el-table-column prop="createdAt" label="发布时间" width="160">
          <template #default="{row}">{{ dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="!row.pinTop" link type="warning" :disabled="!canEdit" @click="pinTop(row, true)">置顶</el-button>
            <el-button v-else link type="info" :disabled="!canEdit" @click="pinTop(row, false)">取消置顶</el-button>
            <el-popconfirm v-if="canEdit" title="确认删除此公告？" @confirm="del(row)">
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s; go(1)}" @current-change="go" />
      </div>
    </div>

    <el-dialog v-model="editVisible" class="notice-dialog" :title="editing?.id ? '编辑公告' : '发布公告'" width="min(720px,92vw)">
      <el-form ref="formRef" :model="mForm" :rules="mRules" label-width="90px">
        <el-form-item label="标题" prop="title"><el-input v-model="mForm.title" maxlength="100" show-word-limit /></el-form-item>
        <el-form-item label="类型"><el-radio-group v-model="mForm.type">
          <el-radio label="normal">普通通知</el-radio>
          <el-radio label="important">重要</el-radio>
          <el-radio label="urgent">紧急</el-radio>
        </el-radio-group></el-form-item>
        <el-form-item label="置顶"><el-switch v-model="mForm.pinTop" /></el-form-item>
        <el-form-item label="发布范围" prop="targets">
          <el-checkbox-group v-model="mForm.targets">
            <el-checkbox v-for="(v,k) in SCOPE" :key="k" :label="k">{{ v }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="内容" prop="content"><div class="editor-shell">
          <div class="rt-toolbar">
            <select v-model="fontSize" class="font-size-select" @change="exec('fontSize', fontSize)">
              <option value="3">16px</option><option value="4">18px</option><option value="5">20px</option><option value="6">24px</option><option value="7">28px</option>
            </select>
            <el-button-group>
              <el-button size="small" @click="exec('bold')" title="加粗"><b>B</b></el-button>
              <el-button size="small" @click="exec('italic')" title="斜体"><i>I</i></el-button>
              <el-button size="small" @click="exec('underline')" title="下划线"><u>U</u></el-button>
              <el-button size="small" @click="exec('insertUnorderedList')" title="无序列表">• 列表</el-button>
              <el-button size="small" @click="exec('insertOrderedList')" title="有序列表">1. 列表</el-button>
              <el-button size="small" @click="exec('justifyLeft')">左</el-button>
              <el-button size="small" @click="exec('justifyCenter')">中</el-button>
              <el-button size="small" @click="exec('justifyRight')">右</el-button>
              <el-color-picker v-model="color" size="small" @change="c=>exec('foreColor', c)" />
            </el-button-group>
          </div>
          <div ref="editorRef" class="editor" contenteditable="true" @input="onEditorInput" placeholder="请输入公告内容..."></div>
        </div></el-form-item>
        <el-form-item label="附件"><el-upload action="#" :auto-upload="false" :on-change="onAttachChange" :on-remove="onAttachRemove" :file-list="fileList">
          <el-button><Upload /> 上传附件</el-button>
          <template #tip><div class="upload-tip">支持图片、PDF、Word、Excel、压缩包</div></template>
        </el-upload></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible=false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">{{ editing?.id ? '保存' : '立即发布' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, nextTick } from 'vue';
import dayjs from 'dayjs';
import { noticeList, createNotice, updateNotice, deleteNotice, pinNotice, toggleNotice, uploadAttachment } from '@/api/notices';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { Bell, Plus, Upload } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const TYPE = { normal: '普通通知', important: '重要', urgent: '紧急' };
const SCOPE = { all: '全部人员', student: '学生', counselor: '辅导员', college_admin: '院系管理员', school_admin: '学校管理员' };
const canEdit = computed(() => ['school_admin', 'super_admin', 'college_admin'].includes(userStore.role));
const SCOPE_LIST = { template: `dummy` };

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, pageSize: 15 });
const go = async (p) => { f.page = p; loading.value = true; try { const r = await noticeList(f); list.value = r?.list || []; total.value = r?.total || 0; } finally { loading.value = false; } };

const editVisible = ref(false);
const editing = ref(null);
const formRef = ref();
const saving = ref(false);
const editorRef = ref(null);
const fontSize = ref('3');
const color = ref('#303133');
const fileList = ref([]);
const uploadedAttachments = ref([]);
const mForm = reactive({});
const mRules = {
  title: [{ required: true, message: '请输入标题' }],
  targets: [{ type: 'array', required: true, message: '请选择发布范围', min: 1 }],
  content: [{ required: true, message: '请输入内容' }]
};

const exec = (cmd, val = null) => document.execCommand(cmd, false, val);
const onEditorInput = () => {
  mForm.content = editorRef.value?.innerHTML || '';
};
const onAttachChange = async (f) => {
  try {
    const fd = new FormData(); fd.append('file', f.raw);
    const r = await uploadAttachment(fd);
    uploadedAttachments.value.push({ name: f.name, url: r.url });
    ElMessage.success('上传成功');
  } catch (_) { ElMessage.error('上传失败'); fileList.value = fileList.value.filter(x => x.uid !== f.uid); }
};
const onAttachRemove = (f) => {
  uploadedAttachments.value = uploadedAttachments.value.filter(x => x.name !== f.name);
};

const openEdit = async (row) => {
  editing.value = row;
  const defaultTargets = row?.targets?.length ? [...row.targets] : ['all'];
  Object.assign(mForm, row ? { ...row, targets: [...(row.targets||defaultTargets)] } : { title: '', type: 'normal', pinTop: false, targets: ['all'], content: '' });
  uploadedAttachments.value = row?.attachments?.length ? row.attachments.map(a => ({...a})) : [];
  fileList.value = uploadedAttachments.value.map(a => ({ name: a.name, url: a.url }));
  editVisible.value = true;
  await nextTick();
  if (editorRef.value) editorRef.value.innerHTML = mForm.content || '';
};
const submitEdit = async () => {
  mForm.content = editorRef.value?.innerHTML || '';
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = { ...mForm, attachments: uploadedAttachments.value };
    if (editing.value?.id) { await updateNotice(editing.value.id, payload); ElMessage.success('已更新'); }
    else { await createNotice(payload); ElMessage.success('已发布'); }
    editVisible.value = false; go(f.page);
  } finally { saving.value = false; }
};
const del = async (r) => { await deleteNotice(r.id); ElMessage.success('已删除'); go(f.page); };
const pinTop = async (r, v) => { await pinNotice(r.id, v); ElMessage.success(v ? '已置顶' : '已取消置顶'); go(f.page); };
const toggle = async (r, v) => { await toggleNotice(r.id, v); ElMessage.success(v ? '已启用' : '已停用'); go(f.page); };

onMounted(() => go(1));
</script>
<style lang="scss" scoped>
.notice-workspace { padding-bottom: 8px; }
.notice-board {
  margin-top: 18px;
  padding: 0;
  overflow: hidden;
  border: 1px solid #E6EDF7;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 12px 32px rgba(23, 43, 77, .055);
}
.notice-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid #EDF2F8;

  h3 { margin: 5px 0 0; color: #172B4D; font-size: 18px; }
  em { margin-left: 5px; color: #1876D2; font-size: 22px; font-style: normal; }
}
.notice-kicker { color: #1686D9; font-size: 11px; font-weight: 800; letter-spacing: .16em; }
.notice-guide { display: flex; align-items: center; gap: 7px; color: #8B99AD; font-size: 12px; }
.notice-guide span { width: 7px; height: 7px; border-radius: 50%; background: #17B5C8; box-shadow: 0 0 0 4px rgba(23, 181, 200, .1); }
.notice-title-cell { display:flex; align-items:center; gap:8px; color: #223A5F; }
.expand-content { margin: 4px 22px 14px 56px; padding: 18px 20px; border-left: 3px solid #26A9D4; border-radius: 4px 12px 12px 4px; background: #F5F9FD; line-height: 1.85; color:#43546D; }
.page-wrap { display:flex; justify-content:flex-end; padding: 18px 22px; border-top: 1px solid #EDF2F8; }
.editor-shell { width: 100%; overflow: hidden; border: 1px solid #DCE5F0; border-radius: 12px; background: #fff; }
.rt-toolbar { padding: 9px; border-bottom: 1px solid #E6EDF6; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: #F6F9FC; }
.font-size-select { height: 30px; padding: 4px 8px; border: 1px solid #D9E3EF; border-radius: 7px; color: #44546A; background: #fff; }
.editor { min-height: 220px; padding: 16px 18px; outline: none; line-height: 1.8; color: #293B58;
  &:empty:before { content: attr(placeholder); color: #c0c4cc; }
}
.upload-tip { margin-top: 6px; color:#909399; font-size: 12px; }
:deep(.notice-table) { --el-table-header-bg-color: #F5F8FC; --el-table-row-hover-bg-color: #F3F8FF; }
:deep(.notice-table th.el-table__cell) { height: 50px; color: #52647E; font-weight: 700; }
:deep(.notice-table td.el-table__cell) { padding: 13px 0; }
:global(.notice-dialog.el-dialog) { overflow: hidden; border-radius: 18px; box-shadow: 0 24px 70px rgba(15, 35, 75, .22); }
:global(.notice-dialog .el-dialog__header) { margin: 0; padding: 20px 24px; border-bottom: 1px solid #E9EFF7; background: linear-gradient(90deg, #F4F8FD, #fff); }
:global(.notice-dialog .el-dialog__body) { padding: 24px 26px 8px; }
:global(.notice-dialog .el-dialog__footer) { padding: 16px 24px 20px; border-top: 1px solid #EEF2F7; }

@media (max-width: 768px) {
  .notice-heading { align-items: flex-start; flex-direction: column; padding: 19px; }
  .notice-guide { display: none; }
  .expand-content { margin: 4px 12px 12px; }
  .page-wrap { justify-content: center; overflow-x: auto; padding: 15px 12px; }
}
</style>
