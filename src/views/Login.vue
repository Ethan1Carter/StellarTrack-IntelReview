<template>
  <div class="login-bg">
    <!-- 装饰背景 -->
    <div class="bg-decoration">
      <div class="circle c1"></div>
      <div class="circle c2"></div>
      <div class="orbit orbit-one"></div>
      <div class="orbit orbit-two"></div>
    </div>

    <div class="login-container">
      <div class="login-left hide-on-mobile">
        <div>
          <div class="brand-kicker">{{ branding.englishName }} · STUDENT GROWTH OS</div>
          <div class="brand-lockup">
            <img src="/branding/xinggui-logo.png" :alt="`${branding.appName} · ${branding.institutionName}`" />
          </div>
          <div class="brand-statement">让每一份成长，<br/>都有清晰的轨迹。</div>
          <p class="brand-description">连接申报、审核、五育核算与成长洞察，为学生和管理者提供可信、透明的评价依据。</p>
        </div>
        <div class="features">
          <div class="feature"><el-icon size="22" color="#2DD4BF"><Select /></el-icon><span>考评模块化 灵活配置</span></div>
          <div class="feature"><el-icon size="22" color="#818CF8"><CollectionTag /></el-icon><span>线上审批 全程留痕</span></div>
          <div class="feature"><el-icon size="22" color="#FBBF24"><TrendCharts /></el-icon><span>数据可视化 智能统计</span></div>
          <div class="feature"><el-icon size="22" color="#FB7185"><Lock /></el-icon><span>分级权限 安全可靠</span></div>
        </div>
        <div class="footer-tip">© 2024 {{ branding.englishName }} · Assessment System v1.0</div>
      </div>

      <div class="login-right">
        <el-card shadow="never" class="login-card">
          <div class="mobile-brand show-only-mobile">
            <img class="mobile-logo" src="/branding/xinggui-logo.png" :alt="`${branding.appName} · ${branding.institutionName}`" />
          </div>
          <div class="login-kicker">SECURE ACCESS</div>
          <h2 class="welcome">欢迎回来</h2>
          <p class="subtitle">登录{{ branding.appName }}，继续查看学生成长与考评进度</p>

          <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent="handleLogin">
            <el-form-item prop="username">
              <el-input v-model="form.username" size="large" placeholder="请输入账号（学号/工号）" :prefix-icon="User" clearable />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="form.password" size="large" type="password" show-password placeholder="请输入密码" :prefix-icon="Lock" @keyup.enter="handleLogin" />
            </el-form-item>
            <el-form-item>
              <div style="display:flex; justify-content: space-between; align-items:center; width: 100%; font-size: 13px;">
                <el-checkbox v-model="form.remember">记住我</el-checkbox>
                <span class="tip">默认密码 123456</span>
              </div>
            </el-form-item>
            <el-button type="primary" size="large" class="login-button" :loading="loading" @click="handleLogin">
              {{ loading ? '登录中...' : '立即登录' }}
            </el-button>
          </el-form>

          <!-- 演示账号 -->
          <el-divider content-position="center">演示账号</el-divider>
          <div class="demo-list">
            <div v-for="(d, i) in demoAccounts" :key="i" class="demo-item" @click="fillAccount(d)">
              <div class="role">{{ d.label }}</div>
              <div class="acct">{{ d.username }} / {{ d.password }}</div>
            </div>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock, Select, CollectionTag, TrendCharts } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { branding } from '@/config/branding';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const formRef = ref();
const loading = ref(false);
const form = reactive({ username: '', password: '', remember: true });
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
};

const demoAccounts = [
  { label: '学校管理员', username: 'admin', password: 'admin123', color: '#F56C6C' },
  { label: '院系管理员（计算机学院）', username: 'admin_cs', password: '123456', color: '#409EFF' },
  { label: '辅导员', username: 'counselor1', password: '123456', color: '#67C23A' },
  { label: '学生', username: 'student2023CS01', password: '123456', color: '#E6A23C' }
];

const fillAccount = (d) => {
  form.username = d.username;
  form.password = d.password;
};

const handleLogin = async () => {
  await formRef.value.validate();
  loading.value = true;
  try {
    await userStore.login({ username: form.username.trim(), password: form.password });
    // 优先使用 query 中的 redirect（用户被踢回登录前访问的地址）
    let redirect = route.query.redirect;
    // 校验 redirect：必须是站内路径且不能是 login/403/404 等特殊页面
    if (redirect && typeof redirect === 'string') {
      const invalidPrefixes = ['/login', '/403', '/404'];
      const startsWithBad = invalidPrefixes.some(p => redirect.startsWith(p));
      if (!redirect.startsWith('/') || startsWithBad) redirect = undefined;
    }
    if (!redirect) {
      // 兜底：无有效角色信息时跳转到 '/'，让路由守卫统一处理重定向
      const role = userStore.role;
      if (!role) redirect = '/';
      else redirect = defaultRedirect();
    }
    router.push(redirect);
  } finally { loading.value = false; }
};

