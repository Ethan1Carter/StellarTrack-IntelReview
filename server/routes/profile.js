const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { auth } = require('../middleware/auth');
const { comparePassword, hashPassword, getClientIp } = require('../utils');
const { upload, compressImages, toFileUrl } = require('../middleware/upload');
const { AppError } = require('../middleware/errorHandler');

router.use(auth);

/**
 * GET /api/profile - 我的信息
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, {
      attributes: { exclude: ['password'] },
      include: [
        { association: 'college', attributes: ['id', 'name'] },
        { 
          association: 'classInfo', 
          attributes: ['id', 'name', 'major', 'grade'],
          include: [{ association: 'college', attributes: ['id', 'name'] }]
        }
      ]
    });
    const u = user.toJSON();
    // 前端兼容字段映射
    u.name = u.realName;
    u.jobNo = u.employeeNo;
    res.success(u);
  } catch (err) { next(err); }
});

/**
 * PUT /api/profile - 更新基本信息
 */
router.put('/', auth, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    const allowed = ['realName', 'phone', 'email', 'gender'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) user[k] = req.body[k];
    }
    // 兼容前端传 name 字段，映射为 realName
    if (req.body.name !== undefined && !req.body.realName) {
      user.realName = req.body.name;
    }
    await user.save();
    const u = user.toJSON(); delete u.password;
    res.success(u, '已更新');
  } catch (err) { next(err); }
});

/**
 * POST /api/profile/avatar - 上传头像
 */
router.post('/avatar', auth, upload.single('avatar'), compressImages, async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('请上传头像', 400);
    const user = await User.findByPk(req.userId);
    user.avatar = toFileUrl(req.file.path);
    await user.save();
    res.success({ avatar: user.avatar }, '头像已更新');
  } catch (err) { next(err); }
});

/**
 * POST /api/profile/change-password - 修改密码
 */
router.post('/change-password', auth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (!oldPassword || !newPassword || !confirmPassword) throw new AppError('请完整填写', 400);
    if (newPassword.length < 6) throw new AppError('新密码至少6位', 400);
    if (newPassword !== confirmPassword) throw new AppError('两次新密码不一致', 400);

    const user = await User.findByPk(req.userId);
    if (!comparePassword(oldPassword, user.password)) throw new AppError('原密码不正确', 400);
    user.password = hashPassword(newPassword);
    await user.save();
    res.success(null, '密码修改成功');
  } catch (err) { next(err); }
});

module.exports = router;
