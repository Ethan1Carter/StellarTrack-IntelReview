/**
 * 补充迁移2：创建 score_summaries 表（简化UNIQUE约束） + 若无加分模块则插入示例加分模块
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/db');

async function addColumnSafe(sql) {
  try { await sequelize.query(sql); console.log('✓ OK  :', sql.slice(0, 70)); }
  catch (e) {
    const code = e.original?.code || e.code;
    if (['42701', '42P07', '23505', '42P16'].includes(code)) console.log('skip（已存在）:', sql.slice(0, 60));
    else console.warn('WARN:', sql.slice(0, 70), '→', e.message);
  }
}

async function run() {
  await sequelize.authenticate();

  // 0. 补齐 applications 可能缺失的新列（event_date / certificate_no / attach_photos / total_levels 等）
  console.log('\n----- 补齐 applications 新列 -----');
  const appCols = [
    ['event_date', 'DATE'],
    ['certificate_no', 'VARCHAR(200)'],
    ['attach_photos', 'JSONB'],
    ['total_levels', 'INTEGER NOT NULL DEFAULT 2'],
    ['reject_reason', 'TEXT'],
    ['academic_year', 'VARCHAR(20)'],
    ['semester', "VARCHAR(20) CHECK (semester IN ('first','second'))"],
    ['submitted_at', 'TIMESTAMP'],
    ['approved_at', 'TIMESTAMP'],
    ['resubmit_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['status', "VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approving','approved','rejected','revoked','returned'))"]
  ];
  for (const [col, type] of appCols) {
    try {
      await sequelize.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      console.log('✓ + applications.' + col);
    } catch (e) {
      const code = e.original?.code || e.code;
      if (['42701', '23505'].includes(code)) console.log('skip applications.' + col + '（已存在）');
      else console.warn('WARN applications.' + col, e.message);
    }
  }

  // 1. score_summaries 表（去掉 UNIQUE 里的 COALESCE，改为普通索引代替）
  await addColumnSafe(`CREATE TABLE IF NOT EXISTS score_summaries (
    id BIGSERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL,
    academic_year VARCHAR(20) NOT NULL,
    semester VARCHAR(10),
    category VARCHAR(30) NOT NULL,
    module_id INTEGER,
    total_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    pass_count INTEGER NOT NULL DEFAULT 0,
    level_1_count INTEGER NOT NULL DEFAULT 0,
    level_2_count INTEGER NOT NULL DEFAULT 0,
    level_3_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  try {
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_score_summaries_key ON score_summaries (student_id, academic_year, COALESCE(semester,''), category, COALESCE(module_id,0))`);
    console.log('✓ UNIQUE index 已创建（score_summaries）');
  } catch (e) { console.warn('skip unique idx:', e.message); }

  // 2. 检查 bonus_modules 是否有记录，若无则插入示例模块
  const [rows] = await sequelize.query(`SELECT COUNT(*)::int c FROM bonus_modules`);
  if (rows[0].c === 0) {
    console.log('bonus_modules 为空，正在插入示例加分模块（9 大类）...');
    const demoMods = [
      { name: '学业成绩', code: 'academy', category: 'academy', color: '#409EFF', desc: '学业成绩相关加分类别' },
      { name: '思想品德', code: 'morality', category: 'morality', color: '#67C23A', desc: '思想品德、好人好事、表扬奖励等加分' },
      { name: '文体活动', code: 'sports', category: 'sports', color: '#E6A23C', desc: '体育、文艺、竞赛等活动加分' },
      { name: '学科竞赛', code: 'competition', category: 'competition', color: '#F56C6C', desc: '各学科、技能竞赛获奖加分', singleMax: 15 },
      { name: '志愿服务', code: 'volunteer', category: 'volunteer', color: '#909399', desc: '志愿服务、社会公益等加分' },
      { name: '创新创业', code: 'innovation', category: 'innovation', color: '#9b59b6', desc: '创业训练、创新创业大赛等加分' },
      { name: '奖学金获奖', code: 'scholarship', category: 'scholarship', color: '#1abc9c', desc: '各类奖学金获奖加分' },
      { name: '考勤表现', code: 'attendance', category: 'attendance', color: '#34495e', desc: '班级考勤、早晚自习等表现加分' },
      { name: '其他项目', code: 'other', category: 'other', color: '#7f8c8d', desc: '其他未分类加分项' }
    ];
    for (const m of demoMods) {
      await sequelize.query(`
        INSERT INTO bonus_modules (name, code, category, description, rule_description, single_max_score, yearly_max_score, yearly_max_count, apply_scope, require_photo, min_photo_count, require_description, require_certificate_no, is_required, color, icon, status, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'all', true, 1, true, false, false, ?, ?, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, { replacements: [
        m.name, m.code, m.category, m.desc, m.desc + '，具体标准见学生手册。',
        m.singleMax || 10, m.singleMax === 15 ? 80 : 50, m.singleMax === 15 ? 20 : 10,
        m.color, m.code.toUpperCase().slice(0, 2)
      ] });
      console.log('  +', m.name);
    }
    console.log('✅ 已插入示例加分模块');
  } else {
    console.log(`bonus_modules 已有 ${rows[0].c} 条记录，跳过示例模块插入`);
  }

  console.log('\n✅ 补充迁移完成');
  process.exit(0);
}
run().catch(e => { console.error('❌', e); process.exit(1); });
