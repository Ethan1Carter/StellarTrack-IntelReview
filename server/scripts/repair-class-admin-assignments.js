require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Op } = require('sequelize');
const { sequelize, Class, User } = require('../models');

async function repairClassAdminAssignments({ apply = false, classIds } = {}) {
  const where = { classAdminId: null };
  if (classIds) where.id = { [Op.in]: classIds };
  const classes = await Class.findAll({ where, attributes: ['id'], order: [['id', 'ASC']] });
  const results = [];
  for (const { id } of classes) {
    const result = await sequelize.transaction(async (transaction) => {
      const cls = await Class.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!cls || cls.classAdminId != null) return null;
      const admins = await User.findAll({
        where: {
          classId: cls.id, collegeId: cls.collegeId, role: 'class_admin',
          status: 'active',
          [Op.or]: [{ roleStatus: 'active' }, { roleStatus: null }]
        },
        attributes: ['id'],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!admins.length) return null;
      if (admins.length !== 1) {
        return { classId: cls.id, status: 'skipped_multiple_admins', count: admins.length };
      }
      if (apply) await cls.update({ classAdminId: admins[0].id }, { transaction });
      return { classId: cls.id, adminId: admins[0].id, status: apply ? 'repaired' : 'would_repair' };
    });
    if (result) results.push(result);
  }
  return results;
}

if (require.main === module) {
  repairClassAdminAssignments({ apply: process.argv.includes('--apply') })
    .then(results => console.log(JSON.stringify(results, null, 2)))
    .catch(err => { console.error(err.message); process.exitCode = 1; })
    .finally(() => sequelize.close());
}

module.exports = { repairClassAdminAssignments };
