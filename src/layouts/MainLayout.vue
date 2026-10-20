<template>
  <el-container class="main-layout" :class="{ collapsed, mobile: isMobile }">
    <!-- 侧边栏 -->
    <el-aside :width="isMobile ? (showSidebar ? sidebarWidth + 'px' : '0px') : (collapsed ? sidebarCollapsedWidth + 'px' : sidebarWidth + 'px')"
      class="sidebar" :class="{ hide: isMobile && !showSidebar }">
      <div class="logo-area" @click="goHome">
        <div class="logo-icon">
          <img src="/branding/xinggui-symbol.png" :alt="branding.appName" />
        </div>
        <transition name="fade">
          <div class="logo-text" v-show="!collapsed && !isMobile">
            <div class="title">{{ branding.appName }}</div>
            <div class="subtitle">{{ branding.institutionName }}</div>
          </div>
        </transition>
      </div>
      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="route.path"
          :collapse="collapsed && !isMobile"
          :collapse-transition="false"
          router
          background-color="transparent"
          text-color="#AEB9D4"
          active-text-color="#FFFFFF">
          <template v-for="item in menus" :key="item.path">
            <!-- 单级菜单 -->
            <el-menu-item v-if="!item.children" :index="item.path">
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>
                <el-badge v-if="item.badge === 'bonusPending'" :value="bonusStore.pendingCount" :hidden="bonusStore.pendingCount === 0" :max="99">
                  {{ item.title }}
                </el-badge>
                <span v-else>{{ item.title }}</span>
              </template>
            </el-menu-item>
            <!-- 带子菜单的分组 -->
            <el-sub-menu v-else :index="'g-' + item.path">
              <template #title>
                <el-icon><component :is="item.icon" /></el-icon>
                <span>{{ item.title }}</span>
              </template>
              <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
                <template #title>
                  <el-badge v-if="child.badge === 'bonusPending'" :value="bonusStore.pendingCount" :hidden="bonusStore.pendingCount === 0" :max="99">
                    {{ child.title }}
                  </el-badge>
                  <span v-else>{{ child.title }}</span>
                </template>
              </el-menu-item>
            </el-sub-menu>
          </template>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <!-- 遮罩（移动端） -->
    <div v-if="isMobile && showSidebar" class="sidebar-mask" @click="showSidebar = false"></div>

    <el-container>
      <!-- 顶部导航 -->
      <el-header class="header">
        <div class="header-left">
          <el-button v-if="!isMobile" text @click="toggleCollapse" size="large">
            <el-icon :size="20"><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          </el-button>
          <el-button v-else text @click="showSidebar = !showSidebar" size="large">
            <el-icon :size="20"><Menu /></el-icon>
          </el-button>
          <el-breadcrumb separator="/" class="hide-on-mobile breadcrumb">
            <el-breadcrumb-item v-for="(item, i) in breadcrumbs" :key="i">{{ item }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="header-right">
          <!-- 公告通知横幅（最近一条置顶） -->
          <el-badge v-if="latestTopNotice" is-dot class="hide-on-mobile mr-8" @click="showNotice(latestTopNotice)">
            <el-button text type="primary" size="small">
              <el-icon><Bell /></el-icon>
              <span style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle;">
                公告：{{ latestTopNotice.title }}
              </span>
            </el-button>
          </el-badge>

          <!-- 消息中心 -->
          <el-popover placement="bottom-end" :width="380" trigger="click" popper-class="msg-pop">
            <template #reference>
              <el-badge :value="userStore.unreadMessageCount" :hidden="userStore.unreadMessageCount === 0" class="mr-8">
                <el-button circle text>
                  <el-icon :size="20"><Message /></el-icon>
                </el-button>
              </el-badge>
            </template>
            <div class="msg-panel">
              <div class="msg-header">
                <span class="msg-title">消息中心</span>
                <el-button size="small" link @click="readAll">全部已读</el-button>
              </div>
              <div v-if="messages.length === 0" class="empty-page">暂无消息</div>
              <div v-else class="msg-list">
                <div v-for="m in messages.slice(0, 5)" :key="m.id" class="msg-item" :class="{ unread: !m.isRead }" @click="openMsg(m)">
                  <div class="msg-dot" v-if="!m.isRead"></div>
                  <div class="msg-right">
                    <div class="msg-meta"><strong>{{ m.title }}</strong><span class="msg-time">{{ formatTime(m.createdAt) }}</span></div>
                    <div class="msg-content">{{ m.content }}</div>
                  </div>
                </div>
              </div>
              <div class="msg-footer">
                <router-link to="/profile">查看全部消息 →</router-link>
              </div>
            </div>
          </el-popover>

          <!-- 用户菜单 -->
          <el-dropdown trigger="click" @command="handleUserCmd">
            <div class="user-box">
              <el-avatar :size="34" :src="userStore.userInfo?.avatar">
                {{ userStore.displayName?.slice(0, 1) }}
              </el-avatar>
              <div class="hide-on-mobile user-meta">
                <div class="name">{{ userStore.displayName }}</div>
                <div class="role">{{ userStore.roleText }}</div>
              </div>
              <el-icon class="hide-on-mobile"><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>个人中心
                </el-dropdown-item>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 主内容 -->
      <el-main class="main-content">
        <div class="content-shell">
          <router-view v-slot="{ Component }">
            <transition name="fade-slide" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </div>
      </el-main>

      <el-footer height="auto" class="footer">
        <div>© 2024 {{ branding.institutionName }} · {{ branding.appName }} v1.0.0</div>
        <div class="hide-on-mobile">技术支持：考评项目组</div>
      </el-footer>
    </el-container>

    <!-- 修改密码弹窗 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <el-form ref="pwdRef" :model="pwdForm" :rules="pwdRules" label-width="90px">
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="pwdForm.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="pwdForm.confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="submitPwd">确认修改</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="logoutVisible"
      class="logout-dialog"
      width="min(420px, 92vw)"
      :show-close="false"
      :close-on-click-modal="!logoutLoading"
      :close-on-press-escape="!logoutLoading"
      align-center
    >
      <div class="logout-dialog-body">
        <div class="logout-mark"><el-icon><SwitchButton /></el-icon></div>
        <div class="logout-kicker">SIGN OUT</div>
        <h2>准备退出登录？</h2>
        <p>退出后将返回登录页。为保障账号安全，请勿在公共设备上保留登录状态。</p>
      </div>
      <template #footer>
        <div class="logout-actions">
          <el-button :disabled="logoutLoading" @click="logoutVisible = false">暂不退出</el-button>
          <el-button type="primary" :loading="logoutLoading" @click="confirmLogout">确认退出</el-button>
        </div>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { computed, ref, reactive, onMounted, onBeforeUnmount, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { useBonusStore } from '@/stores/bonus';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');
import { getMessageList, getUnreadCount, markAllAsRead, markAsRead } from '@/api/message';
import { changePassword } from '@/api/profile';
import { myNoticeList } from '@/api/notices';
import { branding } from '@/config/branding';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const bonusStore = useBonusStore();

const sidebarWidth = 220;
const sidebarCollapsedWidth = 64;
const collapsed = ref(false);
const showSidebar = ref(true);

const isMobile = ref(window.innerWidth < 768);
const onResize = () => {
  const mobile = window.innerWidth < 768;
  if (mobile !== isMobile.value) {
    isMobile.value = mobile;
    showSidebar.value = !mobile;
  }
};
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

const toggleCollapse = () => collapsed.value = !collapsed.value;
const goHome = () => router.push('/');

// ========== 菜单（按角色过滤） ==========
const MENU_CONFIG = [
  // 智能数据看板（含AI分析功能）
  {
    path: '/dashboard',
    title: '智能数据看板',
    icon: 'DataBoard',
    roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin']
  },
  {
    path: '/ai-material-review',
    title: 'AI 材料审核',
    icon: 'MagicStick',
    roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin']
  },
  // 申报
  { path: '/growth-plan', title: '成长行动计划', icon: 'TrendCharts', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
  { path: '/rule-guide', title: '规则查询与申报指引', icon: 'Reading', roles: ['student', 'class_admin'] },
  { path: '/apply', title: '申报加分', icon: 'EditPen', roles: ['student', 'class_admin'] },
  { path: '/my-applications', title: '我的申报', icon: 'Tickets', roles: ['student', 'class_admin'] },
  { path: '/my-honors', title: '我的荣誉', icon: 'Medal', roles: ['student', 'class_admin'] },
  { path: '/class-honors', title: '班级荣誉', icon: 'Medal', roles: ['counselor'] },
  { path: '/bonus-review', title: '历史加分待办', icon: 'Stamp', roles: ['class_admin'], badge: 'bonusPending' },
  // 考评审核中心
  {
    path: '/approval',
    title: '考评审核中心',
    icon: 'DocumentChecked',
    roles: ['class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin']
  },
  { path: '/class-reports', title: '班级报表审核', icon: 'DocumentCopy', roles: ['class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
  // 分数与班级
  { path: '/my-score', title: '我的成绩', icon: 'Trophy', roles: ['student', 'class_admin'] },
  { path: '/course-scores', title: '课程成绩', icon: 'Reading', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
  { path: '/evaluation', title: '综测结果', icon: 'Trophy', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
{ path: '/my-class', title: '我的班级', icon: 'School', roles: ['student', 'class_admin', 'counselor'] },
  { path: '/my-classes', title: '我带的班级', icon: 'School', roles: ['counselor'] },
  { path: '/notice', title: '公告通知', icon: 'BellFilled', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
  { path: '/publicity', title: '考评公示', icon: 'Stamp', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] },
  // 管理
  {
    path: '/org-users',
    title: '组织用户管理',
    icon: 'OfficeBuilding',
    roles: ['class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'],
    children: [
      { path: '/colleges', title: '组织架构', icon: 'OfficeBuilding', roles: ['counselor', 'college_admin', 'school_admin', 'super_admin'] },
      { path: '/users', title: '用户管理', icon: 'User', roles: ['class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] }
    ]
  },
  { path: '/modules', title: '加分模块', icon: 'Collection', roles: ['college_admin', 'school_admin', 'super_admin'] },
  { path: '/semesters', title: '学期管理', icon: 'Calendar', roles: ['college_admin', 'school_admin', 'super_admin'] },
  { path: '/evaluation-config', title: '综测公式配置', icon: 'DataAnalysis', roles: ['college_admin', 'school_admin', 'super_admin'] },
  { path: '/role-approval', title: '角色审批', icon: 'Checked', roles: ['counselor', 'college_admin', 'school_admin', 'super_admin'] },
  { path: '/schools', title: '学校管理', icon: 'OfficeBuilding', roles: ['super_admin'] },
  { path: '/permissions', title: '权限管理', icon: 'Lock', roles: ['super_admin'] },
  { path: '/notices', title: '公告通知(管理)', icon: 'Bell', roles: ['counselor', 'college_admin', 'school_admin', 'super_admin'] },
  { path: '/logs', title: '操作日志', icon: 'Notebook', roles: ['school_admin', 'super_admin'] },
  { path: '/recycles', title: '数据回收(回收站)', icon: 'Delete', roles: ['school_admin', 'super_admin'] },
  { path: '/backups', title: '数据备份', icon: 'FolderOpened', roles: ['super_admin'] },
  // 个人
  { path: '/profile', title: '个人中心', icon: 'Avatar', roles: ['student', 'class_admin', 'counselor', 'college_admin', 'school_admin', 'super_admin'] }
];
// 根据角色过滤菜单，同时处理子菜单权限
const menus = computed(() => {
  const role = userStore.role;
  const filterAllowed = (list) => {
    return list.map(item => ({
      ...item,
      children: item.children ? filterAllowed(item.children) : undefined
    })).filter(item => {
      if (item.roles && !item.roles.includes(role)) return false;
      if (item.children && item.children.length === 0) return false;
      return true;
    });
  };
  return filterAllowed(JSON.parse(JSON.stringify(MENU_CONFIG)));
});

// ========== 面包屑（支持子菜单） ==========
function findMenuCrumbs(path, list, trail = []) {
  for (const m of list) {
    const next = [...trail, m.title];
    if (m.path === path) return next;
    if (m.children) {
      const hit = findMenuCrumbs(path, m.children, next);
      if (hit) return hit;
    }
  }
  return null;
}
const breadcrumbs = computed(() => {
  const crumbs = ['首页'];
  const hit = findMenuCrumbs(route.path, menus.value);
  if (hit) crumbs.push(...hit);
  return crumbs;
});

// ========== 消息中心 ==========
const messages = ref([]);
const loadMessages = async () => {
  try {
    const res = await getMessageList({ pageSize: 10 }, { __suppressMsg: true });
    messages.value = res?.list || [];
    const unread = await getUnreadCount({ __suppressMsg: true });
    userStore.unreadMessageCount = unread?.count || 0;
  } catch (_) {}
};
const openMsg = async (m) => {
  if (!m.isRead) {
    try { await markAsRead(m.id); userStore.unreadMessageCount = Math.max(0, userStore.unreadMessageCount - 1); } catch (_) {}
  }
  const role = userStore.role;
  const isStudent = role === 'student';
  if (m.relatedType === 'application' && m.relatedId) {
    if (isStudent || m.type !== 'approval_todo') {
      router.push({ path: '/my-applications', query: { detailId: m.relatedId } });
    } else {
      router.push({ path: '/approval', query: { applicationId: m.relatedId } });
    }
  } else if (m.relatedType === 'appeal' && m.relatedId) {
    if (isStudent) {
      router.push({ path: '/my-applications', query: { appealId: m.relatedId } });
    } else {
      router.push({ path: '/approval', query: { appealId: m.relatedId } });
    }
  } else if (m.relatedType === 'class_report' && m.relatedId) {
    router.push({ path: '/class-reports' });
  } else if (m.relatedType === 'bonus_claim' && m.relatedId) {
    router.push(role === 'class_admin' ? '/bonus-review' : '/bonus-my');
  } else {
    router.push('/profile');
  }
};
const readAll = async () => {
  try {
    await markAllAsRead();
    messages.value.forEach(m => m.isRead = true);
    userStore.unreadMessageCount = 0;
    ElMessage.success('已全部标记为已读');
  } catch (_) {}
};
const formatTime = (t) => dayjs(t).fromNow();

// ========== 公告置顶 ==========
const latestTopNotice = ref(null);
const loadTopNotice = async () => {
  try {
    // 接口按置顶、发布时间排序；没有置顶公告时，回退展示学生可见的最新公告。
    const res = await myNoticeList({ page: 1, pageSize: 1 }, { __suppressMsg: true });
    latestTopNotice.value = res?.list?.[0] || null;
  } catch (_) {}
};
const showNotice = (n) => {
  router.push({ path: '/notice', query: { noticeId: n.id } });
};

// ========== 用户菜单操作 ==========
const handleUserCmd = async (cmd) => {
  if (cmd === 'profile') router.push('/profile');
  else if (cmd === 'password') pwdVisible.value = true;
  else if (cmd === 'logout') logoutVisible.value = true;
};

const logoutVisible = ref(false);
const logoutLoading = ref(false);
const confirmLogout = async () => {
  logoutLoading.value = true;
  try {
    await userStore.logout();
    logoutVisible.value = false;
    ElMessage.success('已退出登录');
    router.replace('/login');
  } finally { logoutLoading.value = false; }
};

// ========== 修改密码 ==========
const pwdVisible = ref(false);
const pwdRef = ref();
const pwdLoading = ref(false);
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
const pwdRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '至少6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (_r, v, cb) => {
        if (v !== pwdForm.newPassword) cb(new Error('两次密码不一致'));
        else cb();
      }, trigger: 'blur'
    }
  ]
};
const submitPwd = async () => {
  await pwdRef.value.validate();
  pwdLoading.value = true;
  try {
    await changePassword(pwdForm);
    ElMessage.success('密码修改成功，请重新登录');
    pwdVisible.value = false;
    await userStore.logout();
    router.push('/login');
  } finally { pwdLoading.value = false; }
};

onMounted(() => {
  loadMessages();
  loadTopNotice();
  // 班级管理员启动加分待办实时推送（SSE + 轮询兜底）
  bonusStore.start();
  // 1分钟轮询未读消息
  const interval = setInterval(loadMessages, 60000);
  onBeforeUnmount(() => clearInterval(interval));
});
</script>

<style lang="scss" scoped>
.main-layout { height: 100vh; background: $content-bg; }

.sidebar {
  background: $sidebar-bg;
  border-right: 1px solid rgba(255,255,255,.06);
  transition: width 0.24s ease, transform .24s ease;
  overflow: hidden;
  box-shadow: 12px 0 36px rgba(17, 26, 58, .14);
  display: flex;
  flex-direction: column;

  &.hide { transform: translateX(-100%); }

  .logo-area {
    height: $header-height;
    display: flex;
    align-items: center;
    padding: 0 18px;
    gap: 12px;
    background:
      radial-gradient(circle at 20% 20%, rgba(45,212,191,.18), transparent 42%),
      linear-gradient(135deg, #19244C 0%, #111A3A 100%);
    color: #fff;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,.07);
    .logo-icon {
      width: 38px; height: 38px; border-radius: 12px;
      background: rgba(255,255,255,.96);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 8px 24px rgba(0,9,43,.34), inset 0 1px 0 #fff;
      img { width: 34px; height: 34px; object-fit: contain; }
    }
    .logo-text { flex: 1; min-width: 0; .title { font-size: 15px; font-weight: 700; letter-spacing: .04em;} .subtitle { font-size: 10px; color: #92A2C9; margin-top: 3px; letter-spacing: .08em;} }
  }
  .menu-scroll { flex: 1; padding: 12px 8px; }
  :deep(.el-menu) { border: none; }
  :deep(.el-menu-item), :deep(.el-sub-menu__title) {
    height: 46px;
    border-radius: 11px;
    margin: 3px 0;
    color: $sidebar-text-color !important;
    transition: background .18s ease, color .18s ease, transform .18s ease;
    &:hover { background: rgba(255,255,255,.07) !important; color: #fff !important; }
  }
  :deep(.el-menu-item.is-active) {
    background: linear-gradient(90deg, rgba(99,102,241,.34), rgba(79,70,229,.16)) !important;
    color: $sidebar-active-color !important;
    font-weight: 700;
    box-shadow: inset 3px 0 0 #2DD4BF;
  }
  :deep(.el-menu-item .el-icon), :deep(.el-sub-menu__title .el-icon) { font-size: 18px; }
}
.sidebar-mask { position: fixed; inset: 0; background: rgba(12,18,40,.56); backdrop-filter: blur(3px); z-index: 1000; }

.header {
  background: $header-bg;
  height: $header-height !important;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(219,227,240,.78);
  backdrop-filter: blur(14px);
  position: sticky; top: 0; z-index: 100;
  .header-left, .header-right { display: flex; align-items: center; gap: 12px; }
  .breadcrumb { margin-left: 12px; }
  :deep(.el-button.is-text) { border-radius: 10px; color: #59677F; }
}
.user-box { display: flex; align-items: center; gap: 10px; padding: 6px 9px 6px 7px; border-radius: 12px; cursor: pointer; transition: background .18s ease; &:hover { background: #F1F3FA; }
  :deep(.el-avatar) { background: linear-gradient(135deg, #4F46E5, #7C3AED); box-shadow: 0 5px 14px rgba(79,70,229,.24); }
  .user-meta { line-height: 1.2; .name { font-size: 13px; color: $text-primary; font-weight: 700; } .role { font-size: 11px; color: $text-secondary; margin-top: 3px; } }
}
:deep(.logout-dialog) { overflow:hidden; border:1px solid #DCE8F5; border-radius:22px; box-shadow:0 22px 60px rgba(14,44,94,.2); }
:deep(.logout-dialog .el-dialog__header) { display:none; }
:deep(.logout-dialog .el-dialog__body) { padding:0; }
:deep(.logout-dialog .el-dialog__footer) { padding:0 26px 25px; }
.logout-dialog-body { position:relative; padding:34px 30px 25px; overflow:hidden; text-align:center; background:linear-gradient(145deg,#F8FBFF,#fff);
  &::before { content:''; position:absolute; width:260px; height:260px; top:-178px; left:50%; border:1px solid rgba(32,131,209,.15); border-radius:50%; box-shadow:0 0 0 22px rgba(32,131,209,.035), 0 0 0 52px rgba(32,131,209,.02); transform:translateX(-50%); }
  > * { position:relative; z-index:1; }
}
.logout-mark { width:68px; height:68px; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; border-radius:22px; color:#fff; font-size:30px; background:linear-gradient(135deg,#174787,#11A9C8); box-shadow:0 12px 26px rgba(20,88,157,.24); }
.logout-kicker { color:#1B83C7; font-size:10px; font-weight:800; letter-spacing:.18em; }
.logout-dialog-body h2 { margin:8px 0 9px; color:#172B4D; font-size:23px; letter-spacing:-.03em; }
.logout-dialog-body p { max-width:300px; margin:0 auto; color:#71829A; font-size:13px; line-height:1.75; }
.logout-actions { display:flex; justify-content:center; gap:10px; }
.logout-actions :deep(.el-button) { min-width:122px; height:42px; border-radius:11px; }
.main-content {
  background:
    radial-gradient(circle at 92% 2%, rgba(31, 173, 238, .12), transparent 26rem),
    radial-gradient(circle at 8% 92%, rgba(79, 70, 229, .07), transparent 24rem),
    linear-gradient(rgba(35, 99, 190, .025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(35, 99, 190, .025) 1px, transparent 1px),
    $content-bg;
  background-size: auto, auto, 28px 28px, 28px 28px, auto;
  padding: 26px 28px 30px;
  overflow-x: auto;
}
.content-shell { width: 100%; max-width: 1680px; min-width: 0; margin: 0 auto; }
.footer { padding: 14px 24px; background: rgba(255,255,255,.82); border-top: 1px solid #E8EDF5; text-align: center; color: #8894A8; font-size: 11px; display: flex; justify-content: space-between; align-items: center; @include mobile { flex-direction: column; gap: 4px; } }

.fade-slide-enter-active, .fade-slide-leave-active { transition: all 0.2s; }
.fade-slide-enter-from { opacity: 0; transform: translateY(8px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-8px); }

@include mobile {
  .header { padding: 0 12px; }
  .main-content { padding: 14px; background-size: auto, auto, 22px 22px, 22px 22px, auto; }
}

// 消息弹窗
:deep(.msg-pop) { padding: 0; border-radius: 12px; overflow: hidden; }
.msg-panel { padding: 0; max-height: 480px; display: flex; flex-direction: column;
  .msg-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #ebeef5; .msg-title { font-weight: 600; font-size: 15px; } }
  .msg-list { flex: 1; overflow-y: auto; max-height: 360px; }
  .msg-item { padding: 10px 16px; display: flex; gap: 10px; cursor: pointer; border-bottom: 1px solid #f2f6fc; &:hover { background: #f5f7fa; }
    &.unread { background: #ecf5ff; }
    .msg-dot { width: 8px; height: 8px; border-radius: 50%; background: #F56C6C; margin-top: 8px; flex-shrink: 0; }
    .msg-right { flex: 1; min-width: 0;
      .msg-meta { display: flex; justify-content: space-between; align-items: center; font-size: 13px;
        .msg-time { color: #C0C4CC; font-size: 11px; } }
      .msg-content { color: #59677F; font-size: 12px; margin-top: 4px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    }
  }
  .msg-footer { padding: 10px 16px; border-top: 1px solid #ebeef5; font-size: 12px; text-align: right; a { color: $primary-color; text-decoration: none; } }
}
</style>
