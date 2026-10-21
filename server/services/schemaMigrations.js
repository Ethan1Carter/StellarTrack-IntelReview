const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { backupDatabase } = require('./databaseBackup');
const root = path.resolve(__dirname, '../migrations');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'schema-contract.json'), 'utf8'));
const additions = new Set(['growth_plans', 'guidance_resources']);
const definitions = [
  { id: '20261021_001', name: '核心结构基线', file: '001-core.sql', tables: [...new Set(contract.map(x => x.table_name))].filter(x => !additions.has(x)) },
  { id: '20261021_002', name: '成长行动计划', file: '002-growth.sql', tables: ['growth_plans'] },
  { id: '20261021_003', name: '制度与校园活动', file: '003-guidance.sql', tables: ['guidance_resources'] }
];
const migrations = definitions.map(item => {
  const columns = item.columns || contract.filter(x => item.tables.includes(x.table_name));
  const sql = fs.readFileSync(path.join(root, item.file), 'utf8').replace(/\r\n/g, '\n');
  return { ...item, columns, sql, checksum: crypto.createHash('sha256').update(JSON.stringify({ sql, columns, tables: item.tables, kind: item.kind || 'create' })).digest('hex') };
});
const compatibleType = (expected, actual) => {
  if (expected === actual) return true;
  return [['smallint', 'integer', 'bigint'], ['json', 'jsonb'], ['timestamp with time zone', 'timestamp without time zone']]
    .some(group => group.includes(expected) && group.includes(actual));
};
async function inspectDatabase(sequelize, { transaction, list = migrations } = {}) {
  const query = async (sql, options = {}) => (await sequelize.query(sql, { transaction, logging: false, ...options }))[0];
  const [identity] = await query('SELECT current_database() AS database');
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).map(x => x.tablename);
  const columns = await query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'");
  const byColumn = new Map(columns.map(x => [x.table_name + '.' + x.column_name, x]));
  const applied = tables.includes('schema_migrations') ? await query('SELECT id,checksum FROM public.schema_migrations ORDER BY id') : [];
  const issues = [], pending = [];
  let gap = false;
  for (const migration of list) {
    if (!applied.some(x => x.id === migration.id)) gap = true;
    else if (gap) issues.push(`升级记录顺序不完整：${migration.id} 之前存在未执行版本`);
  }
  for (const recorded of applied) {
    const known = list.find(x => x.id === recorded.id);
    if (!known) issues.push(`数据库含当前程序未知的升级版本 ${recorded.id}，请使用匹配版本的程序`);
    else if (known.checksum !== recorded.checksum) issues.push(`升级文件校验不符：${recorded.id}，禁止修改已执行版本`);
  }
  for (const migration of list) {
    const present = migration.tables.filter(x => tables.includes(x));
    const recorded = applied.some(x => x.id === migration.id);
    const verifyStructure = recorded || migration.kind !== 'change';
    if (verifyStructure && present.length && present.length !== migration.tables.length) issues.push(`${migration.name}结构不完整，缺表：${migration.tables.filter(x => !tables.includes(x)).join('、')}；需先按旧版本修复`);
    if (recorded && !present.length) issues.push(`已执行版本 ${migration.id} 的数据表丢失，拒绝自动重建以掩盖数据损失`);
    if (verifyStructure && present.length === migration.tables.length) for (const expected of migration.columns) {
      const key = expected.table_name + '.' + expected.column_name, actual = byColumn.get(key);
      if (!actual) issues.push(`缺少字段 ${key}；需先按历史版本补齐后再接管`);
      else if (!compatibleType(expected.data_type, actual.data_type)) issues.push(`字段类型不兼容 ${key}：${actual.data_type}`);
    }
    if (!recorded) pending.push({ id: migration.id, name: migration.name, action: migration.kind === 'change' ? 'apply' : present.length ? 'adopt' : 'create' });
  }
  // 这些唯一键是并发创建计划、发布版本的必要条件，不能仅凭字段齐全判定就绪。
  const indexes = await query("SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='public'");
  for (const [table, fields] of [['growth_plans', 'student_id,academic_year,semester'], ['guidance_resources', 'series_id,revision']]) {
    if (tables.includes(table) && !indexes.some(x => x.tablename === table && /CREATE UNIQUE INDEX/.test(x.indexdef) && x.indexdef.replace(/[\s\"]/g, '').includes('(' + fields + ')'))) issues.push(`缺少必要唯一索引：${table}(${fields})`);
  }
  const businessTables = tables.filter(x => x !== 'schema_migrations');
  if (businessTables.length && !list[0].tables.some(x => tables.includes(x))) issues.push('目标库并非空库且未识别到本项目核心表，拒绝初始化');
  return { database: identity.database, ready: pending.length === 0 && issues.length === 0, pending, issues, applied: applied.map(x => x.id), existingTables: businessTables.length };
}
async function upgradeDatabase(sequelize, options = {}) {
  if (sequelize.getDialect() !== 'postgres') throw new Error('统一版本升级目前仅支持 PostgreSQL；其他引擎请使用原维护流程');
  if (!options.apply) return inspectDatabase(sequelize, options);
  return sequelize.transaction(async transaction => {
    await sequelize.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'", { transaction });
    const [[lock]] = await sequelize.query('SELECT pg_try_advisory_xact_lock(742193,1) AS acquired', { transaction });
    if (!lock.acquired) throw new Error('另一进程正在升级数据库，请稍后重试');
    const before = await inspectDatabase(sequelize, { transaction, list: options.list });
    if (before.issues.length) throw new Error(before.issues.join('\n'));
    if (options.confirmDatabase !== before.database) throw new Error(`需要 --confirm-database ${before.database} 明确目标库`);
    if (!before.pending.length) return { ...before, executed: [], backup: null };
    if (before.existingTables && !options.maintenanceConfirmed) throw new Error('已有业务库需先停止业务写入，并显式传入 --maintenance-confirmed');
    const backupConnection = { host: sequelize.config.host, port: sequelize.config.port, user: sequelize.config.username, password: sequelize.config.password, database: before.database };
    const backup = before.existingTables ? backupDatabase(backupConnection, options.backupDirectory) : null;
    await sequelize.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (id varchar(40) PRIMARY KEY, name varchar(160) NOT NULL, checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)', { transaction });
    const executed = [];
    for (const pending of before.pending) {
      const migration = (options.list || migrations).find(x => x.id === pending.id);
      if (pending.action !== 'adopt') await sequelize.query(migration.sql, { transaction, logging: false });
      await sequelize.query('INSERT INTO public.schema_migrations(id,name,checksum) VALUES (:id,:name,:checksum)', { transaction, replacements: { id: migration.id, name: migration.name, checksum: migration.checksum } });
      executed.push(pending);
    }
    const after = await inspectDatabase(sequelize, { transaction, list: options.list });
    if (!after.ready) throw new Error(after.issues.join('\n') || '升级后版本仍未就绪');
    return { ...after, executed, backup };
  });
}
async function assertRuntimeSchema(sequelize) {
  if (sequelize.getDialect() !== 'postgres') return null;
  const status = await inspectDatabase(sequelize);
  if (status.issues.length || status.pending.some(x => x.action !== 'adopt')) {
    throw new Error('数据库结构未就绪，请先运行 npm run db:status 查看问题，并在备份及维护窗口内执行 db:upgrade。' + status.issues.join('；'));
  }
  return status;
}
module.exports = { migrations, inspectDatabase, upgradeDatabase, assertRuntimeSchema, compatibleType };
