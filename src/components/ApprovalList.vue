<template>
  <div>
    <!-- 辅导员快捷统计卡片：待终审数、申诉待办数、所带班级数 -->
    <div v-if="isCounselor && mode==='pending'" class="counselor-stats">
      <div class="cs-card cs-blue" @click="quickFilter('final_review')">
        <div class="cs-icon"><Finished /></div>
        <div class="cs-body">
          <div class="cs-label">待终审</div>
          <div class="cs-value">{{ counselorStats.pendingFinal }}</div>
          <div class="cs-extra">已通过待终审确认</div>
        </div>
      </div>
      <div class="cs-card cs-orange" @click="$emit('switch-appeals')">
        <div class="cs-icon"><Bell /></div>
        <div class="cs-body">
          <div class="cs-label">申诉待办</div>
          <div class="cs-value">{{ counselorStats.pendingAppeals }}</div>
          <div class="cs-extra">班级管理员重新审批中</div>
        </div>
      </div>
      <div class="cs-card cs-green">
        <div class="cs-icon"><School /></div>
        <div class="cs-body">
          <div class="cs-label">所带班级</div>
          <div class="cs-value">{{ counselorStats.classCount }}</div>
          <div class="cs-extra">本学期负责班级</div>
        </div>
      </div>
      <div class="cs-card cs-red">
        <div class="cs-icon"><User /></div>
        <div class="cs-body">
          <div class="cs-label">覆盖学生</div>
          <div class="cs-value">{{ counselorStats.studentCount }}</div>
          <div class="cs-extra">所带班级学生总数</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="filters">
        <el-select v-model="f.status" placeholder="状态" style="width:140px" clearable @change="go(1)">
          <el-option v-if="mode==='pending'" label="待处理" value="waiting" />
          <el-option v-if="mode==='done'" label="已通过" value="passed" />
          <el-option v-if="mode==='done'" label="已驳回" value="refused" />
          <el-option v-if="mode==='done'" label="已退回" value="returned" />
          <el-option label="辅导员终审" value="final_review" />
          <el-option label="申诉中" value="appealing" />
          <el-option label="申诉办结" value="appeal_closed" />
        </el-select>
        <el-select v-model="f.moduleId" placeholder="模块" style="width:180px" clearable @change="go(1)">
          <el-option v-for="m in modules" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
        <el-input v-model="f.keyword" placeholder="搜索学生姓名/标题" style="width:240px" clearable @keyup.enter="go(1)" />
        <el-button type="primary" @click="go(1)">查询</el-button>
        <!-- 批量操作按钮 -->
        <template v-if="mode==='pending' && isClassAdmin">
          <el-divider direction="vertical" />
          <span class="batch-tip" v-if="selectedIds.length > 0">已选 {{ selectedIds.length }} 条</span>
          <el-button type="success" :disabled="selectedIds.length === 0 || batchSubmitting" @click="batchAct('approve')">
            批量通过
          </el-button>
          <el-button type="danger" :disabled="selectedIds.length === 0 || batchSubmitting" @click="batchAct('reject')">
            批量驳回
          </el-button>
        </template>
      </div>
      <el-table :data="list" v-loading="loading" stripe @selection-change="handleSelectionChange">
        <!-- 多选列（仅待审批模式下显示，班级管理员可用） -->
        <el-table-column v-if="mode==='pending' && isClassAdmin" type="selection" width="50" :selectable="row => canApprove(row)" />
        <el-table-column prop="id" label="序号" width="60" />
        <el-table-column prop="approvalNo" label="审批单号" width="180">
          <template #default="{row}">
            <el-tooltip v-if="row.approvalNo" content="AP+创建年月日+6位流水号" placement="top">
              <span style="font-family: monospace; letter-spacing: 0.3px; color: #606266;">{{ row.approvalNo }}</span>
            </el-tooltip>
            <span v-else style="color:#c0c4cc;">--</span>
          </template>
        </el-table-column>
        <el-table-column label="模块" width="130">
          <template #default="{row}"><el-tag :style="{background: row.module?.color, border:'none'}" effect="dark" size="small">{{ row.module?.name }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="学生" width="130">
          <template #default="{row}">{{ row.student?.realName || row.student?.name }}（{{ row.student?.username }}）</template>
        </el-table-column>
        <el-table-column prop="applyScore" label="申请分" width="90" align="center" />
        <el-table-column label="当前阶段" width="160" align="center">
          <template #default="{row}">
            <el-tag :type="currentStageTagType(row)" size="small" effect="light" style="font-weight:500;">
              {{ currentStageText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="110" align="center">
          <template #default="{row}"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column v-if="mode==='done'" label="我的操作" width="110" align="center">
          <template #default="{row}"><StatusTag :status="myAction(row)" /></template>
        </el-table-column>
        <el-table-column prop="createdAt" label="提交时间" width="160">
          <template #default="{row}">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <!-- 【重构】操作列：详情抽屉 + 行内一键审批按钮，不用再"关闭详情再审批" -->
        <el-table-column label="操作" width="380" fixed="right" align="center">
          <template #default="{row}">
            <el-button link type="primary" @click="openDetail(row)">详情/流程</el-button>
            <!-- 班级管理员：待审批单据可审批；终审/申诉中状态被锁定 -->
            <template v-if="mode==='pending' && canApprove(row) && isClassAdmin">
              <el-button link type="success" @click="quickAction(row, 'approve')">通过</el-button>
              <el-button link type="warning" @click="quickAction(row, 'return')">退回</el-button>
              <el-button link type="danger" @click="quickAction(row, 'reject')">驳回</el-button>
            </template>
            <!-- 辅导员：仅对 approved 状态可做终审；appealing 状态禁用（需班级管理员先处理） -->
            <template v-if="isCounselor && row.status === 'approved'">
              <el-button link type="success" style="font-weight:600;" @click="openFinalReview(row)">终审</el-button>
            </template>
            <!-- 班级管理员：申诉中单据可重新审批 -->
            <template v-if="isClassAdmin && row.status === 'appealing' && row.appealInfo?.hasPending">
              <el-button link type="warning" style="font-weight:600;" @click="openReReview(row)">重新审批</el-button>
            </template>
            <!-- 班级管理员：终审状态被锁定，提示用户 -->
            <template v-if="isClassAdmin && row.status === 'final_review'">
              <el-tag size="small" type="info" effect="plain">已终审·锁定</el-tag>
            </template>
            <!-- 辅导员：终审后申诉中，提示用户可查看申诉记录 -->
            <template v-if="isCounselor && row.status === 'appealing'">
              <el-tag size="small" type="warning" effect="plain">待班级管理员重新审批</el-tag>
            </template>
            <!-- 学院管理员/学校管理员：删除已通过审批的申报单（含分数扣减） -->
            <el-popconfirm
              v-if="(isCollegeAdmin || isSchoolAdmin) && ['approved','final_review'].includes(row.status)"
              title="确定删除该审批单？删除后已认定分数将同步扣减，此操作不可恢复！"
              width="320"
              @confirm="adminDelete(row)"
            >
              <template #reference><el-button link type="danger">删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <div class="page-wrap">
        <el-pagination background layout="total, prev, pager, next, sizes" :total="total" :current-page="f.page" :page-size="f.pageSize" @size-change="(s)=>{f.pageSize=s;go(1)}" @current-change="go" />
      </div>
    </div>

    <!-- 【重构】详情抽屉：内嵌"审批流程时间线" + 底部直接审批操作栏，不关闭抽屉也能审批 -->
    <el-drawer v-model="detailVisible" size="min(920px, 94vw)" :with-header="false" destroy-on-close>
      <div class="drawer-inner" v-if="current">
        <!-- 顶部标题 -->
        <div class="drawer-header">
          <div>
            <h3 style="margin:0 0 6px;">
              <el-tag :style="{background: current.module?.color, border:'none', marginRight:'8px'}" effect="dark" size="small">{{ current.module?.name }}</el-tag>
              {{ current.title }}
            </h3>
            <div class="sub-info">
              <span v-if="current.approvalNo" style="font-family: monospace;">审批单号：<b>{{ current.approvalNo }}</b></span>
              <span>学生：<b>{{ current.student?.realName || current.student?.name }}</b>（{{ current.student?.username }} / {{ current.student?.studentNo || '无学号' }}）</span>
              <span>学院：<b>{{ current.college?.name || current.classInfo?.college?.name || '-' }}</b></span>
              <span>班级：<b>{{ current.classInfo?.name || '-' }}</b></span>
              <span>辅导员：<b>{{ current.classInfo?.counselor?.realName || (current.classInfo?.counselorId ? '用户#'+current.classInfo.counselorId : '-') }}</b></span>
              <span>申请分数：<b style="color:#F56C6C;">{{ current.applyScore }}</b></span>
              <span>提交时间：{{ fmtFull(current.createdAt) }}</span>
            </div>
          </div>
          <el-button link @click="detailVisible=false" style="font-size:18px;">✕</el-button>
        </div>

        <!-- 主体内容：左45%当前审批阶段 + 右55%申报详情 -->
        <el-row :gutter="16" style="padding: 12px 20px 8px;">
          <!-- 简化审批流程：只显示"正在审批阶段"（醒目） + 已完成记录（历史审批意见区已详细展示） -->
          <el-col :md="11" :xs="24">
            <!-- 当前阶段醒目卡片 -->
            <div class="current-stage-card" :class="currentStageCardClass(current)">
              <div class="csc-dot" />
              <div class="csc-body">
                <div class="csc-label">
                  （{{ (stageIndex(current) + 0) }} / {{ stagesArr(current).length }}）
                  当前审批阶段
                </div>
                <div class="csc-title">{{ currentStageText(current) }}</div>
                <div class="csc-desc" v-if="current?.status==='pending' || current?.status==='approving' || current?.status==='returned'">
                  待审批人处理
                  <span v-if="current?.status === 'returned'" style="color:#E6A23C;">（学生已补充材料，重走审批）</span>
                </div>
                <div class="csc-desc" v-else-if="current?.status==='approved'" style="color:#67C23A;">审批通过，分数已计入汇总</div>
                <div class="csc-desc" v-else-if="current?.status==='rejected'" style="color:#F56C6C;">审批已驳回，该申报作废</div>
                <div class="csc-desc" v-else-if="current?.status==='revoked'" style="color:#909399;">已撤销</div>
                <div class="csc-desc" v-else-if="current?.status==='final_review'" style="color:#67C23A;">
                  辅导员已终审，单据已锁定；班级管理员不可操作。
                  <span v-if="isClassAdmin" style="color:#F56C6C;">学生申诉后可重新审批</span>
                  <span v-else-if="isCounselor" style="color:#67C23A;">学生可发起申诉</span>
                </div>
                <div class="csc-desc" v-else-if="current?.status==='appealing'" style="color:#F56C6C;">
                  学生已发起申诉，等待班级管理员重新审批
                  <span v-if="isClassAdmin" style="color:#E6A23C;">（请处理申诉）</span>
                  <span v-else-if="isCounselor" style="color:#909399;">（您无需直接处理，由班级管理员重新审批）</span>
                </div>
                <div class="csc-time" v-if="currentStageTime(current)">{{ currentStageTime(current) }}</div>
              </div>
            </div>

            <!-- 已完成步骤（对勾 + 简述），未开始的步骤不再显示 -->
            <div v-if="completedStages(current).length" class="panel-title" style="margin-top: 20px;">已完成步骤</div>
            <div v-for="(s, i) in completedStages(current)" :key="'c'+i" class="done-row">
              <div class="done-dot" />
              <div class="done-body">
                <div class="done-title">{{ s.label }}：<span class="done-action">{{ s.summary }}</span></div>
                <div class="done-time" v-if="s.time">{{ s.time }}</div>
              </div>
            </div>
          </el-col>

          <!-- 申报详情：学生信息卡 + 证明材料 + 说明 + 历史审批 -->
          <el-col :md="13" :xs="24">
            <ApplyDetailDialog v-model="subDetailVisible" :app="current" />

            <!-- 学生信息卡（学院/班级/辅导员/学号） -->
            <div class="student-info-card mt-8">
              <div class="sic-avatar">
                <el-avatar :size="48" style="background:#409EFF;">{{ (current.student?.realName || current.student?.username || '?').slice(0,1) }}</el-avatar>
              </div>
              <div class="sic-body">
                <div class="sic-row">
                  <span class="sic-lbl">姓名</span><span class="sic-val"><b>{{ current.student?.realName || current.student?.name || '-' }}</b></span>
                  <span class="sic-lbl">学号</span><span class="sic-val">{{ current.student?.studentNo || current.student?.username || '-' }}</span>
                </div>
                <div class="sic-row">
                  <span class="sic-lbl">学院</span><span class="sic-val">{{ current.college?.name || current.classInfo?.college?.name || '-' }}</span>
                  <span class="sic-lbl">班级</span><span class="sic-val">{{ current.classInfo?.name || '-' }}</span>
                </div>
                <div class="sic-row">
                  <span class="sic-lbl">辅导员</span><span class="sic-val">{{ current.classInfo?.counselor?.realName || (current.classInfo?.counselorId ? '用户#'+current.classInfo.counselorId : '-') }}</span>
                  <span class="sic-lbl">专业/年级</span><span class="sic-val">{{ (current.classInfo?.major || '-') + ' · ' + (current.classInfo?.grade || '-') }}</span>
                </div>
              </div>
            </div>

            <!-- 证明材料（附件预览）直接展示，无需再点进 ApplyDetailDialog -->
            <div class="mt-16">
              <div class="panel-title" style="border-left-color:#67C23A;">证明材料（{{ proofFiles.length }}）</div>
              <el-empty v-if="!proofFiles.length" description="暂无附件" :image-size="50" />
              <el-row v-else :gutter="12">
                <el-col v-for="(u, i) in proofFiles" :key="i" :xs="8" :sm="6" :md="6" :lg="4">
                  <div class="proof-item">
                    <a :href="u" target="_blank" rel="noopener">
                      <img v-if="isImg(u)" :src="u" class="proof-img" />
                      <div v-else class="proof-file">
                        <el-icon :size="28"><Document /></el-icon>
                        <span>{{ filename(u) }}</span>
                      </div>
                    </a>
                  </div>
                </el-col>
              </el-row>
            </div>

            <el-descriptions :column="2" border size="small" class="mt-16">
              <el-descriptions-item label="说明" :span="2"><div style="white-space:pre-wrap; line-height:1.7; max-height:200px; overflow:auto;">{{ current.description || '（无）' }}</div></el-descriptions-item>
              <el-descriptions-item label="事件日期">{{ current.eventDate || '-' }}</el-descriptions-item>
              <el-descriptions-item label="证书编号">{{ current.certificateNo || '-' }}</el-descriptions-item>
              <el-descriptions-item label="相关链接" :span="2"><el-link v-if="current.linkUrl" type="primary" :href="current.linkUrl" target="_blank">{{ current.linkUrl }}</el-link><span v-else>-</span></el-descriptions-item>
            </el-descriptions>
            <!-- 历史审批意见（每次审批的具体意见） -->
            <div v-if="current.reviews?.length" class="mt-16">
              <div class="panel-title">历史审批意见</div>
              <div v-for="(rv, i) in current.reviews" :key="i" class="review-item">
                <div class="review-head">
                  <span class="reviewer">{{ rv.reviewerName || ('用户'+rv.reviewerId) }}</span>
                  <el-tag size="small" :type="rv.action==='approve'?'success':(rv.action==='reject'?'danger':'warning')">
                    {{ rv.action==='approve' ? '通过' : (rv.action==='reject' ? '驳回' : '退回补充') }}
                  </el-tag>
                  <span v-if="rv.finalScore != null" class="score">最终得分：<b>+{{ rv.finalScore }}</b></span>
                  <span class="time">{{ fmtFull(rv.createdAt || rv.reviewedAt) }}</span>
                </div>
                <div v-if="rv.comment" class="review-comment">{{ rv.comment }}</div>
              </div>
            </div>

            <!-- 辅导员终审信息（status=final_review 或有终审记录） -->
            <div v-if="current.status === 'final_review' || current.finalReviewedBy" class="mt-16">
              <div class="panel-title" style="border-left-color:#67C23A;">辅导员终审</div>
              <div class="review-item" style="border-left-color:#67C23A;">
                <div class="review-head">
                  <span class="reviewer">终审人：{{ current.finalReviewer?.realName || current.finalReviewedByName || ('用户#'+current.finalReviewedBy) }}</span>
                  <el-tag size="small" type="success" effect="dark">辅导员终审</el-tag>
                  <span v-if="current.finalReviewAction" class="action-tag">
                    {{ finalActionText(current.finalReviewAction) }}
                  </span>
                  <span v-if="current.finalScore != null" class="score">最终得分：<b>+{{ current.finalScore }}</b></span>
                  <span class="time">{{ fmtFull(current.finalReviewedAt) }}</span>
                </div>
                <div v-if="current.finalReviewComment" class="review-comment">{{ current.finalReviewComment }}</div>
                <div v-if="current.rejectReason" class="review-comment" style="margin-top:6px; color:#F56C6C;">{{ current.rejectReason }}</div>
              </div>
            </div>

            <!-- 申诉信息（status=appealing 或有申诉历史） -->
            <div v-if="current.appealInfo && (current.appealInfo.count > 0 || current.status === 'appealing')" class="mt-16">
              <div class="panel-title" style="border-left-color:#F56C6C;">
                申诉记录
                <el-tag v-if="current.status === 'appealing'" size="small" type="danger" effect="dark" style="margin-left:8px;">申诉中</el-tag>
                <el-tag v-else-if="current.appealInfo?.hasClosed" size="small" type="info" effect="plain" style="margin-left:8px;">申诉办结</el-tag>
              </div>
              <div class="appeal-stats">
                <span>累计申诉次数：<b>{{ current.appealInfo.count }}</b></span>
                <span v-if="current.maxAppealCount">最大可申诉次数：<b>{{ current.maxAppealCount }}</b></span>
              </div>
              <div v-if="current.appealInfo?.latest" class="review-item" style="border-left-color:#F56C6C;">
                <div class="review-head">
                  <span class="reviewer">学生申诉</span>
                  <el-tag size="small" :type="appealStatusTagType(current.appealInfo.latest.status)">
                    {{ appealStatusText(current.appealInfo.latest.status) }}
                  </el-tag>
                  <span v-if="current.appealInfo.latest.reviewedAt" class="time">
                    审批时间：{{ fmtFull(current.appealInfo.latest.reviewedAt) }}
                  </span>
                  <span v-else class="time">提交时间：{{ fmtFull(current.appealInfo.latest.createdAt) }}</span>
                </div>
                <div v-if="current.appealInfo.latest.reason" class="review-comment" style="background:#FEF0F0;">
                  申诉理由：{{ current.appealInfo.latest.reason }}
                </div>
                <div v-if="current.appealInfo.latest.reply" class="review-comment" style="margin-top:6px;">
                  重新审批意见：{{ current.appealInfo.latest.reply }}
                </div>
              </div>
            </div>

            <!-- 抄送记录（班级管理员审批完成后自动抄送辅导员+学生） -->
            <div v-if="ccRecords.length" class="mt-16">
              <div class="panel-title" style="border-left-color:#909399;">抄送记录</div>
              <div v-for="(cc, i) in ccRecords" :key="'cc'+i" class="review-item" style="border-left-color:#909399;">
                <div class="review-head">
                  <span class="reviewer">抄送对象：{{ cc.user?.realName || ('用户#'+cc.userId) }}（{{ cc.user?.username }}）</span>
                  <el-tag size="small" type="info" effect="plain">{{ cc.type }}</el-tag>
                  <span class="time">{{ fmtFull(cc.createdAt) }}</span>
                </div>
                <div v-if="cc.title" class="review-comment">{{ cc.title }}：{{ cc.content }}</div>
              </div>
            </div>
          </el-col>
        </el-row>

        <!-- 审批动作分为结果选择、对应表单和确认提交，避免不同结果共用同一输入区。 -->
        <div v-if="mode==='pending' && canApprove(current) && isClassAdmin" class="drawer-footer review-footer">
          <div class="review-footer-heading">
            <div>
              <div class="review-footer-title">处理本次申报</div>
              <div class="review-footer-subtitle">请选择处理结果，再填写对应的审批信息</div>
            </div>
            <el-tag :type="reviewActionMeta.type" effect="light">{{ reviewActionMeta.label }}</el-tag>
          </div>

          <div class="review-action-picker" role="radiogroup" aria-label="审批结果">
            <button
              v-for="action in reviewActions"
              :key="action.value"
              type="button"
              class="review-action-option"
              :class="[`is-${action.value}`, { 'is-selected': selectedAction === action.value }]"
              :aria-checked="selectedAction === action.value"
              role="radio"
              @click="selectReviewAction(action.value)"
            >
              <span class="review-action-option-title">{{ action.label }}</span>
              <span class="review-action-option-desc">{{ action.shortDescription }}</span>
            </button>
          </div>

          <div class="review-action-form" :class="`is-${selectedAction}`">
            <div class="review-action-copy">
              <strong>{{ reviewActionMeta.title }}</strong>
              <span>{{ reviewActionMeta.description }}</span>
            </div>
            <div class="review-action-fields">
              <div v-if="selectedAction === 'approve'" class="review-field review-score-field">
                <label for="approval-final-score">最终打分</label>
                <el-input-number id="approval-final-score" v-model="appr.finalScore" :min="0" :max="Math.min(current.module?.maxScore || 999, Number(current.applyScore) || 0)" :step="current.module?.singleScore || 0.5" />
                <span>申请分 {{ current.applyScore }}</span>
              </div>
              <div class="review-field review-comment-field">
                <label for="approval-comment">
                  {{ reviewActionMeta.commentLabel }}
                  <em v-if="reviewActionMeta.commentRequired">必填</em>
                  <small v-else>选填</small>
                </label>
                <el-input id="approval-comment" v-model="appr.comment" type="textarea" :rows="3" maxlength="500" show-word-limit
                  :placeholder="reviewActionMeta.placeholder" />
              </div>
            </div>
          </div>

          <div class="review-action-submit">
            <span class="review-action-note">{{ reviewActionMeta.confirmHint }}</span>
            <el-button :type="reviewActionMeta.type" class="review-submit-button" :loading="submitting" @click="drawerAct(selectedAction)">
              {{ reviewActionMeta.submitLabel }}
            </el-button>
          </div>
        </div>
        <!-- 辅导员终审操作区：approved 状态下辅导员可做终审 -->
        <div v-else-if="isCounselor && current.status === 'approved'" class="drawer-footer" style="background:#F0F9EB;">
          <div class="footer-left">
            <div style="color:#67C23A; font-size:13px; font-weight:600;">辅导员终审：</div>
            <el-select v-model="finalReviewForm.action" style="width:160px; margin-left:8px;">
              <el-option label="维持通过" value="approve" />
              <el-option label="修改分数" value="modify" />
              <el-option label="改为驳回" value="reject" />
            </el-select>
            <el-input-number v-if="finalReviewForm.action !== 'reject'" v-model="finalReviewForm.finalScore"
              :min="0" :max="current.module?.maxScore || 999" :step="current.module?.singleScore || 0.5" style="margin-left:8px;" />
            <span v-if="finalReviewForm.action !== 'reject'" style="margin-left:8px; color:#909399; font-size:12px;">（不高于申请分 {{ current.applyScore }}）</span>
            <el-input v-model="finalReviewForm.comment" type="textarea" :rows="2" maxlength="500" show-word-limit
              placeholder="终审意见（必填）：请说明终审理由，学生将收到该说明" style="width: min(460px,50vw); margin-left:16px;" />
          </div>
          <div class="footer-right">
            <el-button :type="finalReviewForm.action === 'reject' ? 'danger' : 'success'" class="btn-primary-approve" :loading="submitting"
              @click="submitFinalReview(current)">
              {{ finalReviewForm.action === 'reject' ? '✓ 确认驳回' : (finalReviewForm.action === 'modify' ? '✓ 确认修改' : '✓ 确认终审通过') }}
            </el-button>
          </div>
        </div>
        <!-- 班级管理员重新审批申诉操作区：appealing 状态下可重新审批 -->
        <div v-else-if="isClassAdmin && current.status === 'appealing' && current.appealInfo?.hasPending" class="drawer-footer" style="background:#FDF6EC;">
          <div class="footer-left">
            <div style="color:#E6A23C; font-size:13px; font-weight:600;">申诉重新审批：</div>
            <el-select v-model="reReviewForm.status" style="width:140px; margin-left:8px;">
              <el-option label="申诉成立" value="approved" />
              <el-option label="申诉驳回" value="rejected" />
            </el-select>
            <el-input-number v-if="reReviewForm.status === 'approved'" v-model="reReviewForm.newFinalScore"
              :min="0" :max="current.module?.maxScore || 999" :step="current.module?.singleScore || 0.5" style="margin-left:8px;" />
            <span v-if="reReviewForm.status === 'approved'" style="margin-left:8px; color:#909399; font-size:12px;">（不高于申请分 {{ current.applyScore }}）</span>
            <el-input v-model="reReviewForm.reply" type="textarea" :rows="2" maxlength="500" show-word-limit
              placeholder="重新审批意见（必填）：请说明申诉成立/驳回的理由" style="width: min(460px,50vw); margin-left:16px;" />
          </div>
          <div class="footer-right">
            <el-button type="warning" class="btn-primary-approve" :loading="submitting"
              @click="submitReReview(current)">✓ 提交重新审批</el-button>
          </div>
        </div>
        <!-- 非可审批状态：显示最终结果（只有 approved/rejected/revoked/draft 等终态或不可处理态才显示） -->
        <div v-else-if="!['pending','approving','returned'].includes(current.status)" class="drawer-footer" style="background:#f4f4f5;">
          <div style="color:#909399;">当前案件状态：</div>
          <StatusTag :status="current.status" style="margin-left:8px;" />
          <span v-if="isClassAdmin && current.status === 'final_review'" style="margin-left:12px; color:#F56C6C; font-size:12px;">
            该单据已终审，无法操作；如学生发起申诉，单据重新开放后可重新审批
          </span>
          <span v-if="isCounselor && current.status === 'appealing'" style="margin-left:12px; color:#E6A23C; font-size:12px;">
            等待班级管理员重新审批
          </span>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue';
import dayjs from 'dayjs';
import StatusTag from './StatusTag.vue';
import ApplyDetailDialog from './ApplyDetailDialog.vue';
import { getApprovalList, reviewApplication, finalReviewApplication, getCcRecords, batchReview, adminDeleteApplication } from '@/api/applications';
import { getAppealDetail, reviewAppeal } from '@/api/appeals';
import { listModules } from '@/api/modules';
import { getClassList } from '@/api/classes';
import { getAppeals } from '@/api/appeals';
import { useUserStore } from '@/stores/user';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Finished, Bell, School, User, Document } from '@element-plus/icons-vue';
import { useRoute } from 'vue-router';

const props = defineProps({ mode: { type: String, default: 'pending' } });
const emit = defineEmits(['switch-appeals', 'approve-success']);
const userStore = useUserStore();
const route = useRoute();
const modules = ref([]);
const list = ref([]);
const total = ref(0);
const loading = ref(false);
const f = reactive({ page: 1, pageSize: 10, status: '', moduleId: '', keyword: '' });

// 批量审批相关
const selectedIds = ref([]);
const batchSubmitting = ref(false);
const handleSelectionChange = (selection) => {
  selectedIds.value = selection.map(item => item.id);
};
const batchAct = async (action) => {
  const actionText = action === 'approve' ? '通过' : '驳回';
  const { value: comment } = await ElMessageBox.prompt(
    `请输入批量${actionText}的审批意见`,
    `确认批量${actionText} ${selectedIds.value.length} 条申报`,
    {
      confirmButtonText: `确认批量${actionText}`,
      cancelButtonText: '取消',
      inputPattern: action === 'reject' ? /.+/ : undefined,
      inputErrorMessage: '驳回必须填写原因'
    }
  ).catch(() => ({}));
  if (comment === undefined || comment === null) return;
  
  batchSubmitting.value = true;
  try {
    const res = await batchReview(selectedIds.value, action === 'approve' ? 'pass' : 'reject', { comment });
    const data = res?.data || res || {};
    const successCount = data.success ?? data.ok ?? 0;
    const skipCount = data.skipped ?? data.skip ?? 0;
    ElMessage.success(`批量处理完成：成功 ${successCount} 条${skipCount ? `，跳过 ${skipCount} 条` : ''}`);
    selectedIds.value = [];
    go(f.page);
    if (action === 'approve') {
      emit('approve-success');
    }
  } catch (e) {
    ElMessage.error(e?.message || '批量操作失败');
  } finally {
    batchSubmitting.value = false;
  }
};

// 辅导员快捷统计
const counselorStats = reactive({ pendingFinal: 0, pendingAppeals: 0, classCount: 0, studentCount: 0 });
const loadCounselorStats = async () => {
  if (!isCounselor.value) return;
  try {
    // 待终审数：approved 状态
    const r1 = await getApprovalList({ mode: 'pending', status: 'passed', page: 1, pageSize: 1 });
    counselorStats.pendingFinal = r1?.total || 0;
    // 申诉待办数
    const r2 = await getAppeals({ status: 'pending', page: 1, pageSize: 1 });
    counselorStats.pendingAppeals = r2?.total || 0;
    // 所带班级 + 覆盖学生
    const r3 = await getClassList({ pageSize: 300 });
    const cls = r3?.list || [];
    counselorStats.classCount = cls.length;
    counselorStats.studentCount = cls.reduce((s, c) => s + (Number(c.studentCount) || 0), 0);
  } catch (_) {}
};
const quickFilter = (status) => { f.status = status; go(1); };
const fmt = (t) => dayjs(t).format('MM-DD HH:mm');
const fmtFull = (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '';
// ===== 附件预览帮助 =====
const isImg = (u) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(u || '');
const filename = (u) => (u || '').split('/').pop() || '文件';
const proofFiles = computed(() => {
  const p = current.value?.proofUrl || current.value?.attachPhotos;
  if (!p) return [];
  if (Array.isArray(p)) return p.filter(Boolean);
  return String(p).split(',').map(s => s.trim()).filter(Boolean);
});

// 当前登录用户角色便捷变量
const isCounselor = computed(() => userStore.userInfo?.role === 'counselor');
const isClassAdmin = computed(() => userStore.userInfo?.role === 'class_admin');
const isCollegeAdmin = computed(() => userStore.userInfo?.role === 'college_admin');
const isSchoolAdmin = computed(() => ['school_admin','super_admin'].includes(userStore.userInfo?.role));

// 抽屉 & 当前审批项
const detailVisible = ref(false);
const subDetailVisible = ref(false);
const current = ref(null);
const appr = reactive({ finalScore: 0, comment: '' });
// 辅导员终审表单
const finalReviewForm = reactive({ action: 'approve', finalScore: 0, comment: '' });
// 班级管理员重新审批申诉表单
const reReviewForm = reactive({ status: 'approved', newFinalScore: 0, reply: '' });
// 抄送记录（详情抽屉加载）
const ccRecords = ref([]);
const submitting = ref(false);
const selectedAction = ref('approve');
const reviewActions = [
  {
    value: 'approve', label: '通过', type: 'success', shortDescription: '确认分值并通过',
    title: '通过申报', description: '确认材料无误后，认定分值将进入学生综合考评。',
    commentLabel: '审批意见', commentRequired: false,
    placeholder: '可填写通过依据或补充说明', submitLabel: '确认通过',
    confirmHint: '通过后将记录最终认定分值。'
  },
  {
    value: 'return', label: '退回补充', type: 'warning', shortDescription: '学生补充后可重提',
    title: '退回补充材料', description: '请明确说明需要补充或修改的内容，学生完成后可以重新提交。',
    commentLabel: '补充要求', commentRequired: true,
    placeholder: '例如：请补充获奖证书照片，并确保姓名和获奖日期清晰可见', submitLabel: '确认退回',
    confirmHint: '退回后学生可修改材料并重新提交。'
  },
  {
    value: 'reject', label: '驳回', type: 'danger', shortDescription: '结束本次申报',
    title: '驳回申报', description: '请说明不予认定的具体原因，学生会收到该反馈。',
    commentLabel: '驳回原因', commentRequired: true,
    placeholder: '请填写不予认定的具体原因', submitLabel: '确认驳回',
    confirmHint: '驳回后本次申报将结束，学生仍可按规则重新发起申报。'
  }
];
const reviewActionMeta = computed(() => reviewActions.find(item => item.value === selectedAction.value) || reviewActions[0]);
const selectReviewAction = (action) => {
  selectedAction.value = action;
};

// ====== 工具 ======
const myAction = (row) => {
  const r = row.reviews?.find(x => x.reviewerId === userStore.userInfo?.id);
  if (!r) return 'waiting';
  return r.action;
};
// 班级管理员可审批的判定：仅 pending/approving/returned 三态可审批；终审/申诉中状态禁止班级管理员操作
const canApprove = (row) => ['pending', 'returned', 'approving'].includes(row?.status);

// ====== 终审/申诉显示辅助 ======
function finalActionText(action) {
  return { approve: '维持通过', modify: '修改分数', reject: '改为驳回' }[action] || action;
}
function appealStatusText(s) {
  return { pending: '申诉待处理', approved: '申诉成立', rejected: '申诉驳回' }[s] || s;
}
function appealStatusTagType(s) {
  return { pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info';
}

// 构造流程阶段数组：提交 → 班级管理员 → 辅导员终审 → 归档（辅导员终审是强制独立步骤，与totalLevels无关）
function stagesArr(row) {
  const n = Number(row?.totalLevels || 1);
  const arr = [{ label: '提交' }];
  // 按总级数生成班级/院系审批阶段
  for (let i = 1; i <= n; i++) {
    if (n === 1) arr.push({ label: '班级管理员' });
    else if (i === 1) arr.push({ label: '班级管理员' });
    else if (i === 2) arr.push({ label: '辅导员' });
    else if (i === 3) arr.push({ label: '院系管理员' });
    else arr.push({ label: `第${i}级审批` });
  }
  // 辅导员终审阶段：对所有非纯驳回/撤回的单据都展示（本项目中班级管理员审批后，需辅导员做终审）
  const hasFinalStage = row?.status !== 'draft' && row?.status !== 'rejected' && row?.status !== 'revoked';
  if (hasFinalStage) arr.push({ label: '辅导员终审' });
  // 归档阶段（仅终态 approved/final_review/rejected/revoked 时展示）
  const st = row?.status;
  if (st === 'approved' || st === 'final_review' || st === 'rejected' || st === 'revoked') arr.push({ label: '已归档' });
  return arr;
}

// 处于第几阶段（0 索引）：0=提交, 1=班级管理员, 2=辅导员终审, 3=归档
function stageIndex(row) {
  if (!row) return 0;
  const st = row.status;
  // 草稿/待提交
  if (st === 'draft' || st === 'pending') return 0;
  const n = Number(row?.totalLevels || 1);
  // 审批中/退回：仍在班级管理员阶段
  if (st === 'approving' || st === 'returned') {
    const lv = Number(row.currentLevel || 1);
    return Math.min(lv, n); // 停在班级管理员或对应审批阶段
  }
  // 班级管理员已驳回 → 已归档终点
  if (st === 'rejected' || st === 'revoked') return stagesArr(row).length - 1;
  // approved = 班级管理员已通过，等待辅导员终审 → 当前在辅导员终审阶段(index = n+1)
  if (st === 'approved') return n + 1;
  // final_review = 辅导员已终审 → 到归档
  if (st === 'final_review') return stagesArr(row).length - 1;
  // 申诉中：回到班级管理员重新审批阶段
  if (st === 'appealing') return 1;
  return 1;
}

// 最后一步整体状态（如果被驳回，finish 要显示 error）
function currentStageStatus(row) {
  const st = row?.status;
  if (st === 'rejected' || st === 'revoked') return 'error';
  if (st === 'appealing') return 'warning';
  return '';
}

// 审批流程时间线（带每步具体说明 + 时间）
function timelineStages(row) {
  const stages = stagesArr(row);
  const reviews = row?.reviews || [];
  const activeIdx = stageIndex(row);
  const overallStatus = currentStageStatus(row);
  const n = Number(row?.totalLevels || 1);
  const finalStageIdx = n + 1; // 辅导员终审所在索引（班级管理员为1..n，下一就是终审）
  const st = row?.status;
  const hasFinalReviewCompleted = !!(row?.finalReviewedBy && row?.finalReviewAction);

  return stages.map((s, i) => {
    let description = '', time = '', icon = undefined;
    const isFinalStage = s.label === '辅导员终审';
    const isArchiveStage = s.label === '已归档';

    if (i === 0) {
      // 提交
      description = '学生提交申报';
      time = fmtFull(row.createdAt);
    } else if (isFinalStage) {
      // 辅导员终审阶段
      if (hasFinalReviewCompleted) {
        const actionMap = { approve: '终审通过', modify: '修改分数后通过', reject: '终审驳回' };
        const action = actionMap[row.finalReviewAction] || '已处理';
        const who = row.finalReviewer?.realName || ('用户#' + row.finalReviewedBy);
        description = `${who}：${action}${row.finalScore != null ? `，+${row.finalScore} 分` : ''}`;
        time = fmtFull(row.finalReviewedAt);
      } else if (activeIdx === i) {
        description = '等待辅导员终审...';
      } else {
        description = '未开始';
      }
    } else if (isArchiveStage) {
      // 归档
      if (st === 'rejected') { description = '审批已驳回'; time = fmtFull(row.rejectedAt); }
      else if (st === 'revoked') { description = '学生撤回申请'; time = fmtFull(row.revokedAt || row.updatedAt); }
      else if (st === 'final_review') {
        description = row.finalReviewAction === 'reject' ? '终审驳回，流程结束' : '辅导员终审完成，分数已生效';
        time = fmtFull(row.finalReviewedAt);
      } else if (st === 'approved') {
        description = '班级管理员已通过，待辅导员终审完成后归档';
      } else {
        description = '流程进行中';
      }
    } else if (i <= reviews.length) {
      // 第 i 级审批（index 1..n，班级管理员等）
      const rv = reviews[i - 1];
      const who = rv.reviewerName || rv.reviewerRole || `审批人${i}`;
      const actionText = rv.action === 'approve' ? '通过' : (rv.action === 'reject' ? '驳回' : '退回补充');
      description = `${who}：${actionText}${rv.finalScore != null ? `，+${rv.finalScore} 分` : ''}`;
      time = fmtFull(rv.createdAt || rv.reviewedAt);
      if (rv.action === 'reject') description += '（终止）';
    } else if (i === activeIdx) {
      description = `等待${s.label}审批中...`;
    } else {
      description = `未开始`;
    }

    // 当前步骤 + 若已被驳回最后一步标 error
    let status = '';
    if (i < activeIdx) status = 'finish';
    else if (i === activeIdx) status = overallStatus && i === stages.length - 1 ? overallStatus : 'process';
    else if (overallStatus && i === stages.length - 1) status = overallStatus;
    // 辅导员终审已完成的情况也标 finish
    if (isFinalStage && hasFinalReviewCompleted) status = 'finish';
    if (isArchiveStage && (st === 'final_review' || st === 'rejected' || st === 'revoked')) status = 'finish';
    if (isArchiveStage && st === 'approved' && !hasFinalReviewCompleted) status = 'wait';

    return { label: s.label, description, time, icon, status };
  });
}

// ====== 简化阶段显示：只显示当前阶段文字 ======
function currentStageText(row) {
  if (!row) return '-';
  const st = row.status;
  // 待处理状态：显示"等待XX审批"
  if (st === 'pending' || st === 'draft') return '待提交 / 等待处理';
  if (st === 'approving' || st === 'returned') {
    const stages = stagesArr(row);
    const lv = Math.min(Number(row.currentLevel || 1), stages.length - 1);
    const label = stages[lv]?.label || '审批中';
    return st === 'returned' ? `等待${label}复审` : `等待${label}审批`;
  }
  // approved = 班级管理员已通过，但辅导员终审尚未完成
  if (st === 'approved') return row.finalReviewedBy ? '辅导员已终审' : '等待辅导员终审';
  if (st === 'rejected') return '已驳回';
  if (st === 'revoked') return '已撤销';
  if (st === 'final_review') return '辅导员终审完成';
  if (st === 'appealing') return '申诉中';
  return '处理中';
}
function currentStageTagType(row) {
  const st = row?.status;
  const finalDone = !!(row?.finalReviewedBy && row?.finalReviewAction);
  // approved 状态：只有辅导员终审完成后才算 success
  if (st === 'approved') return finalDone ? 'success' : '';
  if (st === 'revoked') return 'success';
  if (st === 'rejected' || st === 'appealing') return 'danger';
  if (st === 'returned') return 'warning';
  if (st === 'final_review') return 'success';
  return ''; // primary 蓝（等待审批中）
}
function currentStageCardClass(row) {
  const st = row?.status;
  const finalDone = !!(row?.finalReviewedBy && row?.finalReviewAction);
  if (st === 'final_review' || (st === 'approved' && finalDone)) return 'csc-success';
  if (st === 'rejected' || st === 'revoked' || st === 'appealing') return 'csc-error';
  if (st === 'returned') return 'csc-warning';
  return 'csc-processing';
}
function currentStageTime(row) {
  if (!row) return '';
  const st = row.status;
  const finalDone = !!(row.finalReviewedBy && row.finalReviewAction);
  if (st === 'pending' || st === 'draft') return fmtFull(row.createdAt);
  // approved：如果辅导员已经终审完成，显示终审时间；否则显示班级管理员通过时间
  if (st === 'approved') return finalDone ? fmtFull(row.finalReviewedAt) : fmtFull(row.approvedAt);
  if (st === 'rejected') return fmtFull(row.rejectedAt);
  if (st === 'final_review') return fmtFull(row.finalReviewedAt);
  if (st === 'appealing') {
    const latest = row.appealInfo?.latest;
    return fmtFull(latest?.createdAt);
  }
  // approving/returned：取最后一次 review 的时间或提交时间
  const revs = row.reviews || [];
  if (revs.length) return fmtFull(revs[revs.length - 1]?.createdAt || revs[revs.length - 1]?.reviewedAt);
  return fmtFull(row.updatedAt);
}
function completedStages(row) {
  if (!row) return [];
  const stages = stagesArr(row);
  const reviews = row.reviews || [];
  const st = row.status;
  const list = [];

  // 第 0 步：学生提交（除了草稿外永远显示）
  if (st !== 'draft') {
    list.push({ label: '① 学生提交', summary: '已提交', time: fmtFull(row.createdAt) });
  }

  // 第 1..N 步：每个 review 对应一个已完成阶段
  for (let i = 0; i < reviews.length; i++) {
    const rv = reviews[i];
    const s = stages[i + 1];
    const who = rv.reviewerName || rv.reviewerRole || '';
    const action = rv.action === 'approve' ? '通过' : (rv.action === 'reject' ? '驳回' : '退回补充');
    const score = rv.finalScore != null ? `，+${rv.finalScore} 分` : '';
    list.push({
      label: `第${i + 1}步：${s?.label || '-'}${who ? ' (' + who + ')' : ''}`,
      summary: `${action}${score}`,
      time: fmtFull(rv.createdAt || rv.reviewedAt)
    });
  }

  // 辅导员终审步骤
  if (st === 'final_review' || (row.finalReviewedBy && row.finalReviewAction)) {
    const actionMap = { approve: '终审通过', modify: '修改分数', reject: '终审驳回' };
    const action = actionMap[row.finalReviewAction] || '终审';
    const who = row.finalReviewer?.realName || ('用户#' + row.finalReviewedBy);
    const score = row.finalScore != null ? `，+${row.finalScore} 分` : '';
    list.push({
      label: `辅导员终审 (${who})`,
      summary: `${action}${score}`,
      time: fmtFull(row.finalReviewedAt)
    });
  }

  return list;
}

// ====== 业务动作 ======
const go = async (p) => { f.page = p; loading.value = true;
  try {
    const r = await getApprovalList({ ...f, mode: props.mode });
    list.value = r?.list || []; total.value = r?.total || 0;
  } finally { loading.value = false; }
};

// 打开详情抽屉：加载当前行 + 异步抓取抄送记录（与该申报相关的站内信）
const openDetail = async (row) => {
  current.value = row;
  detailVisible.value = true;
  appr.finalScore = Number(row.applyScore);
  appr.comment = '';
  selectedAction.value = 'approve';
  // 初始化终审表单
  finalReviewForm.action = 'approve';
  finalReviewForm.finalScore = Number(row.finalScore ?? row.applyScore);
  finalReviewForm.comment = '';
  // 初始化重新审批表单
  reReviewForm.status = 'approved';
  reReviewForm.newFinalScore = Number(row.finalScore ?? row.applyScore);
  reReviewForm.reply = '';
  // 异步加载抄送记录（与该申报相关的所有站内消息）
  ccRecords.value = [];
  try {
    const r = await getCcRecords(row.id);
    ccRecords.value = (Array.isArray(r) ? r : (r?.list || [])).filter(x => x && x.userId).slice(0, 20);
  } catch (e) { /* 静默忽略抄送记录加载失败 */ }
};

// 辅导员打开终审：直接打开详情抽屉（终审表单已在底部展示）
const openFinalReview = (row) => {
  if (!isCounselor.value) {
    ElMessage.warning('只有辅导员可以执行终审');
    return;
  }
  openDetail(row);
};

// 辅导员提交终审：必填意见 + action + 可选 finalScore
const submitFinalReview = async (row) => {
  if (!row?.id) return;
  if (!finalReviewForm.comment || !finalReviewForm.comment.trim()) {
    ElMessage.warning('终审意见为必填项，请填写审批意见');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认对申报 #${row.id} 执行终审（${finalActionText(finalReviewForm.action)}）？`,
      '终审确认',
      { type: 'warning', confirmButtonText: '确认终审', cancelButtonText: '取消' }
    );
  } catch (_) { return; }
  submitting.value = true;
  try {
    await finalReviewApplication(row.id, {
      action: finalReviewForm.action,
      finalScore: finalReviewForm.action !== 'reject' ? Number(finalReviewForm.finalScore) : undefined,
      comment: finalReviewForm.comment.trim()
    });
    ElMessage.success('终审完成');
    detailVisible.value = false;
    current.value = null;
    go(f.page);
  } catch (e) {
    ElMessage.error(e?.message || '终审失败');
  } finally {
    submitting.value = false;
  }
};

// 班级管理员打开申诉重新审批：加载申诉详情后打开抽屉
const openReReview = async (row) => {
  if (!isClassAdmin.value && !isCollegeAdmin.value && !isSchoolAdmin.value) {
    ElMessage.warning('只有班级管理员及以上可以重新审批申诉');
    return;
  }
  await openDetail(row);
  // 额外抓取申诉详情用于展示申诉材料
  const appealId = row.appealInfo?.latest?.id;
  if (appealId) {
    try {
      const d = await getAppealDetail(appealId);
      if (d && current.value) {
        current.value = { ...current.value, _appealDetail: d };
      }
    } catch (e) { /* 静默 */ }
  }
};

// 班级管理员提交申诉重新审批：必填意见 + status + 可选 newFinalScore
const submitReReview = async (row) => {
  const appealId = row?.appealInfo?.latest?.id;
  if (!appealId) {
    ElMessage.error('未找到关联的申诉记录，无法重新审批');
    return;
  }
  if (!reReviewForm.reply || !reReviewForm.reply.trim()) {
    ElMessage.warning('请填写重新审批意见');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认对申诉 #${appealId} 执行「${reReviewForm.status === 'approved' ? '申诉成立' : '申诉驳回'}」？`,
      '重新审批确认',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }
    );
  } catch (_) { return; }
  submitting.value = true;
  try {
    await reviewAppeal(appealId, {
      status: reReviewForm.status,
      reply: reReviewForm.reply.trim(),
      newFinalScore: reReviewForm.status === 'approved' ? Number(reReviewForm.newFinalScore) : undefined
    });
    ElMessage.success(reReviewForm.status === 'approved' ? '申诉已通过，单据回到辅导员终审环节' : '申诉已驳回，原终审结果保留');
    detailVisible.value = false;
    current.value = null;
    go(f.page);
  } catch (e) {
    ElMessage.error(e?.message || '重新审批失败');
  } finally {
    submitting.value = false;
  }
};

