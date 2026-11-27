<script setup lang="ts">
// A panel over the page, closed with Done or by tapping outside it.
import { t } from "../i18n.ts";

defineProps<{ title: string; width: number }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel" :style="{ width: `${width}px` }">
      <h2 class="section-title">{{ title }}</h2>
      <slot />
      <button class="done" @click="emit('close')">{{ t("done") }}</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.panel {
  max-width: 92%;
  max-height: 90%;
  overflow: auto;
  padding: 24px 26px 20px;
  border-radius: 18px;
  background: var(--card);
  color: var(--text);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}
h2 {
  margin-bottom: 12px;
}
.done {
  display: block;
  width: 100%;
  margin-top: 18px;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
  font-size: 17px;
  font-weight: 600;
}

@media (max-width: 600px) {
  .panel {
    padding: 20px 18px 16px;
  }
}
</style>
