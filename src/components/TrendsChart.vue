<script setup lang="ts">
import { computed, ref } from "vue";
import { fixed } from "../format.ts";
import { t } from "../i18n.ts";
import { type YearTrend, yearColor } from "../trends.ts";
import { niceScale, svgPath } from "../chart.ts";
import ChartFrame from "./ChartFrame.vue";

const props = defineProps<{
  years: YearTrend[];
  monthNames: string[];
  decimals: number;
  unit: string;
  light: boolean;
  /** Where to mark freezing with a line (0 or 32), if wanted. */
  freezing?: number;
}>();

const activeMonth = ref<number>();

const pct = (v: number) => `${v}%`;
const xOf = (m: number) => ((m + 0.5) / 12) * 100;
const colorOf = (i: number) => yearColor(i, props.years.length, props.light);

const scale = computed(() => {
  const values = props.years.flatMap((y) => y.months.filter((v): v is number => v !== null));
  return values.length ? niceScale(Math.min(...values), Math.max(...values), 1) : undefined;
});

const lines = computed(() => {
  const s = scale.value;
  if (!s) return [];
  return props.years.map((y, i) => {
    // A new piece of line after each month without data.
    let d = "";
    let run: [number, number][] = [];
    y.months.forEach((v, m) => {
      if (v !== null) run.push([xOf(m), s.yOf(v)]);
      if ((v === null || m === 11) && run.length) {
        d += svgPath(run);
        run = [];
      }
    });
    return {
      year: y.year,
      d,
      color: colorOf(i),
      // The newest year stands out.
      width: i === props.years.length - 1 ? 3.5 : 2,
      dots: y.months
        .map((v, m) => (v === null ? undefined : { left: pct(xOf(m)), top: pct(s.yOf(v)) }))
        .filter((p) => p !== undefined),
    };
  });
});

const xLabels = computed(() =>
  props.monthNames.map((label, m) => ({ key: m, left: xOf(m), label }))
);

function pick(at: number) {
  activeMonth.value = Math.max(0, Math.min(11, Math.floor(at * 12)));
}

const tip = computed(() => {
  const m = activeMonth.value;
  if (m === undefined) return undefined;
  const rows = props.years
    .map((y, i) => ({ year: y.year, v: y.months[m], color: colorOf(i) }))
    .filter((r) => r.v !== null)
    .reverse();
  return { x: xOf(m), month: props.monthNames[m], rows };
});
</script>

<template>
  <ChartFrame
    :scale="scale"
    :freezing="freezing"
    :x-labels="xLabels"
    :cursor="tip?.x"
    :empty="years.length ? undefined : t('noDataYet')"
    @pick="pick"
    @leave="activeMonth = undefined"
  >
    <template #svg>
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
    </template>

    <template v-for="l in lines" :key="`dots-${l.year}`">
      <span v-for="(p, i) in l.dots" :key="i" class="dot" :style="{ ...p, background: l.color }" />
    </template>

    <template v-if="tip" #tip>
      <span class="month">{{ tip.month }}</span>
      <span v-for="r in tip.rows" :key="r.year" class="row">
        <i :style="{ background: r.color }" />{{ r.year }}
        <strong>{{ fixed(r.v!, decimals) }}{{ unit }}</strong>
      </span>
    </template>
  </ChartFrame>
</template>

<style scoped>
.dot {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
}
.month {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--muted);
  text-transform: capitalize;
}
.row {
  display: block;
  font-size: 15px;
  line-height: 1.6;
}
i {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 7px;
  border-radius: 50%;
}
strong {
  margin-left: 12px;
  font-weight: 500;
}
</style>
