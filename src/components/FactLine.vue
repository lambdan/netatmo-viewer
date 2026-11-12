<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Fact } from "../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDate, num, temp } from "../format.ts";

const FETCH_MS = 10 * 60 * 1000;
const ROTATE_MS = 20 * 1000;

const facts = ref<Fact[]>([]);
const index = ref(0);
const visible = ref(true);

async function load() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    facts.value = await api.facts(tz);
    if (index.value >= facts.value.length) index.value = 0;
  } catch {
    // Keep showing the old facts; they're just for fun.
  }
}

/** Local noon of a YYYY-MM-DD day, as unix seconds (noon stays on the right day in any zone). */
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime() / 1000;

function render(text: string): string {
  return text.replace(/\{(\w+):([^}]*)\}/g, (_, kind: string, v: string) => {
    if (kind === "t") return `${temp(Number(v))}°`;
    if (kind === "n") return num(Number(v));
    if (kind === "m") return fmtDate(noon(2000, Number(v), 1), { month: "long" });
    if (kind === "md") {
      const [m, d] = v.split("-").map(Number);
      return fmtDate(noon(2000, m, d), { day: "numeric", month: "long" });
    }
    if (kind === "d") {
      const [y, m, d] = v.split("-").map(Number);
      const thisYear = y === new Date().getFullYear();
      return fmtDate(noon(y, m, d), thisYear ? { day: "numeric", month: "long" } : {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    return v;
  });
}

const current = computed(() => {
  const f = facts.value[index.value];
  if (!f) return undefined;
  const text = render(f.text);
  // Tokens like {m:11} can start a sentence; month names are lowercase in some languages.
  return { icon: f.icon, text: text.charAt(0).toUpperCase() + text.slice(1) };
});

let fadeTimer: number | undefined;
function next() {
  if (facts.value.length < 2) return;
  visible.value = false;
  fadeTimer = setTimeout(() => {
    index.value = (index.value + 1) % facts.value.length;
    visible.value = true;
  }, 600);
}

let fetchTimer: number | undefined;
let rotateTimer: number | undefined;
onMounted(() => {
  load();
  fetchTimer = setInterval(load, FETCH_MS);
  rotateTimer = setInterval(next, ROTATE_MS);
});
onUnmounted(() => {
  clearInterval(fetchTimer);
  clearInterval(rotateTimer);
  clearTimeout(fadeTimer);
});
</script>

<template>
  <div v-if="current" class="fact" :class="{ hidden: !visible }" @click.stop="next">
    <span class="icon">{{ current.icon }}</span>{{ current.text }}
  </div>
</template>

<style scoped>
/* Sits inside the outdoor card, between the readings and the chart. */
.fact {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: baseline;
  align-items: baseline;
  margin-top: 28px;
  font-size: 20px;
  line-height: 1.35;
  color: var(--muted);
  cursor: pointer;
  opacity: 1;
  -webkit-transition: opacity 0.6s;
  transition: opacity 0.6s;
}
.fact.hidden {
  opacity: 0;
}
.icon {
  -webkit-flex: none;
  flex: none;
  margin-right: 10px;
}

@media (max-width: 600px) {
  .fact {
    margin-top: 18px;
    font-size: 16px;
  }
}
</style>
