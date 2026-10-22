<script setup lang="ts">
import { ref } from "vue";
import type { Module, StationEvent } from "../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDate } from "../format.ts";

const props = defineProps<{ events: StationEvent[]; modules: Module[]; currentModule: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();

/** "" = all modules */
const moduleId = ref(props.currentModule);
const date = ref("");
const label = ref("Moved");
const error = ref<string>();
const busy = ref(false);

async function add() {
  // "YYYY-MM-DD" from the date picker, as local midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
  if (!m) {
    error.value = "Pick a date first";
    return;
  }
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000;
  await run(() => api.addEvent(at, label.value, moduleId.value || null));
  if (!error.value) {
    date.value = "";
    label.value = "Moved";
  }
}

function moduleName(id: string | null) {
  return id === null ? "All modules" : props.modules.find((m) => m.id === id)?.name ?? "Unknown module";
}

async function remove(e: StationEvent) {
  if (confirm(`Delete "${e.label}"?`)) await run(() => api.deleteEvent(e.id));
}

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = undefined;
  try {
    await fn();
    emit("changed");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel">
      <h2>Events</h2>
      <p class="note">
        Marked on the history charts, e.g. when a module was moved to another room. Events for
        "All modules" (like moving house) show up on every module.
      </p>

      <div v-for="e in events.slice().reverse()" :key="e.id" class="event">
        <span class="when">{{ fmtDate(e.at, { day: "numeric", month: "short", year: "numeric" }) }}</span>
        <span class="label">{{ e.label }}<small>{{ moduleName(e.moduleId) }}</small></span>
        <button class="delete" :disabled="busy" @click="remove(e)" aria-label="Delete">×</button>
      </div>
      <p v-if="!events.length" class="note">No events yet.</p>

      <form class="add" @submit.prevent="add">
        <select v-model="moduleId">
          <option v-for="m in modules" :key="m.id" :value="m.id">{{ m.name }}</option>
          <option value="">All modules</option>
        </select>
        <input type="date" v-model="date" />
        <input type="text" v-model="label" maxlength="100" placeholder="What happened" />
        <button type="submit" :disabled="busy || !label.trim()">Add</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>

      <button class="done" @click="emit('close')">Done</button>
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
  width: 520px;
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
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.note {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.event {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  min-height: 46px;
  border-bottom: 1px solid var(--line);
}
.when {
  -webkit-flex: 0 0 120px;
  flex: 0 0 120px;
  font-size: 15px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.label {
  -webkit-flex: 1;
  flex: 1;
  font-size: 17px;
}
.label small {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  -webkit-appearance: none;
}
.delete {
  width: 40px;
  height: 40px;
  font-size: 24px;
  color: var(--muted);
}
.add {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-wrap: wrap;
  flex-wrap: wrap;
  margin-top: 16px;
}
.add > * {
  margin-bottom: 8px;
}
select {
  -webkit-flex: 1 0 100%;
  flex: 1 0 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  -webkit-appearance: none;
  /* A small chevron, since the native one is hidden */
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23889' stroke-width='2'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 13px center;
}
input {
  min-width: 0;
  margin-right: 8px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 16px;
  -webkit-appearance: none;
}
input[type="date"] {
  -webkit-flex: 0 0 160px;
  flex: 0 0 160px;
}
input[type="text"] {
  -webkit-flex: 1;
  flex: 1;
}
.add button {
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--text);
  color: var(--bg);
  font-weight: 600;
}
button:disabled {
  opacity: 0.5;
}
.error {
  margin: 10px 0 0;
  color: var(--warn);
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
</style>
