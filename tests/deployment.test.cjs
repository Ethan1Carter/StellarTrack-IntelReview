const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('部署清单只保留环境示例，不包含配置备份、用户材料或密钥文件', { skip: process.platform !== 'win32' }, () => {
  const project = path.resolve(__dirname, '..');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'deploy/package-test.ps1'), '-ListOnly'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const files = result.stdout.trim().split(/\r?\n/).map(item => item.replace(/\\/g, '/'));
  assert.ok(files.includes('server/.env.example'));
  assert.ok(files.includes('server/package-lock.json'));
  assert.ok(files.includes('server/scripts/init-pg.sql'));
  for (const file of ['001-core.sql', '002-growth.sql', '003-guidance.sql', 'schema-contract.json']) assert.ok(files.includes('server/migrations/' + file));
  assert.ok(files.includes('server/scripts/migrate-db.js'));
  for (const file of files) {
    if (path.posix.basename(file).startsWith('.env')) assert.equal(path.posix.basename(file), '.env.example');
    assert.ok(!/(^|\/)(uploads|backups|node_modules|\.git|\.ssh|\.aws|\.serena)\//.test(file));
    assert.ok(!/\.(pem|key|pfx|dump|backup)$/.test(file));
  }
});

test('写数据库的旧测试必须显式使用测试库，缺少配置时立即拒绝', () => {
  const result = spawnSync(process.execPath, ['server/scripts/test-evaluation.js'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', ALLOW_DB_TEST_WRITES: '', DB_NAME: '' }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ALLOW_DB_TEST_WRITES/);
});
