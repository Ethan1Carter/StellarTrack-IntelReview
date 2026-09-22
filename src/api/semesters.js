import request from '@/utils/request';

export const getSemesterList = (params) => request({ url: '/semesters', method: 'GET', params });
// 获取当前学期（按日期匹配数据库中存在且对当前用户可见的学期）
export const getCurrentSemester = () => request({ url: '/semesters/current', method: 'GET' });
// 学生申报页专用：仅返回「我学院可见 + 申报中」的学期
export const listActiveSemesters = () => request({ url: '/semesters', method: 'GET', params: { scope: 'for_apply' } });
// 列表通用：返回我学院可见的所有 active 学期（不止 started）
export const listAllActiveSemesters = () => request({ url: '/semesters', method: 'GET', params: { scope: 'all_active' } });
export const createSemester = (data) => request({ url: '/semesters', method: 'POST', data });
export const updateSemester = (id, data) => request({ url: `/semesters/${id}`, method: 'PUT', data });
export const deleteSemester = (id) => request({ url: `/semesters/${id}`, method: 'DELETE' });
export const setSemesterApplyStatus = (id, applyStatus) => request({ url: `/semesters/${id}/set-apply-status`, method: 'PATCH', data: { applyStatus } });

// ---- 班级综合考评报表 ----
export const generateClassReport = (classId, data) => request({ url: `/semesters/reports/generate/${classId}`, method: 'POST', data });
export const getClassReport = (classId, params) => request({ url: `/semesters/reports/class/${classId}`, method: 'GET', params });
export const listReports = (params) => request({ url: '/semesters/reports/list', method: 'GET', params });
export const submitReportToCounselor = (id, data) => request({ url: `/semesters/reports/${id}/submit`, method: 'POST', data });
export const rejectReport = (id, data) => request({ url: `/semesters/reports/${id}/reject`, method: 'POST', data });
export const approveReport = (id, data) => request({ url: `/semesters/reports/${id}/approve`, method: 'POST', data });
