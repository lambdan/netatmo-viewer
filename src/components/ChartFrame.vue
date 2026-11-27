<script setup lang="ts">
// What the history charts have in common: grid and value labels, the freezing line, time labels
// along the bottom, and a cursor with a tooltip that follows a finger (or the mouse).
// The charts draw their lines into the `svg` slot and fill in the tooltip.

import { computed, ref } from "vue";
import { fixed } from "../format.ts";
import { type Scale, VIEW_H, VIEW_W } from "../chart.ts";

const props = defineProps<{
  scale?: Scale;
  /** Where to mark freezing with a line (0 or 32), if wanted. Only drawn within the scale. */
  freezing?: number;
  /** Labels along the bottom; `left` in %. */
  xLabels: { key: string | number; left: number; label: string }[];
  /** Where the cursor and tooltip are (in % from the left), while one is shown. */
  cursor?: number;
  /** Shown instead of the chart when there's nothing to draw. */
  empty?: string;
}>();
const emit = defineEmits<{
  /** Where the finger or mouse is, from 0 (left edge) to 1 (right edge). */
  pick: [at: number];
  leave: [];
}>();

const plot = ref<HTMLElement>();
const pct = (v: number) => `${v}%`;

function pick(clientX: number) {
  if (!plot.value) return;
  const rect = plot.value.getBoundingClientRect();
  emit("pick", (clientX - rect.left) / rect.width);
}

const freezeTop = computed(() => {
  const y = props.freezing !== undefined ? props.scale?.yOf(props.freezing) : undefined;
  return y !== undefined && y >= 0 && y <= 100 ? y : undefined;
});
</script>

<template>
  <div class="chart">
    <div
      class="plot"
      ref="plot"
      @touchstart.prevent="pick($event.touches[0].clientX)"
      @touchmove.prevent="pick($event.touches[0].clientX)"
      @mousemove="pick($event.clientX)"
      @mouseleave="emit('leave')"
    >
      <template v-if="scale">
        <div v-for="v in scale.grid" :key="v" class="hline" :style="{ top: pct(scale.yOf(v)) }">
          <span class="ylabel">{{ fixed(v, v % 1 ? 1 : 0) }}</span>
        </div>
      </template>
      <div v-if="freezeTop !== undefined" class="freeze-line" :style="{ top: pct(freezeTop) }" />
      <slot name="under" />

      <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" preserveAspectRatio="none">
        <slot name="svg" />
      </svg>
      <slot />

      <template v-if="cursor !== undefined">
        <div class="cursor" :style="{ left: pct(cursor) }" />
        <slot name="marker" />
        <div class="tip" :class="{ right: cursor > 70 }" :style="{ left: pct(cursor) }">
          <slot name="tip" />
        </div>
      </template>

      <div v-if="empty" class="empty">{{ empty }}</div>
    </div>
    <div class="xlabels">
      <span v-for="l in xLabels" :key="l.key" :style="{ left: pct(l.left) }">{{ l.label }}</span>
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
.freeze-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 2px solid var(--freeze);
  opacity: 0.7;
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
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
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
  padding: 7px 11px;
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  pointer-events: none;
}
.tip.right {
  transform: translateX(-100%);
  margin-left: -10px;
}
.empty {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--muted);
}

/* Phones: only every other time label, so they don't overlap. */
@media (max-width: 600px) {
  .xlabels span:nth-child(even) {
    display: none;
  }
  .xlabels span,
  .ylabel {
    font-size: 11px;
  }
}
</style>
