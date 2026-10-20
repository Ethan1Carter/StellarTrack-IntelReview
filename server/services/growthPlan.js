const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');

const directions = [
  ['morality', '德育实践', ['morality', 'moral', 'F1'], ['参与一次主题教育或公共服务', '记录参与过程与个人反思', '整理可核验的活动证明']],
  ['academy', '学习与创新', ['academy', 'academic', 'competition', 'innovation', 'F2', 'F2b'], ['选择一项课程或创新实践目标', '完成学习复盘或项目阶段记录', '向教师或学习小组征求反馈']],
  ['sports', '体育健康', ['sports', 'sports_arts', 'F3'], ['结合自身情况制定适量运动安排', '记录运动项目与参与过程', '总结执行情况并调整安排']],
  ['arts', '美育实践', ['arts', 'art', 'F4'], ['选择一次艺术实践或文化活动', '保留作品或观摩记录', '整理实践感受与过程证明']],
  ['labor', '劳动与志愿服务', ['labor', 'volunteer', 'F5'], ['选择一项劳动实践或志愿服务', '记录岗位、过程与实际参与时间', '整理服务反思及相关证明']]
];

function normalizePreferences(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('成长偏好格式无效', 400);
  const focusKey = input.focusKey ?? '';
  const goal = input.goal ?? '';
  const weeklyMinutes = input.weeklyMinutes === undefined ? 60 : Number(input.weeklyMinutes);
  const recordStatus = input.recordStatus ?? 'unsure';
  if (typeof focusKey !== 'string' || (focusKey && !directions.some(item => item[0] === focusKey))
    || typeof goal !== 'string' || goal.trim().length > 200 || ![30, 60, 120, 180].includes(weeklyMinutes)
    || !['unsure', 'record_only', 'new_practice'].includes(recordStatus)) throw new AppError('请选择有效方向、时间安排和参与情况，目标不超过 200 字', 400);
  return { focusKey, goal: goal.trim(), weeklyMinutes, recordStatus };
}

function buildGrowthPlan({ summary, applications, academicYear, semester, preferences, now = new Date() }) {
  const choices = normalizePreferences(preferences);
  const scores = summary?.categoryScores || {};
  const records = directions.map(([key, name, aliases]) => ({ key, name,
    recordedScore: aliases.reduce((sum, alias) => sum + (Number(scores[alias]) || 0), 0) }));
  // 只描述已记录证据，不将不同量纲的原始分值排序为学生能力高低。
  const focus = records.find(item => item.key === choices.focusKey) || records.find(item => item.recordedScore === 0) || records[0];
  const actions = choices.recordStatus === 'record_only'
    ? [`梳理已有的「${focus.name}」参与经历`, '补齐已有经历的过程记录与证明', '整理个人反思并向教师征求反馈']
    : [...directions.find(item => item[0] === focus.key)[3]];
  if (choices.recordStatus === 'unsure') actions[0] = `先确认「${focus.name}」已有参与情况，再选择补录或实践安排`;
  if (choices.goal) actions[0] = `围绕个人目标安排「${focus.name}」的第一步`;
  const days = choices.recordStatus === 'record_only' ? [3, 7, 14] : choices.weeklyMinutes >= 120 ? [7, 14, 28] : [7, 21, 35];
  const approvedCount = applications.filter(app => ['approved', 'final_review'].includes(app.status) && app.finalReviewAction !== 'reject').length;
  const tasks = actions.map((title, index) => ({ id: crypto.randomUUID(), title,
    dueAt: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now.getTime() + days[index] * 86400000)),
    status: 'todo', notes: '', attachments: [], feedback: [], history: [] }));
  return { generatedAt: now.toISOString(), source: 'rules', academicYear, semester,
    diagnosis: { totalScore: Number(summary?.totalScore || 0), focus, records, approvedCount, preferences: choices,
      focusReason: choices.focusKey ? '采用学生主动选择的成长方向。' : '从当前缺少记录的维度提供起点，学生可自行选择其他方向；各维度已有记录时提供默认方向。',
      arrangement: `按本人每周可投入约 ${choices.weeklyMinutes} 分钟提供起始安排，可由教师结合实际调整；不代表必须完成的时长。`,
      pendingCount: applications.filter(app => ['approving', 'pending', 'returned'].includes(app.status)).length,
      explanation: '根据当前已记录的评价数据给出行动模板，不代表完整能力诊断；没有记录不等于没有参与，完成任务也不自动加分。' },
    goals: [{ title: choices.goal || `补充「${focus.name}」成长记录`, target: choices.recordStatus === 'record_only' ? '整理已有经历，补齐过程记录与证明' : '结合实际参与情况，选择适合自己的行动并留存证据' },
      { title: '形成可核验的过程', target: '提交执行记录，由教师反馈后调整' }], tasks,
    actions: tasks.map((task, index) => ({ order: index + 1, title: task.title, cycle: task.dueAt, status: '待开始' })) };
}

