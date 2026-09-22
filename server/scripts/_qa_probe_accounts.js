/**
 * QA 探针（只读）：盘点真实账号 / 院系 / 班级 / 申报数据，为端到端越权断言准备素材。
 * 不写库。raw SQL 使用真实列名（snake_case）。
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

const Q = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });

(async () => {
  try {
    await sequelize.authenticate();
    console.log('[DB] connected\n');

    // ---- 3. 有学生的班级（不同院系）----
    console.log('=== 3. 有>=3名学生的班级 ===');
    const clsRows = await Q(`
      SELECT c.id AS class_id, c.name AS class_name, c.college_id,
             c.class_admin_id, c.counselor_id, count(u.id)::int AS stu_cnt
      FROM classes c JOIN users u ON u.class_id = c.id AND u.role = 'student' AND u.status='active'
      GROUP BY c.id, c.name, c.college_id, c.class_admin_id, c.counselor_id
      HAVING count(u.id) >= 3 ORDER BY c.id LIMIT 25`);
    console.table(clsRows);

    // ---- 4. 数据存量 ----
    console.log('\n=== 4. 数据存量 ===');
    console.log('   applications:', JSON.stringify((await Q(`SELECT count(*)::int c FROM applications`))[0]));
    console.table(await Q(`SELECT status, count(*)::int c FROM applications GROUP BY status ORDER BY c DESC`));
    console.log('   bonus_claims:');
    console.table(await Q(`SELECT status, count(*)::int c FROM bonus_claims GROUP BY status ORDER BY c DESC`));
    console.log('   score_summaries:', JSON.stringify((await Q(`SELECT count(*)::int c FROM score_summaries`))[0]));

    // ---- 5. 有 approved 申报的学生 ----
    console.log('\n=== 5. 有 approved/final_review 申报的学生（前10）===');
    console.table(await Q(`
      SELECT a.student_id AS sid, u.username, u.real_name, u.class_id, u.college_id,
             count(*)::int AS app_cnt, COALESCE(sum(a.final_score),0)::float AS sum_score
      FROM applications a JOIN users u ON u.id = a.student_id
      WHERE a.status IN ('approved','final_review') AND a.deleted_at IS NULL
      GROUP BY a.student_id, u.username, u.real_name, u.class_id, u.college_id
      ORDER BY app_cnt DESC LIMIT 10`));

    // ---- 6. bonus_claims 近期 ----
    console.log('\n=== 6. bonus_claims 近期10条 ===');
    console.table(await Q(`
      SELECT id, student_id, pillar, score, final_score, status, academic_year, semester, class_id
      FROM bonus_claims ORDER BY id DESC LIMIT 10`));

    // ---- 7. 学期 ----
    console.log('\n=== 7. 学期 ===');
    console.table(await Q(`SELECT id, academic_year, semester, name, status, college_id FROM semesters ORDER BY id DESC LIMIT 8`));

    // ---- 8. 辅导员 -> 班级 ----
    console.log('\n=== 8. 辅导员与管辖班级（前15）===');
    console.table((await Q(`
      SELECT c.counselor_id AS cid, u.username, count(*)::int AS cls_cnt,
             array_agg(c.id ORDER BY c.id) AS class_ids
      FROM classes c JOIN users u ON u.id = c.counselor_id
      GROUP BY c.counselor_id, u.username ORDER BY cls_cnt DESC LIMIT 15`))
      .map(r => ({ ...r, class_ids: String(r.class_ids || '').slice(0, 70) })));

    // ---- 9. 班管 -> 班级 ----
    console.log('\n=== 9. 班级管理员与管辖班级（前15）===');
    console.table((await Q(`
      SELECT c.class_admin_id AS aid, u.username, count(*)::int AS cls_cnt,
             array_agg(c.id ORDER BY c.id) AS class_ids
      FROM classes c JOIN users u ON u.id = c.class_admin_id
      GROUP BY c.class_admin_id, u.username ORDER BY cls_cnt DESC LIMIT 15`))
      .map(r => ({ ...r, class_ids: String(r.class_ids || '').slice(0, 70) })));

    // ---- 10. 重点账号的 scope 输入 ----
    console.log('\n=== 10. 重点账号 ===');
    console.table(await Q(`
      SELECT id, username, real_name, role, college_id, class_id, status
      FROM users WHERE username IN
      ('dzxxgc001','dzxxgc002','zsxy001','xawlxy003','admin','superadmin','developer','overstep_final_01039163')
      ORDER BY id`));

    // ---- 11. 班级 16 的同学（用于"他人 studentId"）----
    console.log('\n=== 11. class_id=16 的学生（前10）===');
    console.table(await Q(`
      SELECT id, username, real_name, college_id, class_id FROM users
      WHERE class_id = 16 AND role='student' AND status='active' ORDER BY id LIMIT 10`));

    // ---- 12. 其他院系班级（用于越权目标）----
    console.log('\n=== 12. 非 college_id=8 且有学生的班级 ===');
    console.table(await Q(`
      SELECT c.id AS class_id, c.name, c.college_id, count(u.id)::int AS stu_cnt
      FROM classes c JOIN users u ON u.class_id=c.id AND u.role='student'
      WHERE c.college_id <> 8 GROUP BY c.id, c.name, c.college_id
      HAVING count(u.id)>=3 ORDER BY c.id LIMIT 10`));

    // ---- 13. 有 pending bonus_claim 的学生 ----
    console.log('\n=== 13. pending bonus_claims（前10）===');
    console.table(await Q(`
      SELECT id, student_id, pillar, score, status, academic_year, semester, class_id, class_admin_id
      FROM bonus_claims WHERE status='pending' ORDER BY id DESC LIMIT 10`));

    // ---- 14. 有 course_scores 数据？ ----
    try {
      console.log('\n=== 14. course_scores ===');
      console.log('   count:', JSON.stringify((await Q(`SELECT count(*)::int c FROM course_scores`))[0]));
      console.table(await Q(`SELECT * FROM course_scores LIMIT 3`));
    } catch (e) { console.log('   (无表或查询失败:', e.message, ')'); }

    process.exit(0);
  } catch (err) {
    console.error('[FATAL]', err.message);
    if (err.sql) console.error(err.sql);
    process.exit(1);
  }
})();
