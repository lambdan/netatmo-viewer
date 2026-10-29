<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  Metric,
  Module,
  MonthlyResponse,
  RecordsResponse,
  SeriesResponse,
  StationEvent,
} from "../../shared/types.ts";
import { api } from "../api.ts";
import { fixed, fmtDate } from "../format.ts";
import { METRIC_INFO, metricsFor } from "../metrics.ts";
import { periodFor, type RangeKind, recordStarts, shift, timeZone } from "../period.ts";
import { isLight } from "../theme.ts";
import { buildYears, yearColor } from "../trends.ts";
import EventsPanel from "./EventsPanel.vue";
import HistoryChart from "./HistoryChart.vue";
import RecordsPanel from "./RecordsPanel.vue";
import Segmented from "./Segmented.vue";
import TrendsChart from "./TrendsChart.vue";

const props = defineProps<{ modules: Module[]; initialModule?: string }>();
const emit = defineEmits<{ close: [] }>();

// A wall display shouldn't get stuck in the past: go back to "now" after a while.
const IDLE_MS = 3 * 60 * 1000;

type View = RangeKind | "years";

const charted = computed(() => props.modules.filter((m) => metricsFor(m).length));
const moduleId = ref(
  props.initialModule && charted.value.some((m) => m.id === props.initialModule)
    ? props.initialModule
    : charted.value[0]?.id ?? "",
);
const module = computed(() => charted.value.find((m) => m.id === moduleId.value));
const metrics = computed(() => (module.value ? metricsFor(module.value) : []));
const metric = ref<Metric>("temperature");
watch(metrics, (ms) => {
  if (!ms.includes(metric.value)) metric.value = ms[0] ?? "temperature";
});
const info = computed(() => METRIC_INFO[metric.value]);

const view = ref<View>("week");
const anchor = ref(new Date());
const period = computed(() => (view.value === "years" ? undefined : periodFor(view.value, anchor.value)));
const canGoForward = computed(() => !!period.value && period.value.to * 1000 < Date.now());

function step(n: number) {
  if (view.value === "years" || (n > 0 && !canGoForward.value)) return;
  anchor.value = shift(view.value, anchor.value, n);
}

const moduleOptions = computed(() => charted.value.map((m) => ({ value: m.id, label: m.name })));
const metricOptions = computed(() => metrics.value.map((k) => ({ value: k, label: METRIC_INFO[k].label })));
const viewOptions: { value: View; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "years", label: "Years" },
];

// --- data ---

const series = ref<SeriesResponse>();
const records = ref<RecordsResponse>();
const monthly = ref<MonthlyResponse>();
const error = ref<string>();
/** Each part loads on its own, so the chart doesn't wait for the records and vice versa. */
function loader<T>(fetch: () => Promise<T> | undefined, target: { value: T | undefined }) {
  let seq = 0;
  return async () => {
    const id = ++seq;
    try {
      const value = await fetch();
      if (id !== seq) return; // a newer request is on its way
      target.value = value;
      error.value = undefined;
    } catch (e) {
      if (id === seq) error.value = `Couldn't load history (${(e as Error).message})`;
    }
  };
}

const base = () => ({ module: moduleId.value, metric: metric.value });
const loadSeries = loader(() => {
  const p = period.value;
  return p
    ? api.history({ ...base(), from: p.from, to: p.to, bucket: p.bucket, tz: timeZone })
    : undefined;
}, series);
const loadMonthly = loader(
  () => (view.value === "years" ? api.monthly({ ...base(), tz: timeZone }) : undefined),
  monthly,
);
// Records don't depend on the period being viewed.
const loadRecords = loader(() => api.records({ ...base(), ...recordStarts() }), records);

watch([moduleId, metric, () => period.value?.from, view], loadSeries, { immediate: true });
watch([moduleId, metric, view], loadMonthly, { immediate: true });
watch([moduleId, metric], loadRecords, { immediate: true });

// --- events (e.g. station moves) ---

const events = ref<StationEvent[]>([]);
const showEvents = ref(false);
async function loadEvents() {
  try {
    events.value = await api.events();
  } catch (e) {
    error.value = `Couldn't load events (${(e as Error).message})`;
  }
}
loadEvents();

/** Events that affected the module being viewed. */
const moduleEvents = computed(() => events.value.filter((e) => e.moduleIds.includes(moduleId.value)));

