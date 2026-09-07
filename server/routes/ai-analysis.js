/**
 * AI 智能分析接口
 * 根据角色返回不同维度的智能分析看板数据
 */
const express = require('express');
const router = express.Router();
const { ScoreSummary, User, Class, College, Application, BonusModule, ApprovalRecord } = require('../models');
const { resolveAcademicTerm, parsePagination } = require('../utils');
const { auth, requireAdmin, requireSchoolAdmin } = require('../middleware/auth');
const { Op, Sequelize } = require('sequelize');
const { AppError } = require('../middleware/errorHandler');

router.use(auth);

const categoryNames = {
  academy: '学业表现', morality: '德育品德', sports: '文体活动',
  competition: '竞赛获奖', volunteer: '志愿服务', innovation: '创新创业',
  scholarship: '奖学金', attendance: '考勤加分', other: '其他'
};

/**
 * 生成智能分析文本建议
 */
function generateInsights(data, context) {
  const insights = [];

  if (context === 'student') {
    if (data.totalScore > 0) {
      const avg = data.classAvg || 0;
      if (Number(data.totalScore) > Number(avg)) {
        insights.push({ type: 'positive', icon: 'CircleCheck', title: '表现优秀', text: `您的综合得分 ${data.totalScore} 分，高于班级平均分 ${avg} 分，继续保持！` });
      } else {
        insights.push({ type: 'warning', icon: 'Warning', title: '需加把劲', text: `您的综合得分 ${data.totalScore} 分，低于班级平均分 ${avg} 分，建议多参与加分活动。` });
      }
    }
    if (data.categoryData && data.categoryData.length > 0) {
      const sorted = [...data.categoryData].sort((a, b) => b.value - a.value);
      insights.push({ type: 'info', icon: 'TrendCharts', title: '优势领域', text: `您在「${sorted[0].name}」类别表现突出，得分 ${sorted[0].value} 分。` });
      if (sorted.length > 1) {
        insights.push({ type: 'suggestion', icon: 'MagicStick', title: '提升建议', text: `建议加强「${sorted[sorted.length - 1].name}」类别的参与，当前仅 ${sorted[sorted.length - 1].value} 分。` });
      }
    } else {
      insights.push({ type: 'suggestion', icon: 'MagicStick', title: '起步建议', text: '您还没有加分记录，建议从学业表现和志愿服务类别开始申报。' });
    }
    if (data.classRank && data.classTotal) {
      const percentile = (1 - data.classRank / data.classTotal) * 100;
      insights.push({ type: 'info', icon: 'Histogram', title: '排名分析', text: `您在班级中排名第 ${data.classRank}/${data.classTotal}，超越了 ${percentile.toFixed(0)}% 的同学。` });
    }
  }

  if (context === 'class') {
    if (data.avgScore > 0) {
      insights.push({ type: 'info', icon: 'DataAnalysis', title: '班级概况', text: `班级平均分 ${data.avgScore} 分，共 ${data.studentCount} 名学生参与考评。` });
    }
    if (data.scoreDistribution) {
      const dist = data.scoreDistribution;
      const highCount = dist.filter(d => d.name === '90+')[0]?.value || 0;
      const lowCount = dist.filter(d => d.name === '0-59')[0]?.value || 0;
      if (highCount > 0) insights.push({ type: 'positive', icon: 'CircleCheck', title: '高分表现', text: `班级有 ${highCount} 名学生得分 90+，表现优异。` });
      if (lowCount > 0) insights.push({ type: 'warning', icon: 'Warning', title: '需关注学生', text: `班级有 ${lowCount} 名学生得分低于 60 分，建议重点关注。` });
    }
    if (data.passRate) {
      insights.push({ type: 'info', icon: 'TrendCharts', title: '申报通过率', text: `班级申报通过率为 ${data.passRate}。` });
    }
    if (data.moduleParticipation && data.moduleParticipation.length > 0) {
      const sorted = [...data.moduleParticipation].sort((a, b) => b.count - a.count);
      insights.push({ type: 'info', icon: 'Trophy', title: '热门模块', text: `「${sorted[0].name}」参与度最高（${sorted[0].count} 次）。` });
    }
  }

  if (context === 'college') {
    if (data.classAverageCompare && data.classAverageCompare.length > 0) {
      const sorted = [...data.classAverageCompare].sort((a, b) => b.value - a.value);
      insights.push({ type: 'positive', icon: 'CircleCheck', title: '领先班级', text: `「${sorted[0].name}」平均分最高（${sorted[0].value} 分）。` });
      if (sorted.length > 1) {
        insights.push({ type: 'warning', icon: 'Warning', title: '需提升班级', text: `「${sorted[sorted.length - 1].name}」平均分最低（${sorted[sorted.length - 1].value} 分），建议加强辅导。` });
      }
    }
    if (data.modulePassRates && data.modulePassRates.length > 0) {
      const lowRate = data.modulePassRates.filter(m => m.rate < 60);
      if (lowRate.length > 0) {
        insights.push({ type: 'warning', icon: 'Warning', title: '低通过率模块', text: `「${lowRate.map(m => m.name).join('、')}」通过率低于 60%，建议检查申报标准。` });
      }
    }
    insights.push({ type: 'info', icon: 'DataAnalysis', title: '院系概况', text: `本院系共 ${data.classCount} 个班级参与考评。` });
  }

  if (context === 'school') {
    if (data.collegeCompare && data.collegeCompare.length > 0) {
      const sorted = [...data.collegeCompare].sort((a, b) => b.value - a.value);
      insights.push({ type: 'positive', icon: 'CircleCheck', title: '领先院系', text: `「${sorted[0].name}」平均分全校第一（${sorted[0].value} 分）。` });
      insights.push({ type: 'warning', icon: 'Warning', title: '待提升院系', text: `「${sorted[sorted.length - 1].name}」平均分最低（${sorted[sorted.length - 1].value} 分）。` });
    }
    if (data.monthlyTrend && data.monthlyTrend.length > 0) {
      const total = data.monthlyTrend.reduce((s, m) => s + m.count, 0);
      insights.push({ type: 'info', icon: 'TrendCharts', title: '申报趋势', text: `全年共收到 ${total} 次申报，月均 ${Math.round(total / 12)} 次。` });
    }
    insights.push({ type: 'info', icon: 'DataAnalysis', title: '全校概况', text: `全校共 ${data.totalColleges} 个院系参与综合考评。` });
  }

  return insights;
}

/**
 * GET /api/ai-analysis/student - 学生AI分析看板
 */
router.get('/student', auth, async (req, res, next) => {
  try {
    const studentId = req.userId;
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const summary = await ScoreSummary.findOne({ where: { studentId, academicYear: y, semester: s } });
    const classId = req.user.classId;

    // 班级平均分
    let classAvg = 0;
    if (classId) {
      const classSummaries = await ScoreSummary.findAll({ where: { classId, academicYear: y, semester: s }, attributes: ['totalScore'] });
      classAvg = classSummaries.length ? (classSummaries.reduce((t, r) => t + Number(r.totalScore || 0), 0) / classSummaries.length).toFixed(2) : '0.00';
    }

    const categoryData = [];
    const categoryScores = summary?.categoryScores || {};
    for (const k of Object.keys(categoryNames)) {
      if (categoryScores[k]) {
        categoryData.push({ name: categoryNames[k], value: Number(categoryScores[k]), key: k });
      }
    }

    // 趋势
    const apps = await Application.findAll({
      where: { studentId, status: 'approved', approvedAt: { [Op.not]: null } },
      attributes: ['approvedAt', 'finalScore']
    });
    const monthMap = {};
    for (const app of apps) {
      const m = app.approvedAt ? String(app.approvedAt).slice(5, 7) : '01';
      monthMap[m] = (monthMap[m] || 0) + Number(app.finalScore || 0);
    }
    const trend = [];
    for (let i = 1; i <= 12; i++) {
      const k = String(i).padStart(2, '0');
      trend.push({ month: `${i}月`, score: Number(monthMap[k] || 0).toFixed(2) });
    }

    // 同班同学分数对比
    let peerComparison = [];
    if (classId) {
      const peers = await ScoreSummary.findAll({
        where: { classId, academicYear: y, semester: s },
        include: [{ association: 'student', attributes: ['id', 'realName'] }],
        order: [['totalScore', 'DESC']],
        limit: 20
      });
      peerComparison = peers.map((p, i) => ({ rank: i + 1, name: p.student?.realName || '', score: Number(p.totalScore).toFixed(2), isMe: p.studentId === studentId }));
    }

    const data = {
      totalScore: Number(summary?.totalScore || 0).toFixed(2),
      classAvg,
      classRank: summary?.classRank || null,
      classTotal: classId ? await ScoreSummary.count({ where: { classId, academicYear: y, semester: s } }) : 0,
      appCount: summary?.applicationCount || 0,
      categoryData,
      trend,
      peerComparison
    };

    data.insights = generateInsights(data, 'student');
    res.success(data);
  } catch (err) { next(err); }
});

