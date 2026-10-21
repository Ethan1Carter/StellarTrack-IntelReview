<template>
  <div class="register-bg">
    <div class="bg-decoration">
      <div class="circle c1"></div>
      <div class="circle c2"></div>
      <div class="orbit orbit-one"></div>
      <div class="orbit orbit-two"></div>
    </div>

    <div class="register-container">
      <!-- 左侧品牌区 -->
      <div class="register-left hide-on-mobile">
        <div>
          <div class="brand-kicker">{{ branding.englishName }} · ACCOUNT REGISTRATION</div>
          <div class="brand-lockup">
            <img src="/branding/xinggui-logo.png" :alt="`${branding.appName} · ${branding.institutionName}`" />
          </div>
          <div class="brand-statement">五类角色，<br/>各就各位。</div>
          <p class="brand-description">选择你的身份提交注册，系统会按层级自动流转给对应的审批人，通过后即可登录使用。</p>
        </div>
        <div class="flow">
          <div class="flow-title">审批链路</div>
          <div class="flow-item"><span class="dot d1"></span>学生 · 注册后直接生效</div>
          <div class="flow-item"><span class="dot d2"></span>班级管理员 · 本班辅导员审批</div>
          <div class="flow-item"><span class="dot d3"></span>辅导员 · 所属学院管理员审批</div>
          <div class="flow-item"><span class="dot d4"></span>学院管理员 · 学校管理员审批</div>
          <div class="flow-item"><span class="dot d5"></span>学校管理员 · 超级管理员审批</div>
        </div>
        <div class="footer-tip">© 2024 {{ branding.englishName }} · Assessment System v1.0</div>
      </div>

      <!-- 右侧表单区 -->
      <div class="register-right">
        <el-card shadow="never" class="register-card">
          <div class="card-head">
            <div>
              <div class="kicker">SIGN UP</div>
              <h2 class="title">注册账号</h2>
              <p class="subtitle">选择身份 → 填写资料 → 提交审核</p>
            </div>
            <el-button link type="primary" @click="goLogin">返回登录</el-button>
          </div>

          <el-alert
            v-if="closed"
            type="warning"
            :closable="false"
            show-icon
            title="系统当前已关闭自助注册"
            description="请联系管理员为你在「用户管理」中开通账号。"
            style="margin-bottom:16px"
          />

          <template v-if="!closed">
            <el-steps :active="step" align-center finish-status="success" class="steps">
              <el-step title="选择身份" />
              <el-step title="填写资料" />
              <el-step :title="result.autoApproved ? '注册成功' : '等待审批'" />
            </el-steps>

            <!-- 第一步：选择角色 -->
            <div v-if="step === 0 && loadingOptions" class="role-loading">
              <el-skeleton :rows="3" animated />
            </div>
            <el-alert
              v-else-if="step === 0 && loadError"
              type="error"
              :closable="false"
              show-icon
              title="注册信息加载失败"
              :description="loadError"
              style="margin-bottom:12px"
            />
            <div v-if="step === 0 && loadError" class="role-loading">
              <el-button type="primary" @click="loadOptions">重新加载</el-button>
            </div>
            <div v-else-if="step === 0" class="role-grid">
              <div
                v-for="r in roles"
                :key="r.value"
                class="role-card"
                :class="{ active: form.role === r.value }"
                :style="{ '--accent': (roleStyle[r.value] || {}).color || '#4F46E5' }"
                @click="pickRole(r)"
              >
                <div class="role-icon"><component :is="(roleStyle[r.value] || {}).icon || 'User'" /></div>
                <div class="role-name">{{ r.label }}</div>
                <div class="role-desc">{{ r.description }}</div>
                <el-tag size="small" :type="r.autoApprove ? 'success' : 'warning'" effect="plain">
                  {{ r.autoApprove ? '免审批' : '需审批' }}
                </el-tag>
              </div>
            </div>

            <!-- 第二步：填写资料 -->
            <el-form
              v-else-if="step === 1"
              ref="formRef"
              :model="form"
              :rules="rules"
              label-position="top"
              class="reg-form"
              @submit.prevent="handleSubmit"
            >
              <div class="picked">
                <el-tag effect="dark" :color="(roleStyle[form.role] || {}).color">{{ roleLabel(form.role) }}</el-tag>
                <span class="picked-tip">{{ roleMeta ? roleMeta.description : '' }}</span>
                <el-button link type="primary" size="small" @click="backToRoles">更换身份</el-button>
              </div>

              <div class="grid-2">
                <el-form-item label="真实姓名" prop="realName">
                  <el-input v-model="form.realName" placeholder="请输入真实姓名" clearable />
                </el-form-item>
                <el-form-item :label="needClass ? '学号（作为登录账号）' : '工号（作为登录账号）'" prop="username">
                  <el-input v-model="form.username" :placeholder="needClass ? '请输入学号' : '请输入工号'" clearable />
                </el-form-item>
              </div>

              <div class="grid-2">
                <el-form-item label="密码" prop="password">
                  <el-input v-model="form.password" type="password" show-password placeholder="6~32 位" />
                </el-form-item>
                <el-form-item label="确认密码" prop="confirmPassword">
                  <el-input v-model="form.confirmPassword" type="password" show-password placeholder="请再次输入密码" />
                </el-form-item>
              </div>

              <div class="grid-2">
                <el-form-item label="性别" prop="gender">
                  <el-select v-model="form.gender" placeholder="请选择" style="width:100%">
                    <el-option label="男" value="male" />
                    <el-option label="女" value="female" />
                    <el-option label="不透露" value="unknown" />
                  </el-select>
                </el-form-item>
                <el-form-item label="手机号" prop="phone">
                  <el-input v-model="form.phone" placeholder="选填，用于接收通知" clearable />
                </el-form-item>
              </div>

              <div class="grid-2">
                <el-form-item v-if="needSchool" label="所属学校" prop="schoolId">
                  <el-select v-model="form.schoolId" placeholder="请选择学校" style="width:100%" filterable @change="onSchoolChange">
                    <el-option v-for="s in schools" :key="s.id" :label="s.name" :value="s.id" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="needCollege" label="所属院系" prop="collegeId">
                  <el-select
                    v-model="form.collegeId"
                    :placeholder="allowNewCollege ? '选择已有院系，或直接输入本院系名称' : '请选择院系'"
                    style="width:100%"
                    filterable
                    :allow-create="allowNewCollege"
                    :default-first-option="allowNewCollege"
                    @change="onCollegeChange"
                  >
                    <el-option v-for="c in collegeOptions" :key="c.id" :label="c.name" :value="c.id" />
                  </el-select>
                  <div v-if="allowNewCollege" class="field-hint">没有你的院系？直接输入名称即可，审批通过后会自动建立。</div>
                </el-form-item>
                <el-form-item v-if="needClass" label="所属班级" prop="classId">
                  <el-select
                    v-model="form.classId"
                    :placeholder="form.collegeId ? (allowNewClass ? '选择已有班级，或直接输入班级名称' : '请选择班级') : '请先选择院系'"
                    style="width:100%"
                    filterable
                    :allow-create="allowNewClass"
                    :default-first-option="allowNewClass"
                    :disabled="!form.collegeId"
                  >
                    <el-option v-for="c in classOptions" :key="c.id" :label="c.name" :value="c.id" />
                  </el-select>
                  <div v-if="allowNewClass" class="field-hint">没有你的班级？直接输入班级名称即可，学生会立即纳入该班级。</div>
                </el-form-item>
              </div>

              <el-form-item label="邮箱" prop="email">
                <el-input v-model="form.email" placeholder="选填" clearable />
              </el-form-item>

              <div class="form-actions">
                <el-button @click="backToRoles">上一步</el-button>
                <el-button type="primary" :loading="submitting" @click="handleSubmit">
                  {{ submitting ? '提交中...' : '提交注册' }}
                </el-button>
              </div>

              <p class="agree">提交即表示你确认所填信息真实有效，并同意学校对本平台账号进行统一管理。</p>
            </el-form>

            <!-- 第三步：结果 -->
            <div v-else class="result">
              <el-icon :size="54" :color="result.autoApproved ? '#10B981' : '#F59E0B'">
                <component :is="result.autoApproved ? 'CircleCheckFilled' : 'Clock'" />
              </el-icon>
              <h3>{{ result.autoApproved ? '注册成功' : '注册申请已提交' }}</h3>
              <p class="result-desc">
                <template v-if="result.autoApproved">
                  账号「{{ result.username }}」已生效，现在就可以登录使用。
                </template>
                <template v-else>
                  账号「{{ result.username }}」正在等待
                  <b>{{ result.approverLabel || '对应管理员' }}</b> 审批，通过后即可登录。
                </template>
              </p>
              <p v-if="result.autoCreatedCollege" class="result-desc">
                你填写的院系「<b>{{ result.collegeName }}</b>」会在审批通过后自动建立。
              </p>
              <p v-if="result.autoCreatedClass" class="result-desc">
                <template v-if="result.autoApproved">
                  已为你建立班级「<b>{{ result.className }}</b>」，你已纳入该班级。
                </template>
                <template v-else>
                  你填写的班级「<b>{{ result.className }}</b>」会在审批通过后自动建立。
                </template>
              </p>
              <el-alert
                v-if="!result.autoApproved"
                type="info"
                :closable="false"
                show-icon
                title="审批通过前无法登录"
                description="你可以稍后用「查询审核进度」查看状态；若被驳回，可修改资料后重新提交注册。"
                style="margin-bottom:18px; text-align:left"
              />
              <div class="result-actions">
                <el-button @click="openStatus(result.username, form.password)">查询审核进度</el-button>
                <el-button type="primary" @click="goLogin">返回登录</el-button>
              </div>
            </div>
          </template>
        </el-card>

        <div class="bottom-links">
          <el-button link type="primary" @click="goLogin">已有账号？返回登录</el-button>
          <el-button link @click="statusVisible = true">查询审核进度</el-button>
        </div>
      </div>
    </div>

    <!-- 审核进度查询 -->
    <el-dialog v-model="statusVisible" title="查询注册审核进度" width="min(420px,92vw)">
      <el-form label-position="top">
        <el-form-item label="账号（学号/工号）">
          <el-input v-model="statusForm.username" placeholder="注册时填写的账号" clearable />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="statusForm.password" type="password" show-password placeholder="注册时设置的密码" @keyup.enter="checkStatus" />
        </el-form-item>
      </el-form>

      <el-descriptions v-if="statusResult" :column="1" border size="small" style="margin-top:6px">
        <el-descriptions-item label="姓名">{{ statusResult.realName }}</el-descriptions-item>
        <el-descriptions-item label="注册身份">{{ statusResult.roleLabel }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <el-tag :type="STATUS_TAG[statusResult.status] || 'info'" size="small">{{ STATUS_TEXT[statusResult.status] || statusResult.status }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="statusResult.status === 'pending' && statusResult.approverLabel" label="待审批人">
          {{ statusResult.approverLabel }}
        </el-descriptions-item>
        <el-descriptions-item v-if="statusResult.status === 'rejected'" label="驳回原因">
          {{ statusResult.rejectReason || '未填写' }}
        </el-descriptions-item>
      </el-descriptions>

      <template #footer>
        <el-button @click="statusVisible = false">关闭</el-button>
        <el-button type="primary" :loading="statusLoading" @click="checkStatus">查询</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { branding } from '@/config/branding';
import { getRegisterOptions, submitRegister, queryRegisterStatus } from '@/api/register';

const router = useRouter();

const roles = ref([]);
const schools = ref([]);
const colleges = ref([]);
const classes = ref([]);
const closed = ref(false);
const submitting = ref(false);
const loadingOptions = ref(false);
const loadError = ref('');

const step = ref(0);
const formRef = ref();

const form = reactive({
  role: '',
  realName: '',
  username: '',
  password: '',
  confirmPassword: '',
  gender: 'unknown',
  phone: '',
  email: '',
  schoolId: null,
  collegeId: null,
  classId: null
});

const result = reactive({
  autoApproved: false, username: '', approverLabel: '',
  autoCreatedCollege: false, collegeName: '',
  autoCreatedClass: false, className: ''
});

/** 角色卡片配色与图标（图标由 main.js 全局注册） */
const roleStyle = {
  student: { color: '#409EFF', icon: 'Reading' },
  class_admin: { color: '#10B981', icon: 'Avatar' },
  counselor: { color: '#6366F1', icon: 'UserFilled' },
  college_admin: { color: '#F59E0B', icon: 'School' },
  school_admin: { color: '#EF4444', icon: 'OfficeBuilding' }
};

const STATUS_TAG = { active: 'success', pending: 'warning', rejected: 'danger' };
const STATUS_TEXT = { active: '已通过', pending: '待审批', rejected: '已驳回' };

const roleMeta = computed(() => roles.value.find(r => r.value === form.role) || null);
const needSchool = computed(() => !!(roleMeta.value && roleMeta.value.needSchool));
const needCollege = computed(() => !!(roleMeta.value && roleMeta.value.needCollege));
const needClass = computed(() => !!(roleMeta.value && roleMeta.value.needClass));
// 学院管理员允许自己填写院系名称（本院系尚未录入系统时）
const allowNewCollege = computed(() => !!(roleMeta.value && roleMeta.value.allowNewCollege));
// 学生 / 班级管理员允许自己填写班级名称（班级尚未录入系统时）
const allowNewClass = computed(() => !!(roleMeta.value && roleMeta.value.allowNewClass));
// 需要绑定学校的角色：院系按所选学校过滤；学生/班级管理员由班级反查学校，不过滤
const collegeOptions = computed(() => {
  if (!needSchool.value) return colleges.value;
  if (!form.schoolId) return [];
  return colleges.value.filter(c => String(c.schoolId) === String(form.schoolId));
});
const classOptions = computed(() => classes.value.filter(c => String(c.collegeId) === String(form.collegeId)));

const roleLabel = (v) => {
  const hit = roles.value.find(r => r.value === v);
  return hit ? hit.label : v;
};

const rules = computed(() => {
  const base = {
    realName: [
      { required: true, message: '请输入真实姓名', trigger: 'blur' },
      { pattern: /^[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/, message: '姓名格式不正确', trigger: 'blur' }
    ],
    username: [
      { required: true, message: needClass.value ? '请输入学号' : '请输入工号', trigger: 'blur' },
      { pattern: /^[A-Za-z0-9_.@-]{4,50}$/, message: '只能是字母、数字、_ . @ -，长度 4~50 位', trigger: 'blur' }
    ],
    password: [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, max: 32, message: '密码长度需为 6~32 位', trigger: 'blur' }
    ],
    confirmPassword: [
      { required: true, message: '请再次输入密码', trigger: 'blur' },
      {
        validator: (_rule, value, cb) => (value === form.password ? cb() : cb(new Error('两次输入的密码不一致'))),
        trigger: 'blur'
      }
    ],
    phone: [{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: 'blur' }],
    email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }]
  };
  if (needCollege.value) base.collegeId = [{ required: true, message: '请选择所属院系', trigger: 'change' }];
  if (needSchool.value) base.schoolId = [{ required: true, message: '请选择所属学校', trigger: 'change' }];
  if (needClass.value) base.classId = [{ required: true, message: '请选择所属班级', trigger: 'change' }];
  return base;
});

