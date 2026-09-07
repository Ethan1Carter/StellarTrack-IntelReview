import request from '@/utils/request';

// 学生：提交申诉（仅辅导员终审状态的申报可申诉）
// data: { applicationId, reason, attachments?: string[] }
export function submitAppeal(data) {
  return request({ url: '/appeals', method: 'POST', data, timeout: 90000 });
}

// 学生：查看我发起的申诉（分页）
// 管理员：查看权限范围内的申诉（班级管理员=本班，辅导员=自己班级，院管=本院，超管=全部）
export function getAppeals(params) {
  return request({ url: '/appeals', method: 'GET', params });
}

// 申诉详情
export function getAppealDetail(id) {
  return request({ url: `/appeals/${id}`, method: 'GET' });
}

// 管理员（班级管理员及以上）审批申诉
// body: { status: 'approved'|'rejected', reply: '答复' }
export function reviewAppeal(id, body) {
  return request({ url: `/appeals/${id}/review`, method: 'PATCH', data: body });
}

