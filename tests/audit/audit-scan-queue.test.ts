import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuditCountQueue,
  type AuditCountQueueOptions,
  type AuditCountSave,
  type AuditCountSaveResult,
  type QueueStorage,
  storedPendingCount,
} from '@/lib/audit-scan-queue';

const KEY = 'audit-count-queue:a1:1';

/** Timers that move only when the test says so. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    now: () => now,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        timers.set(++seq, { at: now + ms, fn });
        return seq;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
    },
    settle,
    /** Moves time forward, firing due timers in order and letting the promises they start settle. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await settle();
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}
type FakeClock = ReturnType<typeof fakeClock>;

function memoryStorage(): QueueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const NAMES: Record<string, string> = { me: 'Owner', sara: 'Sara' };

/**
 * saveAuditCounts for one round, in memory: absolute writes (null: not counted), written only if the stored number is
 * still the base (null: not counted), whoever saved it; otherwise a conflict. `saveAs` saves as another user.
 * Push to `failures` to fail the next calls: 'throw' before writing, 'lost' after writing, 'error' as an answer.
 */
function fakeServer(itemIds: string[], user = 'me') {
  const rows = new Map(itemIds.map((id) => [id, { count: null as number | null, by: null as string | null }]));
  const calls: AuditCountSave[][] = [];
  const failures: Array<'throw' | 'lost' | 'error'> = [];
  const write = (saves: AuditCountSave[], as: string) => {
    const answer: Extract<AuditCountSaveResult, { success: true }> = { success: true, saved: [], conflicts: [], refused: [] };
    for (const { productId, count, base } of saves) {
      const row = rows.get(productId);
      if (!row) answer.refused.push({ productId, reason: 'not-an-item' });
      else if (count !== null && (!Number.isInteger(count) || count < 0 || count > 100_000)) {
        answer.refused.push({ productId, reason: 'invalid' });
      } else if (row.count === (base ?? null)) {
        rows.set(productId, { count, by: count === null ? null : as });
        answer.saved.push({ productId, count });
      } else answer.conflicts.push({ productId, current: row.count, byName: row.by ? (NAMES[row.by] ?? null) : null });
    }
    return answer;
  };
  const saveAs = (as: string) => async (saves: AuditCountSave[]): Promise<AuditCountSaveResult> => {
    calls.push(saves.map((s) => ({ ...s })));
    const failure = failures.shift();
    if (failure === 'throw') throw new TypeError('Failed to fetch');
    if (failure === 'error') return { success: false, error: 'خطا در ثبت شمارش.' };
    const answer = write(saves, as);
    if (failure === 'lost') throw new TypeError('Failed to fetch');
    return answer;
  };
  return { rows, calls, failures, save: saveAs(user), saveAs };
}

/** A save whose calls stay open until the test answers them. */
function heldSave() {
  const calls: Array<{ saves: AuditCountSave[]; answer: (result: AuditCountSaveResult) => void }> = [];
  const save = (saves: AuditCountSave[]) =>
    new Promise<AuditCountSaveResult>((resolve) => {
      calls.push({ saves, answer: resolve });
    });
  return { calls, save };
}
const allSaved = (saves: AuditCountSave[]): AuditCountSaveResult => ({
  success: true,
  saved: saves.map(({ productId, count }) => ({ productId, count })),
  conflicts: [],
  refused: [],
});

function makeQueue(
  save: AuditCountQueueOptions['save'],
  opts: { initial?: Array<[string, number | null]>; storage?: QueueStorage; clock?: FakeClock; round?: 1 | 2 | 3 } = {},
) {
  const clock = opts.clock ?? fakeClock();
  const queue = new AuditCountQueue({
    auditId: 'a1',
    round: opts.round ?? 1,
    save,
    initial: new Map(opts.initial ?? []),
    storage: opts.storage,
    timers: clock.timers,
    now: clock.now,
  });
  return { queue, clock };
}