// 通用执行审批（供抽屉底部和行内按钮复用）
// 关键：无论 approve/reject/return 全部弹确认，避免"直接默认退回"
const doAction = async (row, action, { finalScore, comment }) => {
  const normalizedComment = String(comment || '').trim();
  if (['return', 'reject'].includes(action) && !normalizedComment) {
    ElMessage.warning(action === 'return' ? '请填写需要补充的内容' : '请填写驳回原因');
    return false;
  }

  let confirmText = '';
  let confirmType = 'info';
  let confirmButtonText = '确认执行';
  if (action === 'approve') {
    confirmText = `确认通过申报 ID=${row.id}？给予 ${finalScore} 分`;
    confirmType = 'success';
    confirmButtonText = '确认通过';
  } else if (action === 'reject') {
    confirmText = `确认驳回申报 ID=${row.id}？学生将收到以下原因：${normalizedComment}`;
    confirmType = 'error';
    confirmButtonText = '确认驳回';
  } else if (action === 'return') {
    confirmText = `确认退回申报 ID=${row.id}？学生补充后可以重新提交。`;
    confirmType = 'warning';
    confirmButtonText = '确认退回';
  }
  await ElMessageBox.confirm(confirmText, '操作确认', {
    type: confirmType,
    confirmButtonText,
    cancelButtonText: '取消'
  });
  submitting.value = true;
  try {
    await reviewApplication(row.id, {
      action,
      finalScore: action === 'approve' ? Number(finalScore) : undefined,
      comment: normalizedComment || undefined
    });
    ElMessage.success(action === 'approve' ? '已通过' : (action === 'reject' ? '已驳回' : '已退回补充'));
    return true;
  } finally {
    submitting.value = false;
  }
  return false;
};

