<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StationEvent } from "../../shared/types.ts";
import { fixed, fmtDate } from "../format.ts";
import { niceStep, type Tick } from "../period.ts";

const props = defineProps<{
  /** [bucket start, avg, min, max] */
  points: [number, number, number, number][];
  from: number;
  to: number;
  bucket: number;
  ticks: Tick[];
  color: string;
  decimals: number;
  unit: string;
  tipFormat: Intl.DateTimeFormatOptions;
  events?: StationEvent[];
}>();

const W = 1000;
const H = 400;
const el = ref<HTMLElement>();
const active = ref<number>();
watch(() => props.points, () => (active.value = undefined));

const pct = (v: number) => `${v}%`;
const visibleEvents = computed(() =>
  (props.events ?? []).filter((e) => e.at >= props.from && e.at < props.to)
);
const xOf = (t: number) => ((t - props.from) / (props.to - props.from)) * 100;
// Plot each bucket in its middle.
const center = (p: [number, number, number, number]) => Math.min(p[0] + props.bucket / 2, props.to);

const scale = computed(() => {
  if (!props.points.length) return undefined;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of props.points) {
    if (p[2] < lo) lo = p[2];
    if (p[3] > hi) hi = p[3];
  }
  const step = niceStep(Math.max(hi - lo, Math.pow(10, -props.decimals) * 10), 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const grid: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) grid.push(v);
  return { lo, hi, grid, yOf: (v: number) => (1 - (v - lo) / (hi - lo)) * 100 };
});

const paths = computed(() => {
  const s = scale.value;
  if (!s) return { line: "", band: "" };
  const X = (t: number) => (xOf(t) / 100) * W;
  const Y = (v: number) => (s.yOf(v) / 100) * H;
  // Don't draw across gaps (station offline etc).
  const segments: [number, number, number, number][][] = [];
  let cur: [number, number, number, number][] = [];
  for (const p of props.points) {
    if (cur.length && p[0] - cur[cur.length - 1][0] > props.bucket * 3) {
      segments.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segments.push(cur);

  let line = "";
  let band = "";
  for (const seg of segments) {
    line += seg.map((p, i) => `${i ? "L" : "M"}${X(center(p)).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    if (seg.length > 1) {
      band += seg.map((p, i) => `${i ? "L" : "M"}${X(center(p)).toFixed(1)},${Y(p[3]).toFixed(1)}`).join("");
      band += seg.slice().reverse().map((p) => `L${X(center(p)).toFixed(1)},${Y(p[2]).toFixed(1)}`).join("");
      band += "Z";
    }
  }
  return { line, band };
});

function pick(clientX: number) {
  const pts = props.points;
  if (!el.value || !pts.length) return;
  const rect = el.value.getBoundingClientRect();
  const t = props.from + ((clientX - rect.left) / rect.width) * (props.to - props.from);
  // Binary search for the nearest bucket.
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (center(pts[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(center(pts[lo - 1]) - t) < Math.abs(center(pts[lo]) - t)) lo--;
  active.value = lo;
}

const tip = computed(() => {
  const s = scale.value;
  if (active.value === undefined || !s) return undefined;
  const p = props.points[active.value];
  if (!p) return undefined;
  const x = xOf(center(p));
  return {
    x,
    y: s.yOf(p[1]),
    alignRight: x > 70,
    value: `${fixed(p[1], props.decimals)}${props.unit}`,
    range: p[2] !== p[3] ? `${fixed(p[2], props.decimals)} – ${fixed(p[3], props.decimals)}${props.unit}` : "",
    time: fmtDate(p[0], props.tipFormat),
  };
});
</script>

<template>
  <div class="chart">
    <div
      class="plot"
      ref="el"
      @touchstart.prevent="pick($event.touches[0].clientX)"
      @touchmove.prevent="pick($event.touches[0].clientX)"
      @mousemove="pick($event.clientX)"
      @mouseleave="active = undefined"
    >
      <template v-if="scale">
        <div v-for="v in scale.grid" :key="v" class="hline" :style="{ top: pct(scale.yOf(v)) }">
          <span class="ylabel">{{ fixed(v, v % 1 ? 1 : 0) }}</span>
        </div>
      </template>
      <div v-for="t in ticks" :key="t.t" class="vline" :style="{ left: pct(xOf(t.t)) }" />
      <template v-for="e in visibleEvents" :key="e.id">
        <div class="event-line" :style="{ left: pct(xOf(e.at)) }" />
        <span
          class="event-label"
          :class="{ right: xOf(e.at) > 75 }"
          :style="{ left: pct(xOf(e.at)) }"
        >{{ e.label }}</span>
      </template>

      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
        <path :d="paths.band" :fill="color" fill-opacity="0.2" />
        <path
          :d="paths.line"
          fill="none"
          :stroke="color"
          stroke-width="2.5"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <template v-if="tip">
        <div class="cursor" :style="{ left: pct(tip.x) }" />
        <div class="dot" :style="{ left: pct(tip.x), top: pct(tip.y), background: color }" />
        <div class="tip" :class="{ right: tip.alignRight }" :style="{ left: pct(tip.x) }">
          <strong>{{ tip.value }}</strong>
          <span v-if="tip.range" class="range">{{ tip.range }}</span>
          <span class="time">{{ tip.time }}</span>
        </div>
      </template>

      <div v-if="!points.length" class="empty">No data for this period</div>
    </div>
    <div class="xlabels">
      <span v-for="t in ticks" :key="t.t" :style="{ left: pct(xOf(t.labelAt)) }">{{ t.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  height: 100%;
  padding: 10px 0 26px 44px;
}
.plot {
  position: relative;
  height: 100%;
  -webkit-user-select: none;
  user-select: none;
}
svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.hline,
.vline {
  position: absolute;
  border-color: var(--line);
  border-style: solid;
  border-width: 0;
}
.hline {
  left: 0;
  right: 0;
  border-top-width: 1px;
}
.vline {
  top: 0;
  bottom: 0;
  border-left-width: 1px;
}
.ylabel {
  position: absolute;
  left: -44px;
  width: 36px;
  top: -8px;
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.xlabels {
  position: absolute;
  left: 44px;
  right: 0;
  bottom: 0;
  height: 18px;
}
.xlabels span {
  position: absolute;
  -webkit-transform: translateX(-50%);
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.event-line {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 2px dashed var(--warn);
  opacity: 0.7;
}
.event-label {
  position: absolute;
  bottom: 6px;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--warn-bg);
  color: var(--warn);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.event-label.right {
  -webkit-transform: translateX(-100%);
  transform: translateX(-100%);
  margin-left: -6px;
}
.cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--muted);
}
.dot {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--card);
}
.tip {
  position: absolute;
  top: 0;
  margin-left: 10px;
  padding: 7px 11px;
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  pointer-events: none;
}
.tip.right {
  -webkit-transform: translateX(-100%);
  transform: translateX(-100%);
  margin-left: -10px;
}
.tip strong {
  display: block;
  font-size: 20px;
  font-weight: 500;
}
.tip span {
  display: block;
  font-size: 13px;
  color: var(--muted);
}
.empty {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--muted);
}

/* Phones: only every other axis label, so they don't overlap. */
@media (max-width: 600px) {
  .xlabels span:nth-child(even) {
    display: none;
  }
  .xlabels span,
  .ylabel {
    font-size: 11px;
  }
}
</style>
