/**
 * Undo/redo history of whole-state snapshots.
 *
 * Call record() with the state as it was *before* each change. Changes that share a group and come within
 * `mergeWindowMs` of each other are merged into one undo step, so typing "12.5" into a field undoes in one go.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastGroup: string | null = null;
  private lastTime = 0;

  constructor(private readonly limit = 200, private readonly mergeWindowMs = 1000) {}

  /** Saves `before` as an undo step, unless it continues the previous change in the same group. */
  record(before: T, group?: string, now = Date.now()): void {
    const continues = group !== undefined && group === this.lastGroup && now - this.lastTime <= this.mergeWindowMs;
    this.lastGroup = group ?? null;
    this.lastTime = now;
    if (continues) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Returns the state to go back to, or null if there is nothing to undo. `current` becomes redoable. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    this.breakMerge();
    return previous;
  }

  /** Returns the state to go forward to, or null if there is nothing to redo. `current` becomes undoable. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.breakMerge();
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.breakMerge();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** The next change always starts a new step. */
  private breakMerge(): void {
    this.lastGroup = null;
  }
}
