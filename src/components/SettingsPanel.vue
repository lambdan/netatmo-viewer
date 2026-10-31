<script setup lang="ts">
import { type ThemeMode, themeSettings } from "../theme.ts";

defineEmits<{ close: [] }>();

const modes: { value: ThemeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const toggle = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];
</script>

<template>
  <div class="overlay" @click.self="$emit('close')">
    <div class="panel">
      <h2>Display</h2>

      <div class="row">
        <span class="label">Theme</span>
        <div class="segmented">
          <button
            v-for="m in modes"
            :key="m.value"
            :class="{ active: themeSettings.mode === m.value }"
            @click="themeSettings.mode = m.value"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <div class="row" :class="{ disabled: themeSettings.mode !== 'auto' }">
        <span class="label">Light from</span>
        <input type="time" v-model="themeSettings.dayStart" :disabled="themeSettings.mode !== 'auto'" />
      </div>
      <div class="row" :class="{ disabled: themeSettings.mode !== 'auto' }">
        <span class="label">Dark from</span>
        <input type="time" v-model="themeSettings.nightStart" :disabled="themeSettings.mode !== 'auto'" />
      </div>

      <div class="row">
        <span class="label">Freezing line</span>
        <div class="segmented">
          <button
            v-for="o in toggle"
            :key="o.label"
            :class="{ active: themeSettings.freezingLine === o.value }"
            @click="themeSettings.freezingLine = o.value"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <p class="note">Saved on this device.</p>
      <button class="done" @click="$emit('close')">Done</button>
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
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.panel {
  width: 420px;
  max-width: 90%;
  padding: 24px 26px 20px;
  border-radius: 18px;
  background: var(--card);
  color: var(--text);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}
h2 {
  margin: 0 0 18px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.row {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
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
.segmented {
  display: -webkit-flex;
  display: flex;
  padding: 3px;
  border-radius: 10px;
  background: var(--bg);
}
button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  cursor: pointer;
  -webkit-appearance: none;
}
.segmented button {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 16px;
  color: var(--muted);
}
.segmented button.active {
  background: var(--card);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
input[type="time"] {
  -webkit-appearance: none;
  min-width: 110px;
  padding: 7px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.note {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.done {
  display: block;
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
  font-size: 17px;
  font-weight: 600;
}
</style>
