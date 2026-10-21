import request from '@/utils/request';

// 用户管理
export function getUserList(params) {
  return request({ url: '/users', method: 'GET', params });
}

export function getStaffList(params) {
  return request({ url: '/users/staff', method: 'GET', params });
}

export function getUser(id) {
  return request({ url: `/users/${id}`, method: 'GET' });
}

export function createUser(data) {
  return request({ url: '/users', method: 'POST', data });
}

export function updateUser(id, data) {
  return request({ url: `/users/${id}`, method: 'PUT', data });
}

export function deleteUser(id) {
  return request({ url: `/users/${id}`, method: 'DELETE' });
}

export function batchDeleteUsers(ids) {
  return request({ url: '/users/batch-delete', method: 'POST', data: { ids } });
}

// 批量启用/停用用户
// status: 'disabled' 停用 | 'active' 启用
export function batchToggleUserStatus(ids, status) {
  return request({ url: '/users/batch-status', method: 'POST', data: { ids, status } });
}

export function toggleUserStatus(id, status) {
  return request({ url: `/users/${id}/status`, method: 'PATCH', data: { status } });
}

export function resetUserPassword(id) {
  return request({ url: `/users/${id}/reset-password`, method: 'POST' });
}

export function exportUsers(params) {
  return request({ url: '/users/export', method: 'GET', params, responseType: 'blob' });
}

export function importUsers(formData) {
  return request({ url: '/users/import', method: 'POST', data: formData, timeout: 120000 });
}

export function downloadUserTemplate() {
  return request({ url: '/users/template', method: 'GET', responseType: 'blob' });
}

// 角色审批
export function getRoleApplications(params) {
  return request({ url: '/users/role-applications', method: 'GET', params });
}

export function applyRole(id, data) {
  return request({ url: `/users/${id}/apply-role`, method: 'POST', data });
}

export function approveRole(id, data) {
  return request({ url: `/users/${id}/approve-role`, method: 'POST', data });
}

// 超级管理员权限管理
export function getPermissions() {
  return request({ url: '/users/permissions', method: 'GET' });
}

export function updateUserRole(id, data) {
  return request({ url: `/users/${id}/role`, method: 'PUT', data });
}
