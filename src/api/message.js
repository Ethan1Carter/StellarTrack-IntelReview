import request from '@/utils/request';

export const getMessageList = (params, _config = {}) => request.get('/messages', params, _config);
export const getUnreadCount = (_config = {}) => request.get('/messages/unread-count', undefined, _config);
export const markAsRead = (id, _config = {}) => request.post(`/messages/${id}/read`, undefined, _config);
export const markAllAsRead = (_config = {}) => request.post('/messages/read-all', undefined, _config);
export const deleteMessage = (id, _config = {}) => request.delete(`/messages/${id}`, undefined, _config);
