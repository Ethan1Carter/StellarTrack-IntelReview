const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');
const { resolveInside } = require('../utils/uploadPath');
const { AppError } = require('../middleware/errorHandler');
const fingerprintCache=new Map();

function attachmentValues(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = value.split(','); } }
  if(typeof value==='string')value=[value];
  return (Array.isArray(value)?value:[]).map(item=>typeof item==='string'?item.trim():item?.url).filter(Boolean);
}
function urls(value) {return [...new Set(attachmentValues(value).filter(item=>typeof item==='string'&&item.startsWith('/uploads/')).map(item=>item.split('?')[0]))];}
const key = value => String(value || '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
const certificateKey = value => { const text = key(value); return text.length >= 4 && !['不详','暂无编号','无证书编号','NONE','UNKNOWN'].includes(text) ? text : ''; };
function signature(value, secret) { return crypto.createHmac('sha256', secret).update(JSON.stringify([value.studentId, value.files])).digest('hex'); }
function verifiedFiles(record, studentId, secret) {
  const value = record.extraData?.materialIntegrity;
  if (!value || value.studentId !== studentId || !Array.isArray(value.files) || typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(value.signature)) return null;
  const expected = signature(value, secret);
  if (value.signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(value.signature), Buffer.from(expected))) return null;
  const attached = new Set(urls(record.attachPhotos));
  return value.files.filter(file => attached.has(file.url));
}
async function fileFingerprint(root, url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) throw new AppError('证明材料地址无效', 400);
  let relative;
  try { relative = decodeURIComponent(url.slice('/uploads/'.length)); } catch (_) { throw new AppError('证明材料地址无效', 400); }
  const file = await fsp.realpath(resolveInside(root, relative)); const realRoot = await fsp.realpath(root);
  if (!file.startsWith(realRoot + path.sep)) throw new AppError('证明材料地址越界', 403);
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new AppError('查重材料须为 10MB 以内文件', 400);
  const cacheKey=JSON.stringify([file,stat.size,stat.mtimeMs]);
  if(fingerprintCache.has(cacheKey))return {url,sha256:fingerprintCache.get(cacheKey),size:stat.size};
  const hash = crypto.createHash('sha256');let bytes=0;for await (const chunk of fs.createReadStream(file)){bytes+=chunk.length;if(bytes>10*1024*1024)throw new AppError('查重材料超过体积限制',400);hash.update(chunk);}
  const sha256=hash.digest('hex');fingerprintCache.set(cacheKey,sha256);if(fingerprintCache.size>256)fingerprintCache.delete(fingerprintCache.keys().next().value);
  return { url, sha256, size:stat.size };
}

async function scanMaterialIntegrity({ studentId, candidate, Application, root, secret, excludeId }) {
  const records = await Application.findAll({ where:{studentId, status:{[Op.notIn]:['draft','revoked','rejected']},
    ...(excludeId ? {id:{[Op.ne]:Number(excludeId)}} : {})},
    attributes:['id','studentId','title','eventDate','certificateNo','moduleId','status','finalReviewAction','attachPhotos','extraData'],
    order:[['id','DESC']],limit:201 });
  // 再核对归属，防止错误的查询适配器扩大结果；仅比较本人的申报。
  const own = records.filter(row => Number(row.studentId) === studentId && Number(row.id) !== Number(excludeId) && row.finalReviewAction !== 'reject').slice(0,200);
  const legacyAllowed = new Set(own.flatMap(row => urls(row.attachPhotos)));
  if(excludeId){
    const edited=await Application.findByPk(Number(excludeId),{attributes:['id','studentId','attachPhotos']});
    if(!edited||Number(edited.studentId)!==studentId)throw new AppError('无权核对该申报',403);
    urls(edited.attachPhotos).forEach(url=>legacyAllowed.add(url));
  }
  const rawAttachments=attachmentValues(candidate.proofUrl ?? candidate.attachPhotos);
  if(rawAttachments.some(url=>typeof url!=='string'||!url.startsWith('/uploads/')))throw new AppError('材料核对只接受系统上传路径，请重新上传不兼容的历史附件',400);
  const attachments = urls(candidate.proofUrl ?? candidate.attachPhotos);
  if (attachments.length > 10) throw new AppError('单份申报最多核对 10 个附件',400);
  const files=[];
  for (const url of attachments) {
    if (!new RegExp(`^/uploads/\\d{8}_u${studentId}/[^/]+$`).test(url) && !legacyAllowed.has(url)) throw new AppError('只能核对本人上传或本人历史申报的材料',403);
    try { files.push(await fileFingerprint(root,url)); } catch (error) {
      if (error.statusCode) throw error; throw new AppError('证明材料无法读取，请重新上传后核对',400);
    }
  }
  const metadata={studentId,files}; metadata.signature=signature(metadata,secret);
  const hashes=new Set(files.map(file=>file.sha256));const cert=certificateKey(candidate.certificateNo);
  const matches=[];let unreadable=0;let legacyRemaining=40;
  for(const record of own) {
    const reasons=[];const existingUrls=urls(record.attachPhotos);
    if(attachmentValues(record.attachPhotos).length>existingUrls.length)unreadable++;
    if(cert && cert===certificateKey(record.certificateNo)) reasons.push('证书编号相同');
    if(attachments.some(url=>existingUrls.includes(url))) reasons.push('使用了同一份附件');
    let existing=verifiedFiles(record,studentId,secret);
    if(!existing && hashes.size) {
      existing=[];
      for(const url of existingUrls) {
        if(legacyRemaining<=0){unreadable++;continue;} legacyRemaining--;
        try{existing.push(await fileFingerprint(root,url));}catch(_){unreadable++;}
      }
    }
    if(existing?.some(file=>hashes.has(file.sha256))) reasons.push('附件文件内容相同');
    if(key(candidate.title) && key(candidate.title)===key(record.title) && candidate.eventDate
      && String(candidate.eventDate).slice(0,10)===String(record.eventDate).slice(0,10)) reasons.push('成果标题和日期相同');
    if(reasons.length) matches.push({id:record.id,title:record.title,moduleId:record.moduleId,reasons});
  }
  return { metadata, matches, checkedRecords:own.length, incomplete:records.length>200 || unreadable>0,
    notice:'仅核对本人最近 200 条有效申报；重复提示不是违规结论。历史附件读取上限为 40 份，无法核对的材料需人工检查。' };
}
function integrityExtra(extra, scan, reason, formal) {
  const explanation=typeof reason==='string'?reason.trim():'';
  if(explanation.length>500 || (formal && scan.matches.length && explanation.length<5)) throw new AppError('发现可能重复的成果，请填写至少 5 字、最多 500 字的情况说明，交由教师复核',400);
  return {...(extra||{}), materialIntegrity:scan.metadata, duplicateReview:{matches:scan.matches,reason:explanation,
    checkedRecords:scan.checkedRecords,incomplete:scan.incomplete,notice:scan.notice,checkedAt:new Date().toISOString()} };
}
module.exports={scanMaterialIntegrity,integrityExtra,fileFingerprint,certificateKey};