function adjustTaskDefinition(plan, taskId, input, actor) {
  if (!Number.isInteger(input.revision) || input.revision !== plan.revision) throw new AppError('计划已更新，请刷新后重试', 409);
  const tasks = JSON.parse(JSON.stringify(plan.tasks || []));
  const task = tasks.find(item => item.id === taskId);
  if (!task) throw new AppError('成长任务不存在', 404);
  if (!['todo', 'in_progress', 'returned'].includes(task.status)) throw new AppError('仅未提交核验的任务可以调整；待核验任务请先反馈退回', 409);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const dueAt = input.dueAt;
  const date = typeof dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? new Date(`${dueAt}T00:00:00Z`) : null;
  if (title.length < 2 || title.length > 200 || reason.length < 2 || reason.length > 1000
    || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dueAt) throw new AppError('请填写有效任务名称、截止日期和调整原因', 400);
  if (task.title === title && task.dueAt === dueAt) throw new AppError('任务内容和日期未改变', 400);
  task.history.push({ actorId: actor.userId, actorName: actor.user.realName, status: task.status,
    at: new Date().toISOString(), message: `教师调整任务：${reason}`, reason,
    previousDefinition: { title: task.title, dueAt: task.dueAt }, definition: { title, dueAt } });
  if (task.history.length > 100) throw new AppError('该任务记录已达上限，请联系教师归档', 400);
  task.title = title; task.dueAt = dueAt;
  return { tasks, revision: plan.revision + 1 };
}

function updateTask(plan, taskId, input, actor, reviewing = false) {
  if (!Number.isInteger(input.revision) || input.revision !== plan.revision) throw new AppError('计划已更新，请刷新后重试', 409);
  const tasks = JSON.parse(JSON.stringify(plan.tasks || []));
  const task = tasks.find(item => item.id === taskId);
  if (!task) throw new AppError('成长任务不存在', 404);
  const now = new Date().toISOString();
  let message;
  if (reviewing) {
    if (task.status !== 'submitted') throw new AppError('仅待核验的任务可以反馈', 409);
    if (!['completed', 'returned'].includes(input.decision)) throw new AppError('请选择核验通过或退回补充', 400);
    const feedback = String(input.feedback || '').trim();
    if (feedback.length < 2 || feedback.length > 1000) throw new AppError('请填写 2–1000 字的核验意见', 400);
    task.status = input.decision;
    task.feedback.push({ reviewerId: actor.userId, reviewerName: actor.user.realName, text: feedback, at: now });
    message = feedback;
  } else {
    if (!['todo', 'in_progress', 'returned'].includes(task.status)) throw new AppError('待核验或已完成的任务不能修改', 409);
    if (!['in_progress', 'submitted'].includes(input.status)) throw new AppError('请选择进行中或提交核验', 400);
    const notes = String(input.notes || '').trim();
    const attachments = input.attachments === undefined ? task.attachments : input.attachments;
    if (notes.length > 2000 || !Array.isArray(attachments) || attachments.length > 5
        || attachments.some(url => typeof url !== 'string' || !new RegExp(`^/uploads/\\d{8}_u${actor.userId}/[^/]+$`).test(url))) throw new AppError('记录或证明附件格式无效，只能使用本人上传的证明', 400);
    if (input.status === 'submitted' && notes.length < 5 && !attachments.length) throw new AppError('请填写执行记录（至少5字）或上传证明后提交核验', 400);
    task.status = input.status; task.notes = notes; task.attachments = attachments;
    message = input.status === 'submitted' ? '提交执行记录与证明，等待教师核验' : '更新行动进度';
  }
  task.history.push({ actorId: actor.userId, actorName: actor.user.realName, status: task.status,
    at: now, message, ...(reviewing ? {} : { notes: task.notes, attachments: [...task.attachments] }) });
  if (task.history.length > 100) throw new AppError('该任务记录已达上限，请联系教师归档', 400);
  return { tasks, revision: plan.revision + 1 };
}

module.exports = { buildGrowthPlan, updateTask, normalizePreferences, adjustTaskDefinition };
