<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { StationEvent } from "../../shared/types.ts";
import { fixed, fmtDate } from "../format.ts";
import { t } from "../i18n.ts";
import type { Tick } from "../period.ts";
import { niceScale, svgPath } from "../chart.ts";
import ChartFrame from "./ChartFrame.vue";

type Point = [start: number, avg: number, min: number, max: number];

const props = defineProps<{
  points: Point[];
  from: number;
  to: number;
  bucket: number;
  ticks: Tick[];
  color: string;
  decimals: number;
  unit: string;
  tipFormat: Intl.DateTimeFormatOptions;
  events?: StationEvent[];
  /** Where to mark freezing with a line (0 or 32), if wanted. */
  freezing?: number;
}>();

const active = ref<number>();
watch(() => props.points, () => (active.value = undefined));

const pct = (v: number) => `${v}%`;
const xOf = (t: number) => ((t - props.from) / (props.to - props.from)) * 100;
// Plot each bucket in its middle.
const center = (p: Point) => Math.min(p[0] + props.bucket / 2, props.to);

const scale = computed(() => {
  if (!props.points.length) return undefined;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of props.points) {
    if (p[2] < lo) lo = p[2];
    if (p[3] > hi) hi = p[3];
  }
  return niceScale(lo, hi, Math.pow(10, -props.decimals) * 10);
});

const paths = computed(() => {
  const s = scale.value;
  if (!s) return { line: "", band: "" };
  // Don't draw across gaps (station offline etc).
  const segments: Point[][] = [];
  let cur: Point[] = [];
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
  const at = (p: Point, v: number): [number, number] => [xOf(center(p)), s.yOf(v)];
  for (const seg of segments) {
    line += svgPath(seg.map((p) => at(p, p[1])));
    if (seg.length > 1) {
      // Along the maxima, back along the minima.
      band += svgPath(seg.map((p) => at(p, p[3])));
      band += svgPath(seg.slice().reverse().map((p) => at(p, p[2])), "L") + "Z";
    }
  }
  return { line, band };
});

const visibleEvents = computed(() =>
  (props.events ?? []).filter((e) => e.at >= props.from && e.at < props.to)
);
const xLabels = computed(() =>
  props.ticks.map((tk) => ({ key: tk.t, left: xOf(tk.labelAt), label: tk.label }))
);

/** The bucket nearest to where the finger is. */
function pick(at: number) {
  const pts = props.points;
  if (!pts.length) return;
  const t = props.from + at * (props.to - props.from);
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
  const p = active.value === undefined ? undefined : props.points[active.value];
  if (!s || !p) return undefined;
  const d = props.decimals;
  return {
    x: xOf(center(p)),
    y: s.yOf(p[1]),
    value: `${fixed(p[1], d)}${props.unit}`,
    range: p[2] !== p[3] ? `${fixed(p[2], d)} – ${fixed(p[3], d)}${props.unit}` : "",
    time: fmtDate(p[0], props.tipFormat),
  };
});
</script>

<template>
  <ChartFrame
    :scale="scale"
    :freezing="freezing"
    :x-labels="xLabels"
    :cursor="tip?.x"
    :empty="points.length ? undefined : t('noDataPeriod')"
    @pick="pick"
    @leave="active = undefined"
  >
    <template #under>
      <div v-for="tk in ticks" :key="tk.t" class="vline" :style="{ left: pct(xOf(tk.t)) }" />
      <template v-for="e in visibleEvents" :key="e.id">
        <div class="event-line" :style="{ left: pct(xOf(e.at)) }" />
        <span class="event-label" :class="{ right: xOf(e.at) > 75 }" :style="{ left: pct(xOf(e.at)) }">
          {{ e.label }}
        </span>
      </template>
    </template>

    <template #svg>
      <path :d="paths.band" :fill="color" fill-opacity="0.2" />
      <path
        :d="paths.line"
        fill="none"
        :stroke="color"
        stroke-width="2.5"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </template>

    <template v-if="tip" #marker>
      <div class="dot" :style="{ left: pct(tip.x), top: pct(tip.y), background: color }" />
    </template>
    <template v-if="tip" #tip>
      <strong>{{ tip.value }}</strong>
      <span v-if="tip.range" class="tip-line">{{ tip.range }}</span>
      <span class="tip-line">{{ tip.time }}</span>
    </template>
  </ChartFrame>
</template>

<style scoped>
.vline {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--line);
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
  transform: translateX(-100%);
  margin-left: -6px;
}
.dot {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--card);
}
strong {
  display: block;
  font-size: 20px;
  font-weight: 500;
}
.tip-line {
  display: block;
  font-size: 13px;
  color: var(--muted);
}
</style>
