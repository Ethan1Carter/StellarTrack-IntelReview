import { defineStore } from 'pinia';
import { loginApi, logoutApi, getMeApi } from '@/api/auth';
import { getProfile, getUnreadCount } from '@/api/profile';
import { ElMessage } from 'element-plus';
import { ROLES, ROLE_LABELS, ROLE_GROUPS, isDeveloper } from '@/constants/roles';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '',
    userInfo: null,
    unreadMessageCount: 0
  }),
  getters: {
    // 原始角色（用于显示）
    rawRole: (state) => state.userInfo?.role || '',
    // 逻辑角色：developer 映射为 super_admin，使所有 .includes(role) 的权限判断自然通过
    role: (state) => (isDeveloper(state.userInfo?.role) ? ROLES.SUPER_ADMIN : (state.userInfo?.role || '')),
    userId: (state) => state.userInfo?.id,
    isLoggedIn: (state) => !!state.token,
    isDeveloper: (state) => isDeveloper(state.userInfo?.role),
    // developer 是最高权限：所有 isXxx getter 都返回 true
    isStudent: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.STUDENT,
    isClassAdmin: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.CLASS_ADMIN,
    isCounselor: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.COUNSELOR,
    isCollegeAdmin: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.COLLEGE_ADMIN,
    isSchoolAdmin: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.SCHOOL_ADMIN,
    isSuperAdmin: (state) => isDeveloper(state.userInfo?.role) || state.userInfo?.role === ROLES.SUPER_ADMIN,
    // 分组判断：与后端 ROLE_GROUPS 同名同义，避免页面里再写角色数组
    isStudentLike: (state) => isDeveloper(state.userInfo?.role) || ROLE_GROUPS.STUDENT_LIKE.includes(state.userInfo?.role),
    isClassAbove: (state) => isDeveloper(state.userInfo?.role) || ROLE_GROUPS.CLASS_ABOVE.includes(state.userInfo?.role),
    isCollegeAbove: (state) => isDeveloper(state.userInfo?.role) || ROLE_GROUPS.COLLEGE_ABOVE.includes(state.userInfo?.role),
    isSchoolAbove: (state) => isDeveloper(state.userInfo?.role) || ROLE_GROUPS.SCHOOL_ABOVE.includes(state.userInfo?.role),
    displayName: (state) => state.userInfo?.name || state.userInfo?.realName || state.userInfo?.username || '未登录',
    roleText: (state) => ROLE_LABELS[state.userInfo?.role] || '',
    // 工具：判断是否包含指定角色（developer 总是拥有所有角色权限）
    hasRole: (state) => (...roles) => {
      if (isDeveloper(state.userInfo?.role)) return true;
      return roles.includes(state.userInfo?.role);
    }
  },
  actions: {
    async login(payload) {
      const res = await loginApi(payload);
      this.token = res.token;
      this.userInfo = res.user;
      ElMessage.success(`欢迎回来，${this.displayName}`);
      try { this.fetchUnread(); } catch (_) {}
      return res;
    },
    async logout({ notifyServer = true } = {}) {
      const token = this.token;
      const userId = this.userInfo?.id;
      this.token = '';
      this.userInfo = null;
      this.unreadMessageCount = 0;
      try {
        for (const key of [`xinggui.aiBatch.${userId}`, `xinggui.aiReview.${userId}`, 'xinggui.aiReview']) sessionStorage.removeItem(key);
      } catch (_) {}
      // 失效响应不再次请求退出接口，防止 401 → logout → 401 递归。
      try { if (token && notifyServer) await logoutApi({ headers: { Authorization: `Bearer ${token}` } }); } catch (_) {}
    },
    async refreshUser() {
      if (!this.token) return null;
      try {
        const user = await getMeApi({ __suppressMsg: true });
        this.userInfo = user;
        return user;
      } catch (error) {
        if (error.response?.status === 401 || error.code === 401) {
          this.token = '';
          this.userInfo = null;
          this.unreadMessageCount = 0;
        }
        return null;
      }
    },
    setUserInfo(user) {
      this.userInfo = { ...(this.userInfo || {}), ...(user || {}) };
    },
    async fetchInfo() {
      if (!this.token) return null;
      try {
        const p = await getProfile({ __suppressMsg: true });
        this.userInfo = { ...(this.userInfo || {}), ...p };
        return this.userInfo;
      } catch (_) { return null; }
    },
    async fetchUnread() {
      try {
        const r = await getUnreadCount({ __suppressMsg: true });
        this.unreadMessageCount = Number(r?.count || r?.unread || 0);
      } catch (_) { /* ignore */ }
    }
  },
  persist: {
    key: 'xawl-assessment-user',
    paths: ['token', 'userInfo', 'unreadMessageCount']
  }
});