test('many scans within 2 s go out as one save of absolute totals with their bases', async () => {
  const server = fakeServer(['p1', 'p2']);
  server.rows.set('p2', { count: 4, by: 'me' });
  const storage = memoryStorage();
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', 4]], storage });
  for (let i = 0; i < 4; i++) {
    queue.add('p1', 1);
    await clock.advance(400);
  }
  queue.add('p1', 1);
  queue.add('p2', 1);
  queue.add('p2', 1);
  assert.deepEqual([queue.getTotal('p1'), queue.getTotal('p2'), queue.pendingCount()], [5, 6, 2]);
  await clock.advance(399);
  assert.equal(server.calls.length, 0);
  await clock.advance(1);
  assert.deepEqual(server.calls, [
    [
      { productId: 'p1', count: 5, base: null },
      { productId: 'p2', count: 6, base: 4 },
    ],
  ]);
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count], [5, 6]);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(queue.lastSavedAt, 2_000);
  assert.equal(storage.data.has(KEY), false);
  await clock.advance(60_000);
  assert.equal(server.calls.length, 1);
});

test('one call at a time: changes made during a call go in the next one, against the confirmed base', async () => {
  const held = heldSave();
  const { queue, clock } = makeQueue(held.save, { initial: [['p1', null]] });
  queue.add('p1', 1);
  await clock.advance(2_000);
  assert.equal(held.calls.length, 1);
  queue.add('p1', 1);
  queue.add('p1', 1);
  const flushed = queue.flush();
  await clock.advance(30_000);
  assert.equal(held.calls.length, 1, 'no second call while the first is unanswered');

  held.calls[0].answer(allSaved(held.calls[0].saves));
  await clock.settle();
  assert.equal(held.calls.length, 2, 'flush sends the rest as soon as the first call is answered');
  assert.deepEqual(held.calls[1].saves, [{ productId: 'p1', count: 3, base: 1 }]);
  assert.equal(queue.pendingCount(), 1);
  held.calls[1].answer(allSaved(held.calls[1].saves));
  await flushed;
  assert.equal(queue.pendingCount(), 0);
  await clock.advance(30_000);
  assert.equal(held.calls.length, 2);
});

test('a failed save loses nothing and retries after 1 s, 2 s, 5 s, then every 10 s', async () => {
  const clock = fakeClock();
  const server = fakeServer(['p1', 'p2']);
  const times: number[] = [];
  const save = (saves: AuditCountSave[]) => {
    times.push(clock.now());
    return server.save(saves);
  };
  server.failures.push('throw', 'error', 'throw', 'throw', 'throw');
  const storage = memoryStorage();
  const { queue } = makeQueue(save, { initial: [['p1', null], ['p2', null]], storage, clock });

  queue.add('p1', 1);
  await clock.advance(2_000);
  assert.equal(queue.online, false);
  assert.equal(queue.lastError, 'Failed to fetch');
  queue.add('p2', 2); // scanning goes on during the outage
  // p1 went out in the call that threw, so the server may already hold it.
  assert.deepEqual(JSON.parse(storage.data.get(KEY)!), {
    p1: { total: 1, base: null, unconfirmed: [1] },
    p2: { total: 2, base: null },
  });

  await clock.advance(1_000);
  assert.equal(queue.online, true, 'the server answered');
  assert.equal(queue.lastError, 'خطا در ثبت شمارش.');
  assert.equal(queue.pendingCount(), 2);

  await clock.advance(27_000);
  assert.deepEqual(times, [2_000, 3_000, 5_000, 10_000, 20_000, 30_000]);
  assert.deepEqual(server.calls[5], [
    { productId: 'p1', count: 1, base: null },
    { productId: 'p2', count: 2, base: null },
  ]);
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count], [1, 2]);
  assert.deepEqual([queue.pendingCount(), queue.online, queue.lastError], [0, true, null]);
  assert.equal(storage.data.has(KEY), false);

  queue.add('p1', 1); // after a success the normal 2 s delay applies again
  await clock.advance(1_999);
  assert.equal(times.length, 6);
  await clock.advance(1);
  assert.equal(times.length, 7);
});

test('the same total sent twice changes nothing', async () => {
  // Locally: a total equal to the saved one is not sent.
  const idle = fakeServer(['p1']);
  idle.rows.set('p1', { count: 3, by: 'me' });
  const local = makeQueue(idle.save, { initial: [['p1', 3]] });
  local.queue.setTotal('p1', 3);
  local.queue.add('p1', 1);
  local.queue.add('p1', -1);
  assert.equal(local.queue.pendingCount(), 0);
  await local.clock.advance(10_000);
  assert.equal(idle.calls.length, 0);

  // On the server: the answer is lost after the write, and the retry sends the same absolute total.
  const server = fakeServer(['p1']);
  server.failures.push('lost');
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null]] });
  queue.add('p1', 1);
  queue.add('p1', 1);
  queue.add('p1', 1);
  await clock.advance(2_000);
  assert.equal(server.rows.get('p1')?.count, 3);
  assert.equal(queue.pendingCount(), 1);
  await clock.advance(1_000);
  assert.deepEqual(server.calls, [[{ productId: 'p1', count: 3, base: null }], [{ productId: 'p1', count: 3, base: null }]]);
  assert.equal(server.rows.get('p1')?.count, 3);
  assert.equal(queue.pendingCount(), 0);
});

