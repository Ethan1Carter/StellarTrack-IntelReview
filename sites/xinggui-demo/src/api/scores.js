import request from '@/utils/request';

export function getMyScore(params) {
  return request({ url: '/scores/me', method: 'GET', params });
}

export function getUserScore(userId, params) {
  return request({ url: `/scores/${userId}`, method: 'GET', params });
}

export function getUserScoreHistory(userId) {
  return request({ url: `/scores/${userId}/history`, method: 'GET' });
}

export function listScores(params) {
  return request({ url: '/scores', method: 'GET', params });
}

export function exportScoreTemplate() {
  return request({ url: '/scores/template', method: 'GET', responseType: 'blob' });
}

export function recalculateScore(userId) {
  return request({ url: `/scores/${userId}/recalculate`, method: 'POST' });
}

/** 学生导出我的成绩Excel（需要班级报表审核通过） */
export function exportMyScore(params) {
  return request({ url: '/scores/me/export', method: 'GET', params, responseType: 'blob' });
}

/** 下载成绩批量导入模板 */
export function downloadScoreImportTemplate() {
  return request({ url: '/scores/import-template', method: 'GET', responseType: 'blob' });
}

/** 成绩批量导入 */
export function importScores(formData) {
  return request({
    url: '/scores/import',
    method: 'POST',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  });
}

