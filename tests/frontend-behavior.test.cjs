const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { parse, compileScript } = require('vue/compiler-sfc');
const { transformSync } = createRequire(require.resolve('vite/package.json'))('esbuild');
const { File } = require('node:buffer');
const vue = require('vue');

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function evaluate(filename, source, mocks, sessionStorage = storage()) {
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const code = transformSync(source, { format: 'cjs', loader: 'js', target: 'es2022' }).code;
  const globals = { module, exports: module.exports, require: id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    sessionStorage, FormData, Blob, File, URL, setTimeout, clearTimeout, console, window: { open() {} } };
  vm.runInNewContext(code, globals, { filename });
  return module.exports;
}
const messages = new Proxy({}, { get: () => () => {} });
function component(relative, mocks = {}, sessionStorage = storage(), props = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'behavior-test' }).content;
  const mounted = [];
  const store = { role: 'school_admin', userId: 9, userInfo: { id: 9, collegeId: 10, classId: 100 } };
  const defaults = {
    vue: { ...vue, onMounted: fn => mounted.push(fn) },
    'vue-router': { useRouter: () => ({ push() {} }), useRoute: () => ({ query: {} }) },
    'element-plus': { ElMessage: messages }, '@element-plus/icons-vue': {},
    '@/stores/user': { useUserStore: () => store },
    '@/components/WorkspaceHero.vue': {}, '@/components/BaseChart.vue': {}, '@/components/AIReviewEvidence.vue': {},
    '@/api/applications': { getMySemesters: async () => [] }, '@/api/modules': { listActiveModules: async () => [] },
    '@/api/ai-material': {}, '@/constants/roles': { ROLE_GROUPS: { STUDENT_LIKE: ['student', 'class_admin'] } },
    '@/api/growth-plans': {},
    '@/utils/request': async () => []
  };
  const compiled = evaluate(filename, script, { ...defaults, ...mocks }, sessionStorage);
  const scope = vue.effectScope();
  const state = scope.run(() => compiled.default.setup(props, { expose() {} }));
  return { state, mounted, stop: () => scope.stop(), sessionStorage };
}

test('网络故障保留登录，明确认证失效清理登录', async () => {
  const filename = path.resolve(__dirname, '../src/stores/user.js');
  let error = new Error('network timeout');
  let loggedOutConfig;
  const definition = evaluate(filename, fs.readFileSync(filename, 'utf8'), {
    pinia: { defineStore: (_name, definition) => definition },
    '@/api/auth': { getMeApi: async () => { throw error; }, logoutApi: async config => { loggedOutConfig = config; } },
    '@/api/profile': {}, 'element-plus': { ElMessage: messages },
    '@/constants/roles': { ROLES: {}, ROLE_GROUPS: {}, ROLE_LABELS: {}, isDeveloper: () => false }
  }).useUserStore;
  const store = { ...definition.state(), ...definition.actions, token: 'retained-token', userInfo: { id: 9 } };
  await store.refreshUser();
  assert.equal(store.token, 'retained-token');
  assert.equal(store.userInfo.id, 9);
  error = { response: { status: 401 } };
  await store.refreshUser();
  assert.equal(store.token, '');
  store.token = 'logout-token';
  await store.logout();
  assert.equal(loggedOutConfig.headers.Authorization, 'Bearer logout-token');
  assert.equal(store.token, '');
});

test('更换班级使旧 AI 报告失效，旧请求不能覆盖新筛选', async () => {
  let resolveOld;
  const fixture = component('src/views/dashboard/Index.vue', { '@/utils/request': () => new Promise(resolve => { resolveOld = resolve; }) });
  try {
    const state = fixture.state;
    state.appliedFilters.classId = 100;
    state.aiInsights.value = ['旧班级结论'];
    const pending = state.loadAIAnalysis();
    state.clearAIAnalysis();
    state.appliedFilters.classId = 200;
    assert.equal(state.aiInsights.value.length, 0);
    resolveOld({ insights: [{ text: '旧请求结论' }] });
    await pending;
    assert.equal(state.aiInsights.value.length, 0);
    assert.equal(state.aiLoading.value, false);
  } finally { fixture.stop(); }
});

