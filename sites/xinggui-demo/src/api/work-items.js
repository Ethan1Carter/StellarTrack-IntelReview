import request from '@/utils/request';
export const getWorkItems=()=>request({url:'/work-items',method:'GET'});
