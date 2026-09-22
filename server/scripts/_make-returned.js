require('dotenv').config();
const { sequelize } = require('../config/db');
const { Application } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    // Update app 22 status to 'returned' for testing
    const [count] = await Application.update(
      { status: 'returned', rejectReason: '测试退回状态' },
      { where: { id: 22 } }
    );
    console.log('Updated rows:', count);

    // Verify
    const app = await Application.findByPk(22);
    console.log('App 22 status:', app?.status);
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
