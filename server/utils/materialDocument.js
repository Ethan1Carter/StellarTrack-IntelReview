const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const MAX_BYTES = 10 * 1024 * 1024;

async function prepareMaterialDocument(filePath, mimeType, options = {}) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('材料超过 10MB 或不是有效文件，请拆分后上传');
  if (IMAGE_TYPES.has(mimeType)) {
    const buffer = await fs.readFile(filePath);
    return { kind: 'image', pageCount: 1, complete: true, method: 'image',
      content: [{ type: 'text', text: '以下是附件第 1 页。' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } }] };
  }
  if (mimeType !== 'application/pdf') throw new Error('不支持读取该材料格式');
  const maxPages = Math.min(8, Math.max(1, Number(options.maxPages) || 5));
  const commandOptions = { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' };
  let temporary;
  try {
    const { stdout } = await run(options.pdfinfo || 'pdfinfo', [filePath], commandOptions);
    const pageCount = Number(stdout.match(/^Pages:\s+(\d+)\s*$/m)?.[1]);
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('无法确定 PDF 页数，请转人工核验');
    if (pageCount > maxPages) throw new Error(`PDF 共 ${pageCount} 页，超过一次识别 ${maxPages} 页的限制，请按证书拆分上传`);
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'xinggui-material-'));
    await run(options.pdftoppm || 'pdftoppm', ['-f', '1', '-l', String(pageCount), '-jpeg',
      '-jpegopt', 'quality=85', '-scale-to', '1800', filePath, path.join(temporary, 'page')], commandOptions);
    const files = (await fs.readdir(temporary)).filter(name => /^page-\d+\.jpg$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (files.length !== pageCount) throw new Error('PDF 页面未完整读取，请转人工核验');
    const content = [];
    let bytes = 0;
    for (let index = 0; index < files.length; index++) {
      const buffer = await fs.readFile(path.join(temporary, files[index]));
      bytes += buffer.length;
      if (bytes > MAX_BYTES) throw new Error('PDF 页面图像过大，请按证书拆分上传');
      content.push({ type: 'text', text: `以下是同一 PDF 附件的第 ${index + 1} 页，共 ${pageCount} 页。` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } });
    }
    return { kind: 'pdf', pageCount, complete: true, method: 'page-images', content };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('PDF 读取组件不可用，请管理员安装 Poppler 并配置路径，或先上传证书图片');
    if (error.killed || error.code === 'ETIMEDOUT') throw new Error('PDF 读取超时，请拆分文件或上传清晰图片');
    if (error.cmd) throw new Error('PDF 读取失败，可能损坏或受密码保护，请上传可读取的 PDF 或图片');
    throw error;
  } finally {
    // temporary 仅由 mkdtemp 产生；确认位于系统临时目录下再递归清理。
    if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir())
        && path.basename(temporary).startsWith('xinggui-material-')) await fs.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { prepareMaterialDocument };
