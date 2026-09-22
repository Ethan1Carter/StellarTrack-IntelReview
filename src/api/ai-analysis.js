import request from '@/utils/request';

export function getStudentAnalysis(params) {
  return request({ url: '/ai-analysis/student', method: 'GET', params });
}

export function getClassAnalysis(params) {
  return request({ url: '/ai-analysis/class', method: 'GET', params });
}

export function getCollegeAnalysis(params) {
  return request({ url: '/ai-analysis/college', method: 'GET', params });
}

export function getSchoolAnalysis(params) {
  return request({ url: '/ai-analysis/school', method: 'GET', params });
}

// 综合AI智能分析（支持多维度和权限继承）
export function getComprehensiveAnalysis(params) {
  return request({ url: '/ai-analysis/comprehensive', method: 'GET', params });
}

export function getGrowthPlan(params) {
  return request({ url: '/ai-analysis/growth-plan', method: 'GET', params });
}

// 生成分析报表（支持导出JSON或XLSX）
export function generateAIReport(params) {
  return request({ url: '/ai-analysis/report', method: 'GET', params });
}

// 导出分析报表为XLSX文件
export function exportAIReportXLSX(params) {
  return request({ url: '/ai-analysis/report', method: 'GET', params: { ...params, format: 'xlsx' }, responseType: 'blob' });
}
