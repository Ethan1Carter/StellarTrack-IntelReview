require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { User, sequelize } = require('../models');
const jwt = require('jsonwebtoken');
const config = require('../config');
const axios = require('axios');
const API = 'http://localhost:3000/api';

(async () => {
  try {
    const u = await User.findOne({ where: { username: 'developer' }, raw: true });
    const token = jwt.sign({ id: u.id }, config.jwt.secret, { expiresIn: '1h' });
    const headers = { Authorization: `Bearer ${token}` };

    // 1. 测试 /auth/me
    console.log('=== GET /auth/me ===');
    const res = await axios.get(`${API}/auth/me`, { headers });
    const me = res.data?.data || res.data;
    console.log('role:', me.role);
    console.log('realName:', me.realName);
    console.log('collegeId:', me.collegeId);
    console.log('classId:', me.classId);

    // 2. 测试 /colleges/all
    console.log('\n=== GET /colleges/all ===');
    try {
      const res2 = await axios.get(`${API}/colleges/all`, { headers });
      const d = res2.data?.data || res2.data;
      console.log('院系数:', Array.isArray(d) ? d.length : '?');
    } catch (e) { console.log('FAIL:', e.response?.status, e.response?.data?.message); }

    // 3. 测试 /users
    console.log('\n=== GET /users?pageSize=3 ===');
    try {
      const res3 = await axios.get(`${API}/users?pageSize=3`, { headers });
      const d = res3.data?.data || res3.data;
      console.log('用户数:', d?.list?.length || d?.length || 0);
    } catch (e) { console.log('FAIL:', e.response?.status, e.response?.data?.message); }

    // 4. 测试 /classes
    console.log('\n=== GET /classes?pageSize=3 ===');
    try {
      const res4 = await axios.get(`${API}/classes?pageSize=3`, { headers });
      const d = res4.data?.data || res4.data;
      console.log('班级数:', d?.list?.length || d?.length || 0);
    } catch (e) { console.log('FAIL:', e.response?.status, e.response?.data?.message); }

  } catch (e) {
    console.error('ERROR:', e.message);
  } finally {
    await sequelize.close();
  }
})();