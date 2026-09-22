import request from '@/utils/request';

// 学生加分申报（新版独立模块 /api/bonus）

// 学生：提交加分申请
export function submitBonus(data) {
  return request({ url: '/bonus/submit', method: 'POST', data, timeout: 120000 });
}

// 学生：上传证明材料（先传拿到 URL，再随 submit 提交）
export function uploadBonusProof(formData) {
  return request({ url: '/bonus/upload', method: 'POST', data: formData, timeout: 120000 });
}

// 学生：我的申报列表
export function getMyBonus() {
  return request({ url: '/bonus/my', method: 'GET' });
}

// 学生：撤回申请
export function withdrawBonus(id) {
  return request({ url: `/bonus/${id}/withdraw`, method: 'POST' });
}

// 学生：编辑并重提（驳回/退回后）
export function resubmitBonus(id, data) {
  return request({ url: `/bonus/${id}`, method: 'PUT', data, timeout: 120000 });
}

// 班级管理员：待办列表（status: pending | returned | all）
export function getBonusPending(params) {
  return request({ url: '/bonus/pending', method: 'GET', params });
}

// 班级管理员：待办统计（角标/实时计数）
export function getBonusStats() {
  return request({ url: '/bonus/stats', method: 'GET' });
}

// 班级管理员：申请详情
export function getBonusDetail(id) {
  return request({ url: `/bonus/${id}`, method: 'GET' });
}

// 班级管理员：审批动作
export function approveBonus(id, data = {}) {
  return request({ url: `/bonus/${id}/approve`, method: 'POST', data });
}
export function rejectBonus(id, comment) {
  return request({ url: `/bonus/${id}/reject`, method: 'POST', data: { comment } });
}
export function returnBonus(id, data = {}) {
  return request({ url: `/bonus/${id}/return`, method: 'POST', data });
}
