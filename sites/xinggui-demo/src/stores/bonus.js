import { defineStore } from 'pinia';
import { getBonusStats } from '@/api/bonus';
import { useUserStore } from '@/stores/user';

/**
 * 加分申报实时 store
 * - 维护班级管理员的待办角标计数（pending / returned）
 * - 通过 fetch 流式读取 SSE（后端 requireClassAdmin 需 Bearer，EventSource 无法自定义头，故用 fetch）
 * - 30s 轮询兜底，保证即使 SSE 中断也能"刷新可见"
 */
export const useBonusStore = defineStore('bonus', {
  state: () => ({
    pendingCount: 0,
    returnedCount: 0,
    connected: false,
    lastEvent: null,        // { event, payload, at } 供审核页监听
    _started: false,
    _abort: null,
    _poll: null,
    _retry: null
  }),
  getters: {
    total: (s) => s.pendingCount + s.returnedCount
  },
  actions: {
    async refresh() {
      try {
        const data = await getBonusStats({ __suppressMsg: true });
        this.pendingCount = Number(data?.pending || 0);
        this.returnedCount = Number(data?.returned || 0);
      } catch (_) { /* ignore */ }
    },
    start() {
      const user = useUserStore();
      if (this._started) return;
      if (user.role !== 'class_admin') return; // 仅班级管理员需要实时待办
      this._started = true;
      this.refresh();
      this.connect();
      this._poll = setInterval(() => this.refresh(), 30000);
    },
    stop() {
      this._started = false;
      if (this._poll) { clearInterval(this._poll); this._poll = null; }
      if (this._retry) { clearTimeout(this._retry); this._retry = null; }
      this.disconnect();
    },
    disconnect() {
      try { this._abort && this._abort.abort(); } catch (_) {}
      this.connected = false;
    },
    async connect() {
      const user = useUserStore();
      if (!user.token) return;
      this.disconnect();
      const controller = new AbortController();
      this._abort = controller;
      try {
        const resp = await fetch('/api/bonus/stream', {
          headers: { Authorization: `Bearer ${user.token}` },
          signal: controller.signal
        });
        if (!resp.ok) throw new Error('SSE connect failed ' + resp.status);
        this.connected = true;
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            this._handleBlock(block);
          }
        }
      } catch (e) {
        this.connected = false;
        if (this._started) this._retry = setTimeout(() => this.connect(), 4000);
      }
    },
    _handleBlock(block) {
      let eventName = 'message';
      let dataStr = '';
      block.split('\n').forEach((line) => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
      });
      if (!dataStr) return;
      let payload;
      try { payload = JSON.parse(dataStr); } catch (_) { return; }
      this.lastEvent = { event: eventName, payload, at: Date.now() };
      if (payload.type === 'new_claim') {
        this.pendingCount = Math.max(0, this.pendingCount + 1);
      } else if (payload.type === 'claim_updated') {
        this.refresh(); // 状态变化后重新统计，避免角标错乱
      }
    }
  }
});