const requestQuickComment = async (action) => {
  if (!['return', 'reject'].includes(action)) return '';
  const isReturn = action === 'return';
  try {
    const { value } = await ElMessageBox.prompt(
      isReturn ? '请说明需要学生补充或修改的内容' : '请填写本次申报不予认定的原因',
      isReturn ? '退回补充' : '驳回申报',
      {
        inputType: 'textarea',
        inputPlaceholder: isReturn ? '例如：请补充获奖证书照片' : '例如：材料与申报事项不符',
        inputValidator: value => !!String(value || '').trim() || '该说明不能为空',
        confirmButtonText: isReturn ? '继续退回' : '继续驳回',
        cancelButtonText: '取消'
      }
    );
    return String(value || '').trim();
  } catch (_) {
    return null;
  }
};

// 行内快捷审批：通过默认按申请分打分；退回/驳回先收集学生可见的反馈。
const quickAction = async (row, action) => {
  const comment = await requestQuickComment(action);
  if (comment === null) return;
  const ok = await doAction(row, action, {
    finalScore: Number(row.applyScore),
    comment
  });
  if (ok) {
    // 如果当前详情正在看这个行，也要同步清掉状态
    if (current.value?.id === row.id) {
      detailVisible.value = false;
      current.value = null;
    }
    go(f.page);
    // 审批成功后，通知父组件切换到"我已审批"
    if (props.mode === 'pending' && action === 'approve') {
      emit('approve-success');
    }
  }
};

