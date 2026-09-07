import request from '@/utils/request';

// ==================== 加分模块回收站 ====================
/** 列表（已软删除的加分模块） */
export function getRecycleModules(params = {}) {
  return request({ url: '/recycles/modules', method: 'GET', params });
}
/** 恢复已删除的加分模块 */
export function restoreRecycleModule(id) {
  return request({ url: `/recycles/modules/${id}/restore`, method: 'POST' });
}
/** 彻底删除（物理删除） */
export function purgeRecycleModule(id) {
  return request({ url: `/recycles/modules/${id}`, method: 'DELETE' });
}

// ==================== 用户回收站 ====================
/** 列表（停用用户） */
export function getRecycleUsers(params = {}) {
  return request({ url: '/recycles/users', method: 'GET', params });
}
/** 恢复停用用户为 active */
export function restoreRecycleUser(id) {
  return request({ url: `/recycles/users/${id}/restore`, method: 'POST' });
}

// ==================== 申诉回收站 ====================
/** 列表（已办结归档申诉） */
export function getRecycleAppeals(params = {}) {
  return request({ url: '/recycles/appeals', method: 'GET', params });
}
/** 恢复归档申诉为 pending */
export function restoreRecycleAppeal(id) {
  return request({ url: `/recycles/appeals/${id}/restore`, method: 'POST' });
}

// ==================== 回收站概览 ====================
export function getRecycleSummary() {
  return request({ url: '/recycles/summary', method: 'GET' });
}
