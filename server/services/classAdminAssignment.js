const { Op } = require('sequelize');
const { Class } = require('../models');
const { AppError } = require('../middleware/errorHandler');

async function syncClassAdminAssignment(user, transaction) {
  const classId = user.role === 'class_admin' && user.classId != null
    ? Number(user.classId) : null;
  const conditions = [{ classAdminId: user.id }];
  if (classId != null) conditions.push({ id: classId });

  // Lock both old and new classes in a stable order before moving the assignment.
  const classes = await Class.findAll({
    where: { [Op.or]: conditions },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  const target = classes.find(cls => Number(cls.id) === classId);
  if (classId != null) {
    if (!target) throw new AppError('选择的班级不存在', 400);
    if (Number(target.collegeId) !== Number(user.collegeId)) {
      throw new AppError('班级与所属院系不一致', 400);
    }
  }

  for (const cls of classes) {
    if (Number(cls.classAdminId) === Number(user.id) && Number(cls.id) !== classId) {
      await cls.update({ classAdminId: null }, { transaction });
    }
  }
  // Multiple admins are allowed; an existing primary remains explicitly assigned.
  if (target && target.classAdminId == null) {
    await target.update({ classAdminId: user.id }, { transaction });
  }
}

module.exports = { syncClassAdminAssignment };
