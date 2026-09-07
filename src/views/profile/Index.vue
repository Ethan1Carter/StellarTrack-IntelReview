<template>
  <div class="profile-workspace">
    <WorkspaceHero
      eyebrow="PERSONAL WORKSPACE"
      title="个人中心"
      description="管理账户资料、安全设置与个人消息，让你的星轨智评工作空间保持清晰可靠。"
    />

    <el-row class="profile-layout" :gutter="18">
      <el-col :xs="24" :md="8">
        <div class="card profile-card">
          <div class="bg-img">
            <div class="cover-copy"><span>MY PROFILE</span><strong>星轨个人名片</strong></div>
            <img src="/branding/xinggui-symbol.png" alt="" />
          </div>
          <div class="avatar-wrap">
            <el-avatar :size="88" :src="avatarPreview || user.avatar" @click="() => $refs.avatarInput.click()">
              {{ displayName.charAt(0) }}
            </el-avatar>
            <input ref="avatarInput" type="file" accept="image/*" @change="onAvatarChange" style="display:none" />
            <div class="cam-icon" @click="() => $refs.avatarInput.click()"><el-icon size="16" color="#fff"><CameraFilled /></el-icon></div>
          </div>
          <h3>{{ displayName }}</h3>
          <div class="role-wrap"><el-tag :type="ROLE[user.role]?.type || 'info'" effect="dark">{{ ROLE[user.role]?.label || user.role }}</el-tag></div>
          <ul class="meta">
            <li><span><el-icon><User /></el-icon> 账号</span>{{ user.username }}</li>
            <li v-if="user.employeeNo"><span><el-icon><Medal /></el-icon> 工号</span>{{ user.employeeNo }}</li>
            <li><span><el-icon><Phone /></el-icon> 电话</span>{{ user.phone || '--' }}</li>
            <li><span><el-icon><Message /></el-icon> 邮箱</span>{{ user.email || '--' }}</li>
            <li v-if="user.classInfo?.name || user.college?.name">
              <span><el-icon><School /></el-icon> {{ user.role==='student'?'班级':'学院' }}</span>
              {{ user.classInfo?.college?.name || user.college?.name || '--' }}
              <template v-if="user.classInfo?.name"> / {{ user.classInfo.name }}</template>
            </li>
            <li v-if="user.uniqueId"><span><el-icon><Medal /></el-icon> 系统ID</span><span class="system-id">{{ user.uniqueId }}</span></li>
            <li><span><el-icon><Calendar /></el-icon> 注册时间</span>{{ fmt(user.createdAt) }}</li>
            <li><span><el-icon><Timer /></el-icon> 最近登录</span>{{ user.lastLoginAt ? fmt(user.lastLoginAt) : '--' }}</li>
          </ul>
        </div>
      </el-col>
      <el-col :xs="24" :md="16">
        <div class="card profile-workbench">
        <el-tabs v-model="tab" class="profile-tabs">
          <el-tab-pane label="基本资料" name="info">
            <div class="profile-section">
              <div class="card-title">个人资料 <el-tag size="small" type="success">可修改</el-tag></div>
              <el-form ref="formRef" class="profile-form" :model="mForm" :rules="rules" label-width="100px">
                <el-form-item label="姓名" prop="name"><el-input v-model="mForm.name" /></el-form-item>
                <el-form-item label="手机号" prop="phone"><el-input v-model="mForm.phone" placeholder="请输入11位手机号" /></el-form-item>
                <el-form-item label="邮箱" prop="email"><el-input v-model="mForm.email" /></el-form-item>
                <el-form-item label="性别"><el-radio-group v-model="mForm.gender"><el-radio label="male">男</el-radio><el-radio label="female">女</el-radio></el-radio-group></el-form-item>
                <el-form-item label="生日"><el-date-picker v-model="mForm.birthday" type="date" style="width:100%" /></el-form-item>
                <el-form-item label="个人简介"><el-input v-model="mForm.bio" type="textarea" :rows="3" maxlength="200" show-word-limit /></el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="saving" @click="submitInfo">保存资料</el-button>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>
          <el-tab-pane label="修改密码" name="pwd">
            <div class="profile-section">
              <div class="card-title">修改登录密码</div>
              <el-form ref="pwdRef" class="profile-form password-form" :model="pwdForm" :rules="pwdRules" label-width="120px">
                <el-form-item label="当前密码" prop="oldPwd"><el-input v-model="pwdForm.oldPwd" type="password" show-password /></el-form-item>
                <el-form-item label="新密码" prop="newPwd"><el-input v-model="pwdForm.newPwd" type="password" show-password placeholder="6-32位，建议字母数字符号组合" /></el-form-item>
                <el-form-item label="确认新密码" prop="confirmPwd"><el-input v-model="pwdForm.confirmPwd" type="password" show-password /></el-form-item>
                <el-form-item><el-button type="primary" :loading="pSaving" @click="submitPwd">确认修改</el-button></el-form-item>
              </el-form>
            </div>
          </el-tab-pane>
          <el-tab-pane label="角色申请" name="role">
            <div class="profile-section">
              <div class="card-title">申请角色变更</div>
              <el-alert v-if="user.roleStatus==='pending'" type="warning" :closable="false" show-icon>
                当前正在申请“{{ ROLE[user.requestedRole]?.label || user.requestedRole }}”，将由{{ roleApprovalHint }}审批。
              </el-alert>
              <el-alert v-else-if="user.roleStatus==='rejected'" type="error" :closable="false" show-icon>
                上次申请未通过：{{ user.roleRejectReason || '未填写原因' }}
              </el-alert>
              <el-form label-width="100px" style="margin-top:16px; max-width:520px;">
                <el-form-item label="当前角色">{{ ROLE[user.role]?.label || user.role }}</el-form-item>
                <el-form-item label="申请角色">
                  <el-select v-model="requestedRole" :disabled="user.roleStatus==='pending'" style="width:100%" placeholder="请选择目标角色">
                    <el-option v-for="item in requestableRoles" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="requestedRole" label="审批人">
                  <span class="role-approval-hint">{{ requestedRoleApprovalHint }}</span>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="roleApplying" :disabled="user.roleStatus==='pending' || !requestedRole" @click="submitRoleApplication">提交申请</el-button>
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>
          <el-tab-pane label="我的消息" name="msg">
            <div class="profile-section message-section">
              <div class="card-title flex-between">
                <div>消息中心（{{ msgTotal }}）</div>
                <div>
                  <el-button v-if="userStore.unreadMessageCount>0" type="text" @click="readAll">全部标为已读</el-button>
                </div>
              </div>
              <el-table :data="msgs" stripe>
                <el-table-column label="类型" width="120">
                  <template #default="{row}">
                    <el-tag size="small" :type="msgTypeTag(row.type)">
                      {{ MSG_TYPE[row.type] || row.type }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="title" label="标题" min-width="260">
                  <template #default="{row}">
                    <div class="message-title" :class="{ unread: !row.isRead }" @click="readMessage(row)">
                      <span v-if="!row.isRead" class="unread-dot"></span>{{ row.title }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="content" label="摘要" show-overflow-tooltip min-width="200" />
                <el-table-column label="时间" width="160">
                  <template #default="{row}">{{ fmt(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="80" align="center">
                  <template #default="{row}">
                    <el-button link type="danger" size="small" @click="deleteMsg(row)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <div class="page-wrap"><el-pagination background layout="total, prev, pager, next" :total="msgTotal" :current-page="msgPage" :page-size="10" @current-change="loadMsg" /></div>
            </div>
          </el-tab-pane>
        </el-tabs>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import dayjs from 'dayjs';
import { getProfile, updateProfile, changePassword, uploadAvatar, listMessages, readMessage as readMsg, readAllMessages, deleteMessage } from '@/api/profile';
import { applyRole } from '@/api/users';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { UserFilled, CameraFilled, User, Medal, Phone, Message, School, Calendar, Timer } from '@element-plus/icons-vue';
import WorkspaceHero from '@/components/WorkspaceHero.vue';

const userStore = useUserStore();
const ROLE = { 
  student: {label:'学生', type:'info'}, 
  class_admin: {label:'班级管理员', type:''},
  counselor: {label:'辅导员', type:'success'},
  college_admin: {label:'院系管理员', type:'warning'},
  school_admin: {label:'学校管理员', type:'danger'},
  super_admin: {label:'超级管理员', type:'danger'},
  developer: {label:'开发者', type:'danger'}
};
const MSG_TYPE = { 
  approval_todo: '审批待办', 
  application_result: '申报结果', 
  appeal_notice: '申诉通知', 
  report_signed: '报表通知',
  approval: '审批消息', 
  notice: '公告通知', 
  system: '系统消息',
  appeal_result: '申诉结果'
};
const user = computed(() => userStore.userInfo || {});
const displayName = computed(() => {
  return user.value.realName || user.value.name || user.value.username || '未设置';
});
const msgTypeTag = (type) => {
  const map = { approval_todo: 'warning', application_result: 'success', appeal_notice: 'danger', report_signed: 'info', approval: 'success', notice: 'warning', system: 'info', appeal_result: 'success' };
  return map[type] || 'primary';
};

const tab = ref('info');
const avatarPreview = ref('');
const avatarInput = ref(null);

const onAvatarChange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const fd = new FormData(); fd.append('avatar', f);
    const r = await uploadAvatar(fd);
    avatarPreview.value = r.url;
    await userStore.fetchInfo();
    ElMessage.success('头像已更新');
  } catch (_) { ElMessage.error('头像上传失败'); }
  finally { if (avatarInput.value) avatarInput.value.value = ''; }
};

