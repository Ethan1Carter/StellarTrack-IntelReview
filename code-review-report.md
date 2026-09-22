# 全栈代码审视报告
**项目**：星轨智评 · 高校五育综合评价平台（student-assessment-web）
**审查范围**：根前端 `src/`（83 文件）· `client/` 前端（23 文件）· `server/` 后端（187 文件）
**审查重点**：代码质量 + 潜在 Bug + 安全红线（只读静态审查 + 关键路径精读）
**审查方**：主理人齐活林（软件开发团队）— 因运行环境无 TeamCreate 工具，由主理人直接以「检索 + 精读」完成，等效于分派审查员。

> 严重度：🔴 严重（功能失效/安全漏洞）｜🟠 较重（明显 bug/质量硬伤）｜🟡 一般（可维护性/小问题）

---

## 一、TL;DR

后端**结构清晰、ORM 参数化做得好、错误处理规范**；但存在 **3 个高危安全问题**（JWT 兜底密钥、任意文件写入/路径穿越、token 落 localStorage 叠加 XSS），**投产前必须修复**。
前端整体可运行，路由守卫与请求层封装良好；存在 XSS 与 token 存储隐患。
`client/` 与根前端为重复/分叉工程，**建议合并**。

---

## 二、安全红线（最优先）

### 🔴 1. JWT 密钥硬编码兜底
`server/config/index.js:26`
```js
secret: process.env.JWT_SECRET || 'xian_wenli_student_assessment_secret_key_2024',
```
一旦 `JWT_SECRET` 环境变量缺失（开发/测试/部署遗漏），即用**可预测的字符串**签名 token，攻击者可自行签发 `school_admin`/`developer` 令牌。**当前 `server/.env` 虽已设置，但该兜底必须移除。**
**修复**：生产环境缺失 `JWT_SECRET` 直接 `throw` 启动失败；开发环境可用随机生成并写入 `.env`。

