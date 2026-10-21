import request from '@/utils/request';

export const getProfile = (_config = {}) => request.get('/profile', undefined, _config);
export const updateProfile = (data, _config = {}) => request.put('/profile', data, _config);
export const uploadAvatar = (fileData) => request.post('/profile/avatar', fileData, { timeout: 60000 });
export const changePassword = (data, _config = {}) => request.post('/profile/change-password', data, _config);

// 消息中心
export const listMessages = (params, _config = {}) => request.get('/messages', params, _config);
export const readMessage = (id, _config = {}) => request.post(`/messages/${id}/read`, undefined, _config);
export const readAllMessages = (_config = {}) => request.post('/messages/read-all', undefined, _config);
export const deleteMessage = (id, _config = {}) => request.delete(`/messages/${id}`, undefined, _config);
export const getUnreadCount = (_config = {}) => request.get('/messages/unread-count', undefined, _config);

// 上传通用
export const uploadImages = (files) => {
  const form = new FormData();
  if (Array.isArray(files)) files.forEach(f => form.append('files', f));
  else form.append('files', files);
  return request.post('/upload/images', form, { timeout: 120000 });
};
