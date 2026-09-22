process.env.AI_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ai-material-smoke-secret';
process.env.DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'ai-material-smoke-password';

const assert = require('assert');
const { reviewMaterial } = require('../services/aiProvider');

(async () => {
  const result = await reviewMaterial({
    fileName: '全国大学生创新创业大赛国家级获奖证书.png',
    title: '全国大学生创新创业大赛获奖证书',
    description: '国家级创新创业竞赛获奖',
    modules: [{ id: 7, name: '创新创业', singleMaxScore: 5, yearlyMaxScore: 10 }]
  }, __filename, 'image/png');

  assert.equal(result.mode, 'fallback');
  assert.equal(result.awardLevel, 'national');
  assert.equal(result.suggestedModuleId, 7);
  assert.ok(Array.isArray(result.riskFlags));
  console.log('AI material fallback smoke check passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
