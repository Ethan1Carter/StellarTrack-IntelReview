import request from '@/utils/request';
export const queryRuleGuide = question => request({ url: '/rule-guide', method: 'GET', params: { question } });
