import request from '@/utils/request';

// 注册表单选项：可注册角色 / 院系 / 班级 / 是否开放注册
export const getRegisterOptions = (_config = {}) => request.get('/register/options', undefined, _config);

// 提交注册申请
export const submitRegister = (data, _config = {}) => request.post('/register', data, _config);

// 查询注册审核进度（需账号 + 密码）
export const queryRegisterStatus = (data, _config = {}) => request.post('/register/status', data, _config);