const defaultRedirect = () => {
  const role = userStore.role;
  if (role === 'student')                    return '/my-applications';
  if (role === 'class_admin')                return '/my-applications';
  if (role === 'counselor')                  return '/dashboard';
  if (role === 'college_admin')              return '/dashboard';
  if (role === 'school_admin' || role === 'super_admin') return '/dashboard';
  // 兜底角色不明时交给路由守卫处理
  return '/';
};
</script>

<style lang="scss" scoped>
.login-bg {
  min-height: 100vh;
  background:
    radial-gradient(circle at 8% 15%, rgba(45,212,191,.14), transparent 24rem),
    radial-gradient(circle at 92% 85%, rgba(124,58,237,.14), transparent 26rem),
    #F2F5FB;
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.bg-decoration { position: absolute; inset: 0; pointer-events: none; overflow: hidden;
  .circle { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .2; }
  .c1 { width: 420px; height: 420px; background: #4F46E5; top: -150px; left: -100px; }
  .c2 { width: 520px; height: 520px; background: #2DD4BF; bottom: -240px; right: -140px; }
  .orbit { position: absolute; border: 1px solid rgba(79,70,229,.12); border-radius: 50%; transform: rotate(-18deg); }
  .orbit::after { content: ''; position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #2DD4BF; box-shadow: 0 0 18px rgba(45,212,191,.8); }
  .orbit-one { width: 560px; height: 210px; right: -170px; top: 12%; &::after { left: 18%; top: 8%; } }
  .orbit-two { width: 460px; height: 170px; left: -160px; bottom: 6%; transform: rotate(22deg); &::after { right: 14%; bottom: 10%; } }
}
.login-container {
  position: relative; z-index: 1;
  width: 100%; max-width: 1040px;
  min-height: 640px;
  background: rgba(255,255,255,.9);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,.88);
  border-radius: 28px;
  box-shadow: 0 32px 90px rgba(31,43,77,.18);
  display: flex; overflow: hidden;
  @include mobile { flex-direction: column; }
}
.login-left {
  flex: 1; padding: 54px;
  background:
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
    radial-gradient(circle at 15% 12%, rgba(45,212,191,.24), transparent 18rem),
    linear-gradient(145deg, #17234B 0%, #111936 62%, #241651 100%);
  background-size: 28px 28px, 28px 28px, auto, auto;
  color: #fff; display: flex; flex-direction: column; justify-content: space-between;
  .brand-kicker { font-size: 10px; letter-spacing: .22em; color: #8CE8DA; font-weight: 700; margin-bottom: 22px; }
  .brand-lockup {
    width: 238px;
    margin-bottom: 28px;
    padding: 12px 18px;
    border: 1px solid rgba(255,255,255,.82);
    border-radius: 22px;
    background: linear-gradient(145deg, rgba(255,255,255,.98), rgba(239,247,255,.94));
    box-shadow: 0 18px 46px rgba(1, 11, 46, .28), inset 0 1px 0 #fff;
    img { display: block; width: 100%; height: auto; }
  }
  .brand-statement { font-size: 38px; line-height: 1.28; font-weight: 750; letter-spacing: -.045em; }
  .brand-description { width: 88%; color: #AAB7D6; line-height: 1.85; font-size: 13px; margin: 18px 0 0; }
  .features { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
    .feature { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #D9E0F2;
      > span { flex: 1; padding: 11px 12px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; backdrop-filter: blur(8px); }
    }
  }
  .footer-tip { margin-top: 26px; font-size: 10px; letter-spacing: .04em; color: #7182AA; }
}
.login-right { flex: 0 0 440px; padding: 42px; display: flex; align-items: center; @include mobile { flex: 1; padding: 20px; }
  .login-card { width: 100%; border: 0 !important; box-shadow: none !important; border-radius: 0; padding: 10px 0; @include mobile { padding: 0; } }
  .mobile-brand { display: none; align-items: center; justify-content: center; margin-bottom: 18px;
    .mobile-logo { display: block; width: 172px; max-width: 62%; height: auto; }
  }
  .login-kicker { font-size: 10px; color: #4F46E5; letter-spacing: .2em; font-weight: 800; margin-bottom: 12px; }
  .welcome { font-size: 30px; margin: 0 0 8px; color: #17233B; font-weight: 750; letter-spacing: -.04em; }
  .subtitle { color: #7A879C; font-size: 13px; margin: 0 0 28px; }
  .tip { color: #C0C4CC; }
  :deep(.el-input__wrapper) { min-height: 46px; background: #F8FAFD; box-shadow: 0 0 0 1px #E1E7F0 inset; }
  .login-button { width: 100%; height: 46px; border-radius: 12px; background: linear-gradient(110deg, #4F46E5, #6D5DF5); border: 0; }
}
.demo-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; @include mobile { grid-template-columns: 1fr 1fr; } }
.demo-item { padding: 10px 11px; border-radius: 11px; background: #F7F8FC; border: 1px solid #ECEFF5; cursor: pointer; transition: all .18s ease;
  &:hover { background: #F3F2FF; border-color: #D9D6FE; transform: translateY(-1px); }
  .role { font-size: 11px; color: #7C899D; }
  .acct { font-size: 11px; font-family: 'SFMono-Regular', Consolas, monospace; color: #4F46E5; margin-top: 4px; word-break: break-all; }
}
</style>