test('a conflict holds the product back; theirs takes their count, mine resends over it', async () => {
  const server = fakeServer(['p1', 'p2', 'p3']);
  server.rows.set('p1', { count: 2, by: 'sara' });
  server.rows.set('p2', { count: 4, by: 'sara' });
  // This page loaded before Sara saved.
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', null], ['p3', null]] });
  queue.add('p1', 1);
  queue.setTotal('p2', 3);
  queue.add('p3', 1);
  await clock.advance(2_000);
  assert.deepEqual(queue.conflicts(), [
    { productId: 'p1', theirs: 2, byName: 'Sara', mine: 1 },
    { productId: 'p2', theirs: 4, byName: 'Sara', mine: 3 },
  ]);
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count, server.rows.get('p3')?.count], [2, 4, 1]);
  assert.equal(queue.pendingCount(), 2);
  queue.add('p1', 1); // scanning on does not resend a product in conflict
  await clock.advance(30_000);
  assert.equal(server.calls.length, 1);

  queue.resolveConflict('p1', 'theirs', 2);
  assert.equal(queue.getTotal('p1'), 2);
  assert.equal(queue.pendingCount(), 1);
  await clock.advance(30_000);
  assert.equal(server.calls.length, 1, 'taking theirs sends nothing');

  queue.resolveConflict('p2', 'mine', 4);
  assert.deepEqual(queue.conflicts(), []);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[1], [{ productId: 'p2', count: 3, base: 4 }]);
  assert.deepEqual(server.rows.get('p2'), { count: 3, by: 'me' });
  assert.equal(queue.pendingCount(), 0);
});

test('undoLast reverts the last add or setTotal', async () => {
  const server = fakeServer(['p1', 'p2']);
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', null]] });
  queue.add('p1', 1);
  queue.add('p1', 1);
  queue.add('p2', 1);
  queue.setTotal('p1', 10);
  assert.equal(queue.undoLast(), 'p1');
  assert.equal(queue.getTotal('p1'), 2);
  assert.equal(queue.undoLast(), 'p2');
  assert.equal(queue.getTotal('p2'), null);
  assert.equal(queue.pendingCount(), 1);
  await clock.advance(2_000);
  assert.deepEqual(server.calls, [[{ productId: 'p1', count: 2, base: null }]]);

  assert.equal(queue.undoLast(), 'p1');
  assert.equal(queue.getTotal('p1'), 1);
  // Undoing the first scan gives "not counted" again, not a count of 0, also once the server holds a number.
  assert.equal(queue.undoLast(), 'p1');
  assert.equal(queue.getTotal('p1'), null);
  assert.equal(queue.pendingCount(), 1);
  assert.equal(queue.undoLast(), null);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[1], [{ productId: 'p1', count: null, base: 2 }]);
  assert.deepEqual(server.rows.get('p1'), { count: null, by: null });
  assert.equal(queue.pendingCount(), 0);
});