### 🔴 2. 任意文件写入 / 路径穿越（用 `originalname` 拼路径）
- `server/routes/backups.js:106`：`fileName = req.file.originalname`，随后 `path.join(BACKUP_DIR, fileName)`。若上传文件名含 `../` 即可写出 `BACKUP_DIR` 之外。
- `server/routes/colleges.js:20`：`filename: (req,file,cb)=>cb(null, 'college_'+Date.now()+'_'+file.originalname)` —— 自带 multer **无 fileFilter**，接受任意类型，且文件名直接拼接 `originalname`，同样存在穿越。
**修复**：一律使用服务端生成的随机名（参考 `middleware/upload.js` 的写法），对 `originalname` 先 `path.basename()` 并拒绝含 `/`、`\` 的名称。

### 🔴 3. Token 持久化到 localStorage + v-html XSS → 账号劫持链
- `src/stores/user.js:124-126`：`persist: { paths: ['token', ...] }`，`pinia-plugin-persistedstate` 默认落 **localStorage**。JWT 可被任意 JS 读取。
- `src/views/notice/Index.vue:55`：`v-html="cur.content"`；`src/views/manage/Notices.vue:11`：`v-html="row.content"`。公告内容由富文本编辑器产生，若未清洗即入库，构成**存储型 XSS**，面向全体学生。
**组合风险**：XSS 脚本读取 localStorage 中的 token → 伪造请求 → 账号接管。
**修复**：token 不持久化（仅内存态，刷新走 `/auth/me` 续期，已有该逻辑）；或改后端 httpOnly Cookie。`v-html` 渲染前用 `DOMPurify` 清洗（或后端清洗后存储）。

### 🟠 4. CORS `origin: true` + `credentials: true`
`server/app.js:27-31`。`origin: true` 反射任意来源，配合 `credentials: true` 属反模式。虽本项目用 Bearer 头（非 Cookie）使 CSRF 风险有限，但仍会向任意站点泄露响应数据。
**修复**：`origin` 改为前端域名白名单数组。

### 🟠 5. 生产环境泄露 `err.message`
`server/middleware/errorHandler.js:92-94`：生产分支返回 `err.message`（DB 错误、文件路径等内部信息）。
**修复**：生产统一返回「服务器内部错误，请稍后重试」，仅保留 `code`/`timestamp`。

### 🟠 6. multer 1.x 已弃用且存在已知漏洞
`server/package-lock.json` 明确标注：`Multer 1.x is impacted by a number of vulnerabilities, which have been patched in 2.x`。
**修复**：升级到 `multer@^2`（API 基本兼容，注意 `fileFilter`/`limits` 行为）。

### 🟠 7. 批量导入默认密码 `123456`
`server/config/index.js:41`：`defaultPassword: process.env.DEFAULT_PASSWORD || '123456'`。
**修复**：导入后强制首次登录改密；或在导入时生成随机密码并通知。

### 🟡 8. token 经 Query 传递
`server/middleware/auth.js:13`：`req.query.token` 也接受 token，易经日志/Referer 泄露。
**修复**：仅接受 `Authorization: Bearer` 头。

### 🟡 9. `.env` 含真实密钥且无 `.gitignore`
工作区存在 `server/.env`（含 JWT_SECRET、DB_PASSWORD 等真实值），且当前**无 `.gitignore`、非 git 仓库**。一旦 `git init` 并提交，密钥即泄露。
**修复**：建立 `.gitignore` 忽略 `.env`、`.env.*`、`node_modules`、`dist`、`uploads`；确认密钥永不上库。

---

## 三、潜在 Bug 与质量

### 后端
- **功能 Bug**：`backups.js:103,106` 上传备份用 image multer（仅允许 图片/PDF），却期望 `.sql`，导致「上传备份」功能实际不可用；同时 `restore` 用 `psql -f` 执行上传 SQL（`backups.js:191-197`），设计上可在权限内执行任意 SQL。
- ** colleges.js 自带 multer 无 fileFilter**（`colleges.js:17-23`），接受任意文件类型。
- **上传目录不统一**：`middleware/upload.js` 用 `server/uploads`，`colleges.js` 用根 `uploads`，易混乱。
- **exec 拼接密码进 shell**（`backups.js:44-53`）：变量均来自配置而非用户输入，但密码含特殊字符仍有破坏命令风险；建议用 `pg_dump` 的 `--dbname`/环境变量方式，避免字符串拼 shell。

### 前端
- **静默吞错**：`src/utils/request.js:64`、`src/stores/user.js:109`、`src/views/application/MyList.vue:525` 多处 `.catch(()=>{})`，失败时无任何提示，难排查。
- **路由守卫过重**：`src/router/index.js:196-295` 含重试/多分支，可维护性一般，建议抽成独立 `permission` 模块。
- **废弃 API**：`src/views/manage/Notices.vue:67-79` 用 `document.execCommand` 做富文本（已废弃）。
- **散落重复**：多视图表格/表单/分页模式存在复制粘贴（已有 `Pagination` 组件但仍散落）。

### client/ 重复工程
`client/src`（23 文件）与根 `src/` 大量功能重叠（application/dashboard/login/module/user/approval…），属**分叉前端**，维护双倍成本、易功能不一致。
**建议**：合并为单一前端工程，或明确两者职责边界（如一个面向学生、一个面向管理）并抽取共享层。

---

## 四、亮点（做得好的）
- ✅ 后端 ORM **全参数化查询**，路由层未见 SQL 注入；`sequelize.query` 仅出现在 `scripts/` 迁移脚本。
- ✅ `auth` 中间件角色分层清晰，`developer → super_admin` 映射合理。
- ✅ `errorHandler` 结构规范，细分 Sequelize / JWT / Multer 错误。
- ✅ `BaseChart.vue` 在 `onUnmounted` 调 `chart.dispose()`，无 ECharts 内存泄漏。
- ✅ `request.js` 拦截器完善（NProgress、blob 处理、`__suppressMsg` 消息抑制）。
- ✅ `formulaParser.js` 显式避免 `eval`/`new Function`。
- ✅ 路由守卫具备角色校验（纵深防御）。

---

## 五、优先修复 Top 8（按风险）
1. 移除 JWT 硬编码兜底，生产缺失 `JWT_SECRET` 直接启动失败。
2. 上传文件名一律服务端生成（`path.basename`+随机），禁拼 `originalname`，修复路径穿越。
3. token 不持久化到 localStorage（改内存态或 httpOnly Cookie）。
4. `v-html` 渲染前用 DOMPurify 清洗（或后端清洗后存储）。
5. CORS 改为前端域名白名单。
6. `errorHandler` 生产返回通用错误，不回显 `err.message`。
7. multer 升级到 2.x。
8. 批量导入强制首次登录改密（替换默认 `123456`）。

---

## 六、下一步建议
- 合并 `client/` 与根前端，明确单一工程。
- 引入 ESLint + 针对 auth/权限/上传的关键路径单测。
- 建立 `.gitignore`，确认 `.env` 不上库；将密钥迁至环境变量/密钥管理。
- 对公告/富文本类内容的存储与渲染统一做清洗管线。
