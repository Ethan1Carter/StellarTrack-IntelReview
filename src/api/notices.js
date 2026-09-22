import request from '@/utils/request';

export function noticeList(params) {
  return request({ url: '/notices', method: 'GET', params });
}

export function myNoticeList(params) {
  return request({ url: '/notices/my', method: 'GET', params });
}

export function getNotice(id) {
  return request({ url: `/notices/${id}`, method: 'GET' });
}

export function createNotice(data) {
  return request({ url: '/notices', method: 'POST', data });
}

export function updateNotice(id, data) {
  return request({ url: `/notices/${id}`, method: 'PUT', data });
}

export function deleteNotice(id) {
  return request({ url: `/notices/${id}`, method: 'DELETE' });
}

export function pinNotice(id, pinTop) {
  return request({ url: `/notices/${id}/pin`, method: 'PATCH', data: { pinTop: pinTop ? 1 : 0 } });
}

export function toggleNotice(id, status) {
  return request({ url: `/notices/${id}/status`, method: 'PATCH', data: { status } });
}

export function uploadAttachment(fileFormData) {
  return request({ url: '/notices/attachment', method: 'POST', data: fileFormData, timeout: 60000 });
}
