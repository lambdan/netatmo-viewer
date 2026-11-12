// The page keeps running the JavaScript it loaded until it reloads, so after a deploy the iPad
// would sit on the old version. Vite names the bundle after its content hash, so a different
// name in the server's index.html means a new version is out.

const BUNDLE = /\/assets\/index-[\w-]+\.js/;

function loadedBundle(): string | undefined {
  const scripts = document.getElementsByTagName("script");
  for (let i = 0; i < scripts.length; i++) {
    const m = scripts[i].src.match(BUNDLE);
    if (m) return m[0];
  }
  // The Vite dev server serves the sources directly; nothing to compare there.
  return undefined;
}

export async function newVersionAvailable(): Promise<boolean> {
  const mine = loadedBundle();
  if (!mine) return false;
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return false;
  const latest = (await res.text()).match(BUNDLE);
  return !!latest && latest[0] !== mine;
}

/** Reloads, with a throwaway query so no cache can hand back the old index.html. */
export function reloadFresh() {
  location.replace(`${location.pathname}?v=${Date.now()}${location.hash}`);
}
