<script setup lang="ts">
import { computed } from "vue";
import { settings, type ThemeMode } from "../settings.ts";
import { reloadFresh } from "../update.ts";
import { t } from "../i18n.ts";
import Modal from "./Modal.vue";
import Segmented from "./Segmented.vue";

const version = __APP_VERSION__;

defineEmits<{ close: [] }>();

// Computed, so the labels follow a change of language right away.
const modes = computed(() =>
  (["auto", "light", "dark"] as ThemeMode[]).map((value) => ({ value, label: t(value) }))
);
const units = [
  { value: "C" as const, label: "°C" },
  { value: "F" as const, label: "°F" },
];
const onOff = computed(() => [
  { value: true, label: t("on") },
  { value: false, label: t("off") },
]);
// Language names are shown in their own language.
const languages = computed(() => [
  { value: "auto" as const, label: t("auto") },
  { value: "en" as const, label: "English" },
  { value: "sv" as const, label: "Svenska" },
]);
</script>

<template>
  <Modal :title="t('display')" :width="420" @close="$emit('close')">
    <div class="row">
      <span class="label">{{ t("theme") }}</span>
      <Segmented inset :options="modes" v-model="settings.mode" />
    </div>
    <div class="row" :class="{ disabled: settings.mode !== 'auto' }">
      <span class="label">{{ t("lightFrom") }}</span>
      <input type="time" v-model="settings.dayStart" :disabled="settings.mode !== 'auto'" />
    </div>
    <div class="row" :class="{ disabled: settings.mode !== 'auto' }">
      <span class="label">{{ t("darkFrom") }}</span>
      <input type="time" v-model="settings.nightStart" :disabled="settings.mode !== 'auto'" />
    </div>
    <div class="row">
      <span class="label">{{ t("temperature") }}</span>
      <Segmented inset :options="units" v-model="settings.tempUnit" />
    </div>
    <div class="row">
      <span class="label">{{ t("freezingLine") }}</span>
      <Segmented inset :options="onOff" v-model="settings.freezingLine" />
    </div>
    <div class="row">
      <span class="label">{{ t("language") }}</span>
      <Segmented inset :options="languages" v-model="settings.language" />
    </div>
    <div class="row">
      <span class="label">{{ t("app") }} <span class="version">{{ version }}</span></span>
      <button class="reload" @click="reloadFresh">{{ t("reload") }}</button>
    </div>
  </Modal>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  border-bottom: 1px solid var(--line);
}
.row.disabled {
  opacity: 0.4;
}
.label {
  font-size: 18px;
}
input[type="time"],
.reload {
  padding: 7px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  -webkit-appearance: none;
}
input[type="time"] {
  min-width: 110px;
  font-size: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.reload {
  font-size: 15px;
}
.version {
  margin-left: 6px;
  font-size: 14px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
