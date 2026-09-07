<template>
  <div class="class-overview-page" v-loading="loading">
    <section class="class-hero">
      <div class="hero-copy">
        <div class="hero-eyebrow"><el-icon><School /></el-icon> CLASS OVERVIEW · 班级概览</div>
        <h1>{{ info.classInfo?.name || '班级信息' }}</h1>
        <div class="class-meta">
          <div v-if="info.classInfo?.college?.name" class="meta-item"><span>所属院系</span>{{ info.classInfo.college.name }}</div>
          <div v-if="info.classInfo?.major" class="meta-item"><span>专业方向</span>{{ info.classInfo.major }}</div>
          <div v-if="info.classInfo?.grade" class="meta-item"><span>所在年级</span>{{ info.classInfo.grade }}</div>
          <div v-if="info.classInfo?.code" class="meta-item"><span>班级代码</span>{{ info.classInfo.code }}</div>
        </div>
      </div>
      <div class="member-orbit" aria-label="班级成员数量">
        <div class="orbit-ring"><strong>{{ info.studentCount || 0 }}</strong><small>人</small></div>
        <span>班级成员</span>
      </div>
      <img class="class-hero-watermark" src="/branding/xinggui-symbol.png" alt="" />
    </section>

    <el-row :gutter="18" class="staff-grid">

      <!-- 辅导员 + 班级管理员 卡片 -->
      <el-col :md="12" :span="24">
        <div class="card staff-card counselor-card">
          <div class="staff-card-head">
            <div class="staff-role-label counselor-label"><el-icon><User /></el-icon> 辅导员</div>
            <span class="staff-status">成长指导</span>
          </div>
          <el-empty v-if="!info.counselor" description="暂无辅导员信息" :image-size="80" />
          <div v-else class="staff-body">
            <el-avatar :size="72" :src="info.counselor.avatar">{{ (info.counselor.realName||info.counselor.username||'?').slice(0,1) }}</el-avatar>
            <div class="staff-info">
              <div class="staff-name">{{ info.counselor.realName || '未填姓名' }}</div>
              <div class="staff-contact"><span>账号</span>{{ info.counselor.username || '-' }}</div>
              <div class="staff-contact"><span>电话</span>{{ info.counselor.phone || '-' }}</div>
              <div class="staff-contact"><span>邮箱</span>{{ info.counselor.email || '-' }}</div>
            </div>
          </div>
        </div>
      </el-col>

      <el-col :md="12" :span="24">
        <div class="card staff-card admin-card">
          <div class="staff-card-head">
            <div class="staff-role-label admin-label"><el-icon><UserFilled /></el-icon> 班级管理员</div>
            <el-tag v-if="info.classAdmin" type="warning" effect="light" size="small">拥有班级审批权限</el-tag>
          </div>
          <el-empty v-if="!info.classAdmin" description="暂未设置班级管理员" :image-size="80">
            <el-tag type="info" size="small">请联系辅导员/院系管理员设置班级管理员</el-tag>
          </el-empty>
          <div v-else class="staff-body">
            <el-avatar :size="72" :src="info.classAdmin.avatar">{{ (info.classAdmin.realName||info.classAdmin.username||'?').slice(0,1) }}</el-avatar>
            <div class="staff-info">
              <div class="staff-name">{{ info.classAdmin.realName || '未填姓名' }}</div>
              <div class="staff-contact"><span>账号</span>{{ info.classAdmin.username || '-' }}</div>
              <div class="staff-contact"><span>电话</span>{{ info.classAdmin.phone || '-' }}</div>
              <div class="staff-contact"><span>邮箱</span>{{ info.classAdmin.email || '-' }}</div>
            </div>
          </div>
        </div>
      </el-col>

      <!-- 同学列表 -->
      <el-col :span="24">
        <div class="card classmates-card">
          <div class="panel-header">
            <div>
              <div class="panel-kicker">STUDENT DIRECTORY</div>
              <h2>同班同学 <span>{{ filtered.length }} / {{ info.studentCount || 0 }}</span></h2>
            </div>
            <el-input v-model="keyword" class="student-search" placeholder="搜索姓名、学号或账号" clearable>
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
          </div>
          <el-table class="classmate-table" :data="filtered">
            <el-table-column label="序号" width="70" type="index" />
            <el-table-column label="学号" width="160">
              <template #default="{row}">{{ row.studentNo || row.username || '-' }}</template>
            </el-table-column>
            <el-table-column label="姓名" min-width="190">
              <template #default="{row}">
                <div class="student-name-cell">
                <el-avatar :size="28" :src="row.avatar">{{ (row.realName||row.username||'?').slice(0,1) }}</el-avatar>
                <span>{{ row.realName || '-' }}</span>
                <el-tag v-if="row.role==='class_admin'" class="ml-8" type="warning" effect="light" size="small">班级管理员</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="性别" width="90">
              <template #default="{row}">{{ genderText(row.gender) }}</template>
            </el-table-column>
            <el-table-column label="电话" prop="phone" min-width="140">
              <template #default="{row}">{{ row.phone || '-' }}</template>
            </el-table-column>
            <template #empty><el-empty description="没有找到匹配的同学" :image-size="90" /></template>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getMyClassInfo } from '@/api/classes';
