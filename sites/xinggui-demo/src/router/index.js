import { createRouter, createWebHashHistory } from 'vue-router';
import NProgress from 'nprogress';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { ROLES, ROLE_GROUPS, isDeveloper } from '@/constants/roles';

/**
 * 全部已登录角色（不含 developer —— developer 由守卫单独无条件放行）
 * 用于"所有人可见"的页面，避免再写一次六元素字符串数组。
 */
const ALL_AUTHENTICATED = [
  ...ROLE_GROUPS.STUDENT_LIKE,
  ROLES.COUNSELOR,
  ...ROLE_GROUPS.COLLEGE_ABOVE
];

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/demo/DemoLogin.vue'),
    meta: { title: '登录', guest: true }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/Register.vue'),
    meta: { title: '注册账号', guest: true }
  },
  {
    path: '/403',
    component: () => import('@/views/error/403.vue'),
    meta: { title: '无权限', guest: true }
  },
  {
    path: '/404',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '页面不存在', guest: true }
  },
  {
    path: '/',
    component: () => import('@/demo/DemoShell.vue'),
    meta: { requiresAuth: true },
    children: [
      {path:'policy-desk',name:'PolicyDesk',component:()=>import('@/views/ai/PolicyDesk.vue'),meta:{title:'制度问答与原文',roles:ROLE_GROUPS.STUDENT_LIKE}},
      {path:'campus-activities',name:'CampusActivities',component:()=>import('@/views/ai/CampusActivities.vue'),meta:{title:'校园活动与实践机会',roles:ROLE_GROUPS.STUDENT_LIKE}},
      {path:'guidance-resources',name:'GuidanceResources',component:()=>import('@/views/manage/GuidanceResources.vue'),meta:{title:'制度与活动发布',roles:ROLE_GROUPS.COLLEGE_ABOVE}},
      {path:'work-items',name:'WorkItems',component:()=>import('@/views/WorkItems.vue'),meta:{title:'我的待办与提醒',icon:'Bell',roles:ALL_AUTHENTICATED}},
      // ========== 智能数据看板（统一页面，多维度筛选，含AI分析功能） ==========
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/demo/DemoDashboard.vue'),
        meta: { title: '智能数据看板', icon: 'DataBoard', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'ai-material-review',
        name: 'AIMaterialReview',
        component: () => import('@/views/ai/MaterialReview.vue'),
        meta: { title: 'AI 材料审核', icon: 'MagicStick', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'growth-plan', name: 'GrowthPlan', component: () => import('@/views/ai/GrowthPlan.vue'),
        meta: { title: '成长行动计划', icon: 'TrendCharts', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'rule-guide', name: 'RuleGuide', component: () => import('@/views/ai/RuleGuide.vue'),
        meta: { title: '规则查询与申报指引', icon: 'Reading', roles: ROLE_GROUPS.STUDENT_LIKE }
      },

      // ========== 申报相关 ==========
      {
        path: 'apply',
        name: 'Apply',
        component: () => import('@/views/application/Apply.vue'),
        meta: { title: '申报加分', icon: 'EditPen', roles: ROLE_GROUPS.STUDENT_LIKE }
      },
      {
        path: 'my-applications',
        name: 'MyApplications',
        component: () => import('@/views/application/MyList.vue'),
        meta: { title: '我的申报', icon: 'Tickets', roles: ROLE_GROUPS.STUDENT_LIKE }
      },
      {
        path: 'my-honors',
        name: 'MyHonors',
        component: () => import('@/views/application/MyHonors.vue'),
        meta: { title: '我的荣誉', icon: 'Medal', roles: ROLE_GROUPS.STUDENT_LIKE }
      },
      {
        path: 'class-honors',
        name: 'ClassHonors',
        component: () => import('@/views/application/ClassHonors.vue'),
        meta: { title: '班级荣誉', icon: 'Medal', roles: [ROLES.COUNSELOR] }
      },
      {
        path: 'approval',
        name: 'ApprovalTodo',
        component: () => import('@/demo/DemoApproval.vue'),
        meta: { title: '考评审核中心', icon: 'DocumentChecked', roles: ROLE_GROUPS.CLASS_ABOVE }
      },
      {
        path: 'class-reports',
        name: 'ClassReports',
        component: () => import('@/views/application/ClassReport.vue'),
        meta: { title: '班级报表审核', icon: 'DocumentCopy', roles: ROLE_GROUPS.CLASS_ABOVE }
      },

      {
        path: 'bonus-my',
        name: 'BonusMy',
        component: () => import('@/views/bonus/MyClaims.vue'),
        meta: { title: '历史加分申报', icon: 'Tickets', roles: ROLE_GROUPS.STUDENT_LIKE }
      },
      {
        path: 'bonus-review',
        name: 'BonusReview',
        component: () => import('@/views/bonus/AdminReview.vue'),
        meta: { title: '历史加分待办', icon: 'Stamp', roles: [ROLES.CLASS_ADMIN] }
      },

      // ========== 分数 ==========
      {
        path: 'my-score',
        name: 'MyScore',
        component: () => import('@/views/score/MyScore.vue'),
        meta: { title: '我的成绩', icon: 'Trophy', roles: ROLE_GROUPS.STUDENT_LIKE }
      },
      {
        path: 'course-scores',
        name: 'CourseScores',
        component: () => import('@/views/score/CourseScores.vue'),
        meta: { title: '课程成绩', icon: 'Reading', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'evaluation',
        name: 'EvaluationResult',
        component: () => import('@/views/score/EvaluationResult.vue'),
        meta: { title: '综测结果', icon: 'Trophy', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'my-class',
        name: 'MyClass',
        component: () => import('@/views/class/MyClass.vue'),
        meta: { title: '我的班级', icon: 'School', roles: [...ROLE_GROUPS.STUDENT_LIKE, ROLES.COUNSELOR] }
      },
      {
        path: 'my-classes',
        name: 'MyClasses',
        component: () => import('@/views/class/MyClasses.vue'),
        meta: { title: '我带的班级', icon: 'School', roles: [ROLES.COUNSELOR] }
      },
      {
        path: 'notice',
        name: 'Notice',
        component: () => import('@/views/notice/Index.vue'),
        meta: { title: '公告通知', icon: 'BellFilled', roles: ALL_AUTHENTICATED }
      },
      {
        path: 'publicity',
        name: 'Publicity',
        component: () => import('@/views/publicity/Index.vue'),
        meta: { title: '考评公示', icon: 'Stamp', roles: ALL_AUTHENTICATED }
      },

      // ========== 系统管理 ==========
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/manage/Users.vue'),
        meta: { title: '用户管理', icon: 'User', roles: ROLE_GROUPS.CLASS_ABOVE }
      },
      {
        path: 'modules',
        name: 'Modules',
        component: () => import('@/views/manage/Modules.vue'),
        meta: { title: '加分模块', icon: 'Collection', roles: ROLE_GROUPS.COLLEGE_ABOVE }
      },
      {
        path: 'score-import',
        name: 'ScoreImport',
        component: () => import('@/views/manage/ScoreImport.vue'),
        meta: { title: '成绩导入', icon: 'Upload', roles: ROLE_GROUPS.CLASS_ABOVE }
      },
      {
        path: 'colleges',
        name: 'Colleges',
        component: () => import('@/views/manage/Colleges.vue'),
        meta: { title: '组织架构', icon: 'OfficeBuilding', roles: [ROLES.COUNSELOR, ...ROLE_GROUPS.COLLEGE_ABOVE] }
      },
      {
        path: 'semesters',
        name: 'Semesters',
        component: () => import('@/views/manage/Semesters.vue'),
        meta: { title: '学期管理', icon: 'Calendar', roles: ROLE_GROUPS.COLLEGE_ABOVE }
      },
      {
        path: 'evaluation-config',
        name: 'EvaluationConfig',
        component: () => import('@/views/manage/EvaluationConfig.vue'),
        meta: { title: '综测公式配置', icon: 'DataAnalysis', roles: ROLE_GROUPS.COLLEGE_ABOVE }
      },
      {
        path: 'role-approval',
        name: 'RoleApproval',
        component: () => import('@/views/manage/RoleApproval.vue'),
        meta: { title: '角色审批', icon: 'Checked', roles: ROLE_GROUPS.ADMIN }
      },
      {
        path: 'schools',
        name: 'Schools',
        component: () => import('@/views/manage/Schools.vue'),
        meta: { title: '学校管理', icon: 'OfficeBuilding', roles: [ROLES.SUPER_ADMIN] }
      },
      {
        path: 'permissions',
        name: 'Permissions',
        component: () => import('@/views/manage/Permissions.vue'),
        meta: { title: '权限管理', icon: 'Lock', roles: [ROLES.SUPER_ADMIN] }
      },
      {
        path: 'notices',
        name: 'Notices',
        component: () => import('@/views/manage/Notices.vue'),
        meta: { title: '公告通知', icon: 'Bell', roles: [ROLES.COUNSELOR, ...ROLE_GROUPS.COLLEGE_ABOVE] }
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('@/views/manage/Logs.vue'),
        meta: { title: '操作日志', icon: 'Notebook', roles: ROLE_GROUPS.SCHOOL_ABOVE }
      },
      {
        path: 'recycles',
        name: 'Recycles',
        component: () => import('@/views/manage/Recycles.vue'),
        meta: { title: '数据回收(回收站)', icon: 'Delete', roles: ROLE_GROUPS.SCHOOL_ABOVE }
      },
      {
        path: 'backups',
        name: 'Backups',
        component: () => import('@/views/manage/Backups.vue'),
        meta: { title: '数据备份', icon: 'FolderOpened', roles: [ROLES.SUPER_ADMIN] }
      },

      // ========== 个人中心 ==========
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/views/profile/Index.vue'),
        meta: { title: '个人中心', icon: 'Avatar', roles: ALL_AUTHENTICATED }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404'
  }
];

const demoRoutes = new Set(['policy-desk','campus-activities','guidance-resources','work-items','dashboard','growth-plan','rule-guide','apply','my-applications','approval','evaluation','evaluation-config']);
const layoutRoute = routes.find(route => route.path === '/');
layoutRoute.children = layoutRoute.children.filter(route => demoRoutes.has(route.path));
routes.find(route => route.path === '/register').redirect = '/login';
const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
});

// 路由守卫
router.beforeEach(async (to, _from, next) => {
  NProgress.start();
  document.title = `${to.meta.title || ''} - ${import.meta.env.VITE_APP_TITLE || '星轨智评'}`;

  const userStore = useUserStore();
  const isLoggedIn = !!userStore.token;

  if (to.meta.guest) {
    if (isLoggedIn && to.path === '/login') return next('/');
    return next();
  }

  if (!isLoggedIn) {
    ElMessage.warning('请先登录');
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }

  // ====== 修复：有 token 但 userInfo 未初始化（刷新页面 / 持久化异步）时主动拉取 ======
  let role = userStore.userInfo?.role;
  
  // 如果没有角色信息，尝试刷新（最多重试2次）
  if (!role) {
    let retries = 0;
    while (!role && retries < 2) {
      retries++;
      try {
        await userStore.refreshUser();
        role = userStore.userInfo?.role;
      } catch (_) {
        // 第一次失败时继续尝试
      }
      if (!role) {
        try {
          await userStore.fetchInfo();
          role = userStore.userInfo?.role;
        } catch (_) {
          // 继续重试或跳转
        }
      }
    }
    
    // 如果2次重试后仍无角色信息
    if (!role) {
      // 检查token是否仍然有效 - 尝试一个简单的API调用
      try {
        const { default: request } = await import('@/utils/request');
        const result = await request.get('/auth/me', { __suppressMsg: true });
        if (result && result.role) {
          userStore.setUserInfo(result);
          role = result.role;
        }
      } catch (e) {
        // token可能已过期或无效
        if (e.message?.includes('401') || e.message?.includes('未登录') || e.message?.includes('登录状态')) {
          userStore.logout();
          ElMessage.warning('登录状态已失效，请重新登录');
          return next({ path: '/login', query: { redirect: to.fullPath } });
        }
      }
    }
  }
  
  role = userStore.userInfo?.role;

  // ====== 修复：根路径 / 重定向放到角色校验之前，避免先被 meta.roles 误拦截 ======
  if (to.path === '/') {
    if (isDeveloper(role) || ROLE_GROUPS.COLLEGE_ABOVE.includes(role) || role === ROLES.COUNSELOR) return next('/dashboard');
    if (ROLE_GROUPS.STUDENT_LIKE.includes(role)) return next('/my-applications');
    if (!role) {
      // 取不到角色 ≠ 登录失效：可能是 /auth/me 瞬时抖动或后端繁忙。
      // 改造前这里直接 userStore.logout() 把用户踢下线，属于"误伤合法用户"；
      // 现在保留登录态并给出重试入口，只有明确返回 401 才登出（见下方 handleMissingRole）。
      return next({ path: '/403', query: { reason: 'role-missing', redirect: to.fullPath } });
    }
    return next('/403');
  }

  // 角色校验
  if (to.meta.roles) {
    if (!role) {
      // 有 token 但 role 仍为空：尝试刷新
      try { await userStore.refreshUser(); role = userStore.userInfo?.role; } catch (_) {}
      if (!role) {
        return next({ path: '/403', query: { reason: 'role-missing', redirect: to.fullPath } });
      }
    }
    // developer 是最高权限，无条件放行
    if (!isDeveloper(role) && !to.meta.roles.includes(role)) {
      return next('/403');
    }
  }

  next();
});

router.afterEach(() => {
  NProgress.done();
});

export default router;
