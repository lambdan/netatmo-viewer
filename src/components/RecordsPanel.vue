<script setup lang="ts">
import type { RecordPeriod, RecordsResponse } from "../../shared/types.ts";
import { fixed, fmtDate } from "../format.ts";
import type { MetricInfo } from "../metrics.ts";

defineProps<{ records?: RecordsResponse; info: MetricInfo }>();

const rows: { key: RecordPeriod; label: string; when: Intl.DateTimeFormatOptions }[] = [
  { key: "today", label: "Today", when: { hour: "2-digit", minute: "2-digit" } },
  { key: "month", label: "This month", when: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } },
  { key: "year", label: "This year", when: { day: "numeric", month: "short" } },
  { key: "all", label: "All time", when: { day: "numeric", month: "short", year: "numeric" } },
];
</script>

<template>
  <div class="records">
    <div class="head">
      <span />
      <span>{{ info.lowWord }}</span>
      <span>{{ info.highWord }}</span>
    </div>
    <div v-for="r in rows" :key="r.key" class="row">
      <span class="label">{{ r.label }}</span>
      <template v-for="side in (['min', 'max'] as const)" :key="side">
        <span class="cell" v-if="records?.periods[r.key][side]">
          <strong>
            {{ fixed(records.periods[r.key][side]![0], info.decimals)
            }}<span :class="{ unit: info.unit.length > 1 }">{{ info.unit }}</span>
          </strong>
          <small>{{ fmtDate(records.periods[r.key][side]![1], r.when) }}</small>
        </span>
        <span class="cell" v-else>–</span>
      </template>
    </div>
    <p class="note" v-if="records?.since">
      <template v-if="!records.complete">
        Still importing older history, currently back to
        {{ fmtDate(records.since, { day: "numeric", month: "short", year: "numeric" }) }}.
      </template>
      <template v-else>
        Since {{ fmtDate(records.since, { day: "numeric", month: "short", year: "numeric" }) }}.
      </template>
    </p>
  </div>
</template>

<style scoped>
.head,
.row {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: baseline;
  align-items: baseline;
}
.head > span,
.row > span {
  -webkit-flex: 1;
  flex: 1;
}
.head > span:first-child,
.row > .label {
  -webkit-flex: 0 0 92px;
  flex: 0 0 92px;
}
.head {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  padding-bottom: 6px;
}
.row {
  padding: 9px 0;
  border-top: 1px solid var(--line);
}
.label {
  font-size: 14px;
  color: var(--muted);
}
.cell strong {
  display: block;
  font-size: 20px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.cell {
  padding-right: 6px;
}
.cell .unit {
  font-size: 12px;
  color: var(--muted);
  margin-left: 1px;
}
.cell small {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