test('pending totals survive a reload and are resent with their bases', async () => {
  const clock = fakeClock();
  const storage = memoryStorage();
  const server = fakeServer(['p1', 'p2', 'p3']);
  server.rows.set('p2', { count: 5, by: 'me' });
  const before = makeQueue(server.save, { initial: [['p1', null], ['p2', 5], ['p3', null]], storage, clock }).queue;
  server.failures.push('lost', 'throw');
  before.add('p3', 1);
  await clock.advance(2_000); // p3 is written, but the answer is lost
  before.add('p1', 1);
  before.add('p1', 1);
  before.add('p2', 1);
  await clock.advance(1_000); // the retry fails before writing
  assert.deepEqual(JSON.parse(storage.data.get(KEY)!), {
    p1: { total: 2, base: null, unconfirmed: [2] },
    p2: { total: 6, base: 5, unconfirmed: [6] },
    p3: { total: 1, base: null, unconfirmed: [1] },
  });
  before.dispose(); // the page reloads

  const initial = [...server.rows].map(([id, row]): [string, number | null] => [id, row.count]);
  const after = makeQueue(server.save, { initial, storage, clock }).queue;
  assert.deepEqual([after.getTotal('p1'), after.getTotal('p2'), after.getTotal('p3')], [2, 6, 1]);
  assert.equal(after.pendingCount(), 2, 'the page already shows p3 saved');
  assert.deepEqual(Object.keys(JSON.parse(storage.data.get(KEY)!)), ['p1', 'p2']);
  await clock.advance(2_000);
  assert.equal(server.calls.length, 3, 'the disposed queue sends nothing');
  assert.deepEqual(server.calls[2], [
    { productId: 'p1', count: 2, base: null },
    { productId: 'p2', count: 6, base: 5 },
  ]);
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count], [2, 6]);
  assert.equal(after.pendingCount(), 0);
  assert.equal(storage.data.has(KEY), false);
});

test('damaged or unwritable storage is ignored, and each round has its own key', () => {
  const unused = async (): Promise<AuditCountSaveResult> => ({ success: false, error: 'unused' });
  const storage = memoryStorage();
  storage.setItem('audit-count-queue:a1:2', '{not json');
  storage.setItem(
    KEY,
    JSON.stringify({ p1: { total: -1, base: null }, p2: { total: 1.5, base: null }, p3: { total: 2 }, p4: { total: 3, base: null } }),
  );
  const round2 = makeQueue(unused, { storage, round: 2 }).queue;
  assert.equal(round2.pendingCount(), 0);
  const round1 = makeQueue(unused, { storage }).queue;
  assert.equal(round1.pendingCount(), 1);
  assert.equal(round1.getTotal('p4'), 3);
  assert.deepEqual(JSON.parse(storage.data.get(KEY)!), { p4: { total: 3, base: null } });

  const full: QueueStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const noRoom = makeQueue(unused, { storage: full }).queue;
  assert.equal(noRoom.add('p1', 1), 1);
  for (const q of [round1, round2, noRoom]) q.dispose();
});

test('a total never goes below 0', async () => {
  const server = fakeServer(['p1', 'p2']);
  server.rows.set('p2', { count: 1, by: 'me' });
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', 1]] });
  assert.equal(queue.add('p1', -1), null, 'nothing to take from an uncounted product');
  assert.equal(queue.pendingCount(), 0);
  queue.add('p1', 2);
  assert.equal(queue.add('p1', -5), 0);
  assert.equal(queue.add('p1', -1), 0);
  assert.equal(queue.add('p2', -3), 0);
  assert.throws(() => queue.setTotal('p1', -1), RangeError);
  assert.throws(() => queue.setTotal('p1', 1.5), RangeError);
  assert.throws(() => queue.add('p1', 0.5), RangeError);
  assert.equal(queue.undoLast(), 'p2');
  assert.equal(queue.getTotal('p2'), 1);
  assert.equal(queue.undoLast(), 'p1', 'the -1 at 0 changed nothing, so it is not undone');
  assert.equal(queue.getTotal('p1'), 2);
  await clock.advance(2_000);
  assert.deepEqual(server.calls, [[{ productId: 'p1', count: 2, base: null }]]);
});

test('refused products are dropped and listed with the reason until they change again', async () => {
  const server = fakeServer(['p1', 'p2']);
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', null]] });
  queue.add('p1', 1);
  queue.setTotal('p2', 100_001);
  queue.add('ghost', 1);
  await clock.advance(2_000);
  assert.deepEqual(queue.refused(), [
    { productId: 'p2', count: 100_001, reason: 'invalid' },
    { productId: 'ghost', count: 1, reason: 'not-an-item' },
  ]);
  assert.deepEqual([queue.getTotal('p1'), queue.getTotal('p2'), queue.getTotal('ghost')], [1, null, null]);
  assert.equal(queue.pendingCount(), 0);
  await clock.advance(30_000);
  assert.equal(server.calls.length, 1);
  queue.setTotal('p2', 7);
  assert.deepEqual(
    queue.refused().map((r) => r.productId),
    ['ghost'],
  );
});

