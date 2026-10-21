<template>
  <div class="err-page">
    <div class="code">4<span class="err-0">0</span>3</div>
    <h1>{{ isRoleMissing ? '用户信息加载失败' : '访问被拒绝' }}</h1>
    <p v-if="isRoleMissing">
      已登录，但未能获取您的角色信息（可能是网络抖动或服务端繁忙）。
      <strong>您的登录状态仍被保留</strong>，可先重试；若多次重试仍失败，请手动重新登录。
    </p>
    <p v-else>
      抱歉，您没有权限访问此页面。请联系管理员或使用更高权限账号登录。
    </p>

    <div class="actions">
      <!-- 角色信息缺失时提供重试入口：重新拉取用户信息后跳回原来要去的页面 -->
      <el-button v-if="isRoleMissing" type="primary" size="large" :loading="loading" @click="retry">
        ↻ 重试
      </el-button>
      <el-button type="primary" size="large" @click="goBack">← 返回首页</el-button>
      <el-button v-if="isRoleMissing" size="large" @click="relogin">重新登录</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const loading = ref(false);

/**
 * 守卫在"已登录但取不到角色"时不再登出用户，而是带 reason=role-missing 转到这里。
 * 此处据此展示重试入口，避免把一次瞬时抖动变成强制重新登录。
 */
const isRoleMissing = computed(() => route.query.reason === 'role-missing');

const goBack = () => router.push('/');

/**
 * 重新拉取用户信息，成功后跳回原本要访问的目标页面
 */
const retry = async () => {
  loading.value = true;
  try {
    let user = null;
    try { user = await userStore.refreshUser(); } catch (_) { /* 交由下面的兜底处理 */ }
    if (!user?.role) {
      try { user = await userStore.fetchInfo(); } catch (_) { /* 继续兜底 */ }
    }
    if (user?.role) {
      const target = typeof route.query.redirect === 'string' && route.query.redirect ? route.query.redirect : '/';
      ElMessage.success('用户信息已恢复');
      router.replace(target);
      return;
    }
    ElMessage.warning('仍未获取到角色信息，请稍后再试或重新登录');
  } finally {
    loading.value = false;
  }
};

/**
 * 用户主动选择重新登录（保留原本要跳转的目标地址）
 */
const relogin = () => {
  const target = typeof route.query.redirect === 'string' && route.query.redirect ? route.query.redirect : '/';
  router.push({ path: '/login', query: { redirect: target } });
};
</script>

<style lang="scss" scoped>
.err-page {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 20px; text-align: center;
  background: linear-gradient(135deg, #fff5f5, #fff);
}
.code { font-size: 120px; font-weight: 900; line-height: 1; background: linear-gradient(135deg, #F56C6C, #E6A23C);
  -webkit-background-clip: text; color: transparent; letter-spacing: -4px; margin-bottom: 20px;
  .err-0 { display: inline-block; animation: shake 2s ease-in-out infinite; }
  @keyframes shake { 0%,100%{ transform: rotate(0);} 25%{ transform: rotate(-20deg);} 75%{ transform: rotate(20deg);} }
}
h1 { color: #303133; margin: 0 0 12px; font-size: 26px; }
p { color: #606266; max-width: 420px; line-height: 1.7; margin-bottom: 28px; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
</style>
