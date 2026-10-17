// Undo/redo history of editor snapshots (code text + layout + selection), one entry per user
// action. Pure and DOM-free so it can be unit-tested.

export class History<T> {
  private stack: T[] = [];
  private index = -1;

  constructor(
    private readonly same: (a: T, b: T) => boolean,
    private readonly cap = 200,
  ) {}

  /** Start over with `state` as the only entry (e.g. on load). */
  reset(state: T): void {
    this.stack = [state];
    this.index = 0;
  }

  /** Record `state` as the result of a user action. Drops the redo tail; ignores no-ops. */
  commit(state: T): boolean {
    const cur = this.stack[this.index];
    if (cur !== undefined && this.same(cur, state)) {
      // Same content (e.g. a drag that ended where it started): refresh selection only.
      this.stack[this.index] = state;
      return false;
    }
    this.stack.length = this.index + 1;
    this.stack.push(state);
    if (this.stack.length > this.cap) this.stack.splice(0, this.stack.length - this.cap);
    this.index = this.stack.length - 1;
    return true;
  }

  /** Replace the current entry without adding a step (e.g. once a restored state has settled). */
  replace(state: T): void {
    if (this.index >= 0) this.stack[this.index] = state;
  }

  undo(): T | undefined {
    if (!this.canUndo) return undefined;
    return this.stack[--this.index];
  }

  redo(): T | undefined {
    if (!this.canRedo) return undefined;
    return this.stack[++this.index];
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  get current(): T | undefined {
    return this.stack[this.index];
  }

  get size(): number {
    return this.stack.length;
  }
}
