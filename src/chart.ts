// Shared by the history charts (HistoryChart, TrendsChart and ChartFrame).

/** The SVG drawing area; it's stretched to the chart's size, so only the proportions matter. */
export const VIEW_W = 1000;
export const VIEW_H = 400;

export interface Scale {
  /** Values to draw grid lines and labels at. */
  grid: number[];
  /** Where a value goes, in % from the top. */
  yOf(v: number): number;
}

/** Nice round step for about `count` grid lines across `span`. */
export function niceStep(span: number, count = 5): number {
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

/** A scale covering lo..hi with round grid lines, at least `minSpan` tall. */
export function niceScale(lo: number, hi: number, minSpan: number): Scale {
  const step = niceStep(Math.max(hi - lo, minSpan), 5);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;
  const grid: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) grid.push(v);
  return { grid, yOf: (v) => (1 - (v - lo) / (hi - lo)) * 100 };
}

/** An SVG path through points given in % of the chart (x from the left, y from the top). */
export function svgPath(points: [number, number][], start = "M"): string {
  return points
    .map(([x, y], i) =>
      `${i ? "L" : start}${((x / 100) * VIEW_W).toFixed(1)},${((y / 100) * VIEW_H).toFixed(1)}`
    )
    .join("");
}
