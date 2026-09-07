import request from '@/utils/request';

// 学生端
export function createApplication(data) {
  return request({ url: '/applications', method: 'POST', data, timeout: 120000 });
}

/** 保存草稿（不进入审批流程，不校验学期开启） */
export function saveDraftApplication(data) {
  return request({ url: '/applications', method: 'POST', data: { ...data, saveDraft: true }, timeout: 120000 });
}

export function uploadProof(formData) {
  return request({ url: '/applications/upload', method: 'POST', data: formData, timeout: 120000 });
}

export function getMyApplications(params) {
  return request({ url: '/applications/my', method: 'GET', params });
}

/** 学生可见学期列表（含历史学期，用于「我的申报」页学期切换） */
export function getMySemesters() {
  return request({ url: '/applications/my/semesters', method: 'GET' });
}

/** 某学期各模块分数汇总（待认定分数 + 已认定生效分数） */
export function getMyScoreSummary(semesterId) {
  return request({ url: '/applications/my/summary', method: 'GET', params: { semesterId } });
}

/** 在校期间已认定的获奖荣誉及等级统计 */
export function getMyHonors(academicYear) {
  return request({
    url: '/applications/my/honors',
    method: 'GET',
    params: academicYear ? { academicYear } : undefined
  });
}

/** 辅导员查看所带班级的已认定荣誉统计与明细 */
export function getCounselorHonors(params) {
  return request({ url: '/applications/counselor/honors', method: 'GET', params });
}

/** 辅导员导出所带班级荣誉，含证书链接与可嵌入的本地图片证书 */
export function exportCounselorHonors(params) {
  return request({ url: '/applications/counselor/honors/export', method: 'GET', params, responseType: 'blob', timeout: 120000 });
}

/** 重复申报校验 */
export function checkDuplicate(data) {
  return request({ url: '/applications/check-duplicate', method: 'POST', data });
}

/** 撤回申报（仅待班级管理员审批状态可撤回，撤回后回到草稿） */
export function withdrawApplication(id) {
  return request({ url: `/applications/${id}/withdraw`, method: 'POST' });
}

/** 导出所选学期个人申报汇总 Excel */
export function exportMyApplications(semesterId) {
  return request({ url: '/applications/my/export', method: 'GET', params: { semesterId }, responseType: 'blob' });
}

export function getApplicationDetail(id) {
  return request({ url: `/applications/${id}`, method: 'GET' });
}

export function updateApplication(id, data) {
  return request({ url: `/applications/${id}`, method: 'PUT', data });
}

export function deleteApplication(id) {
  return request({ url: `/applications/${id}`, method: 'DELETE' });
}

export function resubmitApplication(id, data) {
  return request({ url: `/applications/${id}/resubmit`, method: 'POST', data, timeout: 120000 });
}

/** 重新申请评分：对已通过/已驳回的申报发起，克隆为草稿供学生修改后重提（申诉通过后使用） */
export function reapplyApplication(id, data = {}) {
  return request({ url: `/applications/${id}/reapply`, method: 'POST', data });
}

// 审批端
export function getApprovalList(params) {
  return request({ url: '/applications/approval', method: 'GET', params });
}

export function reviewApplication(id, data) {
  return request({ url: `/applications/${id}/review`, method: 'POST', data });
}

/** 辅导员终审：对已通过（approved）的申报做终审确认，可修改分数或改为驳回 */
export function finalReviewApplication(id, data) {
  return request({ url: `/applications/${id}/final-review`, method: 'POST', data });
}

/** 获取与该申报相关的抄送记录（审批中心详情抽屉使用） */
export function getCcRecords(id) {
  return request({ url: `/applications/${id}/cc-records`, method: 'GET' });
}

export function batchReview(ids, action, payload) {
  return request({ url: '/applications/batch-review', method: 'POST', data: { ids, action, ...payload } });
}

// 管理员端
export function getApplicationList(params) {
  return request({ url: '/applications', method: 'GET', params });
}

export function adminOverride(id, data) {
  return request({ url: `/applications/${id}/override`, method: 'POST', data });
}

/** 学院管理员/学校管理员删除已通过审批的申报单（同时扣减分数） */
export function adminDeleteApplication(id) {
  return request({ url: `/applications/${id}/admin-delete`, method: 'DELETE' });
}

// 班级报表
export function getClassReport(classId, params) {
  return request({ url: `/applications/reports/class/${classId}`, method: 'GET', params });
}

export function signClassReport(classId, data) {
  return request({ url: `/applications/reports/class/${classId}/sign`, method: 'POST', data });
}
