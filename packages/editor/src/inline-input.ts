// A text input floating over the canvas (rename a label or an id). Enter or blur commits,
// Escape cancels; its keys and presses never reach the canvas.

export interface InlineInputOptions {
  /** Screen rect of what is being edited; the input is centred on it. */
  rect: { x: number; y: number; w: number; h: number };
  value: string;
  placeholder?: string;
  title?: string;
  mono?: boolean;
  /** Marks the input invalid while typing; an invalid value is not committed. */
  valid?: (value: string) => boolean;
  /** Called with a changed, valid value. */
  onCommit(value: string): void;
}

export function openInlineInput(host: HTMLElement, o: InlineInputOptions): void {
  document.querySelector(".rename")?.remove();
  const input = document.createElement("input");
  input.className = o.mono ? "rename mono" : "rename";
  input.value = o.value;
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.title) input.title = o.title;
  const w = Math.max(o.rect.w, 140);
  Object.assign(input.style, { left: `${o.rect.x + o.rect.w / 2 - w / 2}px`, top: `${o.rect.y + o.rect.h / 2 - 15}px`, width: `${w}px` });
  host.appendChild(input);
  input.focus();
  input.select();
  const valid = o.valid;
  if (valid) input.addEventListener("input", () => input.classList.toggle("invalid", !valid(input.value)));
  let closed = false;
  const close = (commit: boolean): void => {
    if (closed) return;
    closed = true;
    input.remove();
    host.focus();
    const v = input.value;
    if (commit && v !== o.value && (valid?.(v) ?? true)) o.onCommit(v);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") close(true);
    else if (e.key === "Escape") close(false);
  });
  input.addEventListener("blur", () => close(true));
  input.addEventListener("pointerdown", (e) => e.stopPropagation());
}
