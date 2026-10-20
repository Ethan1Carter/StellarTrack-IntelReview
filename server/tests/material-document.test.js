const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareMaterialDocument } = require('../utils/materialDocument');
const { moduleEligible, applyScoreBasis } = require('../utils/materialRules');
const { checkCertificateOwnership } = require('../utils/certificateOwnership');

// 最小 PDF 测试夹具：只含合成 ASCII 文本，不读取真实业务资料。
function pdfFixture(pages) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`];
  for (let i = 0; i < pages; i++) {
    const stream = `BT /F1 20 Tf 30 100 Td (Synthetic page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(output)); output += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return output;
}

test('真实 PDF 逐页读取；超页数、缺少组件和损坏文件安全转人工', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'xinggui-pdf-test-'));
  try {
    const filename = path.join(folder, 'two-pages.pdf');
    await fs.writeFile(filename, pdfFixture(2));
    const document = await prepareMaterialDocument(filename, 'application/pdf');
    assert.equal(document.pageCount, 2);
    assert.equal(document.complete, true);
    assert.equal(document.content.filter(item => item.type === 'image_url').length, 2);
    assert.match(document.content[2].text, /第 2 页/);
    await assert.rejects(prepareMaterialDocument(filename, 'application/pdf', { maxPages: 1 }), /超过/);
    await assert.rejects(prepareMaterialDocument(filename, 'application/pdf', { pdfinfo: 'xinggui-nonexistent-pdf-tool' }), /组件不可用/);
    await fs.writeFile(filename, 'invalid PDF');
    await assert.rejects(prepareMaterialDocument(filename, 'application/pdf'), /读取失败/);
  } finally {
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('PDF 身份依据必须指向实际页码，不能用不存在的页面证明归属', () => {
  const identity = { documentType: 'individual_certificate', readable: true,
    recipients: [{ name: '张三', evidence: '获奖人：张三', page: 2 }] };
  const applicant = { realName: '张三' };
  assert.equal(checkCertificateOwnership(identity, applicant, true, { kind: 'pdf', pageCount: 2 }).status, 'matched');
  for (const page of [0, 3, null]) {
    identity.recipients[0].page = page;
    assert.equal(checkCertificateOwnership(identity, applicant, true, { kind: 'pdf', pageCount: 2 }).status, 'unverified');
  }
});

test('评分必须引用真实规则，且模块适用范围不因客户端优先选择而放宽', () => {
  const module = { id: 1, name: '竞赛', collegeId: 10, ruleDescription: '校级一等奖加4分。', singleMaxScore: 5 };
  const review = { suggestedModuleId: 1, scoreSuggestion: 4 };
  assert.equal(applyScoreBasis(review, { ruleReference: { moduleId: 1, quote: '校级一等奖加4分。' } }, [module]).scoreSuggestion, 4);
  for (const value of [null, { ruleReference: { moduleId: 1, quote: '全国一等奖加10分。' } }]) {
    assert.equal(applyScoreBasis(review, value, [module]).scoreSuggestion, null);
  }
  assert.equal(moduleEligible(module, { collegeId: 20 }), false);
  assert.equal(moduleEligible({ ...module, applyScope: 'specific_class', applyClassIds: [100] }, { collegeId: 10, classId: 200 }), false);
  assert.equal(moduleEligible(module, { collegeId: 10 }), true);
});

module.exports = { pdfFixture };
