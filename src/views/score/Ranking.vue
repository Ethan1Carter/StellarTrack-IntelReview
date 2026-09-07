<template>
  <div>
    <h2 class="page-title"><el-icon><Rank /></el-icon> 成绩排名</h2>

    <div class="card">
      <div class="filters">
        <el-select v-model="scope" style="width:160px" @change="load">
          <el-option label="班级排名" value="class" />
          <el-option v-if="role!=='student'" label="专业排名" value="major" />
          <el-option v-if="role==='college_admin' || role==='school_admin'" label="院系排名" value="college" />
          <el-option v-if="role==='school_admin'" label="全校排名" value="school" />
        </el-select>
        <el-select v-if="scope==='class'" v-model="classId" style="width:240px" @change="load">
          <el-option v-for="c in classes" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-input v-model="keyword" placeholder="搜索姓名/学号" style="width:220px" clearable @keyup.enter="load">
          <template #append><el-button @click="load">搜索</el-button></template>
        </el-input>
      </div>

      <el-table :data="list" v-loading="loading" stripe :row-class-name="highlight">
        <el-table-column label="名次" width="100" align="center">
          <template #default="{$index, row}">
            <el-tag v-if="$index===0" type="danger" effect="dark" size="large" round>🏆 第1名</el-tag>
            <el-tag v-else-if="$index===1" type="warning" effect="dark" size="large" round>🥈 第2名</el-tag>
            <el-tag v-else-if="$index===2" type="success" effect="dark" size="large" round>🥉 第3名</el-tag>
            <span v-else style="font-weight:600; color:#606266;">第 {{ $index + 1 }} 名</span>
          </template>
        </el-table-column>
        <el-table-column prop="student.username" label="学号" width="140" />
        <el-table-column prop="student.name" label="姓名" width="100" />
        <el-table-column label="班级" min-width="160">
          <template #default="{row}">{{ row.student?.class?.name || row.className || '--' }}</template>
        </el-table-column>
        <el-table-column label="所属院系" min-width="180">
          <template #default="{row}">{{ row.student?.class?.college?.name || row.collegeName || '--' }}</template>
        </el-table-column>
        <el-table-column prop="score" label="综合分" width="120" align="right">
          <template #default="{row}">
            <span style="font-size:16px; font-weight:bold; color:#409EFF;">{{ Number(row.score||0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="approveCount" label="加分项数" width="110" align="right" />
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无排名数据" />
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="page" :page-size="pageSize" @size-change="(s)=>{pageSize=s; load()}" @current-change="(p)=>{page=p; load()}" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { getClassList } from '@/api/college';
import { getRanking } from '@/api/stats';
import { useUserStore } from '@/stores/user';
import { ElMessage } from 'element-plus';
import { Rank } from '@element-plus/icons-vue';

const userStore = useUserStore();
const role = computed(() => userStore.role);
const list = ref([]);
const total = ref(0);
const loading = ref(false);
const scope = ref('class');
const classId = ref(null);
const classes = ref([]);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');

const loadClasses = async () => {
  try {
    const r = await getClassList({ pageSize: 200 });
    classes.value = r?.list || [];
    if (role.value === 'counselor' && classes.value[0]) classId.value = classes.value[0].id;
    else if (role.value === 'student') classId.value = userStore.userInfo?.classId;
    else if (classes.value[0]) classId.value = classes.value[0].id;
  } catch (_) {}
};

const load = async () => {
  loading.value = true;
  try {
    const r = await getRanking({ scope: scope.value, classId: scope.value==='class' ? classId.value : null, page: page.value, pageSize: pageSize.value, keyword: keyword.value });
    list.value = r?.list || []; total.value = r?.total || 0;
  } catch (e) { ElMessage.error(e.message || '加载失败'); }
  finally { loading.value = false; }
};

const highlight = ({row}) => (row.student?.id === userStore.userInfo?.id) ? 'highlight-me' : '';

onMounted(async () => {
  await loadClasses();
  load();
});
</script>
<style lang="scss" scoped>
.filters { display:flex; flex-wrap:wrap; gap:10px; padding: 0 16px 16px; }
.page-wrap { display:flex; justify-content:flex-end; padding:12px 16px; }
:deep(.highlight-me) { background: linear-gradient(90deg, #ecf5ff, #fdf6ec) !important; }
</style>
