module.exports = (sequelize, DataTypes) => sequelize.define('guidance_resources', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  seriesId: { type: DataTypes.STRING(36), allowNull: false },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  editVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  kind: { type: DataTypes.STRING(20), allowNull: false },
  collegeId: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
  data: { type: DataTypes.JSON, allowNull: false },
  createdBy: { type: DataTypes.INTEGER, allowNull: false },
  publishedBy: { type: DataTypes.INTEGER },
  publishedAt: { type: DataTypes.DATE },
  withdrawalReason: { type: DataTypes.STRING(500) }
}, { indexes: [
  { unique: true, fields: ['series_id', 'revision'] },
  { fields: ['college_id', 'kind', 'status'] }
] });
