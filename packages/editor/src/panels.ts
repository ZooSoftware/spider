// Resizable split between code and canvas. Width and collapsed state are per-viewer
// conveniences kept in localStorage (best effort: storage may be unavailable).

const WIDTH_KEY = "spider.codeWidth";
const COLLAPSED_KEY = "spider.codeCollapsed";
const MIN_CODE = 200;
const MIN_CANVAS = 300;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore: private mode / blocked storage
  }
}

export function setupSplit(split: HTMLElement, divider: HTMLElement): void {
  const clamp = (w: number): number => Math.max(MIN_CODE, Math.min(w, split.clientWidth - MIN_CANVAS));
  const setWidth = (w: number): void => split.style.setProperty("--code-w", `${Math.round(clamp(w))}px`);
  const setCollapsed = (c: boolean): void => {
    split.classList.toggle("collapsed", c);
    save(COLLAPSED_KEY, c ? "1" : "0");
  };

  const stored = Number(load(WIDTH_KEY));
  if (stored > 0) setWidth(stored);
  if (load(COLLAPSED_KEY) === "1") split.classList.add("collapsed");

  divider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("active");
    split.classList.add("resizing");
    const left = split.getBoundingClientRect().left;
    const move = (ev: PointerEvent): void => {
      if (split.classList.contains("collapsed")) setCollapsed(false);
      setWidth(ev.clientX - left);
    };
    const up = (): void => {
      divider.removeEventListener("pointermove", move);
      divider.removeEventListener("pointerup", up);
      divider.classList.remove("active");
      split.classList.remove("resizing");
      const w = parseFloat(split.style.getPropertyValue("--code-w"));
      if (w > 0) save(WIDTH_KEY, String(w));
    };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
  divider.addEventListener("dblclick", () => setCollapsed(!split.classList.contains("collapsed")));
}