function eventsIn(year: number) {
  return moduleEvents.value.filter((e) => new Date(e.at * 1000).getFullYear() === year);
}

// --- derived display data ---

const summary = computed(() => {
  const pts = series.value?.points;
  if (!pts || !pts.length) return undefined;
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  for (const p of pts) {
    sum += p[1];
    if (p[2] < lo) lo = p[2];
    if (p[3] > hi) hi = p[3];
  }
  return { lo, hi, avg: sum / pts.length };
});

const color = computed(() => info.value.color(isLight.value, summary.value?.avg));

const monthNames = Array.from({ length: 12 }, (_, i) =>
  fmtDate(new Date(2000, i, 15).getTime() / 1000, { month: "short" }));
const years = computed(() =>
  monthly.value ? buildYears(monthly.value.months, (m) => monthNames[m]) : []
);

/** The delta as shown, so "+0.0" isn't coloured as a rise. */
function rounded(v: number) {
  const f = Math.pow(10, info.value.decimals);
  return Math.round(v * f) / f;
}

function signed(v: number) {
  const r = rounded(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${fixed(Math.abs(r), info.value.decimals)}`;
}

// --- swipe left/right (outside the chart) to change period ---

let touchX = 0;
let touchY = 0;
function onTouchStart(e: TouchEvent) {
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent) {
  if ((e.target as Element).closest?.(".chart")) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1);
}

// --- idle timeout ---

let idleTimer: number | undefined;
function touched() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => emit("close"), IDLE_MS);
}
onMounted(touched);
onUnmounted(() => clearTimeout(idleTimer));
</script>

<template>
  <div
    class="history"
    @touchstart.capture="touched"
    @mousedown.capture="touched"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <header class="top">
      <div>
        <button class="back" @click="emit('close')">‹ Now</button>
        <button class="events-button" @click="showEvents = true">Events</button>
      </div>
      <Segmented v-if="moduleOptions.length > 1" :options="moduleOptions" v-model="moduleId" />
      <Segmented v-if="metricOptions.length > 1" :options="metricOptions" v-model="metric" />
    </header>

    <main class="body">
      <section class="card main">
        <!-- Everything that controls the chart lives in its card, apart from the records. -->
        <div class="chart-head">
          <Segmented :options="viewOptions" v-model="view" />
          <div class="nav" v-if="period">
            <button @click="step(-1)">‹</button>
            <span class="label">{{ period.label }}</span>
            <button @click="step(1)" :disabled="!canGoForward">›</button>
          </div>
          <div class="nav" v-else>
            <span class="label">Monthly averages, year by year</span>
          </div>
        </div>
        <div class="summary" v-if="period">
          <template v-if="summary">
            <span><small>Low</small> {{ fixed(summary.lo, info.decimals) }}{{ info.unit }}</span>
            <span><small>Avg</small> {{ fixed(summary.avg, info.decimals) }}{{ info.unit }}</span>
            <span><small>High</small> {{ fixed(summary.hi, info.decimals) }}{{ info.unit }}</span>
          </template>
        </div>
        <div class="chart-area">
          <HistoryChart
            v-if="period"
            :points="series?.points ?? []"
            :from="period.from"
            :to="period.to"
            :bucket="period.bucket"
            :ticks="period.ticks"
            :color="color"
            :decimals="info.decimals"
            :unit="info.unit"
            :tip-format="period.tipFormat"
            :events="moduleEvents"
          />
          <TrendsChart
            v-else
            :years="years"
            :month-names="monthNames"
            :decimals="info.decimals"
            :unit="info.unit"
            :light="isLight"
          />
        </div>
      </section>

      <aside class="card side">
        <template v-if="view === 'years'">
          <h3>Yearly average</h3>
          <div v-for="(y, i) in years.slice().reverse()" :key="y.year" class="year">
            <i :style="{ background: yearColor(years.length - 1 - i, years.length, isLight) }" />
            <span class="name">
              {{ y.year }}<small v-if="y.partial">{{ y.partial }}</small>
              <span v-for="e in eventsIn(y.year)" :key="e.id" class="year-event">
                {{ e.label }} · {{ fmtDate(e.at, { day: "numeric", month: "short" }) }}
              </span>
            </span>
            <strong>{{ y.avg === undefined ? "–" : fixed(y.avg, info.decimals) + info.unit }}</strong>
            <span class="delta" :class="{ up: rounded(y.delta ?? 0) > 0, down: rounded(y.delta ?? 0) < 0 }">
              {{ y.delta === undefined ? "" : signed(y.delta) }}
            </span>
          </div>
          <p class="note">
            The change is against the same months of the previous year, so partial years compare
            fairly.
          </p>
        </template>
        <template v-else>
          <h3>Records</h3>
          <RecordsPanel :records="records" :info="info" />
        </template>
      </aside>
    </main>

    <footer v-if="error" class="error">{{ error }}</footer>

    <EventsPanel
      v-if="showEvents"
      :events="events"
      :modules="charted"
      :current-module="moduleId"
      @changed="loadEvents"
      @close="showEvents = false"
    />
  </div>
</template>

<style scoped>
.history {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  height: 100%;
  padding: 14px 20px 16px;
}
.top,
.chart-head {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-wrap: wrap;
  flex-wrap: wrap;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
  justify-content: space-between;
}
.top > *,
.chart-head > * {
  margin-bottom: 12px;
}
.chart-head {
  padding-left: 12px;
}
/* Inside the card, the controls need the page background to stand out. */
.chart-head :deep(.segmented),
.chart-head .nav button {
  background: var(--bg);
}
.chart-head :deep(.segmented button.active) {
  background: var(--card);
}
button {
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  -webkit-appearance: none;
}
.back {
  padding: 8px 14px 8px 4px;
  font-size: 19px;
  font-weight: 600;
}
.events-button {
  margin-left: 6px;
  padding: 7px 13px;
  border-radius: 10px;
  background: var(--card);
  color: var(--muted);
  font-size: 15px;
}
.year-event {
  display: block;
  font-size: 12px;
  color: var(--warn);
}
.nav {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
}
.nav button {
  width: 44px;
  height: 40px;
  border-radius: 10px;
  background: var(--card);
  font-size: 24px;
  line-height: 1;
}
.nav button:disabled {
  opacity: 0.3;
}
.nav .label {
  min-width: 200px;
  padding: 0 12px;
  text-align: center;
  font-size: 17px;
}

.body {
  -webkit-flex: 1;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-gap: 16px;
}
.card {
  border-radius: 18px;
  background: var(--card);
  box-shadow: var(--card-shadow);
}
.main {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  min-height: 0;
  padding: 16px 20px 12px 8px;
}
.summary {
  min-height: 30px;
  padding-left: 52px;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.summary span {
  margin-right: 28px;
}
.summary small {
  font-size: 13px;
  color: var(--muted);
  margin-right: 4px;
}
.chart-area {
  -webkit-flex: 1;
  flex: 1;
  min-height: 0;
  position: relative;
}
.chart-area > * {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.side {
  padding: 18px 20px;
  overflow: auto;
}
h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.year {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: baseline;
  align-items: baseline;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}
.year i {
  -webkit-flex: none;
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: 10px;
  border-radius: 50%;
}
.year .name {
  -webkit-flex: 1;
  flex: 1;
  font-size: 17px;
}
.year small {
  margin-left: 6px;
  font-size: 12px;
  color: var(--muted);
}
.year strong {
  font-size: 19px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.year .delta {
  width: 60px;
  text-align: right;
  font-size: 14px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.delta.up {
  color: #e8873a;
}
.delta.down {
  color: #4a9fe8;
}
.note {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.error {
  padding-top: 8px;
  text-align: center;
  font-size: 13px;
  color: var(--warn);
}

@media (orientation: portrait) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(380px, 1fr) auto;
  }
}

/* Phones */
@media (max-width: 600px) {
  .history {
    padding: 12px 12px 14px;
  }
  .body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(340px, 1fr) auto;
    grid-gap: 12px;
  }
  .main {
    padding: 12px 12px 10px 4px;
  }
  .chart-head {
    padding-left: 8px;
  }
  .nav {
    width: 100%;
  }
  .nav .label {
    -webkit-flex: 1;
    flex: 1;
    min-width: 0;
    font-size: 16px;
  }
  .summary {
    padding-left: 44px;
    font-size: 17px;
  }
  .summary span {
    margin-right: 14px;
    white-space: nowrap;
  }
  .side {
    padding: 14px 16px;
  }
}
</style>