// 基本资料
const formRef = ref();
const saving = ref(false);
const mForm = reactive({});
const rules = {
  name: [{ required: true, message: '请输入姓名' }],
  phone: [{ pattern: /^1\d{10}$|^$/, message: '请输入正确的11位手机号' }],
  email: [{ type: 'email', message: '邮箱格式不正确' }]
};
const loadInfo = async () => {
  try { 
    const p = await getProfile(); 
    // 后端返回 realName，表单使用 name 字段
    mForm.name = p.realName || p.name || '';
    mForm.phone = p.phone || '';
    mForm.email = p.email || '';
    mForm.gender = p.gender || '';
    mForm.birthday = p.birthday || '';
    mForm.bio = p.bio || '';
    userStore.setUserInfo(p); 
  } catch (_) {}
};
const submitInfo = async () => {
  await formRef.value.validate();
  saving.value = true;
  try {
    // 提交时将 name 映射为 realName
    const payload = { ...mForm, realName: mForm.name };
    delete payload.name;
    await updateProfile(payload);
    ElMessage.success('资料已保存');
    await userStore.fetchInfo();
  } finally { saving.value = false; }
};

// 密码
const pwdRef = ref();
const pSaving = ref(false);
const pwdForm = reactive({ oldPwd: '', newPwd: '', confirmPwd: '' });
const pwdRules = {
  oldPwd: [{ required: true, message: '请输入当前密码' }],
  newPwd: [{ required: true, min: 6, max: 32, message: '新密码6-32位' },
    { validator: (r,v,cb) => { if (v && /^\d+$/.test(v)) cb(new Error('密码不能全是数字')); else cb(); } }],
  confirmPwd: [{ required: true, message: '请再次输入新密码' },
    { validator: (r,v,cb) => { if (v !== pwdForm.newPwd) cb(new Error('两次密码不一致')); else cb(); } }]
};
const submitPwd = async () => {
  await pwdRef.value.validate();
  pSaving.value = true;
  try {
    await changePassword({ oldPwd: pwdForm.oldPwd, newPwd: pwdForm.newPwd });
    ElMessage.success('密码修改成功，请重新登录');
    userStore.logout();
  } finally { pSaving.value = false; }
};

