const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const config = require('../config');
async function main() {
  const tools = await Promise.all(['pdfinfo', 'pdftoppm'].map(async name => {
    try { await promisify(execFile)(config.ai.pdf[name], ['-v'], { timeout: 5000, windowsHide: true }); return { name, available: true }; }
    catch (_) { return { name, available: false }; }
  }));
  console.log(JSON.stringify({ modelConfigured: config.ai.enabled && !!config.ai.apiKey,
    pdfPageLimit: config.ai.pdf.maxPages, tools }, null, 2));
  if (tools.some(tool => !tool.available)) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
