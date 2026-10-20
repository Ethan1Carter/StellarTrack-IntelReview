const express = require('express');
const router = express.Router();
const { User, Class, College, EvaluationConfig } = require('../models');
const { auth, requireStudent, requireAdmin, requireCollegeAbove, requireSchoolAdmin } = require('../middleware/auth');
const { assertStudentInScope, assertClassInScope, narrowCollegeIds } = require('../middleware/scope');
const { AppError } = require('../middleware/errorHandler');
const { Op } = require('sequelize');
const { calcEvaluation, buildEffectiveConfig, DEFAULT_FORMULAS } = require('../utils/evaluation');
const { validateFormula } = require('../utils/formulaParser');
const { resolveAcademicTerm, getClientIp } = require('../utils');
const { writeOperateLog } = require('../middleware/logger');

router.use(auth);

// ============================================================
// 综测公式配置管理（院级管理员及以上权限）
// ============================================================

/**
 * 解析当前用户的 collegeId（用于院级管理员）
 */
const parseId = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && typeof v.id !== 'undefined') return parseId(v.id);
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function resolveMyCollegeId(req) {
  const fromToken = parseId(req.user?.collegeId);
  if (fromToken != null) return fromToken;
  const latest = await User.findByPk(req.userId, { attributes: ['collegeId'], raw: true });
  return parseId(latest?.collegeId);
}

/**
 * GET /api/evaluation/config - 获取当前用户的综测公式配置
 * 院级管理员：返回本学院配置（如不存在返回默认配置）
 * 学校管理员/超级管理员：可通过 collegeId 查询指定学院的配置，不传则返回全局默认配置
 */
router.get('/config', requireCollegeAbove, async (req, res, next) => {
  try {
    const { collegeId: queryCollegeId } = req.query;
    const role = req.role;

    let targetCollegeId = null;
    if (role === 'college_admin') {
      // 院级管理员只能看本学院
      targetCollegeId = await resolveMyCollegeId(req);
    } else {
      // school_admin / super_admin 可指定，也可看全局默认
      targetCollegeId = parseId(queryCollegeId);
    }

    const where = { status: 'active' };
    if (targetCollegeId != null) {
      where.collegeId = targetCollegeId;
    } else {
      where.collegeId = null;
    }

    let config = await EvaluationConfig.findOne({ where, raw: true });

    if (!config) {
      // 返回默认配置（不持久化）
      const effective = buildEffectiveConfig(null);
      return res.success({
        id: null,
        collegeId: targetCollegeId,
        name: targetCollegeId ? '本院系默认配置（未创建）' : '全局默认配置',
        ...effective,
        isCustom: false,
        isDefault: true
      });
    }

    const effective = buildEffectiveConfig(config);
    res.success({
      id: config.id,
      collegeId: config.collegeId,
      name: config.name,
      ...effective,
      isCustom: true,
      isDefault: false,
      createdBy: config.createdBy,
      updatedBy: config.updatedBy,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    });
  } catch (err) { next(err); }
});

/**
 * 公式字段校验：返回 { valid, errors }
 */
