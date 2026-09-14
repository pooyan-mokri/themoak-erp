/**
 * Background save queue for inventory-count totals (انبارگردانی): one queue per audit and round.
 *
 * A scan changes the local total at once. Totals go to the server about 2 s later as absolute values, one call at
 * a time, so a retried call can never double a count. Each value carries its base, the last value the server
 * confirmed; the server refuses to overwrite any other number, even one this user saved in another tab, and answers
 * with a conflict. A total of null is "not counted", which undoing the first scan gives.
 * A call that throws, answers success: false or is cut off by a reload may still have been written, so its products
 * stay pending, even when undone to the saved total, until an answer for them comes. A conflict carrying a total sent
 * in such an earlier call is this device's own write; one carrying only the total just sent is a real conflict.
 * Pending totals are kept in `storage`, so a reload resends them.
 *
 * Framework-agnostic: the UI subscribes and reads.
 */

export type AuditCountSave = { productId: string; count: number | null; base: number | null };

/** The answer of `save`, i.e. the server action saveAuditCounts. */
export type AuditCountSaveResult =
  | {
      success: true;
      saved: Array<{ productId: string; count: number | null }>;
      /** `current` is the count stored on the server, `byName` the person who saved it. */
      conflicts: Array<{ productId: string; current: number | null; byName: string | null }>;
      refused: Array<{ productId: string; reason: string }>;
    }
  | { success: false; error: string };

export type AuditCountConflict = { productId: string; theirs: number | null; byName: string | null; mine: number | null };

/** A total the server refused; `count` is the total that was sent. */
export type AuditCountRefusal = { productId: string; count: number | null; reason: string };

export type QueueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type QueueTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type AuditCountQueueOptions = {
  auditId: string;
  round: 1 | 2 | 3;
  save: (saves: AuditCountSave[]) => Promise<AuditCountSaveResult>;
  /** productId → the count already saved for this round (null: not counted), from the page data. */
  initial: Map<string, number | null>;
  /** localStorage or similar. Without it, nothing survives a reload. */
  storage?: QueueStorage;
  timers?: QueueTimers;
  now?: () => number;
};

type ProductState = {
  /** The last value the server confirmed for this round. */
  saved: number | null;
  /** The value wanted locally. Pending while it differs from saved. */
  total: number | null;
  conflict: { theirs: number | null; byName: string | null } | null;
  /**
   * Totals sent in calls with no answer yet (in flight, cut off by a reload, thrown or answered success: false), so the
   * server may hold any of them. While any is listed the product is unconfirmed, and pending even at total === saved,
   * until an answer for it comes.
   */
  unconfirmed: Array<number | null>;
};

type StoredEntry = { total: number | null; base: number | null; unconfirmed?: Array<number | null> };

const SAVE_DELAY_MS = 2_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const isCountOrNull = (n: unknown): n is number | null => n === null || isCount(n);
const isPending = (s: ProductState) => s.total !== s.saved || s.unconfirmed.length > 0 || s.conflict !== null;
const storageKey = (auditId: string, round: 1 | 2 | 3) => `audit-count-queue:${auditId}:${round}`;

/** How many products a queue of this audit and round left in `storage` without a confirmed save. */
export function storedPendingCount(storage: QueueStorage, auditId: string, round: 1 | 2 | 3): number {
  try {
    const stored: unknown = JSON.parse(storage.getItem(storageKey(auditId, round)) ?? 'null');
    return stored && typeof stored === 'object' ? Object.keys(stored).length : 0;
  } catch {
    return 0;
  }
}

export class AuditCountQueue {
  private readonly save: AuditCountQueueOptions['save'];
  private readonly storage: QueueStorage | undefined;
  private readonly timers: QueueTimers;
  private readonly now: () => number;
  private readonly key: string;
  private readonly items = new Map<string, ProductState>();
  private readonly listeners = new Set<() => void>();
  private readonly refusals = new Map<string, AuditCountRefusal>();
  /** Products in the call in flight. */
  private readonly sending = new Set<string>();
  private undoStack: Array<{ productId: string; total: number | null }> = [];
  private timer: { handle: unknown } | null = null;
  private inflight: Promise<void> | null = null;
  private failures = 0;
  private disposed = false;
  private error: string | null = null;
  private reached = true;
  private savedAt: number | null = null;

