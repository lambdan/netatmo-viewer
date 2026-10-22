<script setup lang="ts">
import { computed } from "vue";
import type { Module } from "../../shared/types.ts";
import { co2Level, direction, num, temp, tempColor, time, trendArrow } from "../format.ts";
import Sparkline from "./Sparkline.vue";
import { isLight } from "../theme.ts";

const props = defineProps<{ module: Module; hero?: boolean }>();

const m = computed(() => props.module);
const color = computed(() => tempColor(m.value.temperature, isLight.value));
const lowBattery = computed(() => m.value.battery !== undefined && m.value.battery < 20);
const hasTemp = computed(() => m.value.temperature !== undefined);
</script>

<template>
  <section class="card" :class="{ hero, offline: !m.reachable }">
    <header>
      <h2>{{ m.name }}</h2>
      <span v-if="!m.reachable" class="badge warn">offline</span>
      <span v-else-if="lowBattery" class="badge warn">battery {{ m.battery }}%</span>
    </header>

    <template v-if="hasTemp">
      <div class="main">
        <div class="temp" :style="{ color }">
          {{ temp(m.temperature) }}<span class="unit">°</span>
          <span class="trend">{{ trendArrow(m.tempTrend) }}</span>
        </div>
        <div class="minmax" v-if="m.minTemp !== undefined">
          <div>
            <span class="label">max</span> {{ temp(m.maxTemp) }}°
            <span class="at">{{ time(m.maxTempAt) }}</span>
          </div>
          <div>
            <span class="label">min</span> {{ temp(m.minTemp) }}°
            <span class="at">{{ time(m.minTempAt) }}</span>
          </div>
        </div>
      </div>

      <div class="stats">
        <div v-if="m.humidity !== undefined" class="stat">
          <span class="value">{{ num(m.humidity) }}<small>%</small></span>
          <span class="label">humidity</span>
        </div>
        <div v-if="m.co2 !== undefined" class="stat">
          <span class="value">
            <i class="level" :class="co2Level(m.co2)" />{{ num(m.co2) }}<small>ppm</small>
          </span>
          <span class="label">CO₂</span>
        </div>
        <div v-if="m.pressure !== undefined" class="stat">
          <span class="value">{{ num(m.pressure) }}<small>mbar {{ trendArrow(m.pressureTrend) }}</small></span>
          <span class="label">pressure</span>
        </div>
        <div v-if="m.noise !== undefined" class="stat">
          <span class="value">{{ num(m.noise) }}<small>dB</small></span>
          <span class="label">noise</span>
        </div>
      </div>
    </template>

    <div v-else-if="m.kind === 'rain'" class="main">
      <div class="temp rain">{{ temp(m.rain1h) }}<span class="unit"> mm/h</span></div>
      <div class="minmax">
        <div><span class="label">24 h</span> {{ temp(m.rain24h) }} mm</div>
      </div>
    </div>

    <div v-else-if="m.kind === 'wind'" class="main">
      <div class="temp wind">{{ num(m.wind) }}<span class="unit"> km/h {{ direction(m.windAngle) }}</span></div>
      <div class="minmax">
        <div><span class="label">gust</span> {{ num(m.gust) }} km/h {{ direction(m.gustAngle) }}</div>
      </div>
    </div>

    <div class="chart" v-if="m.history && m.history.length > 1">
      <Sparkline :points="m.history" :color="color" :axis="hero" />
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
.card.offline {
  opacity: 0.55;
}
header {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.badge {
  margin-left: 10px;
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
</style>