test('subscribers hear every change until they unsubscribe; dispose stops saving', async () => {
  const server = fakeServer(['p1']);
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null]] });
  let heard = 0;
  const unsubscribe = queue.subscribe(() => heard++);
  queue.add('p1', 1);
  assert.equal(heard, 1);
  await clock.advance(2_000);
  assert.equal(heard, 2, 'the answer');
  unsubscribe();
  queue.add('p1', 1);
  assert.equal(heard, 2);
  queue.dispose();
  await clock.advance(60_000);
  assert.equal(server.calls.length, 1);
});

test('undo after a save whose answer was lost stays unsaved until the server holds it, also over a reload', async () => {
  const clock = fakeClock();
  const storage = memoryStorage();
  const server = fakeServer(['p1']);
  const before = makeQueue(server.save, { initial: [['p1', null]], storage, clock }).queue;
  before.add('p1', 1);
  await clock.advance(2_000); // saved 1
  before.add('p1', 1);
  server.failures.push('lost');
  await clock.advance(2_000); // the server holds 2, the answer is lost
  assert.equal(server.rows.get('p1')?.count, 2);
  assert.equal(before.undoLast(), 'p1'); // «برگشت»
  assert.equal(before.getTotal('p1'), 1);
  assert.equal(before.pendingCount(), 1, 'not shown as saved');
  before.dispose(); // the page reloads

  const after = makeQueue(server.save, { initial: [['p1', 2]], storage, clock }).queue;
  assert.deepEqual([after.getTotal('p1'), after.pendingCount()], [1, 1]);
  await clock.advance(4_000);
  // The server holds the 2 of the lost call: that becomes the base, and 1 is sent again over it.
  assert.deepEqual(server.calls.slice(2), [
    [{ productId: 'p1', count: 1, base: 1 }],
    [{ productId: 'p1', count: 1, base: 2 }],
  ]);
  assert.equal(server.rows.get('p1')?.count, 1);
  assert.deepEqual([after.pendingCount(), after.conflicts()], [0, []]);
  assert.equal(storage.data.has(KEY), false);
});

test('a retry after a lost answer builds on the number it sent; a number it never sent is still a conflict', async () => {
  const server = fakeServer(['p1', 'p2']);
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', null]] });
  queue.add('p1', 3);
  queue.add('p2', 1);
  server.failures.push('lost');
  await clock.advance(2_000); // both written, the answer is lost
  queue.add('p1', 1);
  server.rows.set('p2', { count: 5, by: 'sara' }); // Sara saves p2 before the retry
  await clock.advance(1_000);
  assert.deepEqual(server.calls[1], [
    { productId: 'p1', count: 4, base: null },
    { productId: 'p2', count: 1, base: null },
  ]);
  assert.deepEqual(queue.conflicts(), [{ productId: 'p2', theirs: 5, byName: 'Sara', mine: 1 }]);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[2], [{ productId: 'p1', count: 4, base: 3 }]);
  assert.equal(server.rows.get('p1')?.count, 4);
  assert.equal(queue.pendingCount(), 1, 'only the conflict');
});

test('adoptSaved takes fresh page data for products with nothing unsaved here, and forgets their undo', async () => {
  const held = heldSave();
  const { queue, clock } = makeQueue(held.save, { initial: [['idle', 1], ['busy', 2], ['mine', null], ['clash', null]] });
  queue.add('idle', 1);
  queue.add('clash', 1);
  await clock.advance(2_000);
  held.calls[0].answer({
    success: true,
    saved: [{ productId: 'idle', count: 2 }],
    conflicts: [{ productId: 'clash', current: 3, byName: 'Sara' }],
    refused: [],
  });
  await clock.settle();

  queue.add('busy', 1);
  await clock.advance(2_000); // busy 3 goes out and stays unanswered
  assert.equal(held.calls.length, 2);
  assert.equal(queue.undoLast(), 'busy'); // back at the saved 2 while its call is in flight
  queue.add('mine', 1); // not sent yet

  assert.equal(queue.adoptSaved('mine', 5), false, 'pending');
  assert.equal(queue.adoptSaved('clash', 3), false, 'in conflict');
  assert.equal(queue.adoptSaved('busy', 9), false, 'in flight');
  assert.equal(queue.adoptSaved('idle', 2), true, 'the same number');
  assert.equal(queue.adoptSaved('idle', 6), true);
  assert.deepEqual(['idle', 'busy', 'mine', 'clash'].map((id) => queue.getTotal(id)), [6, 2, 1, 1]);
  assert.equal(queue.pendingCount(), 3, 'busy too: the server may hold the 3 of its call in flight');
  // The +1 on idle is forgotten, so undo cannot put back a number from before the page data.
  assert.deepEqual([queue.undoLast(), queue.undoLast(), queue.undoLast()], ['mine', 'clash', null]);
  assert.equal(queue.getTotal('idle'), 6);
});

