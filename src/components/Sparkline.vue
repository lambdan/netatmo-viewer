<script setup lang="ts">
import { computed, useId } from "vue";
import { time } from "../format.ts";

const props = defineProps<{
  points: [number, number][];
  color: string;
  /** Show hour labels along the bottom. */
  axis?: boolean;
}>();

const W = 300;
const H = 100;
const PAD = 6;
const gradientId = `spark-${useId()}`;

const geometry = computed(() => {
  const pts = props.points;
  if (pts.length < 2) return undefined;
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, v] of pts) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Keep flat-ish indoor curves from looking dramatic.
  const span = Math.max(hi - lo, 2);
  const mid = (hi + lo) / 2;
  lo = mid - span / 2;
  hi = mid + span / 2;

  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);

  const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
  const area = `${line}L${W},${H}L0,${H}Z`;

  const ticks: { left: string; label: string }[] = [];
  if (props.axis) {
    // A label every 6 hours, on the hour.
    const first = Math.ceil(t0 / 21600) * 21600;
    for (let t = first; t < t1; t += 21600) {
      const pct = (x(t) / W) * 100;
      if (pct > 4 && pct < 96) ticks.push({ left: `${pct}%`, label: time(t) });
    }
  }

  const [lt, lv] = pts[pts.length - 1];
  return { line, area, ticks, dotTop: `${(y(lv) / H) * 100}%`, dotLeft: `${(x(lt) / W) * 100}%` };
});
</script>

<template>
  <div class="spark" v-if="geometry">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" :stop-color="color" stop-opacity="0.35" />
          <stop offset="1" :stop-color="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path :d="geometry.area" :fill="`url(#${gradientId})`" />
      <path
        :d="geometry.line"
        fill="none"
        :stroke="color"
        stroke-width="2.5"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <span class="dot" :style="{ top: geometry.dotTop, left: geometry.dotLeft, background: color }" />
    <div class="ticks" v-if="axis">
      <span v-for="t in geometry.ticks" :key="t.label" :style="{ left: t.left }">{{ t.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.spark {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.dot {
  position: absolute;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.35);
}
.ticks {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -20px;
  height: 16px;
}
.ticks span {
  position: absolute;
  -webkit-transform: translateX(-50%);
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--muted);
}
</style>
