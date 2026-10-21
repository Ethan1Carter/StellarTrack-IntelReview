import request from '@/utils/request';

export function reviewMaterial(data) {
  return request({ url: '/ai-materials/review', method: 'POST', data, timeout: 90000 });
}