test('附件上传未完成时不能提交，删除上传中的文件不会被迟到响应带回', async () => {
  let resolveUpload;
  let submitCount = 0;
  const fixture = component('src/views/application/Apply.vue', { '@/api/applications': {
    uploadProof: () => new Promise(resolve => { resolveUpload = resolve; }), createApplication: async () => { submitCount++; }
  } });
  try {
    const state = fixture.state;
    const file = { uid: 1, name: 'proof.pdf', raw: new File(['proof'], 'proof.pdf', { type: 'application/pdf' }) };
    state.fileList.value = [file];
    const upload = state.onFileChange(file);
    assert.equal(state.pendingUploads.value, 1);
    await state.submit(false);
    assert.equal(submitCount, 0);
    state.removeFile(file);
    resolveUpload({ urls: ['/uploads/20261019_u9/proof.pdf'] });
    await upload;
    assert.equal(state.fileList.value.length, 0);
    assert.equal(state.uploadedUrls.value.length, 0);
    assert.equal(state.pendingUploads.value, 0);
  } finally { fixture.stop(); }
});

test('AI 材料清单按账号保存，返回页面恢复其他材料', async () => {
  const sessionStorage = storage();
  const fixture = component('src/views/ai/MaterialReview.vue', {}, sessionStorage);
  fixture.state.materials.value = [
    { id: 1, fileUrl: '/uploads/20261019_u9/a.pdf', status: 'done', result: { title: 'A' } },
    { id: 2, fileUrl: '/uploads/20261019_u9/b.pdf', status: 'analyzing', result: null }
  ];
  fixture.state.persistBatch();
  fixture.stop();
  const restored = component('src/views/ai/MaterialReview.vue', {}, sessionStorage);
  try {
    for (const mount of restored.mounted) await mount();
    assert.equal(restored.state.materials.value.length, 2);
    assert.equal(restored.state.materials.value[0].result.title, 'A');
    assert.equal(restored.state.materials.value[1].status, 'ready');
    assert.equal(sessionStorage.getItem('xinggui.aiBatch.10'), null);
  } finally { restored.stop(); }
});

test('归属不符的材料不能带入申报，未核验材料不能批量提交', async () => {
  let submissions = 0;
  const fixture = component('src/views/ai/MaterialReview.vue', {
    '@/stores/user': { useUserStore: () => ({ role: 'student', userId: 9 }) },
    '@/api/applications': { createApplication: async () => { submissions++; } }
  });
  try {
    const state = fixture.state;
    state.modules.value = [{ id: 1 }];
    state.semesterId.value = 1;
    state.materials.value = ['mismatch', 'unverified', 'matched'].map((status, index) => ({
      id: index + 1, fileName: `proof-${index}.jpg`, fileUrl: `/uploads/20261019_u9/${index}.jpg`, status: 'done',
      result: { suggestedModuleId: 1, scoreSuggestion: status === 'matched' ? 2 : null,
        ownership: { status, message: '归属检查提示' } }
    }));
    state.continueApplication(state.materials.value[0]);
    assert.equal(fixture.sessionStorage.getItem('xinggui.aiReview.9'), null);
    assert.equal(state.submittable.value.length, 1);
    await state.confirmBatchSubmit();
    assert.equal(submissions, 1);
    assert.equal(state.materials.value[0].submitted, undefined);
    assert.equal(state.materials.value[1].submitted, undefined);
    state.continueApplication(state.materials.value[1]);
    assert.equal(JSON.parse(fixture.sessionStorage.getItem('xinggui.aiReview.9')).ownership.status, 'unverified');
  } finally { fixture.stop(); }
});

test('申报页拒绝缓存中的归属不符结果，未核验结果不带入自动建议分', async () => {
  const fixture = component('src/views/application/Apply.vue');
  try {
    const key = 'xinggui.aiReview.9';
    fixture.sessionStorage.setItem(key, JSON.stringify({ ownership: { status: 'mismatch' }, scoreSuggestion: 8 }));
    await fixture.state.loadAiReview();
    assert.equal(fixture.state.aiReviewPayload.value, null);
    assert.equal(fixture.sessionStorage.getItem(key), null);
    fixture.sessionStorage.setItem(key, JSON.stringify({ ownership: { status: 'unverified' }, scoreSuggestion: 8 }));
    await fixture.state.loadAiReview();
    assert.equal(fixture.state.form.score, 0);
    assert.equal(fixture.state.aiReviewPayload.value.ownership.status, 'unverified');
  } finally { fixture.stop(); }
});

