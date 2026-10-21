import request from '@/utils/request';

// 院系列表（全部，不分页）
export const listAllColleges = (params) => request({ url: '/colleges/all', method: 'GET', params });
export const getCollegeList = (params) => request({ url: '/colleges', method: 'GET', params });
export const createCollege = (data) => request({ url: '/colleges', method: 'POST', data });
export const updateCollege = (id, data) => request({ url: `/colleges/${id}`, method: 'PUT', data });
export const deleteCollege = (id) => request({ url: `/colleges/${id}`, method: 'DELETE' });
export const downloadCollegeTemplate = () => request({ url: '/colleges/template', method: 'GET', responseType: 'blob' });
export const importColleges = (formData) => request({ url: '/colleges/import', method: 'POST', data: formData });
export const exportColleges = () => request({ url: '/colleges/export', method: 'GET', responseType: 'blob' });

// 班级
export const getClassList = (params) => request({ url: '/classes', method: 'GET', params });
export const createClass = (data) => request({ url: '/classes', method: 'POST', data });
export const updateClass = (id, data) => request({ url: `/classes/${id}`, method: 'PUT', data });
export const deleteClass = (id) => request({ url: `/classes/${id}`, method: 'DELETE' });
