import request from '@/utils/request';

export function listBackups() {
  return request({ url: '/backups', method: 'GET' });
}

export function createBackup() {
  return request({ url: '/backups', method: 'POST', timeout: 120000 });
}

export function getBackupStats() {
  return request({ url: '/backups/stats', method: 'GET' });
}

export function downloadBackup(filename) {
  return request({ url: `/backups/${encodeURIComponent(filename)}`, method: 'GET', responseType: 'blob', timeout: 120000 });
}

export function deleteBackup(filename) {
  return request({ url: `/backups/${encodeURIComponent(filename)}`, method: 'DELETE' });
}

export function restoreFrom(filename) {
  return request({ url: `/backups/${encodeURIComponent(filename)}/restore`, method: 'POST', timeout: 120000 });
}

export function uploadBackup(formData) {
  return request({ url: '/backups/upload', method: 'POST', data: formData, timeout: 120000 });
}
