// 仅由维护人员在获准升级的数据库上显式执行；应用启动不会调用此脚本。
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if(!process.argv.includes('--apply')){console.error('请在确认目标数据库与业务数据备份后，显式传入 --apply。此命令仅新增制度与活动资源表。');process.exitCode=1;}
else{const {sequelize,GuidanceResource}=require('../models');(async()=>{try{await GuidanceResource.sync({alter:false,force:false});console.log('制度与活动资源表已就绪；未插入示例数据。');}catch(error){console.error('创建资源表失败：'+error.message);process.exitCode=1;}finally{await sequelize.close();}})();}
