<script setup lang="ts">
import { computed } from "vue";
import type { Module } from "../../shared/types.ts";
import {
  co2Level,
  direction,
  fixed,
  fmtDate,
  num,
  temp,
  tempColor,
  time,
  trendArrow,
} from "../format.ts";
import Sparkline from "./Sparkline.vue";
import { isLight } from "../theme.ts";
import { freezingLine, toUnit } from "../units.ts";
import { t } from "../i18n.ts";

const props = defineProps<{ module: Module; hero?: boolean }>();

const m = computed(() => props.module);
const color = computed(() => tempColor(m.value.temperature, isLight.value));
const history = computed(() => m.value.history?.map(([t, v]) => [t, toUnit(v)] as [number, number]));
const lowBattery = computed(() => m.value.battery !== undefined && m.value.battery < 20);
const hasTemp = computed(() => m.value.temperature !== undefined);
/** Humidity, CO₂, pressure and noise, whichever the module has. */
const stats = computed(() => {
  const v = m.value;
  const out: { key: string; value: string; unit: string; label: string; level?: string }[] = [];
  if (v.humidity !== undefined) {
    out.push({ key: "humidity", value: num(v.humidity), unit: "%", label: t("humidity") });
  }
  if (v.co2 !== undefined) {
    out.push({ key: "co2", value: num(v.co2), unit: "ppm", label: t("co2"), level: co2Level(v.co2) });
  }
  if (v.pressure !== undefined) {
    const unit = `mbar ${trendArrow(v.pressureTrend)}`;
    out.push({ key: "pressure", value: num(v.pressure), unit, label: t("pressure") });
  }
  if (v.noise !== undefined) {
    out.push({ key: "noise", value: num(v.noise), unit: "dB", label: t("noise") });
  }
  return out;
});
/** "no data since 14:20" (or with the date, if it wasn't today). */
const staleSince = computed(() => {
  const at = m.value.measuredAt;
  if (!at) return t("noData");
  const today = new Date().toDateString() === new Date(at * 1000).toDateString();
  return t("noDataSince", {
    when: today ? time(at) : fmtDate(at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  });
});
</script>

<template>
  <section class="card" :class="{ hero, offline: !m.reachable }">
    <header>
      <h2>{{ m.name }}</h2>
      <span v-if="!m.reachable" class="badge warn">{{ staleSince }}</span>
      <span v-else-if="lowBattery" class="badge warn">{{ t("battery", { n: m.battery! }) }}</span>
      <!-- Small cards: the other readings on the name's line, to leave room for the chart. -->
      <div class="inline-stats" v-if="!hero && hasTemp && stats.length">
        <span v-for="st in stats" :key="st.key" :title="st.label">
          <i v-if="st.level" class="level" :class="st.level" />{{ st.value }}<small>{{ st.unit }}</small>
        </span>
      </div>
    </header>

    <template v-if="hasTemp">
      <div class="main">
        <div class="temp" :style="{ color }">
          {{ temp(m.temperature) }}<span class="unit">°</span>
          <span class="trend">{{ trendArrow(m.tempTrend) }}</span>
        </div>
        <div class="minmax" v-if="m.minTemp !== undefined">
          <div>
            <span class="label">{{ t("max") }}</span> {{ temp(m.maxTemp) }}°
            <span class="at">{{ time(m.maxTempAt) }}</span>
          </div>
          <div>
            <span class="label">{{ t("min") }}</span> {{ temp(m.minTemp) }}°
            <span class="at">{{ time(m.minTempAt) }}</span>
          </div>
        </div>
      </div>

      <div class="stats" v-if="hero">
        <div v-for="st in stats" :key="st.key" class="stat">
          <span class="value">
            <i v-if="st.level" class="level" :class="st.level" />{{ st.value }}<small>{{ st.unit }}</small>
          </span>
          <span class="label">{{ st.label }}</span>
        </div>
      </div>
    </template>

    <div v-else-if="m.kind === 'rain'" class="main">
      <div class="temp rain">{{ fixed(m.rain1h, 1) }}<span class="unit"> mm/h</span></div>
      <div class="minmax">
        <div><span class="label">24 h</span> {{ fixed(m.rain24h, 1) }} mm</div>
      </div>
    </div>

    <div v-else-if="m.kind === 'wind'" class="main">
      <div class="temp wind">{{ num(m.wind) }}<span class="unit"> km/h {{ direction(m.windAngle) }}</span></div>
      <div class="minmax">
        <div><span class="label">{{ t("gust") }}</span> {{ num(m.gust) }} km/h {{ direction(m.gustAngle) }}</div>
      </div>
    </div>

    <slot />

    <div class="chart" v-if="history && history.length > 1">
      <Sparkline
        :points="history"
        :color="color"
        :axis="hero"
        :freezing="freezingLine()"
      />
    </div>
  </section>
</template>

<style scoped>
.card {
  position: relative;
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  padding: 18px 22px;
  border-radius: 18px;
  background: var(--card);
  box-shadow: var(--card-shadow);
  overflow: hidden;
  -webkit-transition: background-color 1.5s, box-shadow 1.5s;
  transition: background-color 1.5s, box-shadow 1.5s;
}
/* Last known values stay readable, just muted, next to the "no data since" badge. */
.card.offline .main,
.card.offline .stats,
.card.offline .chart {
  opacity: 0.6;
}
header {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
}
h2 {
  margin: 0;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.badge {
  margin-left: 10px;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.badge.warn {
  background: var(--warn-bg);
  color: var(--warn);
}

.main {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: flex-end;
  align-items: flex-end;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  margin-top: 2px;
}
.temp {
  font-size: 64px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hero .temp {
  font-size: 128px;
  font-weight: 200;
}
.unit {
  font-size: 0.5em;
  vertical-align: top;
  margin-left: 2px;
}
.rain .unit,
.wind .unit {
  font-size: 0.3em;
  vertical-align: baseline;
  color: var(--muted);
}
.rain,
.wind {
  color: var(--text);
}
.trend {
  font-size: 0.32em;
  vertical-align: middle;
  color: var(--muted);
  margin-left: 4px;
}
.minmax {
  text-align: right;
  font-size: 17px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  padding-bottom: 6px;
}
.hero .minmax {
  font-size: 22px;
  padding-bottom: 16px;
}
.label {
  color: var(--muted);
  font-size: 0.8em;
}
.at {
  display: inline-block;
  min-width: 3em;
  color: var(--muted);
  font-size: 0.8em;
}

.stats {
  display: -webkit-flex;
  display: flex;
  margin-top: 14px;
}
/* Small cards: on the name's line, without labels (the units say what they are). */
.inline-stats {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-wrap: wrap;
  flex-wrap: wrap;
  -webkit-justify-content: flex-end;
  justify-content: flex-end;
  margin-left: auto;
  padding-left: 10px;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.inline-stats span {
  margin-left: 13px;
}
.inline-stats small {
  font-size: 0.7em;
  color: var(--muted);
  margin-left: 2px;
}
.inline-stats .level {
  margin-right: 5px;
}
.stat {
  margin-right: 24px;
  white-space: nowrap;
}
.hero .stat {
  margin-right: 44px;
}
.stat .value {
  display: block;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.hero .stat .value {
  font-size: 30px;
}
.stat small {
  font-size: 0.55em;
  color: var(--muted);
  margin-left: 3px;
}
.stat .label {
  font-size: 13px;
}
.level {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 7px;
  border-radius: 50%;
  vertical-align: middle;
  position: relative;
  top: -2px;
}
.level.good {
  background: #4cd97b;
}
.level.fair {
  background: #f5c542;
}
.level.poor {
  background: #ff5d5d;
}

.chart {
  position: relative;
  -webkit-flex: 1;
  flex: 1;
  min-height: 40px;
  margin: 14px -22px -18px;
}
.hero .chart {
  margin: 24px 0 24px;
}

/* Phones */
@media (max-width: 600px) {
  .card {
    padding: 14px 16px;
  }
  .temp {
    font-size: 52px;
  }
  .hero .temp {
    font-size: 84px;
  }
  .minmax,
  .hero .minmax {
    font-size: 15px;
    padding-bottom: 4px;
  }
  .hero .minmax {
    padding-bottom: 10px;
  }
  .stats {
    -webkit-flex-wrap: wrap;
    flex-wrap: wrap;
  }
  .stat,
  .hero .stat {
    margin: 0 18px 6px 0;
  }
  .stat .value,
  .hero .stat .value {
    font-size: 20px;
  }
  .chart {
    margin: 10px -16px -14px;
  }
  .hero .chart {
    margin: 16px 0 24px;
  }
}
</style>
