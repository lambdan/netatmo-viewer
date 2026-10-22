<script setup lang="ts">
import { computed, ref } from "vue";
import { fixed } from "../format.ts";
import { niceStep } from "../period.ts";
import { type YearTrend, yearColor } from "../trends.ts";

const props = defineProps<{
  years: YearTrend[];
  monthNames: string[];
  decimals: number;
  unit: string;
  light: boolean;
}>();

const W = 1000;
const H = 400;
const el = ref<HTMLElement>();
const activeMonth = ref<number>();

const pct = (v: number) => `${v}%`;
const xOf = (m: number) => ((m + 0.5) / 12) * 100;

const scale = computed(() => {
  const values = props.years.flatMap((y) => y.months.filter((v): v is number => v !== null));
  if (!values.length) return undefined;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const step = niceStep(Math.max(hi - lo, 1), 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const grid: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) grid.push(v);
  return { grid, yOf: (v: number) => (1 - (v - lo) / (hi - lo)) * 100 };
});

const lines = computed(() => {
  const s = scale.value;
  if (!s) return [];
  return props.years.map((y, i) => {
    let d = "";
    let pen = false;
    y.months.forEach((v, m) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${((xOf(m) / 100) * W).toFixed(1)},${((s.yOf(v) / 100) * H).toFixed(1)}`;
      pen = true;
    });
    const newest = i === props.years.length - 1;
    return {
      year: y.year,
      d,
      color: yearColor(i, props.years.length, props.light),
      width: newest ? 3.5 : 2,
      dots: y.months
        .map((v, m) => (v === null ? undefined : { left: pct(xOf(m)), top: pct(s.yOf(v)) }))
        .filter((p) => p !== undefined),
    };
  });
});

function pick(clientX: number) {
  if (!el.value) return;
  const rect = el.value.getBoundingClientRect();
  activeMonth.value = Math.max(0, Math.min(11, Math.floor(((clientX - rect.left) / rect.width) * 12)));
}

const tip = computed(() => {
  const m = activeMonth.value;
  if (m === undefined) return undefined;
  const rows = props.years
    .map((y, i) => ({ year: y.year, v: y.months[m], color: yearColor(i, props.years.length, props.light) }))
    .filter((r) => r.v !== null)
    .reverse();
  return { x: xOf(m), alignRight: m >= 8, month: props.monthNames[m], rows };
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
      @mouseleave="activeMonth = undefined"
    >
      <template v-if="scale">
        <div v-for="v in scale.grid" :key="v" class="hline" :style="{ top: pct(scale.yOf(v)) }">
          <span class="ylabel">{{ fixed(v, v % 1 ? 1 : 0) }}</span>
        </div>
      </template>
      <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none">
        <path
          v-for="l in lines"
          :key="l.year"
          :d="l.d"
          fill="none"
          :stroke="l.color"
          :stroke-width="l.width"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <template v-for="l in lines" :key="`dots-${l.year}`">
        <span v-for="(p, i) in l.dots" :key="i" class="dot" :style="{ ...p, background: l.color }" />
      </template>

      <template v-if="tip">
        <div class="cursor" :style="{ left: pct(tip.x) }" />
        <div class="tip" :class="{ right: tip.alignRight }" :style="{ left: pct(tip.x) }">
          <span class="month">{{ tip.month }}</span>
          <span v-for="r in tip.rows" :key="r.year" class="row">
            <i :style="{ background: r.color }" />{{ r.year }}
            <strong>{{ fixed(r.v!, decimals) }}{{ unit }}</strong>
          </span>
        </div>
      </template>
      <div v-if="!years.length" class="empty">No data yet</div>
    </div>
    <div class="xlabels">
      <span v-for="(name, m) in monthNames" :key="m" :style="{ left: pct(xOf(m)) }">{{ name }}</span>
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
.hline {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--line);
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
.dot {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
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
}
.cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--muted);
}
.tip {
  position: absolute;
  top: 0;
  margin-left: 10px;
  padding: 8px 12px;
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
.tip .month {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--muted);
  text-transform: capitalize;
}
.tip .row {
  display: block;
  font-size: 15px;
  line-height: 1.6;
}
.tip i {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
  border-radius: 50%;
}
.tip strong {
  margin-left: 12px;
  font-weight: 500;
}
.empty {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--muted);
}
</style>
