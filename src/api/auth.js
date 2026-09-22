import request from '@/utils/request';

export const loginApi = (data, _config = {}) => request.post('/auth/login', data, _config);
export const logoutApi = (_config = {}) => request.post('/auth/logout', undefined, _config);
export const getMeApi = (_config = {}) => request.get('/auth/me', undefined, _config);

// 管理员登录时允许切换角色模拟
export const switchRoleApi = (role, _config = {}) => request.post('/auth/switch-role', { role }, _config);
