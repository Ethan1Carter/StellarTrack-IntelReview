import axios from 'axios';
import { ElMessage, ElMessageBox } from 'element-plus';
import NProgress from 'nprogress';
import { useUserStore } from '@/stores/user';
import router from '@/router';

// 基础配置
const service = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE || '/api'),
  timeout: 30000
});

// 请求拦截
service.interceptors.request.use((config) => {
  NProgress.start();
  const userStore = useUserStore();
  if (userStore.token) {
    config.headers.Authorization = `Bearer ${userStore.token}`;
  }
  // 防止IE缓存
  if (config.method === 'get') {
    config.params = { ...(config.params || {}), _t: Date.now() };
  }
  return config;
}, (err) => {
  NProgress.done();
  return Promise.reject(err);
});

// 响应拦截
service.interceptors.response.use((res) => {
  NProgress.done();
  const raw = res.data;
  // 处理 blob 响应
  if (res.config.responseType === 'blob' || res.config.responseType === 'arraybuffer') {
    // 如果是错误JSON包装，尝试解析
    if (raw.type === 'application/json') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const obj = JSON.parse(reader.result);
            if (obj && obj.code !== 0 && obj.code !== 200) {
              ElMessage.error(obj.message || '请求失败');
              reject(new Error(obj.message || '请求失败'));
            } else resolve(obj.data !== undefined ? obj.data : obj);
          } catch { reject(raw); }
        };
        reader.readAsText(raw);
      });
    }
    return raw;
  }
  // 统一响应结构: { code, message, data, ... }
  if (raw && typeof raw === 'object' && 'code' in raw) {
    if (raw.code === 0 || raw.code === 200) {
      return raw.data !== undefined ? raw.data : raw;
    }
    // 401 未登录
    if (raw.code === 401 || raw.status === 401) {
      const userStore = useUserStore();
      ElMessageBox.confirm('登录状态已失效，请重新登录', '提示', { confirmButtonText: '重新登录', cancelButtonText: '取消', type: 'warning' })
        .then(() => { userStore.logout(); router.push('/login'); })
        .catch(() => {});
      return Promise.reject(Object.assign(new Error(raw.message || '未登录'), { code: 401 }));
    }
    // 403 无权限 - 不自动跳转，让页面自己处理
    if (raw.code === 403 || raw.status === 403) {
      return Promise.reject(new Error(raw.message || '无权限访问'));
    }
    ElMessage.error(raw.message || '请求失败');
    return Promise.reject(new Error(raw.message || '请求失败'));
  }
  // 非标准响应直接返回
  return raw;
}, (err) => {
  NProgress.done();
  let msg = '网络异常，请稍后再试';
  if (err.response) {
    if (err.response.status === 401) {
      const userStore = useUserStore();
      userStore.logout({ notifyServer: false });
      router.push('/login');
      msg = '登录状态已失效';
    } else if (err.response.status === 403) {
      msg = (err.response.data && err.response.data.message) || '无权访问';
      // 不自动跳转到403页面，让组件自己处理权限错误
    }
    else if (err.response.status === 404) msg = '接口不存在';
    else if (err.response.status >= 500) msg = '服务器错误（'+err.response.status+'）';
    else msg = err.response.data?.message || ('HTTP ' + err.response.status);
  } else if (err.code === 'ECONNABORTED') msg = '请求超时，请稍后重试';
  else if (err.message?.includes('Network Error')) msg = '网络连接异常，请检查网络';
  // 覆盖原始 Axios 的 "Request failed with status code X"，让前端 catch(e).message 直接拿到真实错误
  if (msg) err.message = msg;
  if (msg && !err.config?.__suppressMsg) {
    // 抑制标记通过请求配置 __suppressMsg 控制，不再用中文关键字匹配
    ElMessage.error(msg);
  }
  return Promise.reject(err);
});

// 提供 链式快捷调用：request.get(url, params)
['get','post','put','delete','patch','head','options'].forEach(method => {
  service[method] = (url, data, config = {}) => {
    if (method === 'get' || method === 'delete' || method === 'head' || method === 'options') {
      return service.request({ url, method, params: data, ...config });
    }
    return service.request({ url, method, data, ...config });
  };
});

export default service;
