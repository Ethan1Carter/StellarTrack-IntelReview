<template>
  <div class="pagination-wrap">
    <el-pagination
      background
      layout="total, sizes, prev, pager, next, jumper"
      :total="total"
      :page-size="pageSize"
      :current-page="page"
      :page-sizes="[10, 20, 50, 100]"
      @update:current-page="$emit('update:page', $event)"
      @update:page-size="$emit('update:page-size', $event)"
    />
  </div>
</template>

<script setup>
defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 }
});

defineEmits(['update:page', 'update:page-size']);
</script>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
