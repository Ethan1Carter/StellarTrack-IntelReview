import request from '@/utils/request';

export function getStudentDashboard(params) {
  return request({ url: '/stats/student/dashboard', method: 'GET', params });
}

export function getSemesterList() {
  return request({ url: '/semesters', method: 'GET' });
}

export function getClassDashboard(params) {
  return request({ url: '/stats/class', method: 'GET', params });
}

export function getCollegeDashboard(params) {
  return request({ url: '/stats/college', method: 'GET', params });
}

export function getSchoolDashboard(params) {
  return request({ url: '/stats/school', method: 'GET', params });
}

export function getRanking(params) {
  return request({ url: '/stats/ranking', method: 'GET', params });
}

export function getExport(params) {
  return request({ url: '/stats/export', method: 'GET', params, responseType: 'blob' });
}