  constructor(options: AuditCountQueueOptions) {
    this.save = options.save;
    this.storage = options.storage;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
    };
    this.now = options.now ?? (() => Date.now());
    this.key = storageKey(options.auditId, options.round);
    for (const [productId, saved] of options.initial) {
      this.items.set(productId, { saved, total: saved, conflict: null, unconfirmed: [] });
    }
    this.restore();
    this.persist();
    this.schedule();
  }

  /** The error of the last failed call; null again after a successful one. */
  get lastError(): string | null {
    return this.error;
  }

  /** False after a call that threw (the server never answered); true after any answer. */
  get online(): boolean {
    return this.reached;
  }

  /** now() at the last successful call. */
  get lastSavedAt(): number | null {
    return this.savedAt;
  }

  /** Calls in a row that threw or answered success: false; 0 again after a successful one. */
  consecutiveFailures(): number {
    return this.failures;
  }

  getTotal(productId: string): number | null {
    return this.items.get(productId)?.total ?? null;
  }

  /** Adds a whole number (negative to take away), never below 0. Taking from an uncounted product does nothing. */
  add(productId: string, delta: number): number | null {
    if (!Number.isInteger(delta)) throw new RangeError(`delta must be a whole number, got ${delta}`);
    const state = this.state(productId);
    if (state.total === null && delta <= 0) return null;
    return this.change(productId, state, Math.max(0, (state.total ?? 0) + delta));
  }

  /** null: not counted in this round. */
  setTotal(productId: string, n: number | null): number | null {
    if (!isCountOrNull(n)) throw new RangeError(`total must be a whole number >= 0 or null, got ${n}`);
    return this.change(productId, this.state(productId), n);
  }

  /** Reverts the last add or setTotal that changed a total. Returns its productId, or null when there is none. */
  undoLast(): string | null {
    const last = this.undoStack.pop();
    if (!last) return null;
    const state = this.state(last.productId);
    state.total = last.total;
    this.changed();
    return last.productId;
  }

  /** Products whose total is not known to be saved, conflicts included. */
  pendingCount(): number {
    let n = 0;
    for (const state of this.items.values()) if (isPending(state)) n++;
    return n;
  }

  conflicts(): AuditCountConflict[] {
    const out: AuditCountConflict[] = [];
    for (const [productId, s] of this.items) {
      if (s.conflict) out.push({ productId, theirs: s.conflict.theirs, byName: s.conflict.byName, mine: s.total });
    }
    return out;
  }

  refused(): AuditCountRefusal[] {
    return [...this.refusals.values()];
  }

  /** theirs: take their count. mine: keep my total and resend it over their count. */
  resolveConflict(productId: string, choice: 'theirs' | 'mine', theirCount: number | null): void {
    const state = this.items.get(productId);
    if (!state?.conflict) return;
    state.conflict = null;
    state.saved = theirCount;
    if (choice === 'theirs') {
      state.total = theirCount;
      this.forgetUndo(productId);
    }
    this.changed();
  }

  /**
   * Takes a count from page data loaded again, which may hold a newer number saved by someone else. Only for a product
   * with nothing pending here (unconfirmed and in conflict count as pending) and not in the call in flight; otherwise it
   * does nothing. Returns whether the queue now holds that count.
   */
  adoptSaved(productId: string, count: number | null): boolean {
    const state = this.state(productId);
    if (isPending(state) || this.sending.has(productId)) return false;
    if (state.saved !== count) {
      state.saved = count;
      state.total = count;
      this.forgetUndo(productId);
      this.persist();
      this.notify();
    }
    return true;
  }

  /** Sends what is pending now, after the call in flight if there is one. Never throws; a failure schedules a retry. */
  async flush(): Promise<void> {
    if (this.inflight) await this.inflight;
    this.clearTimer();
    await this.run();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops timers and listeners. A call in flight still reaches the server, but its answer is ignored. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  private state(productId: string): ProductState {
    let state = this.items.get(productId);
    if (!state) {
      state = { saved: null, total: null, conflict: null, unconfirmed: [] };
      this.items.set(productId, state);
    }
    return state;
  }

  private change(productId: string, state: ProductState, total: number | null): number | null {
    if (state.total !== total) {
      this.undoStack.push({ productId, total: state.total });
      state.total = total;
      this.refusals.delete(productId);
      this.changed();
    }
    return total;
  }

  private forgetUndo(productId: string) {
    this.undoStack = this.undoStack.filter((u) => u.productId !== productId);
  }

  private changed() {
    this.persist();
    this.notify();
    this.schedule();
  }

  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  private sendable(): AuditCountSave[] {
    const out: AuditCountSave[] = [];
    for (const [productId, s] of this.items) {
      if (isPending(s) && !s.conflict) out.push({ productId, count: s.total, base: s.saved });
    }
    return out;
  }

  private schedule() {
    if (this.disposed || this.timer || this.inflight || this.sendable().length === 0) return;
    const delay =
      this.failures === 0 ? SAVE_DELAY_MS : RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1];
    this.timer = {
      handle: this.timers.setTimeout(() => {
        this.timer = null;
        void this.run();
      }, delay),
    };
  }

  private clearTimer() {
    if (!this.timer) return;
    this.timers.clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private run(): Promise<void> {
    if (this.inflight) return this.inflight;
    const batch = this.disposed ? [] : this.sendable();
    if (batch.length === 0) return Promise.resolve();
    // Until an answer comes the server may hold what this call sends. Kept in storage, so a reload knows it too.
    const earlier = new Map<string, Array<number | null>>();
    for (const { productId, count } of batch) {
      this.sending.add(productId);
      const state = this.state(productId);
      earlier.set(productId, [...state.unconfirmed]);
      if (!state.unconfirmed.includes(count)) state.unconfirmed.push(count);
    }
    this.persist();
    this.inflight = this.send(batch, earlier).finally(() => {
      this.inflight = null;
      this.sending.clear();
      this.schedule();
    });
    return this.inflight;
  }

  /** `earlier`: per product, the totals sent in earlier calls that got no answer. */
  private async send(batch: AuditCountSave[], earlier: Map<string, Array<number | null>>): Promise<void> {
    let result: AuditCountSaveResult;
    try {
      result = await this.save(batch);
    } catch (e) {
      if (this.disposed) return;
      this.failed(batch, e instanceof Error ? e.message : String(e), false);
      return;
    }
    if (this.disposed) return;
    if (!result.success) {
      this.failed(batch, result.error, true);
      return;
    }
    const sent = new Map(batch.map((b) => [b.productId, b]));
    for (const { productId } of result.saved) {
      const b = sent.get(productId);
      const state = this.items.get(productId);
      if (!b || !state) continue;
      // A total changed during the call stays pending, now against this base.
      state.saved = b.count;
      state.unconfirmed = [];
    }
    for (const c of result.conflicts) {
      const b = sent.get(c.productId);
      const state = this.items.get(c.productId);
      if (!b || !state) continue;
      // The server holds a total sent in an earlier call whose answer was lost (a reload during a call loses it too):
      // this device's own write. That is the base; a different total goes out again over it. The total just sent is no
      // proof: another counter, or this account on another device, may have saved the same number from the same base.
      if (earlier.get(c.productId)?.includes(c.current)) state.saved = c.current;
      else state.conflict = { theirs: c.current, byName: c.byName };
      state.unconfirmed = [];
    }
    for (const r of result.refused) {
      const b = sent.get(r.productId);
      const state = this.items.get(r.productId);
      if (!b || !state) continue;
      state.total = state.saved;
      state.unconfirmed = [];
      this.forgetUndo(r.productId);
      this.refusals.set(r.productId, { productId: r.productId, count: b.count, reason: r.reason });
    }
    this.failures = 0;
    this.error = null;
    this.reached = true;
    this.savedAt = this.now();
    this.persist();
    this.notify();
  }

  private failed(batch: AuditCountSave[], error: string, reached: boolean) {
    // No answer for these products, and the call may have been written: until one comes, any of these may be saved.
    for (const b of batch) {
      const state = this.items.get(b.productId);
      if (state && !state.unconfirmed.includes(b.count)) state.unconfirmed.push(b.count);
    }
    this.persist();
    this.failures++;
    this.error = error;
    this.reached = reached;
    this.notify();
  }

  private persist() {
    if (!this.storage) return;
    const pending: Record<string, StoredEntry> = {};
    let any = false;
    for (const [productId, s] of this.items) {
      if (!isPending(s)) continue;
      pending[productId] = { total: s.total, base: s.saved };
      if (s.unconfirmed.length > 0) pending[productId].unconfirmed = s.unconfirmed;
      any = true;
    }
    try {
      if (any) this.storage.setItem(this.key, JSON.stringify(pending));
      else this.storage.removeItem(this.key);
    } catch {
      // Storage full or blocked: keep working in memory.
    }
  }

  private restore() {
    let stored: unknown;
    try {
      stored = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
    } catch {
      return;
    }
    if (!stored || typeof stored !== 'object') return;
    for (const [productId, entry] of Object.entries(stored as Record<string, Partial<Record<keyof StoredEntry, unknown>>>)) {
      const total = entry?.total;
      const base = entry?.base;
      if (!isCountOrNull(total) || !isCountOrNull(base)) continue;
      // The page already shows this total as saved: its call landed but the answer was lost.
      if (this.items.get(productId)?.saved === total) continue;
      const state = this.state(productId);
      state.saved = base;
      state.total = total;
      state.unconfirmed = Array.isArray(entry.unconfirmed) ? entry.unconfirmed.filter(isCountOrNull) : [];
    }
  }
}
