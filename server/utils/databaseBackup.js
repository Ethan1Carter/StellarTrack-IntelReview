const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { AppError } = require('../middleware/errorHandler');

function databaseCommand(config, filePath, restore = false) {
  const dialect = config.db.dialect.toLowerCase();
  const { host, port, user, name, password } = config.db;
  const env = { ...process.env };
  if (dialect === 'mysql') {
    env.MYSQL_PWD = password || '';
    const args = ['--host', String(host), '--port', String(port), '--user', String(user), '--default-character-set=utf8mb4'];
    if (restore && path.extname(filePath).toLowerCase() !== '.sql') throw new AppError('MySQL 仅支持恢复 SQL 文件', 400);
    return { command: restore ? 'mysql' : 'mysqldump', args: [...args, String(name)], env, stdin: restore, stdout: !restore };
  }
  if (dialect !== 'postgres') throw new AppError('当前数据库不支持此备份方式', 400);
  env.PGPASSWORD = password || '';
  const args = ['-h', String(host), '-p', String(port), '-U', String(user), '-d', String(name)];
  if (!restore) return { command: 'pg_dump', args: [...args, '-F', 'p', '-b', '--clean', '--if-exists', '--no-owner', '--no-privileges', '--inserts', '-f', filePath], env };
  if (path.extname(filePath).toLowerCase() === '.sql') {
    return { command: config.backup.psqlPath || 'psql', args: [...args, '-X', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '-f', filePath], env };
  }
  return { command: config.backup.pgRestorePath || 'pg_restore', args: [...args, '--exit-on-error', '--single-transaction', '--clean', '--if-exists', filePath], env };
}

async function runDatabaseCommand(config, filePath, restore = false) {
  const spec = databaseCommand(config, filePath, restore);
  const child = spawn(spec.command, spec.args, { env: spec.env, shell: false, windowsHide: true,
    timeout: 10 * 60 * 1000, stdio: [spec.stdin ? 'pipe' : 'ignore', spec.stdout ? 'pipe' : 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
  const completion = new Promise((resolve, reject) => {
    child.on('error', () => reject(new Error(`无法运行 ${spec.command}，请检查数据库客户端是否已安装`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${spec.command} 执行失败（${code}）：${stderr}`)));
  });
  const transfers = [];
  if (spec.stdin) transfers.push(pipeline(fs.createReadStream(filePath), child.stdin));
  if (spec.stdout) transfers.push(pipeline(child.stdout, fs.createWriteStream(filePath, { flags: 'wx' })));
  try { await Promise.all([completion, ...transfers]); }
  catch (error) { child.kill(); throw error; }
}

module.exports = { databaseCommand, runDatabaseCommand };
