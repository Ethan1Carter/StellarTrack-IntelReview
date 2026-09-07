/**
 * QA 一次性探针（只读）：为回归用例取素材。用完即删。
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

const Q = (sql, bind) => sequelize.query(sql, { bind, type: sequelize.QueryTypes.SELECT });
const show = (t, rows) => { console.log('\n=== ' + t + ' ==='); console.table(rows); };

(async () => {
  await sequelize.authenticate();

  show('1. 学期 applyStatus', await Q(
    `SELECT id, academic_year, semester, name, status, apply_status, college_id, college_ids FROM semesters ORDER BY id DESC`));

  show('2. dzxxgc002(id=93) ScoreSummary 基线', await Q(
    `SELECT id, student_id, class_id, college_id, academic_year, semester, total_score, application_count, category_scores
     FROM score_summaries WHERE student_id=93 ORDER BY id`));

  show('3. course_scores 分布', await Q(
    `SELECT class_id, count(*)::int c FROM course_scores GROUP BY class_id ORDER BY class_id LIMIT 20`));

  show('4. 非16班、且状态为 pending/approving 的申报（给班管越权用）', await Q(
    `SELECT a.id, a.student_id, a.class_id, a.college_id, a.status, a.final_score, u.username, u.real_name
     FROM applications a JOIN users u ON u.id=a.student_id
     WHERE a.class_id <> 16 AND a.deleted_at IS NULL AND a.status IN ('pending','approving','draft')
     ORDER BY a.id DESC LIMIT 15`));

  show('5. 16班的 pending/approving/draft 申报（并发审批素材）', await Q(
    `SELECT a.id, a.student_id, a.class_id, a.college_id, a.status, a.final_score, a.academic_year, a.semester, a.module_id, u.username
     FROM applications a JOIN users u ON u.id=a.student_id
     WHERE a.class_id = 16 AND a.deleted_at IS NULL AND a.status IN ('pending','approving','draft')
     ORDER BY a.id DESC LIMIT 15`));

  show('6. class16 其他学生（学生A看学生B用）', await Q(
    `SELECT id, username, real_name, class_id, college_id FROM users
     WHERE class_id=16 AND role='student' AND status='active' AND id<>93 ORDER BY id LIMIT 5`));

  show('7. 有 approved 申报的班级（非16班，越权目标班）', await Q(
    `SELECT s.class_id, count(*)::int c FROM score_summaries s WHERE s.class_id IS NOT NULL AND s.class_id<>16
     GROUP BY s.class_id ORDER BY c DESC LIMIT 10`));

  show('8. 院系列表', await Q(`SELECT id, name FROM colleges ORDER BY id LIMIT 30`));

  show('9. 各角色可用账号', await Q(
    `SELECT id, username, real_name, role, college_id, class_id, status FROM users
     WHERE role IN ('student','class_admin','counselor','college_admin','school_admin','super_admin','developer')
       AND status='active' AND id < 200 ORDER BY role, id`));

  show('10. counselor 82 所带班级', await Q(
    `SELECT id, name, college_id, counselor_id, class_admin_id FROM classes WHERE counselor_id=82`));

  show('11. college 8 的班级', await Q(
    `SELECT id, name, college_id, counselor_id, class_admin_id FROM classes WHERE college_id=8 ORDER BY id`));

  show('12. ScoreSummary 全体（看 ranking 同分场景）', await Q(
    `SELECT student_id, class_id, college_id, academic_year, semester, total_score FROM score_summaries
     ORDER BY academic_year, semester, total_score DESC LIMIT 40`));

  show('13. oplog 条数', await Q(`SELECT count(*)::int c FROM operation_logs`));

  show('14. dzxxgc002 的申报明细(id=93)', await Q(
    `SELECT id, student_id, status, final_score, academic_year, semester, module_id
     FROM applications WHERE student_id=93 AND deleted_at IS NULL ORDER BY id`));

  process.exit(0);
})().catch(e => { console.error('[FATAL]', e.message); if (e.sql) console.error(e.sql); process.exit(1); });
