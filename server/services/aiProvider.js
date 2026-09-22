const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp'
]);

const LEVEL_KEYWORDS = [
  ['international', ['国际', '世界', '全球']],
  ['national', ['国家级', '全国', '中国']],
  ['provincial', ['省级', '省赛', '省部级']],
  ['school', ['校级', '学校', '校赛']],
  ['college', ['院级', '学院', '系级']]
];

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function parseJsonContent(content) {
  const text = String(content || '').trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch (_error) {
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI 返回内容不是有效 JSON');
    return JSON.parse(match[0]);
  }
}

function inferAwardLevel(text) {
  const source = String(text || '');
  return LEVEL_KEYWORDS.find(([, keywords]) => keywords.some(keyword => source.includes(keyword)))?.[0] || 'other';
}

function chooseModule(text, modules, preferredModuleId) {
  if (preferredModuleId) {
    const preferred = modules.find(module => Number(module.id) === Number(preferredModuleId));
    if (preferred) return preferred;
  }
  const source = String(text || '').toLowerCase();
  const keywordMap = [
    ['志愿', ['志愿', '公益', '服务']],
    ['体育', ['体育', '运动', '比赛', '马拉松']],
    ['艺术', ['艺术', '文艺', '美术', '音乐']],
    ['创新', ['创新', '创业', '专利', '项目']],
    ['竞赛', ['竞赛', '比赛', '大赛', '获奖']],
    ['德育', ['优秀学生', '先进', '思想', '社会实践']]
  ];
  const matched = keywordMap.find(([, keywords]) => keywords.some(keyword => source.includes(keyword)))?.[0];
  return modules.find(module => String(module.name || '').includes(matched || '')) || modules[0] || null;
}

function normalizeReview(value, context) {
  const modules = context.modules || [];
  const text = [context.fileName, context.title, context.description].filter(Boolean).join(' ');
  const suggestedModule = modules.find(module => Number(module.id) === Number(value?.suggestedModuleId))
    || chooseModule(text, modules, context.moduleId);
  const maxScore = Number(suggestedModule?.singleMaxScore || suggestedModule?.yearlyMaxScore || 1);
  const awardLevel = value?.awardLevel || inferAwardLevel(text);
  const riskFlags = Array.isArray(value?.riskFlags)
    ? value.riskFlags.map(flag => typeof flag === 'string' ? { code: 'ai', label: flag, severity: 'medium' } : flag).filter(Boolean)
    : [];
  const evidence = Array.isArray(value?.evidence) ? value.evidence.filter(Boolean).slice(0, 8) : [];

  return {
    title: String(value?.title || context.title || context.fileName || '未命名成果').slice(0, 200),
    eventDate: value?.eventDate || null,
    certificateNo: value?.certificateNo || null,
    awardLevel,
    description: String(value?.description || context.description || '请根据证明材料补充成果说明').slice(0, 500),
    suggestedModuleId: suggestedModule ? Number(suggestedModule.id) : null,
    suggestedModuleName: suggestedModule?.name || null,
    scoreSuggestion: clamp(value?.scoreSuggestion || 1, 0, maxScore),
    confidence: clamp(value?.confidence ?? 0.55, 0, 1),
    riskFlags,
    evidence,
    nextAction: String(value?.nextAction || '请由班级管理员核验原件、日期和获奖等级后确认').slice(0, 300)
  };
}

function fallbackReview(context) {
  const text = [context.fileName, context.title, context.description].filter(Boolean).join(' ');
  const module = chooseModule(text, context.modules || [], context.moduleId);
  return normalizeReview({
    title: context.title || context.fileName || '成长成果材料',
    awardLevel: inferAwardLevel(text),
    suggestedModuleId: module?.id,
    scoreSuggestion: 1,
    confidence: 0.42,
    evidence: ['当前未配置外部模型，已使用本地规则完成初步归类'],
    riskFlags: [{ code: 'manual_review', label: '需要人工核验材料真伪与评分标准', severity: 'high' }],
    nextAction: '请补充成果说明并由管理员人工确认'
  }, context);
}

async function callCompatibleModel(context, filePath, mimeType) {
  if (!config.ai.enabled || !config.ai.apiKey) {
    return { ...fallbackReview(context), provider: 'local-rule', mode: 'fallback' };
  }

  const moduleOptions = (context.modules || []).map(module => ({
    id: Number(module.id),
    name: module.name,
    category: module.category,
    singleMaxScore: module.singleMaxScore,
    yearlyMaxScore: module.yearlyMaxScore
  }));
  const instructions = [
    '你是高校五育综合评价材料审核助手。你只做信息抽取、分类和审核建议，不直接替代人工审批。',
    '请严格返回 JSON，不要 Markdown，不要额外解释。',
    '字段必须包含：title、eventDate、certificateNo、awardLevel、description、suggestedModuleId、scoreSuggestion、confidence、riskFlags、evidence、nextAction。',
    'awardLevel 只能是 international、national、provincial、school、college、other 或 null。',
    'scoreSuggestion 必须参考候选模块的 singleMaxScore，不得超过上限；无法判断时返回 1。',
    'riskFlags 是对象数组，每项包含 code、label、severity；severity 只能是 low、medium、high。',
    'evidence 必须列出你实际使用的材料事实或用户输入，不得编造。',
    `用户补充标题：${context.title || '无'}`,
    `用户补充说明：${context.description || '无'}`,
    `文件名：${context.fileName || path.basename(filePath)}`,
    `候选加分模块：${JSON.stringify(moduleOptions)}`
  ].join('\n');

  const content = [{ type: 'text', text: instructions }];
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    const buffer = await fs.readFile(filePath);
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` }
    });
  } else {
    content.push({ type: 'text', text: '该附件为 PDF。若无法直接读取文件内容，请根据文件名和用户补充信息返回低置信度结果，并标记需要人工复核。' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content }]
      })
    });
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`);
    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;
    const parsed = parseJsonContent(rawContent);
    return { ...normalizeReview(parsed, context), provider: config.ai.model, mode: 'model' };
  } finally {
    clearTimeout(timer);
  }
}

async function reviewMaterial(context, filePath, mimeType) {
  try {
    return await callCompatibleModel(context, filePath, mimeType);
  } catch (error) {
    return {
      ...fallbackReview(context),
      provider: 'local-rule',
      mode: 'fallback',
      warning: `AI 服务暂不可用，已降级为本地规则：${error.message}`
    };
  }
}

module.exports = { reviewMaterial };
