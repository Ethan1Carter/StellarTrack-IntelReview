import request from '@/utils/request';

// 班级列表
export const getClassList = (params) => request({ url: '/classes', method: 'GET', params });
export const createClass = (data) => request({ url: '/classes', method: 'POST', data });
export const updateClass = (id, data) => request({ url: `/classes/${id}`, method: 'PUT', data });
export const deleteClass = (id) => request({ url: `/classes/${id}`, method: 'DELETE' });

// 辅导员班级分配
export const getCounselorAssignments = (params) => request({ url: '/classes/counselor-assignments', method: 'GET', params });
export const assignCounselor = (data) => request({ url: '/classes/assign-counselor', method: 'POST', data });
export const unassignCounselor = (id) => request({ url: `/classes/${id}/unassign-counselor`, method: 'POST' });

// 导出
export const exportClasses = (params) => request({ url: '/classes/export', method: 'GET', params, responseType: 'blob' });

// 获取班级下所有用户
export const getClassUsers = (classId) => request({ url: `/classes/${classId}/users`, method: 'GET' });

// 学生端：获取当前班级信息（辅导员 + 班级管理员 + 同班同学）
export const getMyClassInfo = (params) => request({ url: '/classes/my/info', method: 'GET', params });