function validateConfigPayload(payload) {
  const errors = [];

  // 数值字段范围校验
  const numericFields = [
    'f1Max', 'f2Max', 'f3Max', 'f4Max', 'f5Max',
    'f1Base', 'f3Base', 'f4Base', 'f5Base',
    'f2aWeight', 'f2bWeight', 'f2bMax', 'f2Scale'
  ];
  for (const f of numericFields) {
    if (payload[f] != null && payload[f] !== '') {
      const v = Number(payload[f]);
      if (Number.isNaN(v) || v < 0 || v > 1000) {
        errors.push(`${f} 必须是 0-1000 之间的数字`);
      }
    }
  }

  // 权重和应当为 1（允许小误差）
  const f2aW = Number(payload.f2aWeight ?? 0.8);
  const f2bW = Number(payload.f2bWeight ?? 0.2);
  if (Math.abs(f2aW + f2bW - 1) > 0.001) {
    errors.push(`智育内部权重和必须为1（当前 F2a权重=${f2aW} + F2b权重=${f2bW} = ${f2aW + f2bW}）`);
  }

  // 公式表达式校验
  const formulaFields = [
    { key: 'f1Formula',    vars: ['F1_BASE', 'F1_BONUS', 'F1_DEDUCT'] },
    { key: 'f2Formula',    vars: ['F2A', 'F2B', 'F2A_W', 'F2B_W', 'F2_SCALE'] },
    { key: 'f3Formula',    vars: ['F3_BASE', 'F3_BONUS', 'F3_DEDUCT'] },
    { key: 'f4Formula',    vars: ['F4_BASE', 'F4_BONUS', 'F4_DEDUCT'] },
    { key: 'f5Formula',    vars: ['F5_BASE', 'F5_PRACTICE'] },
    { key: 'totalFormula', vars: ['F1', 'F2', 'F3', 'F4', 'F5'] }
  ];
  for (const { key, vars } of formulaFields) {
    const expr = payload[key];
    if (expr != null && String(expr).trim() !== '') {
      const result = validateFormula(String(expr), vars);
      if (!result.valid) {
        errors.push(`${key} 公式无效: ${result.error}`);
      }
    }
  }

  // categoryMapping 格式校验
  if (payload.categoryMapping != null) {
    if (typeof payload.categoryMapping !== 'object' || Array.isArray(payload.categoryMapping)) {
      errors.push('categoryMapping 必须是对象');
    } else {
      const validTargets = ['F1', 'F2b', 'F3', 'F4', 'F5'];
      for (const [k, v] of Object.entries(payload.categoryMapping)) {
        if (!validTargets.includes(v)) {
          errors.push(`categoryMapping[${k}] 的值 "${v}" 不合法，必须是 ${validTargets.join('/')} 之一`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * PUT /api/evaluation/config - 保存（创建或更新）综测公式配置
 * 院级管理员：自动绑定到本学院
 * 学校管理员/超级管理员：必须传 collegeId 指定学院
 */
router.put('/config', requireCollegeAbove, async (req, res, next) => {
  try {
    const role = req.role;
    const { collegeId: bodyCollegeId } = req.body;

    let targetCollegeId;
    if (role === 'college_admin') {
      targetCollegeId = await resolveMyCollegeId(req);
      if (!targetCollegeId) throw new AppError('当前账号未绑定学院，无法保存配置', 400);
    } else {
      targetCollegeId = parseId(bodyCollegeId);
      if (!targetCollegeId) throw new AppError('学校管理员需要指定 collegeId', 400);
    }

    // 校验
    const { valid, errors } = validateConfigPayload(req.body);
    if (!valid) throw new AppError(`配置校验失败: ${errors.join('; ')}`, 400);

    // 收集允许更新的字段
    const allowedFields = [
      'name', 'f1Max', 'f2Max', 'f3Max', 'f4Max', 'f5Max',
      'f1Base', 'f3Base', 'f4Base', 'f5Base',
      'f2aWeight', 'f2bWeight', 'f2bMax', 'f2Scale',
      'f1Formula', 'f2Formula', 'f3Formula', 'f4Formula', 'f5Formula', 'totalFormula',
      'categoryMapping'
    ];
    const updateData = { updatedBy: req.userId };
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        if (f === 'categoryMapping') {
          updateData[f] = req.body[f];
        } else if (f === 'name') {
          updateData[f] = String(req.body[f]).slice(0, 100);
        } else if (f.includes('Formula')) {
          // 空字符串视为 null（使用默认公式）
          updateData[f] = String(req.body[f] || '').trim() || null;
        } else {
          updateData[f] = Number(req.body[f]);
        }
      }
    }

    // 查找已有配置
    let config = await EvaluationConfig.findOne({
      where: { collegeId: targetCollegeId, status: 'active' }
    });

    if (config) {
      // 更新
      await config.update(updateData);
    } else {
      // 创建
      config = await EvaluationConfig.create({
        collegeId: targetCollegeId,
        name: updateData.name || '综测公式配置',
        status: 'active',
        createdBy: req.userId,
        updatedBy: req.userId,
        ...updateData
      });
    }

    // 操作日志
    await writeOperateLog({
      userId: req.userId, username: req.username, role: req.role, module: '综测配置',
      action: '保存公式配置',
      content: `${role} 保存综测公式配置 (collegeId=${targetCollegeId}, configId=${config.id})`,
      ip: getClientIp(req)
    });

    // 重新拉取完整记录
    const fresh = await EvaluationConfig.findByPk(config.id, { raw: true });
    const effective = buildEffectiveConfig(fresh);
    res.success({
      id: fresh.id,
      collegeId: fresh.collegeId,
      name: fresh.name,
      ...effective,
      isCustom: true,
      isDefault: false
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/evaluation/config/reset - 重置为默认配置（删除本学院的自定义配置）
 */
router.post('/config/reset', requireCollegeAbove, async (req, res, next) => {
  try {
    const role = req.role;
    const { collegeId: bodyCollegeId } = req.body;

    let targetCollegeId;
    if (role === 'college_admin') {
      targetCollegeId = await resolveMyCollegeId(req);
    } else {
      targetCollegeId = parseId(bodyCollegeId);
    }

    if (!targetCollegeId) throw new AppError('无法确定目标学院', 400);

    const config = await EvaluationConfig.findOne({
      where: { collegeId: targetCollegeId, status: 'active' }
    });

    if (config) {
      await config.update({ status: 'disabled', updatedBy: req.userId });
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role, module: '综测配置',
        action: '重置公式配置',
        content: `${role} 重置综测公式配置为默认 (collegeId=${targetCollegeId}, configId=${config.id})`,
        ip: getClientIp(req)
      });
    }

    const effective = buildEffectiveConfig(null);
    res.success({
      message: '已重置为默认配置',
      ...effective,
      isCustom: false,
      isDefault: true
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/evaluation/config/test - 测试公式计算（不持久化）
 * 入参：{ formula, vars }
 */
router.post('/config/test', requireCollegeAbove, async (req, res, next) => {
  try {
    const { formula, vars } = req.body;
    if (!formula) throw new AppError('请输入公式', 400);

    const { evalFormula } = require('../utils/formulaParser');
    let result;
    try {
      result = evalFormula(String(formula), vars || {});
    } catch (e) {
      return res.success({ ok: false, error: e.message, result: null });
    }
    res.success({ ok: true, error: null, result: Number(result.toFixed(4)) });
  } catch (err) { next(err); }
});

// 对本院系少量样本进行整套规则试算；不保存配置，不写入成绩或排名。
router.post('/config/preview', requireCollegeAbove, async (req,res,next)=>{
  try{
    const collegeId=req.role==='college_admin'?await resolveMyCollegeId(req):parseId(req.body.collegeId);
    if(!collegeId) throw new AppError('请选择目标院系',400);
    narrowCollegeIds(req,collegeId);
    const candidate=req.body.config;
    if(!candidate || typeof candidate!=='object' || Array.isArray(candidate)) throw new AppError('试算配置格式无效',400);
    const validation=validateConfigPayload(candidate);if(!validation.valid)throw new AppError(validation.errors.join('；'),400);
    const term=resolveAcademicTerm();const academicYear=req.body.academicYear||term.academicYear;const semester=req.body.semester||term.semester;
    if(typeof academicYear!=='string'||!/^\d{4}-\d{4}$/.test(academicYear)||Number(academicYear.slice(5))!==Number(academicYear.slice(0,4))+1||!['first','second'].includes(semester))throw new AppError('学年或学期无效',400);
    const limit=Number(req.body.sampleSize??3);if(!Number.isInteger(limit)||limit<1||limit>5)throw new AppError('样本人数须为 1–5 人',400);
    const students=await User.findAll({where:{collegeId,role:{[Op.in]:['student','class_admin']},status:'active'},attributes:['id','realName','studentNo'],order:[['id','ASC']],limit,raw:true});
    const rows=[];
    for(const student of students){
      await assertStudentInScope(req,student.id);
      const before=await calcEvaluation(student.id,academicYear,semester);const after=await calcEvaluation(student.id,academicYear,semester,candidate);
      rows.push({studentId:student.id,name:student.realName,studentNo:student.studentNo,before:before.totalScore,after:after.totalScore,delta:Number((after.totalScore-before.totalScore).toFixed(2)),
        modules:Object.keys(before.modules).map(key=>({key,name:before.modules[key].name,before:before.modules[key].score,after:after.modules[key].score})),
        warnings:after.calculation.steps.filter(step=>step.warning).map(step=>step.warning),version:after.calculation.version});
    }
    res.success({academicYear,semester,collegeId,rows,notice:'按系统记录顺序选取本院系少量在校样本，使用查询时数据；不是全院影响评估。试算不保存配置或改写成绩，数据变动后请重新试算。'});
  }catch(error){next(error);}
});

/**
 * GET /api/evaluation/config/defaults - 获取默认公式与参数说明
 */
router.get('/config/defaults', requireCollegeAbove, async (req, res, next) => {
  try {
    res.success({
      formulas: DEFAULT_FORMULAS,
      variables: {
        f1: [
          { name: 'F1_BASE',   desc: '德育基础分' },
          { name: 'F1_BONUS',  desc: '德育正向加分总和' },
          { name: 'F1_DEDUCT', desc: '德育反向扣分总和' }
        ],
        f2: [
          { name: 'F2A',      desc: '智育基础分（学分加权平均分）' },
          { name: 'F2B',      desc: '智育奖励分（竞赛/证书等）' },
          { name: 'F2A_W',    desc: 'F2a 权重' },
          { name: 'F2B_W',    desc: 'F2b 权重' },
          { name: 'F2_SCALE', desc: '智育映射系数' }
        ],
        f3: [
          { name: 'F3_BASE',   desc: '体育基础分' },
          { name: 'F3_BONUS',  desc: '体育正向加分' },
          { name: 'F3_DEDUCT', desc: '体育反向扣分' }
        ],
        f4: [
          { name: 'F4_BASE',   desc: '美育基础分' },
          { name: 'F4_BONUS',  desc: '美育正向加分' },
          { name: 'F4_DEDUCT', desc: '美育反向扣分' }
        ],
        f5: [
          { name: 'F5_BASE',     desc: '劳育基础分' },
          { name: 'F5_PRACTICE', desc: '劳育实践分' }
        ],
        total: [
          { name: 'F1', desc: '德育得分' },
          { name: 'F2', desc: '智育得分' },
          { name: 'F3', desc: '体育得分' },
          { name: 'F4', desc: '美育得分' },
          { name: 'F5', desc: '劳育得分' }
        ]
      },
      functions: {
        min: 'min(a,b,...) 取最小值',
        max: 'max(a,b,...) 取最大值',
        abs: 'abs(x) 取绝对值',
        round: 'round(x) 四舍五入',
        floor: 'floor(x) 向下取整',
        ceil: 'ceil(x) 向上取整',
        sqrt: 'sqrt(x) 开方',
        pow: 'pow(x,y) x的y次方',
        clamp: 'clamp(v,lo,hi) 限定范围',
        if: 'if(cond,a,b) 条件表达式'
      },
      consts: { PI: '圆周率', E: '自然常数' }
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/evaluation/me - 当前学生查看自己的综测结果
 */
router.get('/me', requireStudent, async (req, res, next) => {
  try {
    const { academicYear: ay, semester: sm } = req.query;
    const term = resolveAcademicTerm();
    const y = ay || term.academicYear;
    const s = sm || term.semester;

    const result = await calcEvaluation(req.userId, y, s);
    res.success(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/evaluation/:studentId - 管理员查看指定学生的综测结果
 */
router.get('/:studentId', async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { academicYear: ay, semester: sm } = req.query;
    const term = resolveAcademicTerm();
    const y = ay || term.academicYear;
    const s = sm || term.semester;

    // 权限校验
    const student = await User.findByPk(studentId, {
      include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId', 'counselorId'] }]
    });
    if (!student) throw new AppError('学生不存在', 404);

    await assertStudentInScope(req, student.id);

    const result = await calcEvaluation(Number(studentId), y, s);
    res.success(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/evaluation/class/:classId - 管理员查看整个班级的综测结果（排名）
 */
router.get('/class/:classId', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { academicYear: ay, semester: sm } = req.query;
    const term = resolveAcademicTerm();
    const y = ay || term.academicYear;
    const s = sm || term.semester;

    // 权限校验
    if (req.role === 'student') return res.forbidden();
    assertClassInScope(req, classId);

    // 获取班级所有学生
    const students = await User.findAll({
      where: { classId: Number(classId), role: { [Op.in]: ['student', 'class_admin'] } },
      attributes: ['id', 'username', 'realName', 'studentNo'],
      raw: true
    });

    // 计算每个学生的综测
    const results = [];
    for (const stu of students) {
      try {
        const evalResult = await calcEvaluation(stu.id, y, s);
        results.push({
          studentId: stu.id,
          username: stu.username,
          realName: stu.realName,
          studentNo: stu.studentNo,
          totalScore: evalResult.totalScore,
          modules: {
            F1: evalResult.modules.F1.score,
            F2: evalResult.modules.F2.score,
            F2a: evalResult.modules.F2.f2a,
            F2b: evalResult.modules.F2.f2b,
            F3: evalResult.modules.F3.score,
            F4: evalResult.modules.F4.score,
            F5: evalResult.modules.F5.score
          }
        });
      } catch (e) {
        results.push({
          studentId: stu.id,
          username: stu.username,
          realName: stu.realName,
          studentNo: stu.studentNo,
          totalScore: 0,
          error: e.message
        });
      }
    }

    // 按总分降序排名
    results.sort((a, b) => Number(b.totalScore) - Number(a.totalScore));
    results.forEach((r, i) => { r.rank = i + 1; });

    res.success({ academicYear: y, semester: s, classId: Number(classId), count: results.length, list: results });
  } catch (err) { next(err); }
});

module.exports = router;
