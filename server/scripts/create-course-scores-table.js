/**
 * 创建 course_scores 表（课程成绩 - 智育成绩）
 * 一次性运行脚本
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sequelize } = require('../models');

async function createCourseScoresTable() {
  console.log('[开始] 创建 course_scores 表...');

  const sql = `
    CREATE TABLE IF NOT EXISTS public.course_scores (
      id                 SERIAL         NOT NULL,
      student_id         INTEGER        NOT NULL,
      class_id           INTEGER,
      college_id         INTEGER,
      academic_year      VARCHAR(20)    NOT NULL,
      semester           VARCHAR(20)    NOT NULL,
      course_name        VARCHAR(100)   NOT NULL,
      course_code        VARCHAR(50),
      credit             DECIMAL(5,1)   NOT NULL DEFAULT 0,
      score              DECIMAL(6,2)   NOT NULL,
      score_type         VARCHAR(20)    NOT NULL DEFAULT 'number',
      category           VARCHAR(30)    NOT NULL DEFAULT 'required',
      import_batch       VARCHAR(50),
      created_by         INTEGER,
      remark             VARCHAR(200),
      created_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pk_course_scores PRIMARY KEY (id)
    );

    CREATE INDEX IF NOT EXISTS ix_course_scores_stu_year_sem_course
      ON public.course_scores (student_id, academic_year, semester, course_name);

    CREATE INDEX IF NOT EXISTS ix_course_scores_class_year_sem
      ON public.course_scores (class_id, academic_year, semester);

    CREATE INDEX IF NOT EXISTS ix_course_scores_batch
      ON public.course_scores (import_batch);

    COMMENT ON TABLE  public.course_scores              IS '课程成绩表（智育成绩）';
    COMMENT ON COLUMN public.course_scores.id           IS '成绩ID';
    COMMENT ON COLUMN public.course_scores.student_id   IS '学生ID';
    COMMENT ON COLUMN public.course_scores.class_id     IS '班级ID';
    COMMENT ON COLUMN public.course_scores.college_id   IS '院系ID';
    COMMENT ON COLUMN public.course_scores.academic_year IS '学年';
    COMMENT ON COLUMN public.course_scores.semester     IS '学期';
    COMMENT ON COLUMN public.course_scores.course_name  IS '课程名称';
    COMMENT ON COLUMN public.course_scores.course_code  IS '课程代码';
    COMMENT ON COLUMN public.course_scores.credit       IS '学分';
    COMMENT ON COLUMN public.course_scores.score        IS '课程成绩';
    COMMENT ON COLUMN public.course_scores.score_type   IS '成绩类型：number(数字)/level(等级)';
    COMMENT ON COLUMN public.course_scores.category     IS '课程性质：required(必修)/elective(选修)/public(公共)';
    COMMENT ON COLUMN public.course_scores.import_batch IS '导入批次号';
    COMMENT ON COLUMN public.course_scores.created_by   IS '创建人ID（导入操作人）';
    COMMENT ON COLUMN public.course_scores.remark       IS '备注';
  `;

  await sequelize.query(sql);
  console.log('[完成] course_scores 表创建成功');
}

createCourseScoresTable()
  .then(() => {
    console.log('[退出] 脚本执行完毕');
    process.exit(0);
  })
  .catch(err => {
    console.error('[失败]', err.message);
    console.error(err.stack);
    process.exit(1);
  });
