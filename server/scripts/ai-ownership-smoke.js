// 显式 --live 才调用已配置模型；仅发送合成测试证书，不读取真实学生材料或连接数据库。
const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.argv.includes('--live')) throw new Error('此验证会调用已配置模型，请显式传入 --live');
  const config = require('../config');
  if (!config.ai.enabled || !config.ai.apiKey) throw new Error('未配置可用模型');
  const { reviewMaterial } = require('../services/aiProvider');
  const directory = path.resolve(__dirname, '../../tmp/ai-ownership');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'synthetic-certificate.png');
  const svg = `<svg width="1200" height="840" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="840" fill="#fffdf5"/><rect x="30" y="30" width="1140" height="780" fill="none" stroke="#a47d35" stroke-width="5"/>
    <g font-family="Microsoft YaHei, sans-serif" fill="#182532" text-anchor="middle">
      <text x="600" y="160" font-size="60">荣誉证书</text>
      <text x="600" y="280" font-size="48">获奖人：李四</text>
      <text x="600" y="360" font-size="40">学号：20260002</text>
      <text x="600" y="460" font-size="34">荣获校级创新竞赛一等奖</text>
      <text x="600" y="540" font-size="30">证书编号：TEST-2026-001</text>
      <text x="600" y="610" font-size="28">测试活动组委会　2026年10月19日</text>
      <text x="600" y="740" font-size="32" fill="#b33">合成测试样例，不具有效力</text>
    </g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  let inputFile = filename;
  if (process.argv.includes('--pdf')) {
    inputFile = path.join(directory, 'synthetic-certificate.pdf');
    const PdfPrinter = require('pdfmake');
    const printer = new PdfPrinter({ Standard: { normal: 'Helvetica' } });
    const document = printer.createPdfKitDocument({ defaultStyle: { font: 'Standard' },
      content: [{ text: 'Synthetic cover - test document only' }, { image: filename, width: 500, pageBreak: 'before' }] });
    const stream = require('fs').createWriteStream(inputFile);
    await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); document.on('error', reject); document.pipe(stream); document.end(); });
  }
  const result = await reviewMaterial({
    applicant: { realName: '张三', studentNo: '20260001' },
    fileName: path.basename(inputFile), title: '证书归属测试',
    modules: [{ id: 1, name: '创新竞赛', category: 'intellectual', singleMaxScore: 5, ruleDescription: '校级创新竞赛一等奖每项加4分。' }]
  }, inputFile, process.argv.includes('--pdf') ? 'application/pdf' : 'image/png');
  console.log(JSON.stringify({ mode: result.mode, ownership: result.ownership?.status,
    recipients: result.ownership?.recognizedRecipients.map(person => ({ name: person.name, studentNo: person.studentNo, page: person.page })),
    document: result.document, scoreBasis: result.scoreBasis?.status, scoreSuggestion: result.scoreSuggestion }, null, 2));
  if (result.mode !== 'model') throw new Error('未获得真实模型结果，不能将降级结果计为识别通过');
  if (result.ownership?.status !== 'mismatch' || result.scoreSuggestion !== null
      || !result.ownership.recognizedRecipients.some(person => person.name === '李四')) {
    throw new Error('合成他人证书未获得预期核对结果，请检查模型识别能力');
  }
  if (process.argv.includes('--pdf') && (result.document?.pageCount !== 2
    || !result.ownership.recognizedRecipients.some(person => person.page === 2))) throw new Error('PDF 页码依据未正确定位');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