const requestedRole = ref('');
const roleApplying = ref(false);
const ROLE_PROMOTION_OPTIONS = {
  student: [{ value: 'class_admin', label: '班级管理员' }],
  class_admin: [{ value: 'counselor', label: '辅导员' }],
  counselor: [{ value: 'college_admin', label: '院系管理员' }],
  college_admin: [{ value: 'school_admin', label: '学校管理员' }]
};
const ROLE_APPROVAL_HINTS = {
  class_admin: '您所在班级的辅导员',
  counselor: '您所属院系的院系管理员',
  college_admin: '学校管理员',
  school_admin: '超级管理员'
};
const requestableRoles = computed(() => ROLE_PROMOTION_OPTIONS[user.value.role] || []);
const requestedRoleApprovalHint = computed(() => ROLE_APPROVAL_HINTS[requestedRole.value] || '未配置');
const roleApprovalHint = computed(() => ROLE_APPROVAL_HINTS[user.value.requestedRole] || '对应上级管理员');
const submitRoleApplication = async () => {
  if (!requestedRole.value) return;
  roleApplying.value = true;
  try {
    const result = await applyRole(user.value.id, { role: requestedRole.value });
    ElMessage.success(`角色申请已提交，等待${result?.approverLabel || requestedRoleApprovalHint.value}审批`);
    await userStore.fetchInfo();
  } finally {
    roleApplying.value = false;
  }
};

