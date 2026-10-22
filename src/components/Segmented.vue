<script setup lang="ts" generic="T extends string">
defineProps<{ options: { value: T; label: string }[]; modelValue: T }>();
defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<template>
  <div class="segmented">
    <button
      v-for="o in options"
      :key="o.value"
      :class="{ active: modelValue === o.value }"
      @click="$emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: -webkit-inline-flex;
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--card);
}
button {
  padding: 7px 13px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 15px;
  white-space: nowrap;
  cursor: pointer;
  -webkit-appearance: none;
}
button.active {
  background: var(--bg);
  color: var(--text);
}
</style>