// 学院管理员/学校管理员删除已通过审批单
const adminDelete = async (row) => {
  try {
    await adminDeleteApplication(row.id);
    ElMessage.success('已删除，关联分数已扣减');
    if (current.value?.id === row.id) {
      detailVisible.value = false;
      current.value = null;
    }
    go(f.page);
  } catch (e) {
    ElMessage.error('删除失败：' + (e.message || '服务器错误'));
  }
};

// 抽屉底部审批：使用 appr.finalScore / appr.comment
const drawerAct = async (action) => {
  if (!current.value) return;
  const ok = await doAction(current.value, action, {
    finalScore: Number(appr.finalScore),
    comment: appr.comment
  });
  if (ok) {
    detailVisible.value = false;
    current.value = null;
    go(f.page);
    // 审批成功后，通知父组件切换到"我已审批"
    if (props.mode === 'pending' && action === 'approve') {
      emit('approve-success');
    }
  }
};

watch(() => props.mode, () => go(1));

onMounted(async () => {
  try { modules.value = (await listModules({ pageSize: 200 }))?.list || []; } catch (_) {}
  go(1);
  loadCounselorStats();
  // URL 参数自动打开详情：支持 applicationId
  const appId = route.query.applicationId;
  if (appId) {
    await nextTick();
    const target = list.value.find(item => String(item.id) === String(appId));
    if (target) {
      openDetail(target);
    }
  }
});
</script>

