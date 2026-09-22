import request from '@/utils/request';

// 学校列表
export const listSchools = (params) => request({ url: '/schools', method: 'GET', params });
export const createSchool = (data) => request({ url: '/schools', method: 'POST', data });
export const updateSchool = (id, data) => request({ url: `/schools/${id}`, method: 'PUT', data });
export const deleteSchool = (id) => request({ url: `/schools/${id}`, method: 'DELETE' });