/**
 * GET /api/ai-analysis/class - 班级AI分析看板
 */
router.get('/class', auth, async (req, res, next) => {
  try {
    const classId = req.query.classId;
    if (!classId && req.role !== 'counselor') return res.fail('classId必填');
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    let classIds = [classId];
    if (req.role === 'counselor') {
      const classes = await Class.findAll({ where: { counselorId: req.userId } });
      classIds = classes.map(c => c.id);
      if (classId) classIds = [Number(classId)];
    }

    const summaries = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName', 'studentNo'] }]
    });

    const totalScore = summaries.reduce((sum, r) => sum + Number(r.totalScore || 0), 0);
    const avgScore = summaries.length ? (totalScore / summaries.length).toFixed(2) : '0.00';

    const ranges = [
      { label: '0-59', min: 0, max: 60, count: 0 },
      { label: '60-69', min: 60, max: 70, count: 0 },
      { label: '70-79', min: 70, max: 80, count: 0 },
      { label: '80-89', min: 80, max: 90, count: 0 },
      { label: '90+', min: 90, max: 9999, count: 0 }
    ];
    for (const r of summaries) {
      const t = Number(r.totalScore || 0);
      for (const range of ranges) { if (t >= range.min && t < range.max) { range.count++; break; } }
    }

    const approvedApps = await Application.findAll({
      where: { classId: { [Op.in]: classIds }, status: 'approved', academicYear: y, semester: s },
      group: ['moduleId'],
      attributes: ['moduleId', [Sequelize.fn('COUNT', '*'), 'count']],
      raw: true
    });
    const moduleIds = approvedApps.map(item => item.moduleId).filter(Boolean);
    const moduleRows = moduleIds.length
      ? await BonusModule.findAll({ where: { id: { [Op.in]: moduleIds } }, attributes: ['id', 'name'], raw: true })
      : [];
    const moduleNameById = new Map(moduleRows.map(item => [Number(item.id), item.name]));
    const moduleParticipation = approvedApps.map(item => ({
      name: moduleNameById.get(Number(item.moduleId)) || '未知',
      count: Number(item.count)
    }));

    const topStudents = summaries
      .sort((a, b) => Number(b.totalScore) - Number(a.totalScore))
      .slice(0, 10)
      .map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    // 识别需要关注的学生（低于60分）
    const atRiskStudents = summaries
      .filter(r => Number(r.totalScore) < 60)
      .map(r => ({ name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2), studentNo: r.student?.studentNo || '' }));

    const total = await Application.count({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } });
    const passed = await Application.count({ where: { classId: { [Op.in]: classIds }, status: 'approved', academicYear: y, semester: s } });
    const passRate = total ? ((passed / total) * 100).toFixed(1) + '%' : '0%';

    const data = {
      studentCount: summaries.length,
      avgScore,
      totalApproved: passed,
      passRate,
      scoreDistribution: ranges.map(r => ({ name: r.label, value: r.count })),
      moduleParticipation,
      topStudents,
      atRiskStudents
    };

    data.insights = generateInsights(data, 'class');
    res.success(data);
  } catch (err) { next(err); }
});

/**
 * GET /api/ai-analysis/college - 院系AI分析看板
 */
router.get('/college', auth, async (req, res, next) => {
  try {
    let collegeId = req.query.collegeId;
    if (req.role === 'college_admin') collegeId = req.user.collegeId;
    if (!collegeId && req.role !== 'school_admin' && req.role !== 'super_admin') return res.fail('collegeId必填');

    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const collegeWhere = collegeId ? { collegeId } : {};
    const classes = await Class.findAll({ where: collegeWhere, attributes: ['id', 'name'] });
    const classIds = classes.map(c => c.id);

    const classScores = classIds.length
      ? await ScoreSummary.findAll({
          where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
          attributes: ['classId', 'totalScore'],
          raw: true
        })
      : [];
    const scoresByClass = new Map();
    for (const row of classScores) {
      const classId = Number(row.classId);
      const bucket = scoresByClass.get(classId) || { total: 0, count: 0 };
      bucket.total += Number(row.totalScore || 0);
      bucket.count++;
      scoresByClass.set(classId, bucket);
    }
    const classAvg = classes.map(item => {
      const bucket = scoresByClass.get(Number(item.id));
      return { name: item.name, value: bucket?.count ? Number((bucket.total / bucket.count).toFixed(2)) : 0 };
    });

    const top = await ScoreSummary.findAll({
      where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
      include: [{ association: 'student', attributes: ['id', 'realName'] }],
      order: [['totalScore', 'DESC']],
      limit: 20
    });
    const topStudents = top.map((r, i) => ({ rank: i + 1, name: r.student?.realName || '', score: Number(r.totalScore).toFixed(2) }));

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'], raw: true });
    const applicationStats = classIds.length
      ? await Application.findAll({
          where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s },
          attributes: ['moduleId', 'status', [Sequelize.fn('COUNT', '*'), 'count']],
          group: ['moduleId', 'status'],
          raw: true
        })
      : [];
    const countsByModule = new Map();
    for (const row of applicationStats) {
      const moduleId = Number(row.moduleId);
      const bucket = countsByModule.get(moduleId) || { total: 0, passed: 0 };
      const count = Number(row.count || 0);
      bucket.total += count;
      if (row.status === 'approved') bucket.passed += count;
      countsByModule.set(moduleId, bucket);
    }
    const moduleStats = modules.flatMap(item => {
      const bucket = countsByModule.get(Number(item.id));
      if (!bucket?.total) return [];
      return [{
        name: item.name,
        total: bucket.total,
        passed: bucket.passed,
        rate: Number(((bucket.passed / bucket.total) * 100).toFixed(1))
      }];
    });

    const data = {
      classCount: classes.length,
      classAverageCompare: classAvg,
      topStudents,
      modulePassRates: moduleStats
    };

    data.insights = generateInsights(data, 'college');
    res.success(data);
  } catch (err) { next(err); }
});

/**
 * GET /api/ai-analysis/school - 全校AI分析看板
 */
router.get('/school', requireSchoolAdmin, async (req, res, next) => {
  try {
    const { academicYear, semester } = req.query;
    const term = resolveAcademicTerm();
    const y = academicYear || term.academicYear;
    const s = semester || term.semester;

    const colleges = await College.findAll({ attributes: ['id', 'name'], raw: true });
    const schoolClasses = await Class.findAll({ attributes: ['id', 'collegeId'], raw: true });
    const collegeByClass = new Map(schoolClasses.map(item => [Number(item.id), Number(item.collegeId)]));
    const allSummaries = await ScoreSummary.findAll({
      where: { academicYear: y, semester: s },
      attributes: ['classId', 'totalScore'],
      raw: true
    });
    const scoresByCollege = new Map();
    for (const row of allSummaries) {
      const collegeId = collegeByClass.get(Number(row.classId));
      if (!collegeId) continue;
      const bucket = scoresByCollege.get(collegeId) || { total: 0, count: 0 };
      bucket.total += Number(row.totalScore || 0);
      bucket.count++;
      scoresByCollege.set(collegeId, bucket);
    }
    const collegeCompare = colleges.map(item => {
      const bucket = scoresByCollege.get(Number(item.id));
      return { name: item.name, value: bucket?.count ? Number((bucket.total / bucket.count).toFixed(2)) : 0 };
    });

    const apps = await Application.findAll({
      attributes: ['submittedAt'],
      where: { submittedAt: { [Op.not]: null }, academicYear: y, semester: s }
    });
    const monthMap = {};
    for (const a of apps) {
      if (!a.submittedAt) continue;
      const k = String(a.submittedAt).slice(0, 7);
      monthMap[k] = (monthMap[k] || 0) + 1;
    }
    const months = Object.keys(monthMap).sort().slice(-12);
    const monthlyTrend = months.map(m => ({ month: m.slice(5) + '月', count: monthMap[m] }));

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'], raw: true });
    const moduleCounts = await Application.findAll({
      where: { academicYear: y, semester: s },
      attributes: ['moduleId', [Sequelize.fn('COUNT', '*'), 'count']],
      group: ['moduleId'],
      raw: true
    });
    const countByModule = new Map(moduleCounts.map(item => [Number(item.moduleId), Number(item.count)]));
    const moduleStats = modules.flatMap(item => {
      const count = countByModule.get(Number(item.id)) || 0;
      return count ? [{ name: item.name, value: count }] : [];
    });

    // 全校分数分布
    const ranges = [
      { label: '0-59', min: 0, max: 60, count: 0 },
      { label: '60-69', min: 60, max: 70, count: 0 },
      { label: '70-79', min: 70, max: 80, count: 0 },
      { label: '80-89', min: 80, max: 90, count: 0 },
      { label: '90+', min: 90, max: 9999, count: 0 }
    ];
    for (const r of allSummaries) {
      const t = Number(r.totalScore || 0);
      for (const range of ranges) { if (t >= range.min && t < range.max) { range.count++; break; } }
    }

    const data = {
      totalColleges: colleges.length,
      totalStudents: allSummaries.length,
      collegeCompare,
      monthlyTrend,
      moduleStats,
      scoreDistribution: ranges.map(r => ({ name: r.label, value: r.count }))
    };

    data.insights = generateInsights(data, 'school');
    res.success(data);
  } catch (err) { next(err); }
});

