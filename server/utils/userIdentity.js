/**
 * 用户只读唯一ID生成（共享工具）
 * ------------------------------------------------------------
 * 编码规则（共12位）：学校代码(2) + 学院ID后两位(2) + 班级ID后两位(2) + 全局流水号(6)
 * 例：01 08 25 000123
 *
 * 原先只在 routes/users.js 的"新增用户"里内联实现，
 * 注册系统同样需要发放唯一ID，故抽为单一实现。
 */
const { generateUserId, getNextUserSeq, padZero } = require('./index');

const MAX_UNIQUE_RETRY = 30;

/**
 * 生成一个未被占用的 12 位用户唯一ID
 * @param {{collegeId?:number|null, classId?:number|null}} opts
 * @returns {Promise<string>}
 */
const buildUserUniqueId = async (opts = {}) => {
  const { User } = require('../models');
  const collegeId = opts.collegeId || 0;
  const classId = opts.classId || 0;
  const schoolCode = padZero(1, 2);
  const prefix = `${schoolCode}${padZero(collegeId % 100, 2)}${padZero(classId % 100, 2)}`;

  let seq = await getNextUserSeq(User, prefix);
  let candidate = null;
  for (let retry = 0; retry < MAX_UNIQUE_RETRY; retry++) {
    candidate = generateUserId({ collegeId, classId }, seq);
    const exists = await User.findOne({ where: { uniqueId: candidate }, attributes: ['id'], raw: true });
    if (!exists) return candidate;
    // 冲突时大跨度跳步，避免热点窗口
    seq += 10000 + Math.floor(Math.random() * 90000);
    seq %= 1000000;
    if (seq < 100000) seq += 100000;
  }
  // 终极兜底：时间戳高熵混合
  const fallbackSeq = Math.floor((Date.now() * 7 + process.pid * 13 + Math.random() * 999999) % 900000) + 100000;
  return generateUserId({ collegeId, classId }, fallbackSeq);
};

module.exports = { buildUserUniqueId };
