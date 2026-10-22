<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from "vue";
import type { WeatherData } from "../shared/types.ts";
import { ago, clockTime, dateLine } from "./format.ts";
import ModuleCard from "./components/ModuleCard.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { isLight, lightAt, themeSettings } from "./theme.ts";

const REFRESH_MS = 60 * 1000;
// Old Safari leaks a bit over days of uptime; a reload every few hours keeps it fresh.
const RELOAD_MS = 6 * 60 * 60 * 1000;

const data = ref<WeatherData>();
const fetchError = ref<string>();
const now = ref(new Date());

async function load() {
  try {
    const res = await fetch("/api/weather", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data.value = await res.json();
    fetchError.value = undefined;
  } catch (e) {
    fetchError.value = `Can't reach server (${(e as Error).message})`;
  }
}

const outdoor = computed(() => data.value?.modules.find((m) => m.kind === "outdoor"));
const others = computed(() => data.value?.modules.filter((m) => m !== outdoor.value) ?? []);

const status = computed(() => {
  if (fetchError.value) return { text: fetchError.value, warn: true };
  const d = data.value;
  if (!d) return { text: "Loading…", warn: false };
  if (d.error) {
    const last = d.fetchedAt ? `, showing data from ${ago(d.fetchedAt, now.value.getTime())}` : "";
    return { text: `Netatmo: ${d.error}${last}`, warn: true };
  }
  return { text: `Updated ${ago(d.fetchedAt, now.value.getTime())}`, warn: false };
});

const showSettings = ref(false);

// Light theme during the day, dark at night, unless forced in the settings panel.
watchEffect(() => {
  isLight.value = lightAt(now.value, themeSettings);
  document.documentElement.classList.toggle("light", isLight.value);
});

let refreshTimer: number | undefined;
let clockTimer: number | undefined;
let reloadTimer: number | undefined;

onMounted(() => {
  load();
  refreshTimer = setInterval(load, REFRESH_MS);
  clockTimer = setInterval(() => (now.value = new Date()), 10 * 1000);
  reloadTimer = setTimeout(() => location.reload(), RELOAD_MS);
});

onUnmounted(() => {
  clearInterval(refreshTimer);
  clearInterval(clockTimer);
  clearTimeout(reloadTimer);
});
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="station">
        <button class="gear" aria-label="Settings" @click="showSettings = true">⚙&#xFE0E;</button>
        {{ data?.stationName }}
      </div>
      <div class="clock">
        <span class="date">{{ dateLine(now) }}</span>
        <span class="time">{{ clockTime(now) }}</span>
      </div>
    </header>

    <main class="grid" :class="{ single: !outdoor }" v-if="data && data.modules.length">
      <ModuleCard v-if="outdoor" :module="outdoor" hero class="hero-card" />
      <div class="side">
        <ModuleCard v-for="m in others" :key="m.id" :module="m" />
      </div>
    </main>
    <main v-else class="empty">{{ status.text }}</main>

    <footer class="bottom" :class="{ warn: status.warn }">
      {{ status.text }}<template v-if="data?.demo"> · demo data</template>
    </footer>

    <SettingsPanel v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.app {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  height: 100%;
  padding: 18px 20px 10px;
}

.top {
  display: -webkit-flex;
  display: flex;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  -webkit-align-items: baseline;
  align-items: baseline;
  padding: 0 4px 14px;
}
.station {
  font-size: 20px;
  font-weight: 600;
  color: var(--muted);
}
.gear {
  margin: -10px 6px -10px -8px;
  padding: 10px 8px;
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 22px;
  cursor: pointer;
  -webkit-appearance: none;
}
.clock .date {
  font-size: 18px;
  color: var(--muted);
  margin-right: 14px;
  text-transform: capitalize;
}
.clock .time {
  font-size: 34px;
  font-weight: 300;
  font-variant-numeric: tabular-nums;
}

.grid {
  -webkit-flex: 1;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  grid-gap: 16px;
}
.grid.single {
  grid-template-columns: 1fr;
}
.side {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  min-height: 0;
}
.side > * {
  -webkit-flex: 1;
  flex: 1;
  margin-bottom: 16px;
}
.side > *:last-child {
  margin-bottom: 0;
}

.empty {
  -webkit-flex: 1;
  flex: 1;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  color: var(--muted);
  font-size: 20px;
}

.bottom {
  padding-top: 8px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.bottom.warn {
  color: var(--warn);
}

/* Portrait: stack everything */
@media (orientation: portrait) {
  .app {
    height: auto;
    min-height: 100vh;
  }
  .grid {
    grid-template-columns: 1fr;
    -webkit-align-content: start;
    align-content: start;
  }
  .hero-card {
    min-height: 420px;
  }
  .side > * {
    -webkit-flex: none;
    flex: none;
    height: 260px;
  }
}
</style>