test('我的荣誉兼容历史附件，区分图片和 PDF，预览可切换且不带入其他荣誉材料', async () => {
  const fixture = component('src/views/application/MyHonors.vue');
  try {
    const state = fixture.state;
    state.data.value.honors = [
      { id: 1, title: '团队创新一等奖', academicYear: '2026-2027', awardLevel: 'provincial', certificateNo: 'TEST-001',
        attachPhotos: JSON.stringify(['/uploads/team.pdf', { url: '/uploads/team.JPG?v=1', name: '荣誉证书' }, '/uploads/team.pdf', null, { url: 42 }, 'javascript:bad']) },
      { id: 2, title: '校级优秀志愿者', academicYear: '2025-2026', awardLevel: 'school', proofUrl: '/uploads/volunteer.pdf' },
      { id: 3, title: '无证书附件的荣誉', awardLevel: 'college' }
    ];
    const cards = state.honorCards.value;
    assert.equal(cards[0].attachments.length, 2);
    assert.equal(cards[0].attachments[0].kind, 'pdf');
    assert.equal(cards[0].cover.kind, 'image');
    state.openCertificate(cards[0]);
    assert.equal(state.activeAttachment.value.url, '/uploads/team.JPG?v=1');
    state.activeIndex.value = 0;
    assert.equal(state.activeAttachment.value.kind, 'pdf');
    assert.equal(state.previewImages.value.length, 1);
    state.openCertificate(cards[1]);
    assert.equal(state.activeIndex.value, 0);
    assert.equal(state.activeAttachment.value.url, '/uploads/volunteer.pdf');
    assert.equal(state.previewImages.value.length, 0);
    assert.equal(cards[2].attachments.length, 0);
    state.keyword.value = 'TEST-001';
    assert.equal(state.filteredHonors.value.length, 1);
    assert.equal(state.certificateCount.value, 2);
    state.academicYear.value = '2025-2026';
    assert.equal(state.filteredHonors.value.length, 0);
    state.resetFilters();
    state.levelFilter.value = 'school';
    assert.equal(state.filteredHonors.value[0].id, 2);
    assert.equal(state.academicYears.value.length, 2);
    state.resetFilters();
    assert.equal(state.filteredHonors.value.length, 3);
  } finally { fixture.stop(); }
});

test('我的荣誉加载失败显示重试状态，不伪装为没有荣誉', async () => {
  const fixture = component('src/views/application/MyHonors.vue', { '@/api/applications': {
    getMyHonors: async () => { throw new Error('network unavailable'); }
  } });
  try {
    await fixture.state.loadHonors();
    assert.equal(fixture.state.loadError.value, true);
    assert.equal(fixture.state.loading.value, false);
  } finally { fixture.stop(); }
});

test('成长计划切换学生时，旧响应不能覆盖当前学生，证据上传未完成时不能提交', async () => {
  const pending = []; let updates = 0;
  const fixture = component('src/views/ai/GrowthPlan.vue', { '@/api/growth-plans': {
    getGrowthPlan: () => new Promise(resolve => pending.push(resolve)), updateGrowthTask: async () => { updates++; }
  } });
  try {
    const state = fixture.state;
    state.studentId.value = 9; const first = state.loadPlan();
    state.studentId.value = 10; const second = state.loadPlan();
    pending[1]({ plan: { id: 10, tasks: [] }, student: { realName: '乙' } }); await second;
    pending[0]({ plan: { id: 9, tasks: [] }, student: { realName: '甲' } }); await first;
    assert.equal(state.plan.value.id, 10);
    state.uploading.value = true;
    await state.saveTask('submitted');
    assert.equal(updates, 0);
  } finally { fixture.stop(); }
});

