import request from '@/utils/request';

export function listPublicities(params) {
  return request({ url: '/publicities', method: 'GET', params });
}

export function getPublicity(id) {
  return request({ url: `/publicities/${id}`, method: 'GET' });
}

export function createPublicity(data) {
  return request({ url: '/publicities', method: 'POST', data });
}

export function updatePublicity(id, data) {
  return request({ url: `/publicities/${id}`, method: 'PUT', data });
}

export function endPublicity(id) {
  return request({ url: `/publicities/${id}/end`, method: 'POST' });
}

export function submitObjection(publicityId, data) {
  return request({ url: `/publicities/${publicityId}/objections`, method: 'POST', data });
}

export function listObjections(publicityId) {
  return request({ url: `/publicities/${publicityId}/objections`, method: 'GET' });
}

export function resolveObjection(publicityId, objectionId, data) {
  return request({ url: `/publicities/${publicityId}/objections/${objectionId}/resolve`, method: 'PATCH', data });
}
