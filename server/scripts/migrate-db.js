const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function argumentsFor(argv) {
  const args = { apply: false, check: false, maintenanceConfirmed: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = true;
    else if (flag === '--check') args.check = true;
    else if (flag === '--maintenance-confirmed') args.maintenanceConfirmed = true;
    else if (flag === '--confirm-database' && argv[i + 1] && !argv[i + 1].startsWith('--')) args.confirmDatabase = argv[++i];
    else throw new Error('未知或缺少参数：' + flag);
  }
  if (args.apply && args.check) throw new Error('--apply 与 --check 不能同时使用');
  if (args.apply && !args.confirmDatabase) throw new Error('执行升级必须显式传入 --confirm-database <库名>');
  return args;
}
async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const config = require('../config');
  const { sequelize } = require('../config/db');
  const { upgradeDatabase } = require('../services/schemaMigrations');
  try {
    const result = await upgradeDatabase(sequelize, { ...args, connection: { host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password }, backupDirectory: path.resolve(__dirname, '..', config.backup.dir) });
    console.log(JSON.stringify(result, null, 2));
    if ((args.check || args.apply) && !result.ready) process.exitCode = 1;
  } finally { await sequelize.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { argumentsFor };