test('storedPendingCount counts the products a queue of that audit and round left unsaved', async () => {
  const storage = memoryStorage();
  const server = fakeServer(['p1', 'p2']);
  server.failures.push('throw');
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', null]], storage });
  queue.add('p1', 1);
  queue.add('p2', 2);
  await clock.advance(2_000);
  assert.equal(storedPendingCount(storage, 'a1', 1), 2);
  assert.equal(storedPendingCount(storage, 'a1', 2), 0);
  assert.equal(storedPendingCount(storage, 'other', 1), 0);
  await clock.advance(1_000);
  assert.equal(storedPendingCount(storage, 'a1', 1), 0, 'saved by the retry');
  storage.setItem('audit-count-queue:a1:3', '{not json');
  assert.equal(storedPendingCount(storage, 'a1', 3), 0);
  queue.dispose();
});

test('a lost answer followed by a conflict carrying a total this device sent is adopted, with no stuck conflict', async () => {
  const clock = fakeClock();
  const storage = memoryStorage();
  const server = fakeServer(['p1', 'p2']);
  // The page reloads during a call that is written: the new page data was read before it landed.
  const reloading = (saves: AuditCountSave[]) => {
    void server.save(saves);
    return new Promise<AuditCountSaveResult>(() => {});
  };
  const before = makeQueue(reloading, { initial: [['p1', null], ['p2', null]], storage, clock }).queue;
  before.add('p1', 3);
  await clock.advance(2_000);
  assert.equal(server.rows.get('p1')?.count, 3);
  before.dispose();

  const after = makeQueue(server.save, { initial: [['p1', null], ['p2', null]], storage, clock }).queue;
  assert.equal(after.pendingCount(), 1);
  await clock.advance(2_000);
  // The conflict carries the total of the call cut off by the reload, kept in storage: this device's own write.
  assert.deepEqual(server.calls[1], [{ productId: 'p1', count: 3, base: null }]);
  assert.deepEqual([after.conflicts(), after.pendingCount(), after.getTotal('p1')], [[], 0, 3]);
  assert.equal(storage.data.has(KEY), false);

  // Two calls without an answer (written, then not), then the conflict carries the older of the two totals.
  server.failures.push('lost', 'throw');
  after.add('p2', 2);
  await clock.advance(2_000);
  after.add('p2', 1);
  await clock.advance(1_000);
  assert.equal(server.rows.get('p2')?.count, 2);
  await clock.advance(2_000);
  assert.deepEqual(server.calls.slice(2), [
    [{ productId: 'p2', count: 2, base: null }],
    [{ productId: 'p2', count: 3, base: null }],
    [{ productId: 'p2', count: 3, base: null }],
  ]);
  assert.deepEqual([after.conflicts(), after.pendingCount()], [[], 1]);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[5], [{ productId: 'p2', count: 3, base: 2 }]);
  assert.deepEqual([server.rows.get('p2')?.count, after.pendingCount(), after.conflicts()], [3, 0, []]);
  await clock.advance(60_000);
  assert.equal(server.calls.length, 6);
});