const loadOptions = async () => {
  loadingOptions.value = true;
  loadError.value = '';
  try {
    const data = await getRegisterOptions({ __suppressMsg: true });
    roles.value = (data && data.roles) || [];
    schools.value = (data && data.schools) || [];
    colleges.value = (data && data.colleges) || [];
    classes.value = (data && data.classes) || [];
    closed.value = data ? data.enabled === false : false;
    if (!roles.value.length) loadError.value = '服务端没有返回可注册角色，请稍后重试。';
  } catch (e) {
    // 后端没启动 / 网络异常时会走到这里：给出显式提示与重试入口，
    // 否则页面上只剩"选择身份"标题，看起来像点不动
    loadError.value = e.message || '无法连接服务器，请确认后端服务已启动。';
  } finally {
    loadingOptions.value = false;
  }
};

const pickRole = (r) => {
  form.role = r.value;
  // 切换身份时清理不适用的字段，避免把上一个角色的学校/院系/班级带过去
  form.schoolId = null;
  form.collegeId = null;
  form.classId = null;
  step.value = 1;
};

const backToRoles = () => { step.value = 0; };
const onSchoolChange = () => { form.collegeId = null; form.classId = null; };
const onCollegeChange = () => { form.classId = null; };
const goLogin = () => router.push('/login');

