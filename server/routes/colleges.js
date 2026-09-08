const express = require('express');
const router = express.Router();
const fs = require('fs');
const { College } = require('../models');
const { AppError } = require('../middleware/errorHandler');
const { parsePagination, getClientIp } = require('../utils');
const { requireSchoolAdmin, requireCollegeAbove, requireAdmin, auth } = require('../middleware/auth');
const { writeOperateLog } = require('../middleware/logger');
const { excelUpload } = require('../middleware/upload');
const { invalidateScopeCache, narrowClassIds } = require('../middleware/scope');

router.use(auth);

const XLSX = require('xlsx');

// ================== 院系 / 班级批量导入导出（必须全部在 /:id 之前注册）==================

/**
 * GET /api/colleges/template - 下载批量导入模板
 */
router.get('/template', requireCollegeAbove, async (req, res, next) => {
  try {
    const rows = [
      { '类型': '院系', '院系名称': '信息工程学院', '院系代码': 'XXGC', '院长姓名': '张三', '排序': 1,
        '班级名称': '', '班级代码': '', '专业': '', '年级': '', '辅导员姓名': '', '班级管理员账号': '' },
      { '类型': '班级', '院系名称': '信息工程学院', '院系代码': 'XXGC',
        '班级名称': '计算机2024-1班', '班级代码': 'JSJ202401', '专业': '计算机科学与技术', '年级': '2024',
        '辅导员姓名': '李老师', '班级管理员账号': 'bjgly001', '排序': '' }
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 6 },
      { wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 6 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '院系班级');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="colleges_template.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/**
 * POST /api/colleges/import - Excel 批量导入院系 + 班级
 */
router.post('/import', requireCollegeAbove, excelUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('请上传 Excel 文件', 400);
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    if (!rows.length) throw new AppError('Excel 中没有数据', 400);

    let collegeAdded = 0, collegeUpdated = 0, classAdded = 0, classUpdated = 0, failed = 0;
    const fails = [];
    const { Class, User } = require('../models');

    // 院系管理员仅能导入本学院班级，不能创建/修改院系
    const isCollegeAdmin = req.role === 'college_admin';
    let lockedCollege = null;
    if (isCollegeAdmin) {
      if (!req.user?.collegeId) throw new AppError('您的账号未绑定院系，无法导入', 403);
      lockedCollege = await College.findByPk(req.user.collegeId);
      if (!lockedCollege) throw new AppError('所属院系不存在', 403);
    }

    const cache = {};
    const getCollege = async (name, code) => {
      // 院系管理员：强制使用本院系
      if (isCollegeAdmin) return lockedCollege;
      const key = 'c_' + (name || '') + '_' + (code || '');
      if (cache[key]) return cache[key];
      const where = {};
      if (code) where.code = code;
      else if (name) where.name = name;
      else return null;
      let col = await College.findOne({ where });
      if (!col && name && code) {
        col = await College.create({ name, code, status: 'active', sort: 0 });
        collegeAdded++;
      }
      cache[key] = col;
      return col;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      try {
        const type = String(r['类型'] || r['type'] || '').trim();
        const collegeName = String(r['院系名称'] || r['院系'] || r['collegeName'] || '').trim();
        const collegeCode = String(r['院系代码'] || r['code'] || '').trim();

        // 院系管理员：跳过院系行，仅处理班级行
        if (isCollegeAdmin && (type === '院系' || (!type && !r['班级名称']))) {
          continue; // 跳过院系类型行
        }

        if (!isCollegeAdmin && (type === '院系' || !type)) {
          if (!collegeName) { failed++; fails.push(`第${i+2}行：缺少院系名称`); continue; }
          // 创建/更新院系
          const deanName = String(r['院长姓名'] || r['院长'] || r['deanName'] || '').trim() || null;
          const sort = Number(r['排序'] || r['sort']) || 0;
          let col;
          if (collegeCode) col = await College.findOne({ where: { code: collegeCode } });
          if (!col) col = await College.findOne({ where: { name: collegeName } });
          if (col) {
            await col.update({ name: collegeName, code: collegeCode || col.code, deanName: deanName || col.deanName, sort });
            collegeUpdated++;
          } else {
            if (!collegeCode) { failed++; fails.push(`第${i+2}行：院系代码为空，无法创建院系`); continue; }
            await College.create({ name: collegeName, code: collegeCode, deanName, sort, status: 'active' });
            collegeAdded++;
          }
        }

        // 班级行处理（院系管理员也走此分支）
        const isClassRow = type === '班级' || r['班级名称'];
        if (isClassRow) {
          const className = String(r['班级名称'] || r['班级'] || r['className'] || '').trim();
          const classCode = String(r['班级代码'] || r['classCode'] || '').trim();
          const major = String(r['专业'] || r['major'] || '').trim() || null;
          const grade = String(r['年级'] || r['grade'] || '').trim() || null;
          const counselorName = String(r['辅导员姓名'] || r['辅导员'] || r['counselorName'] || '').trim() || null;
          const classAdminUsername = String(r['班级管理员账号'] || r['班级管理员'] || r['classAdmin'] || '').trim() || null;
          if (!className) { failed++; fails.push(`第${i+2}行：缺少班级名称`); continue; }
          const col = await getCollege(collegeName, collegeCode);
          if (!col) { failed++; fails.push(`第${i+2}行：找不到对应院系（${collegeName}/${collegeCode}）`); continue; }

          let counselorId = null;
          if (counselorName) {
            const u = await User.findOne({ where: { realName: counselorName } });
            if (u) counselorId = u.id;
          }
          let classAdminId = null;
          if (classAdminUsername) {
            const u = await User.findOne({ where: { username: classAdminUsername } });
            if (u) classAdminId = u.id;
          }

          let cls;
          if (classCode) cls = await Class.findOne({ where: { code: classCode } });
          if (!cls) cls = await Class.findOne({ where: { collegeId: col.id, name: className } });
          if (cls) {
            // 院系管理员不能修改其他院系的班级
            if (isCollegeAdmin && Number(cls.collegeId) !== Number(lockedCollege.id)) {
              failed++; fails.push(`第${i+2}行：无权限修改其他院系的班级`); continue;
            }
            await cls.update({ name: className, code: classCode || cls.code, major, grade, counselorId, classAdminId });
            classUpdated++;
          } else {
            await Class.create({
              name: className,
              code: classCode || `C${Date.now()}${i}`,
              collegeId: col.id, major, grade, counselorId, classAdminId,
              status: 'active'
            });
            classAdded++;
          }
        }
      } catch (e) {
        failed++;
        fails.push(`第${i+2}行:${e.message}`);
      }
    }
    invalidateScopeCache();
    res.success({ collegeAdded, collegeUpdated, classAdded, classUpdated, failed, total: rows.length, failMsgs: fails.slice(0, 30) }, '导入完成');
  } catch (err) {
    next(err);
  } finally {
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
  }
});

/**
 * GET /api/colleges/export - 导出院系 + 班级 Excel
 */
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const { Class, User } = require('../models');
    // 院系管理员仅导出本院系
    const isCollegeAdmin = req.role === 'college_admin';
    const collegeWhere = { status: 'active' };
    if (isCollegeAdmin && req.user?.collegeId) {
      collegeWhere.id = req.user.collegeId;
    }
    const colleges = await College.findAll({
      where: collegeWhere,
      order: [['sort', 'ASC'], ['id', 'ASC']],
      include: [{
        model: Class,
        required: false,
        where: { status: 'active' },
        include: [
          { model: User, as: 'counselor', attributes: ['realName'], required: false },
          { model: User, as: 'classAdmin', attributes: ['username'], required: false }
        ]
      }]
    });
    const rows = [];
    for (const col of colleges) {
      rows.push({
        '类型': '院系', '院系名称': col.name, '院系代码': col.code || '',
        '院长姓名': col.deanName || '', '排序': col.sort || 0,
        '班级名称': '', '班级代码': '', '专业': '', '年级': '',
        '辅导员姓名': '', '班级管理员账号': ''
      });
      const allowedClassIds = (req.role === 'school_admin' || req.role === 'super_admin') ? null : new Set(narrowClassIds(req, null) || []);
      const classes = [...(col.classes || [])].filter(cls => allowedClassIds === null || allowedClassIds.has(Number(cls.id))).sort((left, right) => {
        const gradeOrder = String(right.grade || '').localeCompare(String(left.grade || ''), 'zh-CN');
        return gradeOrder || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
      });
      for (const cls of classes) {
        rows.push({
          '类型': '班级', '院系名称': col.name, '院系代码': col.code || '',
          '班级名称': cls.name, '班级代码': cls.code || '', '专业': cls.major || '', '年级': cls.grade || '',
          '辅导员姓名': cls.counselor?.realName || '', '班级管理员账号': cls.classAdmin?.username || ''
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 6 },
      { wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 18 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '院系班级');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="colleges_${Date.now()}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// GET 列表 - 所有登录用户可读
router.get('/', auth, async (_req, res, next) => {
  try {
    const list = await College.findAll({ where: { status: 'active' }, order: [['sort', 'ASC'], ['id', 'ASC']] });
    res.success(list);
  } catch (err) { next(err); }
});

// POST 新增
router.post('/', requireSchoolAdmin, async (req, res, next) => {
  try {
    const raw = req.body || {};
    const rawData = { ...raw };
    // 兼容前端传来 dean 对象（{id, name, realName}）或 deanId/deanName 字符串
    if (rawData.dean && (rawData.dean.name || rawData.dean.realName)) {
      rawData.deanName = rawData.dean.name || rawData.dean.realName;
    } else if (rawData.deanId) {
      const u = await require('../models').User.findByPk(rawData.deanId);
      if (u) rawData.deanName = u.realName;
    }
    // 只 pick 合法字段，避免前端传 classes/orderNum/classCount 等未知属性写入报错
    const data = {
      name: rawData.name,
      code: rawData.code || rawData.codeField || undefined,
      deanName: rawData.deanName,
      description: rawData.description,
      contact: rawData.contact,
      phone: rawData.phone,
      email: rawData.email,
      sort: Number(rawData.sort ?? rawData.orderNum ?? rawData.order ?? 0) || 0
    };
    // 必填校验
    if (!data.name || !String(data.name).trim()) throw new AppError('院系名称必填', 400);
    if (!data.code || !String(data.code).trim()) {
      data.code = 'COL_' + Date.now();
    }
    data.status = (rawData.status && String(rawData.status) !== '') ? rawData.status : 'active';
    try {
      const col = await College.create(data);
      await writeOperateLog({
        userId: req.userId, username: req.username, role: req.role,
        module: '院系管理', action: '新增院系',
        content: `创建院系 ${col.name} code=${col.code}`,
        ip: getClientIp(req)
      });
      res.success(col, '创建成功');
    } catch (sqlerr) {
      if (sqlerr.name === 'SequelizeUniqueConstraintError' && sqlerr.fields && sqlerr.fields.code) {
        throw new AppError(`院系代码 "${data.code}" 已存在，请更换代码`, 400);
      }
      if (sqlerr.name === 'SequelizeUniqueConstraintError') {
        throw new AppError('唯一性字段重复：' + Object.keys(sqlerr.fields || {}).join(','), 400);
      }
      throw sqlerr;
    }
  } catch (err) { next(err); }
});

// GET /all - 全部院系（带 /all 必须在 /:id 之前）
router.get('/all', auth, async (_req, res, next) => {
  try {
    const list = await College.findAll({ where: { status: 'active' }, order: [['sort', 'ASC'], ['id', 'ASC']] });
    res.success(list);
  } catch (err) { next(err); }
});

// GET /:id/classes - 某院系列表所有班级（必须在 /:id 之前）
router.get('/:id/classes', auth, async (req, res, next) => {
  try {
    const { Class } = require('../models');
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    const classes = await Class.findAll({
      where: { collegeId: col.id, status: 'active' },
      order: [['grade', 'DESC'], ['name', 'ASC']]
    });
    res.success(classes);
  } catch (err) { next(err); }
});

// GET /:id/majors - 某院系列表所有专业（唯一值）
router.get('/:id/majors', auth, async (req, res, next) => {
  try {
    const { Class } = require('../models');
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    const classes = await Class.findAll({
      where: { collegeId: col.id, status: 'active' },
      attributes: ['major'],
      group: ['major']
    });
    const majors = classes.map(c => c.major).filter(Boolean);
    res.success([...new Set(majors)]);
  } catch (err) { next(err); }
});

// GET /:id/stats - 某院系统计信息（必须在 /:id 之前）
router.get('/:id/stats', requireAdmin, async (req, res, next) => {
  try {
    const { Class, User, ScoreSummary } = require('../models');
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    const classes = await Class.count({ where: { collegeId: col.id } });
    const students = await User.count({ where: { collegeId: col.id, role: { [require('sequelize').Op.in]: ['student', 'class_admin'] } } });
    const teachers = await User.count({
      where: { collegeId: col.id, role: { [require('sequelize').Op.in]: ['counselor', 'college_admin'] } }
    });
    res.success({ id: col.id, name: col.name, classCount: classes, studentCount: students, teacherCount: teachers });
  } catch (err) { next(err); }
});

// PUT 编辑（学校管理员可编辑所有院系，学院管理员可编辑本院系的专业等字段）
router.put('/:id', auth, async (req, res, next) => {
  try {
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    
    const isSchoolAdmin = ['school_admin', 'super_admin'].includes(req.role);
    const isCollegeAdmin = req.role === 'college_admin';
    const isOwnCollege = Number(req.user?.collegeId) === Number(col.id);
    
    // 权限检查
    if (!isSchoolAdmin && !(isCollegeAdmin && isOwnCollege)) {
      throw new AppError('无权限编辑该院系', 403);
    }
    
    const raw = req.body || {};
    const rawData = { ...raw };
    if (rawData.dean && (rawData.dean.name || rawData.dean.realName)) rawData.deanName = rawData.dean.name || rawData.dean.realName;
    else if (rawData.deanId) {
      const u = await require('../models').User.findByPk(rawData.deanId);
      if (u) rawData.deanName = u.realName;
    }
    // 只 pick 合法字段
    const data = {};
    if (rawData.name !== undefined) data.name = rawData.name;
    if (rawData.code !== undefined) data.code = rawData.code;
    if (rawData.deanName !== undefined) data.deanName = rawData.deanName;
    if (rawData.description !== undefined) data.description = rawData.description;
    if (rawData.contact !== undefined) data.contact = rawData.contact;
    if (rawData.phone !== undefined) data.phone = rawData.phone;
    if (rawData.email !== undefined) data.email = rawData.email;
    if (rawData.status !== undefined && String(rawData.status) !== '') data.status = rawData.status;
    if (Array.isArray(rawData.majors)) data.majors = rawData.majors;
    if (rawData.sort !== undefined || rawData.orderNum !== undefined) {
      data.sort = Number(rawData.sort ?? rawData.orderNum ?? col.sort ?? 0) || 0;
    }
    
    // 学院管理员只能修改有限字段
    if (isCollegeAdmin && !isSchoolAdmin) {
      const allowedFields = ['majors'];
      for (const key of Object.keys(data)) {
        if (!allowedFields.includes(key)) delete data[key];
      }
    }
    
    if (Object.keys(data).length === 0) {
      return res.success(col, '没有需要更新的字段');
    }
    
    await col.update(data);
    res.success(col, '更新成功');
  } catch (err) { next(err); }
});

// DELETE 删除
router.delete('/:id', requireSchoolAdmin, async (req, res, next) => {
  try {
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    const { Class } = require('../models');
    const count = await Class?.count?.({ where: { collegeId: col.id } }) || 0;
    if (count > 0) throw new AppError('该院系下存在班级，无法删除', 400);
    await col.destroy();
    res.success(null, '删除成功');
  } catch (err) { next(err); }
});

// GET /:id - 单个院系详情（必须在 /:id/classes, /:id/majors, /:id/stats 子路径路由之后）
router.get('/:id', auth, async (req, res, next) => {
  try {
    const col = await College.findByPk(req.params.id);
    if (!col) throw new AppError('院系不存在', 404);
    res.success(col);
  } catch (err) { next(err); }
});

module.exports = router;
