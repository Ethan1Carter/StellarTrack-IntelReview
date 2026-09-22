require('dotenv').config();
const { sequelize } = require('../config/db');
const { Application } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    // Update app 22 to belong to a visible semester (ID 15 or 16)
    const [count] = await Application.update(
      { semesterId: 15, academicYear: '2025-2026', semester: 'second' },
      { where: { id: 22 } }
    );
    console.log('Updated rows:', count);

    // Verify
    const app = await Application.findByPk(22);
    console.log('App 22 semesterId:', app?.semesterId, 'status:', app?.status);
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
