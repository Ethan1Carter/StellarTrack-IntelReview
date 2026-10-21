const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { argumentsFor } = require('../scripts/migrate-db');
const { migrations } = require('../services/schemaMigrations');

test('升级入口默认只读，缺少目标确认或参数冲突会拒绝', () => {
  assert.equal(argumentsFor([]).apply, false);
  assert.equal(argumentsFor(['--check']).check, true);
  assert.throws(() => argumentsFor(['--apply']), /confirm-database/);
  assert.throws(() => argumentsFor(['--apply', '--check', '--confirm-database', 'example']), /不能同时/);
  assert.throws(() => argumentsFor(['--confirm-database']), /缺少参数/);
  assert.throws(() => argumentsFor(['--force']), /未知/);
});
test('升级脚本不创建默认账号或演示数据，核心快照不混入后续功能表', () => {
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(migration.sql, /\b(?:INSERT\s+INTO|COPY\s|DROP\s+TABLE|TRUNCATE\s)/i);
    assert.doesNotMatch(migration.sql, /^\\/m);
  }
  assert.doesNotMatch(migrations[0].sql, /growth_plans|guidance_resources/);
});
test('真实数据库验收缺少隔离标志时在连接之前拒绝', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/test-workflow-db.js')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /isolated-database/);
});
