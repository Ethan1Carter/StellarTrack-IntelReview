module.exports = (sequelize, DataTypes) => sequelize.define('growth_plans', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  collegeId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  academicYear: { type: DataTypes.STRING(20), allowNull: false },
  semester: { type: DataTypes.STRING(20), allowNull: false },
  source: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'rules' },
  diagnosis: { type: DataTypes.JSON, allowNull: false },
  goals: { type: DataTypes.JSON, allowNull: false },
  tasks: { type: DataTypes.JSON, allowNull: false },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }
}, { comment: '学生成长行动计划与核验记录', indexes: [
  { unique: true, fields: ['student_id', 'academic_year', 'semester'] },
  { fields: ['class_id', 'academic_year', 'semester'] }
] });
