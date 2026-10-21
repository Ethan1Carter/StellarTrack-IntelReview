import request from '@/utils/request';

export function listModules(params) {
  return request({ url: '/modules', method: 'GET', params });
}

export function listActiveModules() {
  return request({ url: '/modules/active', method: 'GET' });
}

export function listAllModules(params) {
  return request({ url: '/modules/all', method: 'GET', params });
}

export function getModule(id) {
  return request({ url: `/modules/${id}`, method: 'GET' });
}

export function createModule(data) {
  return request({ url: '/modules', method: 'POST', data });
}

export function updateModule(id, data) {
  return request({ url: `/modules/${id}`, method: 'PUT', data });
}

export function deleteModule(id) {
  return request({ url: `/modules/${id}`, method: 'DELETE' });
}

export function toggleModuleStatus(id, status) {
  return request({ url: `/modules/${id}/status`, method: 'PATCH', data: { status } });
}

export function toggleModuleRequired(id, isRequired) {
  return request({ url: `/modules/${id}/toggle-required`, method: 'POST', data: { isRequired } });
}

export function getModuleSchema() {
  return request({ url: '/modules/schema', method: 'GET' });
}

export function exportModules(params) {
  return request({ url: '/modules/export', method: 'GET', params, responseType: 'blob' });
}

export function importModules(data) {
  return request({ url: '/modules/import', method: 'POST', data });
}

export function copyModule(id) {
  return request({ url: `/modules/${id}/copy`, method: 'POST' });
}

export function listFlows(params) {
  return request({ url: '/flows', method: 'GET', params });
}

export function listFlowsAll() {
  return request({ url: '/flows/all', method: 'GET' });
}

export function getFlow(id) {
  return request({ url: `/flows/${id}`, method: 'GET' });
}

export function createFlow(data) {
  return request({ url: '/flows', method: 'POST', data });
}

export function updateFlow(id, data) {
  return request({ url: `/flows/${id}`, method: 'PUT', data });
}

export function deleteFlow(id) {
  return request({ url: `/flows/${id}`, method: 'DELETE' });
}