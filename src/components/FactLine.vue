<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Fact, FactVars } from "../../shared/types.ts";
import { api } from "../api.ts";
import { fmtDate, num, temp, tempDelta } from "../format.ts";
import { factText, ordinal, sincePhrase } from "../i18n.ts";

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

/** Local noon of a day, as unix seconds (noon stays on the right day in any zone). */
const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime() / 1000;

function formatDay(v: string): string {
  const [y, m, d] = v.split("-").map(Number);
  const thisYear = y === new Date().getFullYear();
  return fmtDate(
    noon(y, m, d),
    thisYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" },
  );
}

/** The values of a fact, formatted for display; see FactVars for what each name means. */
function formatVars(vars: FactVars): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k in vars) {
    const v = vars[k];
    if (k === "t" || k === "t2") out[k] = `${temp(Number(v))}°`;
    else if (k === "dt") out[k] = `${tempDelta(Number(v))}°`;
    else if (k === "d") out[k] = formatDay(String(v));
    else if (k === "md") {
      const [m, d] = String(v).split("-").map(Number);
      out[k] = fmtDate(noon(2000, m, d), { day: "numeric", month: "long" });
    } else if (k === "m") out[k] = fmtDate(noon(2000, Number(v), 1), { month: "long" });
    else if (k === "n" || k === "n2") out[k] = num(Number(v));
    else if (k === "o") out[k] = ordinal(Number(v));
    else out[k] = String(v);
  }
  if (out.d !== undefined) out.since = sincePhrase(out.d, vars.rec === 1);
  return out;
}

const current = computed(() => {
  const f = facts.value[index.value];
  if (!f) return undefined;
  const text = factText(f.id, formatVars(f.vars));
  if (!text) return undefined;
  // Month names start sentences now and then, and are lowercase in Swedish.
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