<style lang="scss" scoped>
.filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 16px 16px; }
.page-wrap { display:flex; justify-content: flex-end; padding: 12px 16px; }
.mt-8 { margin-top: 8px; } .mt-16 { margin-top: 16px; }
.mt-20 { margin-top: 20px; }

/* 辅导员快捷统计卡片 */
.counselor-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px;
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); }
}
.cs-card { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 12px;
  cursor: pointer; transition: all 0.2s; border: 1px solid transparent;
  &:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); }
  .cs-icon { width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 22px; color: #fff; }
  .cs-body { flex: 1; min-width: 0; }
  .cs-label { font-size: 12px; color: #909399; margin-bottom: 2px; }
  .cs-value { font-size: 26px; font-weight: 700; line-height: 1.2; }
  .cs-extra { font-size: 11px; color: #C0C4CC; margin-top: 2px; }
  &.cs-blue   { background: linear-gradient(135deg, #ecf5ff, #d9ecff); .cs-icon { background: #409EFF; } .cs-value { color: #409EFF; } }
  &.cs-orange { background: linear-gradient(135deg, #fdf6ec, #faecd5); .cs-icon { background: #E6A23C; } .cs-value { color: #E6A23C; } }
  &.cs-green  { background: linear-gradient(135deg, #f0f9eb, #e1f3d8); .cs-icon { background: #67C23A; } .cs-value { color: #67C23A; } }
  &.cs-red    { background: linear-gradient(135deg, #fef0f0, #fde2e2); .cs-icon { background: #F56C6C; } .cs-value { color: #F56C6C; } }
}

/* ===== 详情抽屉样式 ===== */
.drawer-inner { height: 100%; display: flex; flex-direction: column; }
.drawer-header {
  display:flex; align-items:flex-start; justify-content:space-between;
  padding: 16px 20px; border-bottom: 1px solid #ebeef5; background: #FAFBFC;
}
.sub-info { display: flex; gap: 20px; color: #606266; font-size: 13px; flex-wrap: wrap; }
.panel-title {
  font-size: 14px; font-weight: 600; color: #303133; margin: 8px 0 12px;
  padding-left: 10px; border-left: 3px solid #409EFF;
}
.review-item {
  border-left: 2px solid #EBEEF5; padding: 4px 0 12px 14px; margin-left: 6px;
  &:not(:last-child) { margin-bottom: 6px; }
}
.review-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: 13px; color: #606266; margin-bottom: 4px;
  .reviewer { font-weight: 600; color: #303133; }
  .score { color: #67C23A; }
  .time { color: #909399; margin-left: auto; font-size: 12px; }
}
.review-comment {
  background: #F5F7FA; border-radius: 4px; padding: 8px 12px;
  font-size: 13px; color: #303133; line-height: 1.7; white-space: pre-wrap;
}
.action-tag {
  padding: 2px 8px; background: #ECF5FF; color: #409EFF;
  border-radius: 4px; font-size: 12px; font-weight: 500;
}
.appeal-stats {
  display: flex; gap: 20px; font-size: 12px; color: #606266;
  margin-bottom: 8px; padding: 4px 0 4px 14px;
}

/* ===== 简化流程：当前阶段醒目卡片 ===== */
.current-stage-card {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 16px 18px; border-radius: 10px;
  background: #ECF5FF; border-left: 4px solid #409EFF;
  box-shadow: 0 2px 8px rgba(64,158,255,.08);
}
.current-stage-card.csc-success   { background: #F0F9EB; border-left-color: #67C23A; }
.current-stage-card.csc-error     { background: #FEF0F0; border-left-color: #F56C6C; }
.current-stage-card.csc-warning   { background: #FDF6EC; border-left-color: #E6A23C; }
.current-stage-card.csc-processing{ background: #ECF5FF; border-left-color: #409EFF; }
.csc-dot {
  width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-top: 6px;
  background: #409EFF; box-shadow: 0 0 0 4px rgba(64,158,255,.15);
  animation: pulse-blue 1.8s ease-in-out infinite;
}
.csc-success .csc-dot    { background:#67C23A; box-shadow: 0 0 0 4px rgba(103,194,58,.15); animation: none; }
.csc-error .csc-dot      { background:#F56C6C; box-shadow: 0 0 0 4px rgba(245,108,108,.15); animation: none; }
.csc-warning .csc-dot    { background:#E6A23C; box-shadow: 0 0 0 4px rgba(230,162,60,.15); }
@keyframes pulse-blue {
  0%,100% { box-shadow: 0 0 0 4px rgba(64,158,255,.15); }
  50%     { box-shadow: 0 0 0 7px rgba(64,158,255,.28); }
}
.csc-body  { flex: 1; min-width: 0; }
.csc-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.csc-title {
  font-size: 18px; font-weight: 700; color: #303133;
  margin-bottom: 6px; line-height: 1.3;
}
.csc-success .csc-title { color: #529B2C; }
.csc-error   .csc-title { color: #C45656; }
.csc-warning .csc-title { color: #B88230; }
.csc-desc  { font-size: 13px; color: #606266; line-height: 1.6; }
.csc-time  { font-size: 12px; color: #909399; margin-top: 6px; }

/* 已完成步骤：极简对勾行 */
.done-row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0 6px 4px; }
.done-dot {
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; margin-top: 3px;
  background: #67C23A; color: #fff; position: relative;
}
.done-dot::after {
  content: ''; position: absolute; left: 3px; top: 5px;
  width: 3px; height: 6px;
  border-right: 2px solid #fff; border-bottom: 2px solid #fff;
  transform: rotate(45deg);
}
.done-body  { flex: 1; min-width: 0; }
.done-title { font-size: 13px; color: #606266; line-height: 1.5; }
.done-action { color: #303133; font-weight: 500; }
.done-time  { font-size: 12px; color: #C0C4CC; margin-top: 2px; }

/* 学生信息卡 */
.student-info-card {
  display: flex; gap: 16px; padding: 14px 16px;
  background: linear-gradient(135deg, #ecf5ff, #f0f9eb);
  border-radius: 10px; border: 1px solid #ebeef5;
}
.sic-avatar { display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.sic-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sic-row { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; }
.sic-lbl { color: #909399; min-width: 48px; }
.sic-val { color: #303133; }
/* 证明材料 */
.proof-item { a { display: block; border: 1px solid #ebeef5; border-radius: 8px; overflow: hidden; background: #fafafa; text-align: center; } }
.proof-img { width: 100%; height: 90px; object-fit: cover; display: block; }
.proof-file { padding: 12px 6px; height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  color: #606266; span { font-size: 11px; word-break: break-all; max-width: 100%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } }

/* 抽屉底部固定审批操作栏 */
.drawer-footer {
  border-top: 1px solid #ebeef5; padding: 14px 20px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; background: #fff;
}
.footer-left { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.footer-right { display: flex; gap: 10px; }
/* 通过审批作为主按钮，视觉上更大更突出 */
.btn-primary-approve {
  font-weight: 600;
  padding: 9px 18px;
  box-shadow: 0 2px 6px rgba(103,194,58,.25);
}

/* 班级管理员审批：不同处理结果使用独立表单，避免打分和退回/驳回说明混在一起。 */
.review-footer { display: block; padding: 18px 20px 16px; }
.review-footer-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.review-footer-title { color: #1F2A44; font-size: 14px; font-weight: 700; line-height: 1.35; }
.review-footer-subtitle { margin-top: 3px; color: #7A899D; font-size: 12px; line-height: 1.5; }
.review-action-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.review-action-option {
  min-height: 66px; padding: 10px 12px; border: 1px solid #DCE4EF; border-radius: 8px;
  background: #fff; color: #42526B; cursor: pointer; font: inherit; text-align: left;
  transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
}
.review-action-option:hover { border-color: #AAB9CD; background: #F8FAFD; }
.review-action-option:focus-visible { outline: 2px solid #4F46E5; outline-offset: 2px; }
.review-action-option.is-selected { box-shadow: 0 0 0 1px currentColor; }
.review-action-option.is-approve.is-selected { color: #078A6D; border-color: #62C7AE; background: #EFFCF8; }
.review-action-option.is-return.is-selected { color: #B97705; border-color: #F3C36A; background: #FFF9EB; }
.review-action-option.is-reject.is-selected { color: #D63F59; border-color: #F2A7B6; background: #FFF2F4; }
.review-action-option-title, .review-action-option-desc { display: block; }
.review-action-option-title { font-size: 13px; font-weight: 700; line-height: 1.35; }
.review-action-option-desc { margin-top: 3px; color: #7A899D; font-size: 12px; line-height: 1.35; }
.review-action-form { margin-top: 12px; padding: 14px; border: 1px solid #DCE4EF; border-radius: 8px; background: #F8FAFD; }
.review-action-form.is-approve { border-color: #C8EADB; background: #F4FCF8; }
.review-action-form.is-return { border-color: #F5DEAD; background: #FFFBF2; }
.review-action-form.is-reject { border-color: #F4C8D1; background: #FFF7F8; }
.review-action-copy { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.review-action-copy strong { color: #24324A; font-size: 13px; }
.review-action-copy span { color: #66768D; font-size: 12px; line-height: 1.5; }
.review-action-fields { display: grid; grid-template-columns: minmax(172px, 220px) minmax(0, 1fr); gap: 14px; align-items: end; margin-top: 12px; }
.review-field { min-width: 0; }
.review-field label { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #42526B; font-size: 12px; font-weight: 700; }
.review-field label em { color: #D63F59; font-size: 12px; font-style: normal; }
.review-field label small { color: #8C99AA; font-size: 12px; font-weight: 500; }
.review-score-field > span { display: block; margin-top: 5px; color: #7A899D; font-size: 12px; }
.review-comment-field { grid-column: span 1; }
.review-action-submit { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
.review-action-note { color: #7A899D; font-size: 12px; line-height: 1.5; }
.review-submit-button { min-width: 108px; }

@media (max-width: 640px) {
  .review-footer { padding: 16px; }
  .review-action-picker { grid-template-columns: 1fr; }
  .review-action-option { min-height: 56px; }
  .review-action-fields { grid-template-columns: 1fr; }
  .review-action-submit { align-items: stretch; flex-direction: column; }
  .review-submit-button { width: 100%; }
}

.counselor-stats { gap: 12px; margin-bottom: 18px; }
.cs-card {
  min-height: 112px; padding: 17px 18px; border: 1px solid #DFE8F3; border-radius: 16px; background: #fff !important; box-shadow: 0 10px 26px rgba(22,44,84,.055); position: relative; overflow: hidden;
  &::after { content: ''; position: absolute; width: 84px; height: 84px; right: -40px; bottom: -44px; border: 14px solid var(--cs-soft); border-radius: 50%; }
  .cs-icon { width: 40px; height: 40px; border-radius: 12px; color: var(--cs-accent); background: var(--cs-soft) !important; }
  .cs-label { color: #66768D; }
  .cs-value { color: #17233B !important; font-size: 28px; }
  .cs-extra { color: #9AA7B8; }
  &.cs-blue { --cs-accent: #2563EB; --cs-soft: #EAF2FF; }
  &.cs-orange { --cs-accent: #E99708; --cs-soft: #FFF4D9; }
  &.cs-green { --cs-accent: #0F9F82; --cs-soft: #E5F8F3; }
  &.cs-red { --cs-accent: #E34F6F; --cs-soft: #FFEAF0; }
}
.card { padding: 0; overflow: hidden; border: 1px solid #DFE8F3; border-radius: 16px; box-shadow: 0 10px 28px rgba(22,44,84,.05); }
.filters { padding: 16px 18px; align-items: center; background: linear-gradient(90deg, #F8FAFD, #F5F9FE); border-bottom: 1px solid #E8EEF6; }
:deep(.filters .el-input__wrapper), :deep(.filters .el-select__wrapper) { min-height: 38px; background: #fff; }
.page-wrap { padding: 14px 18px; border-top: 1px solid #EDF2F7; }
</style>