// 消息
const msgs = ref([]);
const msgTotal = ref(0);
const msgPage = ref(1);
const loadMsg = async () => {
  try { const r = await listMessages({ page: msgPage.value, pageSize: 10 }); msgs.value = r?.list || []; msgTotal.value = r?.total || 0; } catch (_) {}
};
const readMessage = async (m) => {
  if (!m.isRead) {
    try { await readMsg(m.id); await Promise.all([loadMsg(), userStore.fetchUnread()]); } catch (_) {}
  }
};
const readAll = async () => { try { await readAllMessages(); await Promise.all([loadMsg(), userStore.fetchUnread()]); ElMessage.success('已全部标为已读'); } catch (_) {} };
const deleteMsg = async (m) => {
  try {
    await ElMessageBox.confirm(`确定删除消息"${m.title}"？`, '删除确认', { type: 'warning' });
    await deleteMessage(m.id);
    ElMessage.success('消息已删除');
    await loadMsg();
    await userStore.fetchUnread();
  } catch (_) {}
};

const fmt = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '--';

onMounted(async () => {
  await loadInfo();
  loadMsg();
});
</script>
<style lang="scss" scoped>
.profile-workspace { padding-bottom: 8px; }
.profile-layout { margin-top: 18px; row-gap: 18px; }
.profile-card, .profile-workbench { border: 1px solid #E6EDF7; border-radius: 18px; box-shadow: 0 12px 32px rgba(23, 43, 77, .055); }
.profile-card { padding: 0 !important; overflow: hidden; position: relative; }
.bg-img {
  position: relative;
  height: 124px;
  overflow: hidden;
  background: radial-gradient(circle at 20% 0, rgba(30, 205, 232, .32), transparent 45%), linear-gradient(125deg, #10265F, #17559F 66%, #0C86B6);

  &::after { content: ''; position: absolute; width: 210px; height: 76px; right: 6px; top: 18px; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; transform: rotate(-15deg); }
  img { position: absolute; width: 106px; height: 106px; right: 14px; top: 8px; object-fit: contain; opacity: .15; filter: grayscale(1) brightness(3); }
}
.cover-copy { position: absolute; z-index: 2; left: 20px; top: 20px; color: #fff;
  span { display: block; color: #9FE4F2; font-size: 9px; font-weight: 800; letter-spacing: .18em; }
  strong { display: block; margin-top: 5px; font-size: 15px; }
}
.avatar-wrap { margin: -45px 0 12px; display: flex; justify-content: center; position: relative; z-index: 3;
  :deep(.el-avatar) { border: 4px solid #fff; background: #1A6FC7; color: #fff; font-size: 28px; box-shadow: 0 8px 22px rgba(17, 57, 111, .2); cursor: pointer; }
  .cam-icon { position: absolute; bottom: 4px; left: calc(50% + 26px); width: 28px; height: 28px;
    border-radius: 50%; background: linear-gradient(135deg, #1B7BE1, #18AFC7); display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid #fff; box-shadow: 0 4px 12px rgba(21, 109, 183, .25); }
}
h3 { text-align: center; margin: 0 0 6px; color: #182E52; font-size: 21px; }
.role-wrap { text-align: center; margin-bottom: 16px; }
.meta { list-style: none; margin: 0; padding: 5px 20px 22px;
  li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px dashed #E5EBF3; color: #344660; font-size: 13px; text-align: right;
    &:last-child { border-bottom: none; }
    span { color: #8290A4; display: flex; align-items: center; gap: 5px; text-align: left; }
  }
}
.system-id { max-width: 150px; overflow-wrap: anywhere; font-family: monospace; font-size: 11px; }
.profile-workbench { min-height: 560px; padding: 0 22px 22px; background: #fff; }
.profile-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.profile-tabs :deep(.el-tabs__nav-wrap::after) { height: 1px; background: #E9EFF7; }
.profile-tabs :deep(.el-tabs__item) { height: 58px; padding: 0 22px; color: #687994; font-weight: 600; }
.profile-tabs :deep(.el-tabs__item.is-active) { color: #1876D2; }
.profile-tabs :deep(.el-tabs__active-bar) { height: 3px; border-radius: 4px 4px 0 0; background: linear-gradient(90deg, #1A72DF, #16B5CB); }
.profile-section { padding: 24px 4px 4px; }
.card-title { display: flex; align-items: center; gap: 9px; margin-bottom: 24px; color: #172B4D; font-size: 18px; font-weight: 700; }
.card-title::before { content: ''; width: 4px; height: 19px; border-radius: 4px; background: linear-gradient(#1C7BEA, #13B9D5); }
.profile-form { max-width: 560px; padding: 0 14px 12px; }
.password-form { max-width: 510px; }
.role-approval-hint { color: #4F46E5; font-weight: 600; }
.profile-form :deep(.el-input__wrapper), .profile-form :deep(.el-textarea__inner) { border-radius: 9px; }
.page-wrap { display:flex; justify-content:flex-end; padding: 16px 0 4px; }
.flex-between { display:flex; justify-content:space-between; align-items:center; }
.message-title { cursor: pointer; color: #40516A; }
.message-title.unread { color: #193B6C; font-weight: 700; }
.unread-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #F05B68; margin-right: 7px; vertical-align: middle; box-shadow: 0 0 0 3px rgba(240,91,104,.1); }

// 外观设置样式
:deep(.el-table) { border-radius: 12px; --el-table-header-bg-color: #F5F8FC; --el-table-row-hover-bg-color: #F3F8FF; }
:deep(.el-table th.el-table__cell) { height: 48px; color: #52647E; font-weight: 700; }

@media (max-width: 768px) {
  .profile-layout { margin-top: 14px; }
  .profile-workbench { min-height: 0; padding: 0 14px 18px; }
  .profile-tabs :deep(.el-tabs__item) { padding: 0 12px; font-size: 13px; }
  .profile-section { padding-top: 20px; }
  .profile-form { padding: 0; }
  .page-wrap { justify-content: center; overflow-x: auto; }
}
</style>