test('undo after a call that threw or failed stays pending and resends until the server holds the undone total', async () => {
  const server = fakeServer(['p1', 'p2']);
  server.rows.set('p1', { count: 1, by: 'me' });
  server.rows.set('p2', { count: 1, by: 'me' });
  const storage = memoryStorage();
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', 1], ['p2', 1]], storage });
  queue.add('p1', 1);
  server.failures.push('lost', 'error');
  await clock.advance(2_000); // p1 2 is written, the answer is lost
  queue.add('p2', 1);
  await clock.advance(1_000); // the retry answers success: false
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count], [2, 1]);
  assert.deepEqual([queue.undoLast(), queue.undoLast()], ['p2', 'p1']); // «برگشت» twice
  assert.deepEqual([queue.getTotal('p1'), queue.getTotal('p2')], [1, 1]);
  assert.equal(queue.pendingCount(), 2, 'back at the saved totals, but not known to be on the server');
  assert.deepEqual(JSON.parse(storage.data.get(KEY)!), {
    p1: { total: 1, base: 1, unconfirmed: [2] },
    p2: { total: 1, base: 1, unconfirmed: [2] },
  });

  await clock.advance(2_000);
  await clock.advance(2_000);
  assert.deepEqual(server.calls.slice(2), [
    [
      { productId: 'p1', count: 1, base: 1 },
      { productId: 'p2', count: 1, base: 1 },
    ],
    [{ productId: 'p1', count: 1, base: 2 }],
  ]);
  assert.deepEqual([server.rows.get('p1')?.count, server.rows.get('p2')?.count], [1, 1]);
  assert.deepEqual([queue.pendingCount(), queue.conflicts()], [0, []]);
  assert.equal(storage.data.has(KEY), false);
});

test('undoing the first scan of the round sends null, also after a lost answer; setTotal takes null', async () => {
  const server = fakeServer(['p1', 'p2', 'p3', 'p4']);
  const initial: Array<[string, number | null]> = [['p1', null], ['p2', null], ['p3', null], ['p4', null]];
  const { queue, clock } = makeQueue(server.save, { initial });
  queue.add('p1', 1);
  await clock.advance(2_000);
  assert.equal(queue.undoLast(), 'p1');
  assert.deepEqual([queue.getTotal('p1'), queue.pendingCount()], [null, 1]);
  queue.add('p2', 1);
  assert.equal(queue.undoLast(), 'p2'); // never sent, so nothing to send
  await clock.advance(2_000);
  assert.deepEqual(server.calls[1], [{ productId: 'p1', count: null, base: 1 }]);
  assert.deepEqual([server.rows.get('p1'), queue.pendingCount()], [{ count: null, by: null }, 0]);

  queue.setTotal('p3', 4);
  await clock.advance(2_000);
  assert.equal(queue.setTotal('p3', null), null);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[3], [{ productId: 'p3', count: null, base: 4 }]);
  assert.deepEqual(server.rows.get('p3'), { count: null, by: null });
  assert.equal(queue.undoLast(), 'p3');
  assert.equal(queue.getTotal('p3'), 4);
  await clock.advance(2_000);
  assert.deepEqual(server.calls[4], [{ productId: 'p3', count: 4, base: null }]);
  assert.throws(() => queue.setTotal('p3', -1), RangeError);

  server.failures.push('lost');
  queue.add('p4', 1);
  await clock.advance(2_000); // p4 1 is written, the answer is lost
  assert.equal(queue.undoLast(), 'p4');
  assert.deepEqual([queue.getTotal('p4'), queue.pendingCount()], [null, 1]);
  await clock.advance(1_000);
  await clock.advance(2_000);
  assert.deepEqual(server.calls.slice(6), [
    [{ productId: 'p4', count: null, base: null }],
    [{ productId: 'p4', count: null, base: 1 }],
  ]);
  assert.deepEqual([server.rows.get('p4'), queue.getTotal('p4')], [{ count: null, by: null }, null]);
  assert.deepEqual([queue.pendingCount(), queue.conflicts()], [0, []]);
});

