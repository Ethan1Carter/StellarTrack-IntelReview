<template>
  <div class="err-page">
    <div class="code">4<span class="err-0">0</span>4</div>
    <h1>页面不存在</h1>
    <p>您访问的页面可能已经被移除、重命名或暂时不可用。</p>
    <div style="display:flex; gap: 12px;">
      <el-button type="primary" size="large" @click="$router.push('/')">← 返回首页</el-button>
      <el-button size="large" @click="history.back()">返回上一页</el-button>
    </div>
  </div>
</template>
<script setup></script>
<style lang="scss" scoped>
.err-page {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 20px; text-align: center;
  background: linear-gradient(135deg, #f0f9ff, #fff);
}
.code { font-size: 120px; font-weight: 900; line-height: 1;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  -webkit-background-clip: text; color: transparent; letter-spacing: -4px; margin-bottom: 20px;
  .err-0 { display: inline-block; color: #409EFF; -webkit-text-fill-color: #409EFF; animation: bounce 2s ease-in-out infinite; }
  @keyframes bounce { 0%,100%{ transform: translateY(0);} 50%{ transform: translateY(-20px);} }
}
h1 { color: #303133; margin: 0 0 12px; font-size: 26px; }
p { color: #606266; max-width: 420px; line-height: 1.7; margin-bottom: 28px; }
</style>