const handleSubmit = async () => {
  if (submitting.value) return;
  try {
    await formRef.value.validate();
  } catch (_) {
    return;
  }
  submitting.value = true;
  try {
    const data = await submitRegister({
      role: form.role,
      realName: form.realName.trim(),
      username: form.username.trim(),
      password: form.password,
      confirmPassword: form.confirmPassword,
      gender: form.gender,
      phone: form.phone.trim(),
      email: form.email.trim(),
      schoolId: form.schoolId,
      // allow-create 选院系时：选中已有院系是数字 id，手输的新院系是字符串名称
      collegeId: typeof form.collegeId === 'string' ? null : form.collegeId,
      collegeName: typeof form.collegeId === 'string' ? form.collegeId.trim() : '',
      classId: typeof form.classId === 'string' ? null : form.classId,
      className: typeof form.classId === 'string' ? form.classId.trim() : ''
    });
    result.autoApproved = !!(data && data.autoApproved);
    result.username = (data && data.username) || form.username;
    result.approverLabel = (data && data.approverLabel) || '';
    result.autoCreatedCollege = !!(data && data.autoCreatedCollege);
    result.collegeName = (data && data.collegeName) || '';
    result.autoCreatedClass = !!(data && data.autoCreatedClass);
    result.className = (data && data.className) || '';
    step.value = 2;
    ElMessage.success(result.autoApproved ? '注册成功' : '注册申请已提交');
  } catch (_) {
    // 错误提示已由请求拦截器统一弹出
  } finally {
    submitting.value = false;
  }
};

