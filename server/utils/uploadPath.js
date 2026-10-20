const path = require('path');
const { AppError } = require('../middleware/errorHandler');

function resolveInside(root, relativePath) {
  if (!relativePath || relativePath.includes('\0') || relativePath.includes('\\')) throw new AppError('附件地址无效', 400);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new AppError('附件地址无效', 400);
  return resolved;
}

function uploadOwner(relativePath) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  if (parts.length !== 2) return null;
  const match = parts[0].match(/^\d{8}_(?:u)?([1-9]\d*)$/);
  return match ? Number(match[1]) : null;
}

module.exports = { resolveInside, uploadOwner };
