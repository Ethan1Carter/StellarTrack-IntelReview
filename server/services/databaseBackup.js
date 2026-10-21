const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function pgTool(name) {
  const explicit = process.env[name === 'pg_dump' ? 'PG_DUMP_PATH' : 'PG_RESTORE_PATH'];
  if (explicit) return explicit;
  if (process.platform === 'win32') {
    const root = path.join(process.env.ProgramFiles || 'C:/Program Files', 'PostgreSQL');
    if (fs.existsSync(root)) {
      const versions = fs.readdirSync(root).filter(x => /^\d+$/.test(x)).sort((a, b) => Number(b) - Number(a));
      for (const version of versions) { const executable = path.join(root, version, 'bin', name + '.exe'); if (fs.existsSync(executable)) return executable; }
    }
  }
  return name;
}
function pgCommand(tool, args, connection) {
  const result = spawnSync(pgTool(tool), args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...process.env, PGPASSWORD: connection.password || '', PGCONNECT_TIMEOUT: '15' } });
  if (result.error || result.status !== 0) throw new Error(`${tool} 执行失败，未继续升级。请检查 PostgreSQL 客户端版本、连接及目录权限。`);
  return result.stdout;
}
function connectionArgs(connection) {
  return ['--host', connection.host, '--port', String(connection.port), '--username', connection.user, '--no-password'];
}
function backupDatabase(connection, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = `before-upgrade-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}.dump`;
  const archive = path.join(directory, filename);
  fs.closeSync(fs.openSync(archive, 'wx', 0o600));
  pgCommand('pg_dump', [...connectionArgs(connection), '--format=custom', '--file', archive, connection.database], connection);
  const listing = pgCommand('pg_restore', ['--list', archive], connection);
  const database = listing.match(/^;\s+dbname: (.+)$/m)?.[1]?.trim();
  if (database !== connection.database || fs.statSync(archive).size < 32) throw new Error('备份数据库名称或归档校验不符，未继续升级');
  const hash = crypto.createHash('sha256'), block = Buffer.alloc(64 * 1024), descriptor = fs.openSync(archive, 'r');
  try { let count; while ((count = fs.readSync(descriptor, block, 0, block.length, null)) > 0) hash.update(block.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return { archive, bytes: fs.statSync(archive).size, sha256: hash.digest('hex'), database };
}
module.exports = { backupDatabase, pgCommand, connectionArgs };
