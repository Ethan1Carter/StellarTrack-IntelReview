/**
 * 终极诊断：脱离 HTTP，直接 require Models 模拟并发 30 User.create
 * 这能 100% 看出到底哪里冲突、重试为什么没生效
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { User, sequelize } = require('../models');
const { generateUserId, getNextUserSeq, padZero, hashPassword } = require('../utils');

async function buildUniqueId(data) {
  const config = require('../config');
  const schoolCode = padZero((config.idGen && config.idGen.schoolCode) || 1, 2);
  const collegeCode = padZero((data.collegeId || 0) % 100, 2);
  const classCode = padZero((data.classId || 0) % 100, 2);
  const prefix = `${schoolCode}${collegeCode}${classCode}`;
  let seq = await getNextUserSeq(User, prefix);
  let uniqueOk = false;
  let candidate = null;
  for (let retry = 0; retry < 30 && !uniqueOk; retry++) {
    candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, seq);
    const exists = await User.findOne({ where: { uniqueId: candidate }, attributes: ['id'], raw: true });
    if (!exists) uniqueOk = true;
    else seq += 10000 + Math.floor(Math.random() * 90000);
  }
  if (!candidate || !uniqueOk) {
    const fallbackSeq = Math.floor((Date.now() * 7 + process.pid * 13 + Math.random() * 999999) % 900000) + 100000;
    candidate = generateUserId({ collegeId: data.collegeId, classId: data.classId }, fallbackSeq);
  }
  return candidate;
}

async function createOne(data, idx) {
  let user = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if (!data.uniqueId) data.uniqueId = await buildUniqueId(data);
      console.log(`  [${idx}] attempt=${attempt}, uniqueId=${data.uniqueId}`);
      user = await User.create(data);
      lastErr = null;
      console.log(`  [${idx}] ✓ SUCCESS id=${user.id}`);
      break;
    } catch (createErr) {
      lastErr = createErr;
      console.log(`  [${idx}] attempt=${attempt} FAIL name=${createErr.name} code=${createErr.code||'-'} parent.code=${createErr.parent && createErr.parent.code} msg=${String(createErr.message).slice(0,80)}`);
      data.uniqueId = null;
      await new Promise(r => setTimeout(r, 50 * attempt + Math.floor(Math.random() * 300)));
    }
  }
  return { ok: !!user, user, lastErr };
}

(async function main() {
  // 找一个班级
  const { Class } = require('../models');
  const cls = await Class.findOne({ order: [['id', 'DESC']], raw: true });
  console.log('Test Class:', { id: cls.id, collegeId: cls.collegeId });

  // 并发 30
  console.log('\n=== 并发 30 User.create 开始 ===');
  const tasks = [];
  for (let i = 0; i < 30; i++) {
    const idx = i;
    tasks.push(createOne({
      username: `TEST_DIRECT_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000000)}`,
      realName: `直测${idx}`, password: hashPassword('123456'),
      role: 'student', collegeId: cls.collegeId, classId: cls.id, gender: 'male', status: 'active'
    }, idx));
  }
  const res = await Promise.all(tasks);
  const succ = res.filter(r => r.ok).length;
  console.log(`\n=== 结果: ${succ}/30 (${(succ/30*100).toFixed(1)}%) ===`);
  const errs = {};
  for (const r of res) if (!r.ok) {
    const k = `${r.lastErr && r.lastErr.name}/${r.lastErr && r.lastErr.parent && r.lastErr.parent.code}/${String(r.lastErr && r.lastErr.message).slice(0,60)}`;
    errs[k] = (errs[k] || 0) + 1;
  }
  console.log('错误分布:', errs);
  process.exit(0);
})();
