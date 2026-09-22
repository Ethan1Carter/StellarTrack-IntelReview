import request from '@/utils/request';

/** 查询课程成绩列表 */
export function listCourseScores(params) {
  return request({ url: '/course-scores', method: 'GET', params });
}

/** 按班级获取学生名单+成绩概况 */
export function getClassStudents(params) {
  return request({ url: '/course-scores/class-students', method: 'GET', params });
}

/** 查询当前学生课程成绩 */
export function getMyCourseScores(params) {
  return request({ url: '/course-scores/me', method: 'GET', params });
}

/** 查询有成绩数据的学期列表 */
export function getCourseScoreSemesters() {
  return request({ url: '/course-scores/semesters', method: 'GET' });
}

/** 下载课程成绩导入模板 */
export function downloadCourseScoreTemplate() {
  return request({ url: '/course-scores/template', method: 'GET', responseType: 'blob' });
}

/** 课程成绩批量导入 */
export function importCourseScores(formData) {
  return request({
    url: '/course-scores/import',
    method: 'POST',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  });
}

/** 删除单条课程成绩 */
export function deleteCourseScore(id) {
  return request({ url: `/course-scores/${id}`, method: 'DELETE' });
}

/** 按批次删除课程成绩 */
export function deleteCourseScoreByBatch(batch) {
  return request({ url: `/course-scores/batch/${batch}`, method: 'DELETE' });
}
