// 五育归属映射（与 server/utils/fiveEducation.js 的 PILLARS 保持一致）
// moral=德育 / intellectual=智育 / sports=体育 / aesthetic=美育 / labor=劳育

export const PILLARS = [
  { value: 'moral', label: '德育', color: '#e74c3c' },
  { value: 'intellectual', label: '智育', color: '#3498db' },
  { value: 'sports', label: '体育', color: '#2ecc71' },
  { value: 'aesthetic', label: '美育', color: '#f39c12' },
  { value: 'labor', label: '劳育', color: '#9b59b6' }
];

export const PILLAR_MAP = PILLARS.reduce((m, p) => { m[p.value] = p; return m; }, {});

// 取五育元信息；未知值回退为灰色，保证任何情况都有可读标签
export function pillarMeta(v) {
  return PILLAR_MAP[v] || { value: v, label: v || '—', color: '#909399' };
}