test('adoptSaved does nothing while a product is pending, unconfirmed or in conflict, and takes the count otherwise', async () => {
  const server = fakeServer(['p1', 'p2', 'p3']);
  server.rows.set('p2', { count: 1, by: 'me' });
  server.rows.set('p3', { count: 7, by: 'sara' }); // saved after this page loaded
  const storage = memoryStorage();
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null], ['p2', 1], ['p3', null]], storage });
  queue.add('p2', 1);
  server.failures.push('throw');
  await clock.advance(2_000);
  queue.undoLast();
  assert.equal(queue.getTotal('p2'), 1);
  assert.equal(queue.adoptSaved('p2', 4), false, 'unconfirmed');
  queue.add('p1', 2);
  assert.equal(queue.adoptSaved('p1', 5), false, 'pending');
  queue.add('p3', 1);
  await clock.advance(1_000);
  assert.deepEqual(queue.conflicts(), [{ productId: 'p3', theirs: 7, byName: 'Sara', mine: 1 }]);
  assert.equal(queue.adoptSaved('p3', 7), false, 'in conflict');
  assert.deepEqual(['p1', 'p2', 'p3'].map((id) => queue.getTotal(id)), [2, 1, 1]);

  // Answered and saved: fresh page data is taken, becomes the base, and nothing is left in storage for them.
  server.rows.set('p1', { count: 5, by: 'sara' });
  assert.equal(queue.adoptSaved('p1', 5), true);
  assert.equal(queue.adoptSaved('p2', 1), true);
  assert.deepEqual(JSON.parse(storage.data.get(KEY)!), { p3: { total: 1, base: null } });
  queue.resolveConflict('p3', 'theirs', 7);
  assert.equal(queue.adoptSaved('p3', 8), true);
  assert.deepEqual([queue.getTotal('p1'), queue.getTotal('p3'), queue.pendingCount()], [5, 8, 0]);
  assert.equal(storage.data.has(KEY), false);
  queue.add('p1', 1);
  await clock.advance(2_000);
  assert.deepEqual(server.calls.at(-1), [{ productId: 'p1', count: 6, base: 5 }]);
  assert.deepEqual([server.rows.get('p1')?.count, queue.pendingCount()], [6, 0]);
});

test('consecutiveFailures counts calls in a row that threw or failed, and any successful call resets it', async () => {
  const server = fakeServer(['p1']);
  const { queue, clock } = makeQueue(server.save, { initial: [['p1', null]] });
  assert.equal(queue.consecutiveFailures(), 0);
  server.failures.push('throw', 'error', 'lost');
  queue.add('p1', 1);
  const seen: number[] = [];
  for (const ms of [2_000, 1_000, 2_000, 5_000]) {
    await clock.advance(ms);
    seen.push(queue.consecutiveFailures());
  }
  assert.deepEqual(seen, [1, 2, 3, 0]);
  assert.deepEqual([queue.pendingCount(), queue.conflicts()], [0, []]);

  // A successful call resets it even when its answers are a conflict and a refusal.
  server.failures.push('error');
  server.rows.set('p1', { count: 9, by: 'sara' });
  queue.add('p1', 1);
  queue.add('ghost', 1);
  await clock.advance(2_000);
  assert.equal(queue.consecutiveFailures(), 1);
  await clock.advance(1_000);
  assert.equal(queue.consecutiveFailures(), 0);
  assert.deepEqual(queue.conflicts(), [{ productId: 'p1', theirs: 9, byName: 'Sara', mine: 2 }]);
  assert.deepEqual(queue.refused(), [{ productId: 'ghost', count: 1, reason: 'not-an-item' }]);
});

test('the same number saved first by another counter, or by this account on another device, is a conflict', async () => {
  for (const other of ['sara', 'me']) {
    const server = fakeServer(['p1']);
    // Both pages loaded before either saved; each finds 1 unit of the frame in a different place, so 2 exist.
    const first = makeQueue(server.saveAs(other), { initial: [['p1', null]] });
    const { queue, clock } = makeQueue(server.save, { initial: [['p1', null]] });
    first.queue.add('p1', 1);
    await first.clock.advance(2_000);
    queue.add('p1', 1);
    await clock.advance(2_000);
    assert.deepEqual(server.rows.get('p1'), { count: 1, by: other });
    assert.deepEqual(queue.conflicts(), [{ productId: 'p1', theirs: 1, byName: NAMES[other], mine: 1 }], other);
    assert.equal(queue.pendingCount(), 1, other);
    first.queue.dispose();
    queue.dispose();
  }

  // The total changes during the call: still a conflict, and nothing goes out over the other number.
  const server = fakeServer(['p1']);
  server.rows.set('p1', { count: 2, by: 'sara' }); // saved after this page loaded
  const held = heldSave();
  const { queue, clock } = makeQueue(held.save, { initial: [['p1', null]] });
  queue.setTotal('p1', 2);
  await clock.advance(2_000);
  queue.add('p1', 1);
  held.calls[0].answer(await server.save(held.calls[0].saves));
  await clock.advance(30_000);
  assert.deepEqual(queue.conflicts(), [{ productId: 'p1', theirs: 2, byName: 'Sara', mine: 3 }]);
  assert.equal(held.calls.length, 1);
  assert.deepEqual(server.rows.get('p1'), { count: 2, by: 'sara' });
});
