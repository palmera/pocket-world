// Generic undo/redo stack. Snapshots are stored as deep clones so later
// mutations to the live value don't corrupt history.
//
// Usage: call push(current) BEFORE applying a change. undo/redo take the current
// value and return the value to restore (or null when there's nothing to do).
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private clone: (t: T) => T,
    private limit = 100,
  ) {}

  push(current: T): void {
    this.past.push(this.clone(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.clone(current));
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.clone(current));
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