/**
 * GET /api/ai-analysis/comprehensive - 综合AI智能分析接口
 * 支持参数: scope(范围), collegeId, major, grade, classId, studentId
 * 权限继承：上一级角色自动拥有下级全部分析权限
 */
router.get('/comprehensive', auth, async (req, res, next) => {
  try {
    const { scope, collegeId, major, grade, classId, studentId } = req.query;
    const result = await getComprehensiveAnalysis({
      scope, collegeId, major, grade, classId, studentId,
      userId: req.userId, role: req.role, user: req.user
    });
    res.success(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/ai-analysis/report - 生成分析报表（支持导出）
 */
router.get('/report', auth, async (req, res, next) => {
  try {
    const { format = 'json', scope, collegeId, major, grade, classId, studentId } = req.query;

    const comprehensiveData = await getComprehensiveAnalysis({
      scope, collegeId, major, grade, classId, studentId,
      userId: req.userId, role: req.role, user: req.user
    });

    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();

      // Sheet 1: 概览
      const overviewData = [
        ['分析范围', comprehensiveData.scope],
        ['学期', comprehensiveData.period],
        ['学生总数', comprehensiveData.summary.totalStudents || (comprehensiveData.summary.name ? 1 : 0)],
        ['平均分数', comprehensiveData.summary.avgScore || comprehensiveData.summary.totalScore],
        ['申报总数', comprehensiveData.summary.totalApplications || comprehensiveData.summary.appCount],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewData), '概览');

      // Sheet 2: 活跃度指标
      if (comprehensiveData.activityMetrics) {
        const metricsData = Object.entries(comprehensiveData.activityMetrics).map(([k, v]) => ({
          '指标': k,
          '数值': String(v)
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metricsData), '活跃度指标');
      }

      // Sheet 3: 模块分析
      if (comprehensiveData.moduleAnalysis && comprehensiveData.moduleAnalysis.length > 0) {
        const moduleData = comprehensiveData.moduleAnalysis.map(m => ({
          '模块名称': m.name,
          '申报数': m.count,
          '占比': m.percentage
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moduleData), '模块分析');
      }

      // Sheet 4: AI洞察与建议
      const insightsData = [
        ...(comprehensiveData.insights || []).map(i => ({
          '类型': i.type,
          '标题': i.title || '',
          '内容': i.content || i.text || String(i)
        })),
        ...(comprehensiveData.risks || []).map(r => ({
          '类型': '风险(' + (r.level || '') + ')',
          '标题': r.title || '',
          '内容': r.desc || r.content || String(r)
        })),
        ...(comprehensiveData.suggestions || []).map(s => ({
          '类型': '建议',
          '标题': '',
          '内容': typeof s === 'string' ? s : (s.content || String(s))
        }))
      ];
      if (insightsData.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(insightsData), 'AI洞察与建议');
      }

      // Sheet 5: 多维度横向对比
      if (comprehensiveData.crossComparison && comprehensiveData.crossComparison.length > 0) {
        const ccData = comprehensiveData.crossComparison.map(c => ({
          '对比维度': c.dimension,
          '现状说明': c.content,
          '行业/管理基准': c.benchmark,
          '差距分析': c.gap
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ccData), '横向对比分析');
      }

      // Sheet 6: 异常数据标注
      if (comprehensiveData.anomalyNotes && comprehensiveData.anomalyNotes.length > 0) {
        const anData = comprehensiveData.anomalyNotes.map(a => ({
          '严重级别': a.level,
          '异常类别': a.category,
          '问题描述': a.description,
          '业务影响': a.impact,
          '整改建议': a.recommendation
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(anData), '异常数据标注');
      }

      // Sheet 7: 问题成因推测
      if (comprehensiveData.causeAnalysis && comprehensiveData.causeAnalysis.length > 0) {
        const csRows = [];
        comprehensiveData.causeAnalysis.forEach(c => {
          (c.possibleCauses || []).forEach((cause, idx) => {
            csRows.push({
              '问题名称': c.problem,
              '推测置信度': c.confidence || '-',
              '成因序号': idx + 1,
              '可能成因': cause
            });
          });
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(csRows), '问题成因推测');
      }

      // Sheet 8: 可落地改善举措
      if (comprehensiveData.improvementActions && comprehensiveData.improvementActions.length > 0) {
        const iaData = comprehensiveData.improvementActions.map(a => ({
          '执行序号': a.order,
          '优先级': a.priority,
          '行动名称': a.action,
          '详细执行方案': a.detail,
          '预期效果': a.expectedEffect,
          '预计周期': a.timeEstimate
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(iaData), '改善举措落地');
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ai_analysis_report_${Date.now()}.xlsx"`);
      res.send(buf);
    } else {
      res.success({
        report: comprehensiveData,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.realName || req.user?.username || '系统'
      });
    }
  } catch (err) { next(err); }
});

async function getComprehensiveAnalysis(params) {
  const { scope, collegeId, major, grade, classId, studentId, userId, role, user } = params;
  const term = resolveAcademicTerm();
  const y = term.academicYear;
  const s = term.semester;

  const isSchoolAdmin = ['school_admin', 'super_admin'].includes(role);
  const isCollegeAdmin = role === 'college_admin';
  const isCounselor = role === 'counselor';
  const isClassAdmin = role === 'class_admin';
  const isStudent = role === 'student';

  const allowedScopes = [];
  if (isStudent) allowedScopes.push('student');
  if (isClassAdmin) allowedScopes.push('student', 'class');
  if (isCounselor) allowedScopes.push('student', 'class');
  if (isCollegeAdmin) allowedScopes.push('student', 'class', 'college');
  if (isSchoolAdmin) allowedScopes.push('student', 'class', 'college', 'school');

  const currentScope = scope || (isStudent ? 'student' : (isClassAdmin || isCounselor ? 'class' : (isCollegeAdmin ? 'college' : 'school')));

  if (!allowedScopes.includes(currentScope)) {
    throw new AppError(`无权限进行${currentScope}范围的分析`, 403);
  }

  let collegeIdNum = collegeId ? Number(collegeId) : null;
  const classWhere = {};

  if (isStudent && userId) {
    const student = await User.findByPk(userId, {
      include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
    });
    if (!student) throw new AppError('学生不存在', 404);
    collegeIdNum = student.classInfo?.collegeId ? Number(student.classInfo.collegeId) : null;
    classWhere.id = student.classId;
  } else if (isClassAdmin && userId) {
    const admin = await User.findByPk(userId, {
      include: [{ association: 'classInfo', attributes: ['id', 'name', 'collegeId'] }]
    });
    if (!admin) throw new AppError('班级管理员不存在', 404);
    collegeIdNum = admin.classInfo?.collegeId ? Number(admin.classInfo.collegeId) : null;
    classWhere.id = admin.classId;
  } else if (isCollegeAdmin && user?.collegeId) {
    if (collegeIdNum && collegeIdNum !== Number(user.collegeId)) {
      throw new AppError('无权限查看其他院系统计', 403);
    }
    collegeIdNum = Number(user.collegeId);
  }

  if (collegeIdNum) classWhere.collegeId = collegeIdNum;
  if (major) classWhere.major = major;
  if (grade) classWhere.grade = grade;
  if (classId) classWhere.id = Number(classId);

  if (isCounselor && userId) {
    const myClasses = await Class.findAll({ where: { counselorId: userId }, attributes: ['id'] });
    const myIds = myClasses.map(c => c.id);
    if (classId) {
      if (!myIds.includes(Number(classId))) throw new AppError('无权限', 403);
      classWhere.id = Number(classId);
    } else {
      classWhere.id = { [Op.in]: myIds };
    }
  }

  const classes = await Class.findAll({ where: classWhere, attributes: ['id', 'name'] });
  const classIds = classes.map(c => c.id);

  const result = {
    scope: currentScope,
    period: `${y}学年${s === 'first' ? '第一学期' : '第二学期'}`,
    summary: {},
    activityMetrics: {},
    moduleAnalysis: [],
    scoreDistribution: [],
    unitComparison: [],
    insights: [],
    risks: [],
    suggestions: [],
    crossComparison: [],
    anomalyNotes: [],
    causeAnalysis: [],
    improvementActions: []
  };

  // 确定学生ID - 如果未指定studentId但scope为student，使用当前用户ID
    let effectiveStudentId = studentId;
    if (currentScope === 'student' && !effectiveStudentId && (isStudent || isClassAdmin)) {
      effectiveStudentId = userId;
    }

    if (currentScope === 'student' && effectiveStudentId) {
    const sid = Number(effectiveStudentId);
    const summary = await ScoreSummary.findOne({ where: { studentId: sid, academicYear: y, semester: s } });
    const allApps = await Application.findAll({ where: { studentId: sid, academicYear: y, semester: s } });

    result.summary = {
      name: userId === sid ? user?.realName : '',
      totalScore: Number(summary?.totalScore || 0).toFixed(2),
      appCount: allApps.length,
      classRank: summary?.classRank,
      classTotal: summary?.classTotal || 0
    };

    const submittedApps = allApps.filter(a => a.status !== 'draft');
    const approvedApps = allApps.filter(a => a.status === 'final_review');
    const rejectedApps = allApps.filter(a => a.status === 'rejected');
    const appealApps = allApps.filter(a => a.status === 'appealing' || a.status === 'appeal_closed');
    const draftApps = allApps.filter(a => a.status === 'draft');
    const pendingApps = allApps.filter(a => ['submitted', 'approving', 'approved'].includes(a.status));

    result.activityMetrics = {
      activeStatus: submittedApps.length > 0 ? '活跃' : '待激活',
      submissionCount: allApps.length,
      approvalRate: allApps.length > 0 ? ((approvedApps.length / allApps.length) * 100).toFixed(1) + '%' : '-',
      rejectionRate: allApps.length > 0 ? ((rejectedApps.length / allApps.length) * 100).toFixed(1) + '%' : '-',
      appealCount: appealApps.length,
      draftCount: draftApps.length,
      pendingCount: pendingApps.length
    };

    const insights = [];
    const total = Number(summary?.totalScore || 0);
    const classTotal = result.summary.classTotal;
    const classRank = result.summary.classRank;

    if (total > 0) {
      if (classRank && classTotal) {
        const percentile = ((classTotal - classRank) / classTotal * 100).toFixed(1);
        if (percentile >= 80) {
          insights.push({ type: 'positive', title: '优秀表现', content: `排名班级前20%，表现优秀，继续保持！` });
        } else if (percentile >= 50) {
          insights.push({ type: 'info', title: '良好表现', content: '排名处于班级中等偏上，仍有提升空间。' });
        } else {
          insights.push({ type: 'warning', title: '需要努力', content: '排名靠后，建议多参与加分活动。' });
        }
      }
    } else {
      insights.push({ type: 'suggestion', title: '起步建议', content: '暂无加分记录，建议从学业表现、志愿服务等类别开始申报。' });
    }

    if (draftApps.length > 0) {
      insights.push({ type: 'warning', title: '待处理草稿', content: `您有 ${draftApps.length} 份草稿未提交，建议尽快完成提交。` });
    }

    if (rejectedApps.length > 0) {
      insights.push({ type: 'risk', title: '驳回分析', content: `有 ${rejectedApps.length} 份申报被驳回，建议查看驳回原因并修正后重新提交。` });
    }

    result.insights = insights;

    const risks = [];
    if (pendingApps.length > 3) {
      risks.push({ level: 'medium', title: '待处理单据较多', desc: `当前有 ${pendingApps.length} 份申报待审批，建议关注审批进度。` });
    }
    if (draftApps.length > 5) {
      risks.push({ level: 'low', title: '草稿堆积', desc: `有 ${draftApps.length} 份草稿未提交，可能存在遗忘。` });
    }
    result.risks = risks;

    const suggestions = [];
    if (approvedApps.length === 0 && allApps.length > 0) {
      suggestions.push('分析已驳回申报的原因，针对性修正后重新提交');
    }
    if (allApps.length < 3) {
      suggestions.push('增加申报频次，至少参与3项以上加分活动');
    }
    if (draftApps.length > 0) {
      suggestions.push('及时处理草稿，避免错过申报时间窗口');
    }
    if (suggestions.length === 0) {
      suggestions.push('保持当前良好的申报习惯，争取更多维度的加分');
    }
    result.suggestions = suggestions;

    // ===== 新增分析维度：多维度横向对比 =====
    const crossComparison = [];
    if (classRank && classTotal) {
      const percentile = ((classTotal - classRank) / classTotal * 100).toFixed(1);
      crossComparison.push({
        dimension: '班级排名横向对比',
        content: `您在班级 ${classTotal} 人中排名第 ${classRank} 名，处于前 ${percentile}% 分位。`,
        benchmark: classTotal > 0 ? `班级前20%为优秀线` : '-',
        gap: Number(percentile) >= 80 ? '已达到优秀水平' : `距离前20%还差 ${Math.max(0, classRank - Math.ceil(classTotal * 0.2))} 个名次`
      });
    }
    // 模块维度对比
    const byModule = {};
    for (const a of allApps) {
      if (!byModule[a.moduleId]) byModule[a.moduleId] = { count: 0, score: 0, approved: 0 };
      byModule[a.moduleId].count++;
      if (a.finalScore) byModule[a.moduleId].score += Number(a.finalScore);
      if (a.status === 'final_review' || a.status === 'approved') byModule[a.moduleId].approved++;
    }
    const moduleNames = {};
    for (const m of await BonusModule.findAll({ attributes: ['id', 'name', 'maxScore'] })) {
      moduleNames[m.id] = { name: m.name, max: Number(m.maxScore || 0) };
    }
    const moduleScores = Object.entries(byModule).map(([mid, d]) => ({
      name: moduleNames[mid]?.name || '未知模块',
      score: d.score,
      max: moduleNames[mid]?.max || 0,
      ratio: moduleNames[mid]?.max > 0 ? ((d.score / moduleNames[mid].max) * 100).toFixed(0) + '%' : '-'
    })).sort((a, b) => b.score - a.score);
    if (moduleScores.length > 0) {
      const strongest = moduleScores[0];
      const weakest = moduleScores[moduleScores.length - 1];
      crossComparison.push({
        dimension: '模块得分横向对比',
        content: `「${strongest.name}」得分最高（${strongest.score}分，占上限${strongest.ratio}），「${weakest.name}」得分最低（${weakest.score}分，占上限${weakest.ratio}）。`,
        benchmark: '各模块均衡发展，建议无短板且有突出项',
        gap: weakest.score < strongest.score * 0.3 ? `弱模块得分仅为强模块的 ${((weakest.score / strongest.score) * 100).toFixed(0)}%，存在明显短板` : '模块得分相对均衡'
      });
    }
    result.crossComparison = crossComparison;

    // ===== 新增分析维度：异常数据标注 =====
    const anomalyNotes = [];
    if (draftApps.length >= 5) {
      anomalyNotes.push({
        level: 'warning',
        category: '草稿异常',
        description: `草稿数量达 ${draftApps.length} 份，远超正常水平（1-2份）`,
        impact: '可能导致错过申报截止期，历史努力白费',
        recommendation: '建议逐一梳理草稿，要么完成提交，要么明确放弃删除'
      });
    }
    if (rejectedApps.length >= 2 && rejectedApps.length >= allApps.length * 0.4 && allApps.length > 0) {
      anomalyNotes.push({
        level: 'high',
        category: '驳回率异常',
        description: `驳回率达 ${((rejectedApps.length / allApps.length) * 100).toFixed(0)}%，超过40%警戒线`,
        impact: '申报效率低下，时间与精力投入未获得对应回报',
        recommendation: '建议详细阅读每个驳回理由，对照加分标准修正申报材料，必要时咨询班级管理员'
      });
    }
    if (pendingApps.length >= 4) {
      anomalyNotes.push({
        level: 'info',
        category: '审批积压异常',
        description: `当前待审批单据 ${pendingApps.length} 份，超过4份以上积压`,
        impact: '可能影响加分生效时效性，导致学期末集中审批压力',
        recommendation: '可联系班级管理员或辅导员确认审批进度，及时补充审批所需材料'
      });
    }
    if (summary && Number(summary.totalScore || 0) === 0 && allApps.length === 0 && studentCount !== undefined) {
      anomalyNotes.push({
        level: 'info',
        category: '零参与异常',
        description: '本学期未提交任何申报记录，为零参与状态',
        impact: '学期综合评价无加分项，可能影响评优评先及毕业资格审查',
        recommendation: '建议至少完成学业表现、志愿服务等基础模块的申报'
      });
    }
    // 模块上限异常
    for (const ms of moduleScores) {
      if (ms.max > 0 && ms.score > ms.max * 0.95) {
        anomalyNotes.push({
          level: 'info',
          category: '模块上限预警',
          description: `「${ms.name}」得分 ${ms.score} 已接近模块上限 ${ms.max} 分`,
          impact: '继续申报该模块无法再积累分数，投入产出比下降',
          recommendation: '建议转移精力至其他得分空间更大的模块'
        });
      }
    }
    result.anomalyNotes = anomalyNotes;

    // ===== 新增分析维度：问题成因推测 =====
    const causeAnalysis = [];
    if (allApps.length < 2) {
      causeAnalysis.push({
        problem: '申报参与度不足',
        possibleCauses: [
          '对加分政策和申报流程了解不充分，不知道如何申报',
          '时间精力投入有限，未关注可参与的加分活动',
          '缺乏申报积极性，未意识到加分对综合评价的影响'
        ],
        confidence: Number(summary?.totalScore || 0) === 0 ? '高' : '中'
      });
    }
    if (rejectedApps.length > allApps.length * 0.3 && allApps.length > 0) {
      causeAnalysis.push({
        problem: '高驳回率问题',
        possibleCauses: [
          '未仔细阅读对应模块的加分标准，申报条件不满足',
          '佐证材料不完整，缺乏关键证明附件（如照片、证书、签到记录）',
          '事件描述不清晰，无法核实加分事实的真实性与有效性',
          '选择了错误的加分模块，将A类活动填报到B类模块'
        ],
        confidence: '高'
      });
    }
    if (draftApps.length > 3) {
      causeAnalysis.push({
        problem: '草稿大量堆积',
        possibleCauses: [
          '申报过程中缺少佐证材料，待补充后未返回继续完成',
          '对申报内容把握不准，处于犹豫观望状态未提交',
          '多次发起申报但中途放弃，形成历史遗留草稿',
          '忘记了已创建草稿，缺乏申报完成的提醒机制'
        ],
        confidence: '中'
      });
    }
    if (moduleScores.length >= 2) {
      const highest = moduleScores[0];
      const lowest = moduleScores[moduleScores.length - 1];
      if (lowest.score < highest.score * 0.2 && highest.score > 0) {
        causeAnalysis.push({
          problem: '模块得分不均衡',
          possibleCauses: [
            '个人兴趣与参与偏好集中，忽视了其他模块的加分机会',
            '对得分较低模块的活动信息获取渠道有限，不知道有哪些可参与的活动',
            '低得分模块的参与门槛相对较高，缺乏对应资源或能力'
          ],
          confidence: '中'
        });
      }
    }
    result.causeAnalysis = causeAnalysis;

    // ===== 新增分析维度：可落地参考改善举措 =====
    const improvementActions = [];
    let actionOrder = 1;
    if (allApps.length < 3) {
      improvementActions.push({
        order: actionOrder++,
        priority: 'P0',
        action: '建立周度申报检查机制',
        detail: '每周日晚固定30分钟梳理本周可申报事项，对照加分模块清单逐一核对是否有遗漏，目标在本学期内至少完成3项有效申报。',
        expectedEffect: '本学期内申报数量提升至3份以上',
        timeEstimate: '第1-2周完成机制建立，持续执行'
      });
    }
    if (draftApps.length > 0) {
      improvementActions.push({
        order: actionOrder++,
        priority: 'P0',
        action: '草稿清零专项行动',
        detail: `对当前 ${draftApps.length} 份草稿执行"3天清零计划"：第1天分类判断（继续补全/直接删除），第2天补充佐证材料，第3天完成全部可提交草稿的提交。`,
        expectedEffect: '草稿数量降至1份以内或全部清空',
        timeEstimate: '3天内完成'
      });
    }
    if (rejectedApps.length > 0) {
      improvementActions.push({
        order: actionOrder++,
        priority: 'P1',
        action: '驳回申诉复盘训练',
        detail: '打开每一份被驳回申报，逐条摘抄驳回理由，对照加分标准找出差距点；如为材料缺失则建立"申报材料清单模板"，后续申报前逐一勾选。',
        expectedEffect: '下次申报驳回率降低至10%以下',
        timeEstimate: '1周内完成复盘，模板沉淀长期复用'
      });
    }
    if (moduleScores.length >= 2) {
      const weakMods = moduleScores.slice(-2).filter(m => m.score < 5);
      if (weakMods.length > 0) {
        improvementActions.push({
          order: actionOrder++,
          priority: 'P1',
          action: '薄弱模块突破计划',
          detail: `针对「${weakMods.map(m => m.name).join('、')}」等得分薄弱模块，制定专项突破方案：①咨询班级管理员了解对应活动类型；②加入相关社团或志愿群获取活动信息；③每月至少参与1次该类活动并完成申报。`,
          expectedEffect: '薄弱模块得分较当前提升至少3-5分',
          timeEstimate: '学期中持续推进，按月检视进展'
        });
      }
    }
    if (Number(summary?.totalScore || 0) < 30 && (classTotal || 0) > 0) {
      improvementActions.push({
        order: actionOrder++,
        priority: 'P2',
        action: '基础分数达标攻坚',
        detail: '优先选择"低门槛、高确定性"的加分活动：学业表现（保持考勤与成绩）、志愿服务（校内志愿活动）、文体活动（院级比赛参与奖）三类是快速积累基础分的首选。',
        expectedEffect: '快速积累20-30分基础分，脱离低分区间',
        timeEstimate: '1-2个月内见效'
      });
    }
    if (improvementActions.length === 0) {
      improvementActions.push({
        order: 1,
        priority: 'P2',
        action: '持续精进保持优势',
        detail: '当前个人考评表现良好，建议：①在强势模块继续保持领先；②在中腰部模块再上一个台阶；③主动分享申报经验给同班同学，形成正向学习氛围。',
        expectedEffect: '班级排名稳步提升，冲击Top 10%',
        timeEstimate: '全学期持续执行'
      });
    }
    result.improvementActions = improvementActions;

  } else {
    const studentCount = classIds.length > 0
      ? await User.count({ where: { classId: { [Op.in]: classIds }, role: { [Op.in]: ['student', 'class_admin'] } } })
      : 0;

    const allApps = classIds.length > 0
      ? await Application.findAll({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } })
      : [];

    const summaries = classIds.length > 0
      ? await ScoreSummary.findAll({ where: { classId: { [Op.in]: classIds }, academicYear: y, semester: s } })
      : [];

    const totalScore = summaries.reduce((sum, s) => sum + Number(s.totalScore || 0), 0);
    const avgScore = summaries.length > 0 ? (totalScore / summaries.length).toFixed(2) : '0.00';

    result.summary = {
      totalStudents: studentCount,
      totalClasses: classes.length,
      avgScore,
      totalApplications: allApps.length
    };

    const submittedApps = allApps.filter(a => a.status !== 'draft');
    const approvedApps = allApps.filter(a => a.status === 'final_review');
    const rejectedApps = allApps.filter(a => a.status === 'rejected');
    const appealApps = allApps.filter(a => a.status === 'appealing' || a.status === 'appeal_closed');
    const appealClosedApps = allApps.filter(a => a.status === 'appeal_closed');
    const draftApps = allApps.filter(a => a.status === 'draft');
    const pendingApps = allApps.filter(a => ['submitted', 'approving', 'approved'].includes(a.status));

    const activeStudentIds = new Set(submittedApps.map(a => a.studentId));
    const activeStudents = activeStudentIds.size;

    const approvedWithTime = allApps.filter(a => a.status === 'final_review' && a.submittedAt && a.approvedAt);
    let avgApprovalTime = 0;
    if (approvedWithTime.length > 0) {
      const totalTime = approvedWithTime.reduce((sum, a) => sum + (new Date(a.approvedAt) - new Date(a.submittedAt)), 0);
      avgApprovalTime = Math.round(totalTime / approvedWithTime.length / (1000 * 60 * 60));
    }

    result.activityMetrics = {
      activeStudents,
      activeRate: studentCount > 0 ? ((activeStudents / studentCount) * 100).toFixed(1) + '%' : '0%',
      avgSubmissions: studentCount > 0 ? (allApps.length / studentCount).toFixed(1) : '0',
      avgApprovalTime: avgApprovalTime + '小时',
      appealTotal: appealApps.length,
      appealResolveRate: appealApps.length > 0 ? ((appealClosedApps.length / appealApps.length) * 100).toFixed(1) + '%' : '-',
      rejectionRate: allApps.length > 0 ? ((rejectedApps.length / allApps.length) * 100).toFixed(1) + '%' : '-',
      draftCount: draftApps.length,
      pendingCount: pendingApps.length
    };

    const modules = await BonusModule.findAll({ attributes: ['id', 'name'] });
    for (const m of modules) {
      const count = allApps.filter(a => a.moduleId === m.id).length;
      if (count > 0) {
        result.moduleAnalysis.push({
          name: m.name,
          count,
          percentage: allApps.length > 0 ? ((count / allApps.length) * 100).toFixed(1) + '%' : '0%'
        });
      }
    }
    result.moduleAnalysis.sort((a, b) => b.count - a.count);

    const ranges = [
      { name: '90+', min: 90, max: 9999, count: 0 },
      { name: '80-89', min: 80, max: 90, count: 0 },
      { name: '70-79', min: 70, max: 80, count: 0 },
      { name: '60-69', min: 60, max: 70, count: 0 },
      { name: '0-59', min: 0, max: 60, count: 0 }
    ];
    for (const s of summaries) {
      const score = Number(s.totalScore || 0);
      for (const range of ranges) {
        if (score >= range.min && score < range.max) { range.count++; break; }
      }
    }
    result.scoreDistribution = ranges.map(r => ({
      name: r.name, value: r.count,
      percentage: summaries.length > 0 ? ((r.count / summaries.length) * 100).toFixed(1) + '%' : '0%'
    }));

    if (currentScope === 'class') {
      const classAvgData = [];
      for (const cls of classes) {
        const clsSummaries = await ScoreSummary.findAll({
          where: { classId: cls.id, academicYear: y, semester: s },
          attributes: ['totalScore']
        });
        const clsAvg = clsSummaries.length > 0
          ? (clsSummaries.reduce((t, r) => t + Number(r.totalScore || 0), 0) / clsSummaries.length).toFixed(2)
          : '0.00';
        const clsApps = allApps.filter(a => a.classId === cls.id);
        const clsApproved = clsApps.filter(a => a.status === 'final_review').length;
        const passRate = clsApps.length > 0 ? ((clsApproved / clsApps.length) * 100).toFixed(1) + '%' : '-';
        classAvgData.push({ name: cls.name, value: Number(clsAvg), passRate });
      }
      result.unitComparison = classAvgData.sort((a, b) => b.value - a.value);
    } else if (currentScope === 'college') {
      const collegeClasses = await Class.findAll({ where: { collegeId: collegeIdNum || user?.collegeId }, attributes: ['id', 'name'] });
      const classAvgData = [];
      for (const cls of collegeClasses) {
        const clsSummaries = await ScoreSummary.findAll({
          where: { classId: cls.id, academicYear: y, semester: s },
          attributes: ['totalScore']
        });
        const clsAvg = clsSummaries.length > 0
          ? (clsSummaries.reduce((t, r) => t + Number(r.totalScore || 0), 0) / clsSummaries.length).toFixed(2)
          : '0.00';
        const clsApps = await Application.findAll({ where: { classId: cls.id, academicYear: y, semester: s } });
        const clsApproved = clsApps.filter(a => a.status === 'final_review').length;
        const passRate = clsApps.length > 0 ? ((clsApproved / clsApps.length) * 100).toFixed(1) + '%' : '-';
        classAvgData.push({ name: cls.name, value: Number(clsAvg), passRate });
      }
      result.unitComparison = classAvgData.sort((a, b) => b.value - a.value);
    } else if (currentScope === 'school') {
      const colleges = await College.findAll({ attributes: ['id', 'name'] });
      const collegeAvgData = [];
      for (const col of colleges) {
        const colClasses = await Class.findAll({ where: { collegeId: col.id }, attributes: ['id'] });
        if (colClasses.length === 0) {
          collegeAvgData.push({ name: col.name, value: 0, passRate: '-' });
          continue;
        }
        const colIds = colClasses.map(c => c.id);
        const colSummaries = await ScoreSummary.findAll({
          where: { classId: { [Op.in]: colIds }, academicYear: y, semester: s },
          attributes: ['totalScore']
        });
        const colAvg = colSummaries.length > 0
          ? (colSummaries.reduce((t, r) => t + Number(r.totalScore || 0), 0) / colSummaries.length).toFixed(2)
          : '0.00';
        const colApps = await Application.findAll({ where: { classId: { [Op.in]: colIds }, academicYear: y, semester: s } });
        const colApproved = colApps.filter(a => a.status === 'final_review').length;
        const passRate = colApps.length > 0 ? ((colApproved / colApps.length) * 100).toFixed(1) + '%' : '-';
        collegeAvgData.push({ name: col.name, value: Number(colAvg), passRate });
      }
      result.unitComparison = collegeAvgData.sort((a, b) => b.value - a.value);
    }

    const insights = [];
    if (summaries.length > 0) {
      const highCount = ranges[0].count + ranges[1].count;
      const lowCount = ranges[4].count;

      if (highCount > 0) {
        insights.push({ type: 'positive', title: '高分表现', content: `${highCount} 人获得80分以上，整体表现良好。` });
      }
      if (lowCount > 0) {
        insights.push({ type: 'warning', title: '关注学生', content: `${lowCount} 人得分低于60分，建议重点关注。` });
      }

      if (activeStudents > 0) {
        insights.push({ type: 'info', title: '参与度', content: `${activeStudents}/${studentCount} 名学生参与了考评，参与率 ${result.activityMetrics.activeRate}。` });
      }

      if (rejectedApps.length > 0) {
        insights.push({ type: 'risk', title: '驳回率', content: `有 ${rejectedApps.length} 份申报被驳回，驳回率 ${result.activityMetrics.rejectionRate}。` });
      }

      if (result.moduleAnalysis.length > 0) {
        insights.push({ type: 'info', title: '热门模块', content: `「${result.moduleAnalysis[0].name}」最受欢迎，共 ${result.moduleAnalysis[0].count} 次申报。` });
      }
    }

    result.insights = insights;

    const risks = [];
    if (pendingApps.length > studentCount * 2) {
      risks.push({ level: 'high', title: '待审批积压', desc: `有 ${pendingApps.length} 份单据待审批，可能影响审批时效。` });
    }
    if (draftApps.length > studentCount) {
      risks.push({ level: 'medium', title: '草稿堆积', desc: `有 ${draftApps.length} 份草稿未提交，可能存在大量待完成申报。` });
    }
    if (activeStudents < studentCount * 0.5 && studentCount > 0) {
      risks.push({ level: 'medium', title: '参与率偏低', desc: `仅 ${result.activityMetrics.activeRate} 的学生参与考评，低于50%。` });
    }
    if (rejectedApps.length > allApps.length * 0.3 && allApps.length > 0) {
      risks.push({ level: 'high', title: '驳回率过高', desc: `驳回率达 ${result.activityMetrics.rejectionRate}，建议检查申报标准。` });
    }
    result.risks = risks;

    const suggestions = [];
    if (activeStudents < studentCount * 0.7 && studentCount > 0) {
      suggestions.push('加强宣传推广，提升学生参与度，目标参与率80%以上');
    }
    if (pendingApps.length > 0) {
      suggestions.push('优化审批流程，减少积压，目标审批时效24小时内');
    }
    if (rejectedApps.length > allApps.length * 0.2 && allApps.length > 0) {
      suggestions.push('组织申报培训，降低驳回率，目标驳回率10%以下');
    }
    if (result.moduleAnalysis.length > 0) {
      const lessPopular = result.moduleAnalysis.slice(-2);
      if (lessPopular.length > 0) {
        suggestions.push(`推广「${lessPopular.map(m => m.name).join('、')}」等参与度较低的模块`);
      }
    }
    if (suggestions.length === 0) {
      suggestions.push('当前状态良好，继续保持现有管理措施');
    }
    result.suggestions = suggestions;

    // ===== 组织级：多维度横向对比 =====
    const crossComparison = [];
    // 1. 参与率对比
    const activeRateNum = activeStudents / Math.max(1, studentCount);
    let participationBenchmark = '';
    if (activeRateNum >= 0.8) participationBenchmark = '远高于60%合格线，处于第一梯队';
    else if (activeRateNum >= 0.6) participationBenchmark = '达到60%合格线，中等偏上水平';
    else if (activeRateNum >= 0.4) participationBenchmark = '低于60%合格线，需加强推动';
    else participationBenchmark = '参与率严重不足，急需专项提升行动';
    crossComparison.push({
      dimension: '学生参与率横向对比',
      content: `当前范围学生总数 ${studentCount} 人，实际参与申报 ${activeStudents} 人，参与率 ${result.activityMetrics.activeRate}。`,
      benchmark: `60%为合格线，80%以上为优秀水平。当前：${participationBenchmark}`,
      gap: studentCount > 0 ? `距离80%优秀目标还需激活 ${Math.max(0, Math.ceil(studentCount * 0.8) - activeStudents)} 名学生` : '-'
    });

    // 2. 单位横向对比（班级/学院间）
    if (result.unitComparison && result.unitComparison.length >= 3) {
      const topUnit = result.unitComparison[0];
      const bottomUnit = result.unitComparison[result.unitComparison.length - 1];
      const midValue = result.unitComparison.reduce((s, u) => s + u.value, 0) / result.unitComparison.length;
      const gapRatio = topUnit.value > 0 ? ((bottomUnit.value / topUnit.value) * 100).toFixed(1) : '0';
      crossComparison.push({
        dimension: `${currentScope === 'school' ? '学院' : '班级'}均分横向对比`,
        content: `第一名「${topUnit.name}」均分 ${topUnit.value} 分，末位「${bottomUnit.name}」均分 ${bottomUnit.value} 分，中位线 ${midValue.toFixed(2)} 分。`,
        benchmark: `建议末位单位均分达到中位线的80%以上，Top3差距控制在30%以内`,
        gap: Number(gapRatio) < 60 ? `末位单位仅为头部的 ${gapRatio}%，差距超过40%，存在两极分化风险` : `单位间差距在合理区间内（差距 ${(100 - Number(gapRatio)).toFixed(0)}%）`
      });

      // 通过率对比
      const passRates = result.unitComparison.map(u => {
        const p = parseFloat(u.passRate);
        return { name: u.name, passRate: isNaN(p) ? 0 : p };
      }).sort((a, b) => b.passRate - a.passRate);
      if (passRates.length > 0) {
        const topPass = passRates[0];
        const botPass = passRates[passRates.length - 1];
        crossComparison.push({
          dimension: `${currentScope === 'school' ? '学院' : '班级'}通过率横向对比`,
          content: `通过率最高「${topPass.name}」${topPass.passRate.toFixed(1)}%，最低「${botPass.name}」${botPass.passRate.toFixed(1)}%。`,
          benchmark: '单位间通过率差距建议控制在20个百分点以内，最低值不低于50%',
          gap: (topPass.passRate - botPass.passRate) > 20 ? `高低差距达 ${(topPass.passRate - botPass.passRate).toFixed(0)} 个百分点，分化明显` : '通过率差距处于可控区间'
        });
      }
    }

    // 3. 模块集中度对比
    if (result.moduleAnalysis.length >= 3) {
      const top3Count = result.moduleAnalysis.slice(0, 3).reduce((s, m) => s + m.count, 0);
      const totalCount = result.moduleAnalysis.reduce((s, m) => s + m.count, 0);
      const concentration = totalCount > 0 ? ((top3Count / totalCount) * 100).toFixed(1) : '0';
      crossComparison.push({
        dimension: '模块申报集中度对比',
        content: `Top3热门模块「${result.moduleAnalysis.slice(0, 3).map(m => m.name).join('、')}」合计占比 ${concentration}%。`,
        benchmark: '合理区间为50%-70%，过高说明参与不均衡，过低说明无主流模块引导',
        gap: Number(concentration) > 75 ? `集中度偏高（${concentration}%），学生申报集中在少数模块，可能造成"偏科"` : Number(concentration) < 40 ? `集中度过低（${concentration}%），缺乏重点引导的加分方向` : '模块分布结构健康，集中度处于合理区间'
      });
    }
    result.crossComparison = crossComparison;

    // ===== 组织级：异常数据标注 =====
    const anomalyNotes = [];
    if (studentCount > 0 && activeRateNum < 0.4) {
      anomalyNotes.push({
        level: 'high',
        category: '参与率严重异常',
        description: `参与率仅 ${result.activityMetrics.activeRate}，低于40%临界线`,
        impact: '大量学生未参与考评，学期整体加分数据缺失，将导致班级/学院排名严重落后',
        recommendation: '建议立即启动"全员参与专项"：①开主题班会宣讲政策；②班级管理员逐人提醒；③设置第一周/第二周阶段性参与率目标'
      });
    }
    if (result.activityMetrics.rejectionRate && parseFloat(result.activityMetrics.rejectionRate) > 25) {
      anomalyNotes.push({
        level: 'high',
        category: '驳回率异常偏高',
        description: `整体驳回率 ${result.activityMetrics.rejectionRate}，超过25%红线`,
        impact: '学生投入大量时间准备但未获得认可，严重打击后续申报积极性，形成"驳回-放弃"恶性循环',
        recommendation: '①统计驳回原因Top3并形成典型案例库；②组织专项培训讲解加分标准与材料要求；③建立班级管理员预审机制，班级管理员审核后再提交'
      });
    }
    if (result.activityMetrics.pendingCount && Number(result.activityMetrics.pendingCount) > Math.max(5, studentCount * 0.1)) {
      anomalyNotes.push({
        level: 'warning',
        category: '审批效率异常',
        description: `待审批积压 ${result.activityMetrics.pendingCount} 份，占学生总数 ${studentCount > 0 ? ((result.activityMetrics.pendingCount / studentCount) * 100).toFixed(0) : 0}%`,
        impact: '审批链路过长导致加分延迟生效，学生无法及时看到成果，影响申报意愿；学期末集中审批会给管理员造成巨大压力',
        recommendation: '①建立审批SLA：班级管理员12小时内响应，辅导员24小时内终审；②设置审批提醒：每日推送待办给对应管理员；③周度通报各班级审批积压情况'
      });
    }
    if (result.unitComparison && result.unitComparison.length > 0) {
      const below50Units = result.unitComparison.filter(u => u.value < 50);
      if (below50Units.length > 0) {
        anomalyNotes.push({
          level: 'warning',
          category: '低分单位异常',
          description: `「${below50Units.map(u => u.name).join('、')}」共 ${below50Units.length} 个${currentScope === 'school' ? '学院' : '班级'}均分低于50分`,
          impact: '这些单位整体考评表现明显落后，可能存在管理缺位或学生意识薄弱问题',
          recommendation: '对低分单位进行一对一帮扶督导：①约谈对应辅导员/班级管理员；②派遣优秀单位经验分享；③设立专项提升计划，每周检视进展'
        });
      }
    }
    if (appealApps.length > Math.max(5, allApps.length * 0.05)) {
      anomalyNotes.push({
        level: 'warning',
        category: '申诉量异常',
        description: `申诉总量 ${appealApps.length} 份，占申报总量的 ${allApps.length > 0 ? ((appealApps.length / allApps.length) * 100).toFixed(1) : 0}%`,
        impact: '大量申诉说明审批结果存在较大争议，可能损害审批流程的公正性和权威性',
        recommendation: '①分析申诉通过/驳回比例，找出争议集中的加分模块；②审查审批标准的一致性执行情况；③组织审批人员培训统一判定尺度'
      });
    }
    result.anomalyNotes = anomalyNotes;

    // ===== 组织级：问题成因推测 =====
    const causeAnalysis = [];
    if (activeRateNum < 0.6 && studentCount > 0) {
      causeAnalysis.push({
        problem: `${currentScope === 'school' ? '全校' : currentScope === 'college' ? '全院' : '班级'}学生参与率不足`,
        possibleCauses: [
          '加分政策宣导不到位：新生未系统培训，老生对政策更新不了解',
          '信息传递链路断裂：辅导员→班级管理员→学生的通知传导存在衰减，末端学生未及时收到活动信息',
          '缺乏参与动力：未看到加分对评优评先、保研、就业的实际价值体现',
          '申报门槛较高：移动端入口不明显、附件上传繁琐、填写流程复杂导致学生望而却步',
          '榜样示范效应不足：高年级优秀学生的加分案例和心得未被分享'
        ],
        confidence: activeRateNum < 0.4 ? '高' : '中'
      });
    }
    if (parseFloat(result.activityMetrics.rejectionRate || '0') > 20) {
      causeAnalysis.push({
        problem: '系统性高驳回率问题',
        possibleCauses: [
          '加分标准定义模糊：不同审批人对同一事件的判定标准不一致，学生无法准确预判能否通过',
          '缺乏申报预审机制：学生直接提交到终审环节，无班级管理员预审和指导过程',
          '未建立正向学习机制：驳回理由简单粗糙，学生不知道具体错在哪里、如何改进',
          '模块错配现象突出：跨模块申报严重，活动类型与申报模块不匹配导致批量驳回',
          '材料要求不明确：未提供可参考的优秀申报范例和附件清单模板'
        ],
        confidence: '高'
      });
    }
    if (result.unitComparison && result.unitComparison.length >= 4) {
      const values = result.unitComparison.map(u => u.value);
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
      const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;
      if (cv > 0.4) {
        causeAnalysis.push({
          problem: `${currentScope === 'school' ? '学院' : '班级'}间发展不均衡`,
          possibleCauses: [
            '资源分配不均：头部单位拥有更多社团、活动、竞赛资源，弱势单位缺乏渠道',
            '管理层重视度差异：部分辅导员/班级管理员积极推动，其他单位处于"放任自流"状态',
            '学生基数结构问题：不同专业/班级学风、活动参与文化存在客观差异',
            '经验传承机制缺失：优秀单位的成功方法论未被系统化总结和推广复制'
          ],
          confidence: '中'
        });
      }
    }
    if (parseFloat(result.activityMetrics.appealResolveRate || '0') < 60 && appealApps.length >= 3) {
      causeAnalysis.push({
        problem: '申诉处理效率低下',
        possibleCauses: [
          '申诉处理流程未明确责任人和SLA，处于"谁有空谁处理"的松散状态',
          '申诉举证材料审核标准不清晰，处理人来回要求补充材料',
          '申诉待办未进入审批人的日常工作清单，容易被遗忘和积压'
        ],
        confidence: '中'
      });
    }
    result.causeAnalysis = causeAnalysis;

    // ===== 组织级：可落地参考改善举措 =====
    const improvementActions = [];
    let orgOrder = 1;
    if (activeRateNum < 0.7 && studentCount > 0) {
      improvementActions.push({
        order: orgOrder++,
        priority: 'P0',
        action: '"百日冲刺·全员参与"专项行动',
        detail: `① 第1周：政策宣导覆盖100%学生（线下班会+线上推送+海报张贴）；② 第2周：完成零申报学生一对一谈话，分类建立参与意愿清单；③ 第3-4周：组织2-3场低门槛、高性价比的集中申报活动（如志愿服务专场、学习打卡竞赛）；④ 每周通报各班级参与率排名，对后进班级点名督导。`,
        expectedEffect: `4周内参与率从 ${result.activityMetrics.activeRate} 提升至70%以上`,
        timeEstimate: '4周专项行动，后续纳入常态管理'
      });
    }
    if (parseFloat(result.activityMetrics.rejectionRate || '0') > 15) {
      improvementActions.push({
        order: orgOrder++,
        priority: 'P0',
        action: '申报质量提升"三大工程"',
        detail: '① 标准公开工程：发布《加分标准+驳回案例汇编》，每个模块至少附3份"优秀申报样例"和3份"驳回典型案例"；② 预审前置工程：建立班级管理员预审机制，预审不通过不允许提交终审；③ 定期培训工程：每月开展1次线上申报培训，针对高驳回模块重点讲解。',
        expectedEffect: `整体驳回率从 ${result.activityMetrics.rejectionRate} 降低至15%以内`,
        timeEstimate: '2周完成汇编发布，1个月见效，季度迭代更新案例库'
      });
    }
    if (Number(result.activityMetrics.pendingCount || 0) > 3) {
      improvementActions.push({
        order: orgOrder++,
        priority: 'P1',
        action: '审批效率SLA与看板管理',
        detail: `① 制定分级时效：班级管理员审批≤12小时，辅导员终审≤24小时，申诉处理≤48小时；② 建立"审批积压看板"，每日上午10点自动推送TOP5积压人提醒；③ 月度审批时效排名公示，连续两月垫底者由上级约谈；④ 引入"超时自动升级"机制：超过SLA 24小时自动升级至上级处理。`,
        expectedEffect: `平均审批时长控制在24小时内，积压量降至 ${Math.ceil(Number(result.activityMetrics.pendingCount || 0) * 0.3)} 份以下`,
        timeEstimate: '第1周完成规则发布，第2周系统配置，长期执行'
      });
    }
    if (result.unitComparison && result.unitComparison.length >= 3) {
      const bottomUnits = result.unitComparison.slice(-Math.ceil(result.unitComparison.length * 0.3));
      if (bottomUnits.length > 0) {
        improvementActions.push({
          order: orgOrder++,
          priority: 'P1',
          action: `"${bottomUnits.map(u => u.name).length > 3 ? bottomUnits.map(u => u.name).slice(0, 3).join('、') + '等' + bottomUnits.length + '个' : bottomUnits.map(u => u.name).join('、')}" 后进单位精准帮扶计划`,
          detail: '① "一对一"结对：每个后进单位与Top3优秀单位结对，定期召开联席会；② 经验复制：优秀单位输出《加分工作手册》，后进单位结合自身情况制定《提升行动方案》；③ 资源倾斜：向后进单位优先分配活动资源、竞赛名额、志愿岗位；④ 月度复盘：每月检视后进单位进步情况，未达预期的单位由辅导员/学院管理员当面述职。',
          expectedEffect: `后进单位均分提升10-15分，整体方差缩小30%，CV降至0.3以内`,
          timeEstimate: '学期内持续推进，每月检视进度'
        });
      }
    }
    if (draftApps.length > Math.max(10, studentCount * 0.2)) {
      improvementActions.push({
        order: orgOrder++,
        priority: 'P2',
        action: '草稿清理与提醒机制建设',
        detail: `针对当前 ${draftApps.length} 份历史草稿：① 系统批量推送草稿待处理通知（短信+站内信+班级管理员转达）；② 规定"72小时清理期"，过期未处理草稿系统自动删除并短信通知作者；③ 长效机制：草稿创建第3天自动提醒，第7天再次提醒，超10天自动归档。`,
        expectedEffect: `草稿存量清理80%以上，增量草稿72小时内处理率达90%`,
        timeEstimate: '1周完成集中清理，2周上线长效提醒机制'
      });
    }
    if (improvementActions.length === 0) {
      improvementActions.push({
        order: 1,
        priority: 'P2',
        action: '管理创新示范与标杆沉淀',
        detail: '当前整体运营状态健康，建议：① 筛选TOP3优秀单位作为"加分管理示范单位"，拍摄经验分享视频；② 提炼优秀实践（如审批机制、培训方法、激励方案）形成《管理最佳实践白皮书》，全校推广；③ 探索创新：引入"积分兑换""班级PK排行榜"等游戏化运营手段，持续提升参与热情。',
        expectedEffect: '打造3-5个标杆示范，全校整体水平再上一个台阶',
        timeEstimate: '学期中后期启动，学期末完成白皮书沉淀'
      });
    }
    result.improvementActions = improvementActions;
  }

  return result;
}

module.exports = router;
