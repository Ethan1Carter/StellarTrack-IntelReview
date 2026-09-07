# StellarTrack-IntelReview

星轨智评（XINGGUI）高校五育综合评价平台，包含 Vue 3 前端和 Express + Sequelize 后端服务。

## 技术栈

- 前端：Vue 3、Vite、Element Plus、Pinia、ECharts
- 后端：Node.js、Express、Sequelize、PostgreSQL

## 本地运行

```bash
npm install
npm run dev
```

后端依赖安装后，可在 `server` 目录运行：

```bash
npm install
npm start
```

请根据实际环境创建 `server/.env`，不要提交生产密钥或数据库凭据。前端环境变量示例见 `.env.development` 和 `.env.production`。
