<script setup lang="ts">
import { ref } from "vue";
import type { Module, StationEvent } from "../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDate } from "../format.ts";
import { t } from "../i18n.ts";
import Modal from "./Modal.vue";

const props = defineProps<{ events: StationEvent[]; modules: Module[]; currentModule: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();

/** Which modules the event affected; a new one starts with the module being viewed. */
const moduleIds = ref<string[]>([props.currentModule]);
const date = ref("");
const label = ref(t("defaultEventLabel"));
const error = ref<string>();
const busy = ref(false);
/** The event being edited in the form, if any. */
const editing = ref<StationEvent>();

const pad = (n: number) => (n < 10 ? "0" : "") + n;

function startEdit(e: StationEvent) {
  const d = new Date(e.at * 1000);
  editing.value = e;
  date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  label.value = e.label;
  moduleIds.value = e.moduleIds.slice();
  error.value = undefined;
}

function resetForm() {
  editing.value = undefined;
  date.value = "";
  label.value = t("defaultEventLabel");
  moduleIds.value = [props.currentModule];
}

async function save() {
  // "YYYY-MM-DD" from the date picker, as local midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
  if (!m) {
    error.value = t("pickDate");
    return;
  }
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000;
  if (!moduleIds.value.length) {
    error.value = t("tickModule");
    return;
  }
  // Keep the time of day of an edited event if only other fields changed.
  const e = editing.value;
  const sameDay = e && new Date(e.at * 1000).toDateString() === new Date(at * 1000).toDateString();
  await run(() =>
    e
      ? api.updateEvent(e.id, sameDay ? e.at : at, label.value, moduleIds.value)
      : api.addEvent(at, label.value, moduleIds.value)
  );
  if (!error.value) resetForm();
}

function moduleNames(ids: string[]) {
  return ids.map((id) => props.modules.find((m) => m.id === id)?.name ?? t("unknownModule")).join(", ");
}

async function remove(e: StationEvent) {
  if (!confirm(t("confirmDelete", { label: e.label }))) return;
  await run(() => api.deleteEvent(e.id));
  if (!error.value && editing.value?.id === e.id) resetForm();
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
  <Modal :title="t('events')" :width="520" @close="emit('close')">
    <p class="note">{{ t("eventsNote") }}</p>

    <div
      v-for="e in events.slice().reverse()"
      :key="e.id"
      class="event"
      :class="{ editing: editing?.id === e.id }"
      @click="startEdit(e)"
    >
      <span class="when">{{ fmtDate(e.at, { day: "numeric", month: "short", year: "numeric" }) }}</span>
      <span class="label">{{ e.label }}<small>{{ moduleNames(e.moduleIds) }}</small></span>
      <button class="delete" :disabled="busy" @click.stop="remove(e)" :aria-label="t('delete')">×</button>
    </div>
    <p class="note">{{ t(events.length ? "tapToEdit" : "noEvents") }}</p>

    <h3 class="section-title">{{ t(editing ? "editEvent" : "newEvent") }}</h3>
    <form class="add" @submit.prevent="save">
      <div class="modules">
        <label v-for="m in modules" :key="m.id" :class="{ checked: moduleIds.includes(m.id) }">
          <input type="checkbox" :value="m.id" v-model="moduleIds" />{{ m.name }}
        </label>
      </div>
      <input type="date" v-model="date" />
      <input type="text" v-model="label" maxlength="100" :placeholder="t('whatHappened')" />
      <button type="submit" :disabled="busy || !label.trim()">{{ t(editing ? "save" : "add") }}</button>
    </form>
    <button v-if="editing" class="cancel" @click="resetForm">{{ t("cancelEditing") }}</button>
    <p v-if="error" class="error">{{ error }}</p>
  </Modal>
</template>

<style scoped>
.note {
  margin: 0 0 14px;
}
.event {
  display: flex;
  align-items: center;
  min-height: 46px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.event.editing {
  margin: 0 -10px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--bg);
}
.when {
  flex: 0 0 120px;
  font-size: 15px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.label {
  flex: 1;
  font-size: 17px;
}
.label small {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.delete {
  width: 40px;
  height: 40px;
  font-size: 24px;
  color: var(--muted);
}
h3 {
  margin-top: 18px;
  font-size: 13px;
  letter-spacing: 0.06em;
}
.cancel {
  margin-top: 4px;
  font-size: 14px;
  color: var(--muted);
}
.add {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10px;
}
.add > * {
  margin-bottom: 8px;
}
.modules {
  flex: 1 0 100%;
}
.modules label {
  display: inline-block;
  margin: 0 8px 4px 0;
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  font-size: 15px;
  color: var(--muted);
  cursor: pointer;
}
.modules label.checked {
  border-color: var(--text);
  color: var(--text);
}
.modules input {
  margin: 0 7px 0 0;
  padding: 0;
  vertical-align: -1px;
  -webkit-appearance: checkbox;
}
input[type="date"],
input[type="text"] {
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
  flex: 0 0 160px;
}
input[type="text"] {
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

/* Phones: one field per row */
@media (max-width: 600px) {
  .when {
    flex-basis: 92px;
    font-size: 13px;
  }
  .label {
    font-size: 15px;
  }
  input[type="date"],
  input[type="text"],
  .add button {
    flex: 1 0 100%;
    margin-right: 0;
  }
}
</style>
