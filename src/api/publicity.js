import request from './request';

export const getPublicityList = (params) => request.get('/publicities', params);
export const getPublicityDetail = (id, params) => request.get(`/publicities/${id}`, params);
export const createPublicity = (data) => request.post('/publicities', data);
export const updatePublicity = (id, data) => request.put(`/publicities/${id}`, data);
export const publishPublicity = (id) => request.post(`/publicities/${id}/publish`);
export const getObjections = (publicityId, params) => request.get(`/publicities/${publicityId}/objections`, params);
export const submitObjection = (publicityId, data) => request.post(`/publicities/${publicityId}/objections`, data);
export const handleObjection = (id, data) => request.post(`/publicities/objections/${id}/handle`, data);
