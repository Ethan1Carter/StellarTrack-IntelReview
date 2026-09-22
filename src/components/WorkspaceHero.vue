<template>
  <section class="workspace-hero">
    <div class="workspace-hero-copy">
      <div class="workspace-hero-kicker"><span></span>{{ eyebrow }}</div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="workspace-hero-actions">
      <slot name="actions" />
    </div>
    <img class="workspace-hero-watermark" src="/branding/xinggui-symbol.png" alt="" />
  </section>
</template>

<script setup>
defineProps({
  eyebrow: { type: String, default: 'XINGGUI WORKSPACE' },
  title: { type: String, required: true },
  description: { type: String, required: true }
});
</script>

<style lang="scss" scoped>
.workspace-hero {
  min-height: 148px;
  padding: 25px 30px;
  border-radius: 22px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  color: #fff;
  background:
    radial-gradient(circle at 77% 0%, rgba(31, 211, 238, .3), transparent 18rem),
    linear-gradient(118deg, #10265F 0%, #164B9A 58%, #087FB6 100%);
  box-shadow: 0 18px 44px rgba(12, 45, 105, .18);

  &::after {
    content: '';
    position: absolute;
    width: 390px;
    height: 128px;
    right: 42px;
    top: 10px;
    border: 1px solid rgba(255, 255, 255, .19);
    border-radius: 50%;
    transform: rotate(-16deg);
  }
}
.workspace-hero-copy { position: relative; z-index: 2; }
.workspace-hero-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #A7EAF5;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .18em;

  span {
    width: 22px;
    height: 2px;
    border-radius: 99px;
    background: #FFBE0B;
    box-shadow: 0 0 12px rgba(255, 190, 11, .7);
  }
}
h1 { margin: 11px 0 7px; font-size: 27px; line-height: 1.2; letter-spacing: -.035em; }
p { margin: 0; color: #CBE6F2; font-size: 13px; }
.workspace-hero-actions {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 9px;

  :deep(.el-button) {
    min-height: 40px;
    padding: 0 17px;
    border-radius: 11px;
    border-color: rgba(255, 255, 255, .34);
    background: rgba(255, 255, 255, .14);
    color: #fff;
    box-shadow: none;
    backdrop-filter: blur(9px);
  }
  :deep(.el-button:hover) { background: rgba(255, 255, 255, .23); border-color: rgba(255, 255, 255, .58); }
}
.workspace-hero-watermark {
  position: absolute;
  z-index: 1;
  width: 162px;
  height: 162px;
  object-fit: contain;
  right: 20%;
  top: -8px;
  opacity: .13;
  filter: grayscale(1) brightness(3);
  pointer-events: none;
}

@include mobile {
  .workspace-hero { min-height: 0; padding: 22px 20px; border-radius: 18px; align-items: flex-start; flex-direction: column; }
  h1 { font-size: 23px; }
  .workspace-hero-actions { width: 100%; :deep(.el-button) { flex: 1; } }
  .workspace-hero-watermark { width: 122px; height: 122px; right: -6px; top: 5px; }
}
</style>
