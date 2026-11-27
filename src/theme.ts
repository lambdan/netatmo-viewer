// Light theme during the day, dark at night, unless forced in the settings panel.

import { ref } from "vue";
import { DEFAULTS, type Settings, settings } from "./settings.ts";

/** True while the light theme is active. */
export const isLight = ref(false);

function minutes(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export function lightAt(now: Date, s: Settings): boolean {
  if (s.mode !== "auto") return s.mode === "light";
  const day = minutes(s.dayStart) ?? minutes(DEFAULTS.dayStart)!;
  const night = minutes(s.nightStart) ?? minutes(DEFAULTS.nightStart)!;
  const mins = now.getHours() * 60 + now.getMinutes();
  return day <= night
    ? mins >= day && mins < night
    // e.g. a day that runs past midnight
    : mins >= day || mins < night;
}

/** Switches the page to the theme for `now` (style.css has the colours under `.light`). */
export function applyTheme(now: Date) {
  isLight.value = lightAt(now, settings);
  document.documentElement.classList.toggle("light", isLight.value);
}
