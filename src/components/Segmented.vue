<script setup lang="ts" generic="T extends string | boolean">
defineProps<{
  options: { value: T; label: string }[];
  modelValue: T;
  /** Inside a card or panel: the page background, so it stands out from the card. */
  inset?: boolean;
}>();
defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<template>
  <div class="segmented" :class="{ inset }">
    <button
      v-for="o in options"
      :key="String(o.value)"
      :class="{ active: modelValue === o.value }"
      @click="$emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--card);
}
button {
  padding: 7px 13px;
  border-radius: 8px;
  color: var(--muted);
  font-size: 15px;
  white-space: nowrap;
}
button.active {
  background: var(--bg);
  color: var(--text);
}
.inset {
  background: var(--bg);
}
.inset button.active {
  background: var(--card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
</style>
