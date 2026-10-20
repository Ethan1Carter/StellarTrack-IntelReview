import request from '@/utils/request';
export const getGrowthPlan = params => request({ url: '/growth-plans', method: 'GET', params });
export const createGrowthPlan = data => request({ url: '/growth-plans', method: 'POST', data });
export const getGrowthStudents = params => request({ url: '/growth-plans/students', method: 'GET', params });
export const updateGrowthTask = (id, taskId, data) => request({ url: `/growth-plans/${id}/tasks/${taskId}`, method: 'PATCH', data });
export const reviewGrowthTask = (id, taskId, data) => request({ url: `/growth-plans/${id}/tasks/${taskId}/review`, method: 'POST', data });
