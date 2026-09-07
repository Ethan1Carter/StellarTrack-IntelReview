import request from '@/utils/request';

export const getNoticeList = (params, _config = {}) => request.get('/notices', params, _config);
export const getNoticeDetail = (id, _config = {}) => request.get(`/notices/${id}`, undefined, _config);
export const createNotice = (data, _config = {}) => request.post('/notices', data, _config);
export const updateNotice = (id, data, _config = {}) => request.put(`/notices/${id}`, data, _config);
export const deleteNotice = (id, _config = {}) => request.delete(`/notices/${id}`, undefined, _config);
