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
import { freezingLine, toCelsius, toUnit } from "../units.ts";
import { t } from "../i18n.ts";
import { buildYears } from "../trends.ts";
import EventsPanel from "./EventsPanel.vue";
import HistoryChart from "./HistoryChart.vue";
import RecordsPanel from "./RecordsPanel.vue";
import Segmented from "./Segmented.vue";
import TrendsChart from "./TrendsChart.vue";
import YearsPanel from "./YearsPanel.vue";

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
const metricOptions = computed(() => metrics.value.map((k) => ({ value: k, label: t(METRIC_INFO[k].label) })));
const viewOptions = computed((): { value: View; label: string }[] => [
  { value: "day", label: t("day") },
  { value: "week", label: t("week") },
  { value: "month", label: t("month") },
  { value: "year", label: t("year") },
  { value: "years", label: t("years") },
]);

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
      if (id === seq) error.value = t("loadHistoryFailed", { error: (e as Error).message });
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
    error.value = t("loadEventsFailed", { error: (e as Error).message });
  }
}
loadEvents();

/** Events that affected the module being viewed. */
const moduleEvents = computed(() => events.value.filter((e) => e.moduleIds.includes(moduleId.value)));

// --- derived display data ---

// Temperatures arrive in °C; these are in the unit chosen in the settings.
const convert = computed(() => (metric.value === "temperature" ? toUnit : (v: number) => v));
const shownSeries = computed(() =>
  series.value?.points.map(([t, avg, lo, hi]) =>
    [t, convert.value(avg), convert.value(lo), convert.value(hi)] as [number, number, number, number]
  )
);
const shownRecords = computed((): RecordsResponse | undefined => {
  const r = records.value;
  if (!r) return undefined;
  const c = convert.value;
  const pair = (p?: [number, number]) => (p ? [c(p[0]), p[1]] as [number, number] : undefined);
  const periods = { ...r.periods };
  for (const k of Object.keys(periods) as (keyof typeof periods)[]) {
    periods[k] = { min: pair(r.periods[k].min), max: pair(r.periods[k].max) };
  }
  return { ...r, periods };
});

const summary = computed(() => {
  const pts = shownSeries.value;
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

// Colours are tuned to °C.
const color = computed(() => {
  const avg = summary.value?.avg;
  const c = avg !== undefined && metric.value === "temperature" ? toCelsius(avg) : avg;
  return info.value.color(isLight.value, c);
});
const freezing = computed(() => (metric.value === "temperature" ? freezingLine() : undefined));

const monthNames = computed(() =>
  Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2000, i, 15).getTime() / 1000, { month: "short" }))
);
const years = computed(() =>
  monthly.value
    ? buildYears(
      monthly.value.months.map(([y, m, avg, n]) => [y, m, convert.value(avg), n]),
      (m) => monthNames.value[m],
    )
    : []
);

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
        <button class="back" @click="emit('close')">{{ t("now") }}</button>
        <button class="events-button" @click="showEvents = true">{{ t("events") }}</button>
      </div>
      <Segmented v-if="moduleOptions.length > 1" :options="moduleOptions" v-model="moduleId" />
      <Segmented v-if="metricOptions.length > 1" :options="metricOptions" v-model="metric" />
    </header>

    <main class="body">
      <section class="card main">
        <!-- Everything that controls the chart lives in its card, apart from the records. -->
        <div class="chart-head">
          <Segmented inset :options="viewOptions" v-model="view" />
          <div class="nav" v-if="period">
            <button @click="step(-1)">‹</button>
            <span class="label">{{ period.label }}</span>
            <button @click="step(1)" :disabled="!canGoForward">›</button>
          </div>
          <div class="nav" v-else>
            <span class="label">{{ t("monthlyAverages") }}</span>
          </div>
        </div>
        <div class="summary" v-if="period">
          <template v-if="summary">
            <span><small>{{ t("low") }}</small> {{ fixed(summary.lo, info.decimals) }}{{ info.unit }}</span>
            <span><small>{{ t("avg") }}</small> {{ fixed(summary.avg, info.decimals) }}{{ info.unit }}</span>
            <span><small>{{ t("high") }}</small> {{ fixed(summary.hi, info.decimals) }}{{ info.unit }}</span>
          </template>
        </div>
        <div class="chart-area">
          <HistoryChart
            v-if="period"
            :points="shownSeries ?? []"
            :from="period.from"
            :to="period.to"
            :bucket="period.bucket"
            :ticks="period.ticks"
            :color="color"
            :decimals="info.decimals"
            :unit="info.unit"
            :tip-format="period.tipFormat"
            :events="moduleEvents"
            :freezing="freezing"
          />
          <TrendsChart
            v-else
            :years="years"
            :month-names="monthNames"
            :decimals="info.decimals"
            :unit="info.unit"
            :light="isLight"
            :freezing="freezing"
          />
        </div>
      </section>

      <aside class="card side">
        <h3 class="section-title">{{ t(view === "years" ? "yearlyAverage" : "records") }}</h3>
        <YearsPanel v-if="view === 'years'" :years="years" :info="info" :events="moduleEvents" />
        <RecordsPanel v-else :records="shownRecords" :info="info" />
        <p v-if="module?.battery !== undefined" class="battery" :class="{ low: module.battery < 20 }">
          {{ t("batteryLevel", { n: module.battery }) }}
        </p>
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
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px 20px 16px;
}
.top,
.chart-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}
.top > *,
.chart-head > * {
  margin-bottom: 12px;
}
.chart-head {
  padding-left: 12px;
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
.nav {
  display: flex;
  align-items: center;
}
/* Inside the card: the page background, like the inset period buttons next to them. */
.nav button {
  width: 44px;
  height: 40px;
  border-radius: 10px;
  background: var(--bg);
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
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-gap: 16px;
}
.main {
  display: flex;
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
  margin-bottom: 12px;
}
.battery {
  margin: 16px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 14px;
  color: var(--muted);
}
.battery.low {
  color: var(--warn);
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
