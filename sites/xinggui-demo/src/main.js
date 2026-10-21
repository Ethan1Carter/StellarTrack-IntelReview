import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';

import App from './App.vue';
import router from './router';
import './styles/index.scss';

document.documentElement.classList.remove('eye-care-mode');
document.body.classList.remove('eye-care-mode');
try {
  const storageKey = 'xinggui-sites-demo-user';
  const persistedUser = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (persistedUser && Object.prototype.hasOwnProperty.call(persistedUser, 'eyeCareMode')) {
    delete persistedUser.eyeCareMode;
    localStorage.setItem(storageKey, JSON.stringify(persistedUser));
  }
} catch (_) {}

// NProgress
NProgress.configure({ showSpinner: false, trickleSpeed: 150 });

const app = createApp(App);

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

app.use(pinia);
app.use(router);

app.mount('#app');
