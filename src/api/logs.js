import request from '@/utils/request';

export function logList(params) {
  return request({ url: '/logs', method: 'GET', params });
}

export function getLog(id) {
  return request({ url: `/logs/${id}`, method: 'GET' });
}

export function exportLogs(params) {
  return request({ url: '/logs/export', method: 'GET', params, responseType: 'blob' });
}

export function clearExpiredLogs(days) {
  return request({ url: '/logs/clear', method: 'DELETE', params: { days } });
}
