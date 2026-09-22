require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../models');

async function main() {
  const queryInterface = sequelize.getQueryInterface();
  const columns = await queryInterface.describeTable('users');
  if (!columns.requested_role && !columns.requestedRole) {
    await queryInterface.addColumn('users', 'requested_role', {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: '申请变更的目标角色'
    });
  }
  console.log('requested_role migration complete');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