test('审核页码只能定位分析时的对应附件，切换申报清空旧页码，缺失原件时不误跳其他附件', async () => {
  const utilities = await import('../src/utils/reviewWorkspace.js');
  const props = vue.reactive({ app: { id: 1, attachPhotos: ['/uploads/other.png', '/uploads/reviewed.pdf'],
    extraData: { aiReview: { fileUrl: '/uploads/reviewed.pdf', document: { pageCount: 3 } } } } });
  const fixture = component('src/components/MaterialReviewWorkspace.vue', {
    './AIReviewEvidence.vue': {}, '@/utils/reviewWorkspace': utilities
  }, storage(), props);
  try {
    const state = fixture.state;
    assert.equal(state.activeFile.value.url, '/uploads/reviewed.pdf');
    state.selectedUrl.value = '/uploads/other.png';
    state.focusEvidence(2);
    assert.equal(state.previewSrc.value, '/uploads/reviewed.pdf#page=2&view=FitH');
    state.focusEvidence(4);
    assert.equal(state.page.value, 2);
    props.app = { id: 2, attachPhotos: ['/uploads/new.pdf'], extraData: { aiReview: {
      fileUrl: '/uploads/missing.pdf', document: { pageCount: 3 }
    } } };
    await vue.nextTick();
    assert.equal(state.page.value, 1);
    assert.equal(state.activeFile.value.url, '/uploads/new.pdf');
    assert.equal(state.sourceAvailable.value, false);
    state.focusEvidence(2);
    assert.equal(state.page.value, 1);
    props.app = { id: 3, attachPhotos: [] };
    await vue.nextTick();
    assert.equal(state.activeFile.value, undefined);
    assert.equal(state.previewSrc.value, '');
  } finally { fixture.stop(); }
});

test('规则查询输入变化即清空旧结论，迟到响应不能冒充当前问题的依据', async () => {
  const pending = [];
  const fixture = component('src/views/ai/RuleGuide.vue', { '@/api/rule-guide': { queryRuleGuide:question=>new Promise(resolve=>pending.push({question,resolve})) } });
  try {
    const state=fixture.state;state.question.value='志愿服务';const first=state.search();
    state.question.value='体育比赛';const second=state.search();
    pending[1].resolve({question:'体育比赛',results:[{id:2}]});await second;
    pending[0].resolve({question:'志愿服务',results:[{id:1}]});await first;
    assert.equal(state.result.value.results[0].id,2);
    state.question.value='竞赛';assert.equal(state.result.value,null);
  } finally { fixture.stop(); }
});

test('成长偏好变化后必须重新预览，保存采用预览对应偏好，旧预览不能覆盖新选择', async () => {
  const pending=[];let saved;
  const fixture=component('src/views/ai/GrowthPlan.vue',{
    '@/stores/user': {useUserStore:()=>({role:'student',userId:9})},
    '@/api/growth-plans': { previewGrowthPlan:body=>new Promise(resolve=>pending.push({body,resolve})),createGrowthPlan:async body=>{saved=body;return{id:1};} }
  });
  try {
    const state=fixture.state;state.preferences.focusKey='arts';state.preferences.goal=' 整理作品 ';
    const first=state.previewChoices();state.preferences.focusKey='labor';
    pending[0].resolve({diagnosis:{preferences:pending[0].body.preferences}});await first;
    assert.equal(state.preview.value,null);await state.startPlan();assert.equal(saved,undefined);
    const second=state.previewChoices();pending[1].resolve({diagnosis:{preferences:{...pending[1].body.preferences,goal:'整理作品'}}});await second;
    assert.equal(state.preferencesDirty.value,false);await state.startPlan();
    assert.equal(saved.preferences.focusKey,'labor');assert.equal(saved.preferences.weeklyMinutes,60);
  } finally { fixture.stop(); }
});

test('规则入口只预选仍然适用的模块，不根据上限代填分值或自动提交', async () => {
  let submissions=0;
  const fixture=component('src/views/application/Apply.vue',{
    'vue-router': {useRouter:()=>({push(){}}),useRoute:()=>({query:{from:'rule-guide',moduleId:'3'}})},
    '@/api/modules':{listActiveModules:async()=>[{id:3,name:'合成模块',singleMaxScore:5,yearlyMaxScore:10}]},
    '@/api/applications':{getMySemesters:async()=>[],createApplication:async()=>submissions++}
  });
  try {for(const mounted of fixture.mounted)await mounted();assert.equal(fixture.state.selectedModule.value.id,3);assert.equal(fixture.state.form.score,null);assert.equal(submissions,0);}
  finally{fixture.stop();}
});
