/**
 * 星轨智评 · 高校五育综合评价平台
 * 后端服务入口文件
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { sequelize, testConnection } = require('./config/db');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { responseEnhancer } = require('./middleware/responseEnhancer');
const { requestLogger } = require('./middleware/logger');
const routes = require('./routes');

// 确保上传和备份目录存在
const uploadDir = path.resolve(__dirname, config.upload.dir);
const backupDir = path.resolve(__dirname, config.backup.dir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const app = express();

// 基础中间件
app.use(cors({
  origin(origin, callback) {
    const allowed = !origin
      || config.cors.origins.includes('*')
      || config.cors.origins.includes(origin);
    callback(null, allowed);
  },
  credentials: true,
  maxAge: 86400
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 统一响应增强中间件（必须在路由前）
app.use(responseEnhancer);
app.use(requestLogger);

// 静态文件：上传的图片
const { mediaAuth, attachScope, attachmentAccess } = require('./middleware/attachmentAccess');
app.use('/uploads', mediaAuth, attachScope, attachmentAccess);

// 健康检查（无需鉴权）
app.get('/api/health', (req, res) => {
  res.success({
    name: `${config.branding.appName} · ${config.branding.institutionName}`,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: config.nodeEnv
  });
});

// 业务路由
app.use('/api', routes);

// 404 与全局错误处理（必须在路由后）
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = config.port;
const HOST = config.host;

// 启动只读检查结构，升级由维护入口显式执行。
async function bootstrap() {
  try {
    await testConnection();
    console.log('[数据库] 连接成功');

    const schemaStatus = await require('./services/schemaMigrations').assertRuntimeSchema(sequelize);
    if (schemaStatus && !schemaStatus.ready) {
      console.warn('[数据库] 现有结构可用但尚未登记统一版本；请在维护窗口执行 db:upgrade 接管版本记录。');
    }

    app.listen(PORT, HOST, () => {
      console.log(`
╔══════════════════════════════════════════════════════════╗
║  ${config.branding.appName} · ${config.branding.institutionName} - 后端服务
╠══════════════════════════════════════════════════════════╣
║  服务地址: http://${HOST}:${PORT}                              ║
║  健康检查: http://${HOST}:${PORT}/api/health                   ║
║  环境: ${config.nodeEnv}                                          ║
║  启动时间: ${new Date().toLocaleString('zh-CN')}                     ║
╚══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('[启动失败]', err.message);
    process.exit(1);
  }
}

bootstrap();
