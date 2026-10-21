import request from '@/utils/request';
export const previewEvaluationConfig=data=>request({url:'/evaluation/config/preview',method:'POST',data,timeout:120000});

/**
 * 获取当前用户/指定学院的综测公式配置
 * @param {Object} params { collegeId? }
 */
export function getEvaluationConfig(params) {
  return request({ url: '/evaluation/config', method: 'GET', params });
}

/**
 * 保存综测公式配置（创建或更新）
 * @param {Object} data 配置数据
 */
export function saveEvaluationConfig(data) {
  return request({ url: '/evaluation/config', method: 'PUT', data });
}

/**
 * 重置为默认配置
 * @param {Object} data { collegeId? }
 */
export function resetEvaluationConfig(data) {
  return request({ url: '/evaluation/config/reset', method: 'POST', data });
}

/**
 * 测试公式计算
 * @param {Object} data { formula, vars }
 */
export function testFormula(data) {
  return request({ url: '/evaluation/config/test', method: 'POST', data });
}

/**
 * 获取默认公式与变量说明
 */
export function getFormulaDefaults() {
  return request({ url: '/evaluation/config/defaults', method: 'GET' });
}

/**
 * 查询自己的综测结果
 * @param {Object} params { academicYear?, semester? }
 */
export function getMyEvaluation(params) {
  return request({ url: '/evaluation/me', method: 'GET', params });
}

/**
 * 管理员查看指定学生的综测结果
 * @param {number} studentId
 * @param {Object} params { academicYear?, semester? }
 */
export function getStudentEvaluation(studentId, params) {
  return request({ url: `/evaluation/${studentId}`, method: 'GET', params });
}

/**
 * 管理员查看整个班级的综测排名
 * @param {number} classId
 * @param {Object} params { academicYear?, semester? }
 */
export function getClassEvaluation(classId, params) {
  return request({ url: `/evaluation/class/${classId}`, method: 'GET', params });
}