import { ElMessage } from 'element-plus';
import { School, User, UserFilled, Search } from '@element-plus/icons-vue';

const info = ref({ classInfo: null, counselor: null, classAdmin: null, students: [], studentCount: 0 });
const loading = ref(false);
const keyword = ref('');
const genderText = (g) => ({ male:'男', female:'女' }[g] || '保密');

const filtered = computed(() => {
  const rows = info.value.students || [];
  const kw = keyword.value.trim();
  if (!kw) return rows;
  return rows.filter(r =>
    [r.username, r.studentNo, r.realName, r.phone].some(v => String(v||'').includes(kw))
  );
});

onMounted(async () => {
  loading.value = true;
  try { info.value = await getMyClassInfo(); }
  catch (e) { ElMessage.error(e.message || '加载失败'); }
  finally { loading.value = false; }
});
</script>

<style lang="scss" scoped>
.ml-8 { margin-left: 8px; }

.class-overview-page { min-width: 0; }
.class-hero {
  min-height: 214px; padding: 32px 38px; border-radius: 24px; overflow: hidden;
  color: #fff; position: relative; display: flex; align-items: center; justify-content: space-between; gap: 32px;
  background:
    radial-gradient(circle at 82% 18%, rgba(25,211,238,.32), transparent 17rem),
    linear-gradient(118deg, #10265F 0%, #154897 57%, #087EB5 100%);
  box-shadow: 0 20px 48px rgba(12,45,105,.2);
  &::before, &::after { content: ''; position: absolute; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; transform: rotate(-17deg); }
  &::before { width: 420px; height: 138px; right: -55px; top: 22px; }
  &::after { width: 310px; height: 102px; right: 14px; top: 41px; }
}
.class-hero-watermark { position:absolute; z-index:0; width:178px; height:178px; right:122px; top:18px; object-fit:contain; opacity:.1; filter:grayscale(1) brightness(3); pointer-events:none; }
.hero-copy { position: relative; z-index: 1; min-width: 0; }
.hero-eyebrow { display: flex; align-items: center; gap: 8px; color: #A9EAF4; font-size: 11px; font-weight: 700; letter-spacing: .14em; }
.class-hero h1 { margin: 14px 0 22px; font-size: 30px; line-height: 1.15; letter-spacing: -.035em; }
.class-meta { display: flex; flex-wrap: wrap; gap: 9px; }
.meta-item { padding: 8px 11px; border: 1px solid rgba(255,255,255,.15); border-radius: 10px; background: rgba(255,255,255,.09); color: #F5FAFF; font-size: 12px; backdrop-filter: blur(8px); }
.meta-item span { margin-right: 8px; color: #9DDCEA; }
.member-orbit { position: relative; z-index: 1; flex: 0 0 150px; display: flex; flex-direction: column; align-items: center; gap: 10px; color: #CDEBF5; font-size: 12px; letter-spacing: .12em; }
.orbit-ring {
  width: 108px; height: 108px; border-radius: 50%; display: flex; align-items: baseline; justify-content: center; padding-top: 31px;
  background: rgba(8,28,75,.3); border: 1px solid rgba(255,255,255,.4); box-shadow: inset 0 0 0 8px rgba(255,255,255,.06), 0 12px 32px rgba(3,28,71,.22);
  position: relative;
  &::after { content: ''; position: absolute; width: 9px; height: 9px; border-radius: 50%; background: #FFBE0B; right: 2px; top: 20px; box-shadow: 0 0 16px rgba(255,190,11,.9); }
  strong { font-size: 36px; line-height: 1; }
  small { margin-left: 4px; color: #B5E3EF; }
}

.staff-grid { margin-top: 18px; }

.staff-card {
  min-height: 222px; padding: 0; overflow: hidden; position: relative; margin-bottom: 18px; border:1px solid #E5EDF7; border-radius:18px; box-shadow:0 10px 28px rgba(23,43,77,.05);
  &::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; }
  &.counselor-card::before { background: linear-gradient(#1D8CF8, #28C7D9); }
  &.admin-card::before { background: linear-gradient(#FFBE0B, #FF8A3D); }
  .staff-card-head { min-height: 58px; padding: 14px 20px 12px 24px; border-bottom: 1px solid #EDF2F8; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .staff-role-label { display:flex; align-items:center; gap:7px; font-size: 14px; font-weight: 750; }
  .counselor-label { color:#1876D2; }
  .admin-label { color:#C97900; }
  .staff-status { color: #8493AA; font-size: 11px; letter-spacing: .08em; }
  .staff-body { display:flex; align-items:center; gap: 22px; padding: 24px 26px 26px; }
  :deep(.el-avatar) { color: #fff; font-weight: 750; font-size: 22px; background: linear-gradient(145deg, #1768D0, #15B8D1); box-shadow: 0 10px 22px rgba(23,104,208,.2); }
  &.admin-card :deep(.el-avatar) { background: linear-gradient(145deg, #F5A800, #F47B3A); box-shadow: 0 10px 22px rgba(244,123,58,.18); }
  .staff-info { flex: 1; min-width: 0; }
  .staff-name { font-size: 19px; color: #17233B; font-weight: 750; margin-bottom: 10px; }
  .staff-contact { margin-top: 5px; color: #63738C; font-size: 12px; word-break: break-all; }
  .staff-contact span { display: inline-block; width: 38px; color: #9AA7BA; }
}

.classmates-card { padding: 0; overflow: hidden; border:1px solid #E5EDF7; border-radius:18px; box-shadow:0 12px 30px rgba(23,43,77,.055); }
.panel-header { padding: 20px 22px; border-bottom: 1px solid #EAF0F7; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.panel-kicker { color: #2583CA; font-size: 10px; font-weight: 800; letter-spacing: .16em; margin-bottom: 5px; }
.panel-header h2 { margin: 0; color: #17233B; font-size: 18px; }
.panel-header h2 span { margin-left: 7px; color: #94A3B8; font-size: 12px; font-weight: 500; }
.student-search { width: 290px; }
:deep(.student-search .el-input__wrapper) { background: #F5F8FC; box-shadow: 0 0 0 1px #E3EAF3 inset; }
:deep(.el-table .el-avatar) { background: linear-gradient(145deg, #E8F1FF, #DDF9FA); color: #1768D0; font-weight: 750; }
.student-name-cell { display:flex; align-items:center; gap:9px; }
:deep(.classmate-table) { --el-table-header-bg-color:#F5F8FC; --el-table-row-hover-bg-color:#F3F8FF; }
:deep(.classmate-table th.el-table__cell) { height:49px; color:#52647E; font-weight:700; }
:deep(.classmate-table td.el-table__cell) { padding:12px 0; }

@include mobile {
  .class-hero { min-height: 0; padding: 24px 20px; border-radius: 18px; align-items: flex-end; }
  .class-hero h1 { font-size: 24px; margin: 12px 0 18px; }
  .member-orbit { flex-basis: 82px; }
  .orbit-ring { width: 72px; height: 72px; padding-top: 21px; strong { font-size: 24px; } &::after { width: 7px; height: 7px; top: 11px; } }
  .member-orbit > span { display: none; }
  .class-hero-watermark { width:120px; height:120px; right:45px; top:24px; }
  .meta-item { padding: 7px 9px; }
  .meta-item span { display: none; }
  .staff-card .staff-body { padding: 20px; gap: 16px; }
  .panel-header { align-items: stretch; flex-direction: column; }
  .student-search { width: 100%; }
}
</style>
