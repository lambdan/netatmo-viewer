<script setup lang="ts">
import type { StationEvent } from "../../shared/types.ts";
import { fixed, fmtDate } from "../format.ts";
import type { MetricInfo } from "../metrics.ts";
import { t } from "../i18n.ts";
import { isLight } from "../theme.ts";
import { type YearTrend, yearColor } from "../trends.ts";

const props = defineProps<{ years: YearTrend[]; info: MetricInfo; events: StationEvent[] }>();

/** The delta as shown, so "+0.0" isn't coloured as a rise. */
function rounded(v: number) {
  const f = Math.pow(10, props.info.decimals);
  return Math.round(v * f) / f;
}

function signed(v: number) {
  const r = rounded(v);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${fixed(Math.abs(r), props.info.decimals)}`;
}

function eventsIn(year: number) {
  return props.events.filter((e) => new Date(e.at * 1000).getFullYear() === year);
}
</script>

<template>
  <div v-for="(y, i) in years.slice().reverse()" :key="y.year" class="year">
    <i :style="{ background: yearColor(years.length - 1 - i, years.length, isLight) }" />
    <span class="name">
      {{ y.year }}<small v-if="y.partial">{{ y.partial }}</small>
      <span v-for="e in eventsIn(y.year)" :key="e.id" class="event">
        {{ e.label }} · {{ fmtDate(e.at, { day: "numeric", month: "short" }) }}
      </span>
    </span>
    <strong>{{ y.avg === undefined ? "–" : fixed(y.avg, info.decimals) + info.unit }}</strong>
    <span class="delta" :class="{ up: rounded(y.delta ?? 0) > 0, down: rounded(y.delta ?? 0) < 0 }">
      {{ y.delta === undefined ? "" : signed(y.delta) }}
    </span>
  </div>
  <p class="note">{{ t("yearlyNote") }}</p>
</template>

<style scoped>
.year {
  display: flex;
  align-items: baseline;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}
i {
  flex: none;
  width: 10px;
  height: 10px;
  margin-right: 10px;
  border-radius: 50%;
}
.name {
  flex: 1;
  font-size: 17px;
}
small {
  margin-left: 6px;
  font-size: 12px;
  color: var(--muted);
}
.event {
  display: block;
  font-size: 12px;
  color: var(--warn);
}
strong {
  font-size: 19px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.delta {
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
}
</style>
