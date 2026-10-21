<template>
  <div ref="elRef" :class="className" :style="{ width: '100%', height }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, shallowRef } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: [String, Number], default: '320px' },
  className: { type: String, default: '' },
  theme: { type: [String, Object], default: null },
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(['ready', 'click']);

const elRef = ref(null);
const chart = shallowRef(null);
let resizeObserver = null;

const initChart = () => {
  if (!elRef.value) return;
  chart.value = echarts.init(elRef.value, props.theme, { renderer: 'canvas' });
  chart.value.setOption(props.option || {});
  chart.value.on('click', (params) => emit('click', params));
  emit('ready', chart.value);

  resizeObserver = new ResizeObserver(() => chart.value?.resize());
  resizeObserver.observe(elRef.value);
};

watch(() => props.option, (val) => {
  if (chart.value && val) chart.value.setOption(val, true);
}, { deep: true });

watch(() => props.loading, (v) => {
  if (!chart.value) return;
  v ? chart.value.showLoading() : chart.value.hideLoading();
});

onMounted(async () => {
  await nextTick();
  initChart();
});
onBeforeUnmount(() => {
  try { resizeObserver?.disconnect(); } catch (_) {}
  try { chart.value?.dispose(); } catch (_) {}
});

defineExpose({
  getInstance: () => chart.value,
  resize: () => chart.value?.resize()
});
</script>