// ===== 审核进度查询 =====
const statusVisible = ref(false);
const statusLoading = ref(false);
const statusResult = ref(null);
const statusForm = reactive({ username: '', password: '' });

const openStatus = (username = '', password = '') => {
  statusResult.value = null;
  if (username) statusForm.username = username;
  if (password) statusForm.password = password;
  statusVisible.value = true;
};

const checkStatus = async () => {
  if (!statusForm.username.trim() || !statusForm.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  statusLoading.value = true;
  try {
    statusResult.value = await queryRegisterStatus({
      username: statusForm.username.trim(),
      password: statusForm.password
    });
  } catch (_) {
    statusResult.value = null;
  } finally {
    statusLoading.value = false;
  }
};

onMounted(loadOptions);
</script>

<style lang="scss" scoped>
.register-bg {
  min-height: 100vh;
  background:
    radial-gradient(circle at 8% 15%, rgba(45,212,191,.14), transparent 24rem),
    radial-gradient(circle at 92% 85%, rgba(124,58,237,.14), transparent 26rem),
    #F2F5FB;
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.bg-decoration { position: absolute; inset: 0; pointer-events: none; overflow: hidden;
  .circle { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .2; }
  .c1 { width: 420px; height: 420px; background: #4F46E5; top: -150px; left: -100px; }
  .c2 { width: 520px; height: 520px; background: #2DD4BF; bottom: -240px; right: -140px; }
  .orbit { position: absolute; border: 1px solid rgba(79,70,229,.12); border-radius: 50%; transform: rotate(-18deg); }
  .orbit::after { content: ''; position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #2DD4BF; box-shadow: 0 0 18px rgba(45,212,191,.8); }
  .orbit-one { width: 560px; height: 210px; right: -170px; top: 12%; &::after { left: 18%; top: 8%; } }
  .orbit-two { width: 460px; height: 170px; left: -160px; bottom: 6%; transform: rotate(22deg); &::after { right: 14%; bottom: 10%; } }
}
.register-container {
  position: relative; z-index: 1;
  width: 100%; max-width: 1080px;
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,.88);
  border-radius: 28px;
  box-shadow: 0 32px 90px rgba(31,43,77,.18);
  display: flex; overflow: hidden;
  @include mobile { flex-direction: column; }
}
.register-left {
  flex: 0 0 400px; padding: 50px 44px;
  background:
    linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px),
    radial-gradient(circle at 15% 12%, rgba(45,212,191,.24), transparent 18rem),
    linear-gradient(145deg, #17234B 0%, #111936 62%, #241651 100%);
  background-size: 28px 28px, 28px 28px, auto, auto;
  color: #fff; display: flex; flex-direction: column; justify-content: space-between;
  .brand-kicker { font-size: 10px; letter-spacing: .2em; color: #8CE8DA; font-weight: 700; margin-bottom: 22px; }
  .brand-lockup {
    width: 210px; margin-bottom: 26px; padding: 12px 16px;
    border: 1px solid rgba(255,255,255,.82); border-radius: 20px;
    background: linear-gradient(145deg, rgba(255,255,255,.98), rgba(239,247,255,.94));
    box-shadow: 0 18px 46px rgba(1, 11, 46, .28), inset 0 1px 0 #fff;
    img { display: block; width: 100%; height: auto; }
  }
  .brand-statement { font-size: 34px; line-height: 1.3; font-weight: 750; letter-spacing: -.04em; }
  .brand-description { width: 92%; color: #AAB7D6; line-height: 1.85; font-size: 13px; margin: 16px 0 0; }
  .flow { margin-top: 20px;
    .flow-title { font-size: 11px; letter-spacing: .14em; color: #7F8DB4; font-weight: 700; margin-bottom: 12px; }
    .flow-item { display: flex; align-items: center; gap: 9px; font-size: 12px; color: #D9E0F2; padding: 7px 0; }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; }
    .d1 { background: #409EFF; } .d2 { background: #10B981; } .d3 { background: #818CF8; }
    .d4 { background: #FBBF24; } .d5 { background: #FB7185; }
  }
  .footer-tip { margin-top: 22px; font-size: 10px; letter-spacing: .04em; color: #7182AA; }
}
.register-right { flex: 1; padding: 34px 40px; min-width: 0;
  @include mobile { padding: 20px; }
}
.register-card { width: 100%; border: 0 !important; box-shadow: none !important; border-radius: 0; padding: 0; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px;
  .kicker { font-size: 10px; color: #4F46E5; letter-spacing: .2em; font-weight: 800; margin-bottom: 8px; }
  .title { font-size: 26px; margin: 0 0 6px; color: #17233B; font-weight: 750; letter-spacing: -.03em; }
  .subtitle { color: #7A879C; font-size: 13px; margin: 0; }
}
.steps { margin-bottom: 20px; :deep(.el-step__title) { font-size: 12px; } }
.role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.role-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 0; }
.role-card {
  position: relative; padding: 16px 15px 14px; border-radius: 14px; cursor: pointer;
  background: #F8FAFD; border: 1px solid #E4E9F2; transition: all .18s ease;
  &:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 12px 26px rgba(31,43,77,.08); }
  &.active { border-color: var(--accent); background: #fff; box-shadow: 0 12px 30px rgba(79,70,229,.14); }
  .role-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
    background: rgba(79,70,229,.08); color: var(--accent); font-size: 18px; margin-bottom: 10px; }
  .role-name { font-size: 14px; font-weight: 700; color: #17233B; margin-bottom: 6px; }
  .role-desc { font-size: 11px; color: #7A879C; line-height: 1.65; min-height: 38px; margin-bottom: 9px; }
}
.reg-form {
  :deep(.el-form-item__label) { font-size: 12px; color: #5B6779; padding-bottom: 4px; }
  :deep(.el-input__wrapper), :deep(.el-select__wrapper) { min-height: 42px; background: #F8FAFD; box-shadow: 0 0 0 1px #E1E7F0 inset; }
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; @include mobile { grid-template-columns: 1fr; } }
.picked { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #F7F8FC; border: 1px solid #ECEFF5; border-radius: 12px; margin-bottom: 16px;
  .picked-tip { flex: 1; font-size: 12px; color: #7A879C; }
}
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
.agree { font-size: 11px; color: #A8B0BF; line-height: 1.7; margin: 12px 0 0; }
.field-hint { font-size: 11px; color: #909399; line-height: 1.6; margin-top: 4px; }
.result { text-align: center; padding: 18px 6px 6px;
  h3 { margin: 14px 0 8px; font-size: 20px; color: #17233B; }
  .result-desc { color: #7A879C; font-size: 13px; line-height: 1.9; margin: 0 0 16px;
    b { color: #4F46E5; }
  }
  .result-actions { display: flex; justify-content: center; gap: 10px; }
}
.bottom-links { display: flex; justify-content: center; gap: 16px; margin-top: 12px; }
</style>
