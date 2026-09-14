'use client';

/**
 * The counting part of the inventory count screen (انبارگردانی): the scan box, the product search for counting by
 * hand, and the save status. Every change goes into AuditCountQueue (one per audit and round), which saves totals in
 * the background; nothing here refreshes the page.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CircleCheck, ScanBarcode, Search, TriangleAlert, Undo2, WifiOff } from 'lucide-react';
import { saveAuditCounts } from '@/actions/inventory-audit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildScanIndex, resolveScan } from '@/lib/audit-scan';
import {
  AuditCountQueue,
  type AuditCountConflict,
  type AuditCountSave,
  type AuditCountSaveResult,
  type QueueStorage,
} from '@/lib/audit-scan-queue';
import { cn } from '@/lib/utils';
import {
  ROUNDS,
  ROUND_LABELS,
  confirmedKey,
  countOf,
  foldSearchText,
  forgetConfirmedCounts,
  knownCount,
  matchesSearch,
  parseWholeNumber,
  roundChangeBlock,
  roundTotals,
  type AuditCountItem,
  type Round,
} from '@/components/inventory/audit-count-view';

const NOT_COUNTED = 'شمارش نشده';
const MAX_SCAN_QUANTITY = 999;
const MAX_TOTAL = 100000; // saveAuditCounts refuses more
const SEARCH_LIMIT = 20;
const RETURN_FOCUS_MS = 1500;

// ---- Saving ----

// Counts the server confirmed while this page is open, by audit, round and product. The page data is not refreshed
// after scans, so a queue built again (after switching tabs or rounds) starts from these instead.
const confirmedCounts = new Map<string, number | null>();
// The page data last checked against those counts. Other page data was loaded since (router.refresh), so it is newer.
let checkedItems: AuditCountItem[] | null = null;

/** A round's saved count as this page knows it. */
export function savedCount(auditId: string, round: Round, item: AuditCountItem): number | null {
  return knownCount(confirmedCounts, auditId, round, item);
}

async function saveCounts(auditId: string, round: Round, saves: AuditCountSave[]): Promise<AuditCountSaveResult> {
  const result = await saveAuditCounts(auditId, round, saves);
  if (!result.success) return result;
  for (const { productId, count } of result.saved) {
    confirmedCounts.set(confirmedKey(auditId, round, productId), count);
  }
  // A conflict says what the server holds now, so a queue built again starts from that.
  for (const { productId, theirCount } of result.conflicts) {
    confirmedCounts.set(confirmedKey(auditId, round, productId), theirCount);
  }
  return {
    success: true,
    saved: result.saved,
    // The queue names the other person's count and name current and byName.
    conflicts: result.conflicts.map((c) => ({ productId: c.productId, current: c.theirCount, byName: c.theirName })),
    refused: result.refused,
  };
}

function browserStorage(): QueueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // Storage blocked: saving still works, but a reload loses what was not saved yet.
  }
}

/**
 * The save queue of one audit and round; the calling component re-renders on every change and answer. A new round
 * gets a new queue. The old one sends what it can before it is dropped, and anything still unsaved stays in
 * localStorage until a queue for that round is built again.
 */
export function useAuditCountQueue(
  auditId: string,
  round: Round,
  items: AuditCountItem[],
  enabled: boolean
): AuditCountQueue | null {
  const [current, setCurrent] = useState<{ queue: AuditCountQueue; auditId: string; round: Round } | null>(null);
  const [, setVersion] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!enabled) return;
    const queue = new AuditCountQueue({
      auditId,
      round,
      save: (saves) => saveCounts(auditId, round, saves),
      initial: roundTotals(auditId, round, itemsRef.current, confirmedCounts),
      storage: browserStorage(),
    });
    const unsubscribe = queue.subscribe(() => setVersion((v) => v + 1));
    setCurrent({ queue, auditId, round });
    return () => {
      unsubscribe();
      void queue.flush().finally(() => queue.dispose());
    };
  }, [auditId, round, enabled]);

  const queue = enabled && current?.auditId === auditId && current.round === round ? current.queue : null;

  // New page data can hold counts others saved since. It replaces the counts confirmed on this page, and the queue
  // takes it for products with nothing unsaved here.
  useEffect(() => {
    if (!queue || checkedItems === items) return;
    checkedItems = items;
    const keep = new Set(queue.conflicts().map((conflict) => conflict.productId));
    for (const item of items) {
      const count = countOf(item, round);
      queue.adoptSaved(item.productId, count);
      // Not taken: this device still has its own number for the product.
      if (queue.getTotal(item.productId) !== count) keep.add(item.productId);
    }
    forgetConfirmedCounts(confirmedCounts, auditId, round, items, keep);
    // The items list reads confirmedCounts, and changing it re-renders nothing.
    setVersion((v) => v + 1);
  }, [auditId, round, items, queue]);

  useEffect(() => {
    if (!queue) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.pendingCount() === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [queue]);

  return queue;
}

type SaveStatusProps = { auditId: string; round: Round; items: AuditCountItem[]; queue: AuditCountQueue | null };

/** Unsaved count, connection trouble, conflicts with another counter, and refused totals. */
export function AuditSaveStatus({ auditId, round, items, queue }: SaveStatusProps) {
  const names = useMemo(() => new Map(items.map((item) => [item.productId, item.product.name] as const)), [items]);
  if (!queue) return null;

  const pending = queue.pendingCount();
  const conflicts = queue.conflicts();
  const refused = queue.refused();
  const nameOf = (productId: string) => names.get(productId) ?? productId;

  const resolve = (conflict: AuditCountConflict, choice: 'theirs' | 'mine') => {
    queue.resolveConflict(conflict.productId, choice, conflict.theirs);
    // Either way the server holds their count now, and it is the base of whatever is sent next.
    confirmedCounts.set(confirmedKey(auditId, round, conflict.productId), conflict.theirs);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {pending > 0 ? (
            <Badge variant="destructive" className="text-sm">
              {pending} ذخیره‌نشده
            </Badge>
          ) : (
            <span className="flex items-center gap-1 font-medium text-green-700 dark:text-green-400">
              <CircleCheck className="h-4 w-4" />
              همه شمارش‌ها ذخیره شد
            </span>
          )}
          {!queue.online ? (
            <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400">
              <WifiOff className="h-4 w-4 shrink-0" />
              اتصال قطع است؛ شمارش‌ها روی همین دستگاه می‌مانند و خودکار دوباره ارسال می‌شوند.
            </span>
          ) : queue.lastError ? (
            <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              ذخیره نشد: {queue.lastError} دوباره تلاش می‌شود.
            </span>
          ) : null}
          {queue.consecutiveFailures() >= 3 && (
            <span className="font-medium text-orange-700 dark:text-orange-400">
              اگر ادامه داشت صفحه را تازه کنید؛ شمارش‌ها روی همین دستگاه می‌مانند.
            </span>
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              اگر هر دو یک مدل را در جاهای مختلف شمرده‌اید، یکی را قبول کنید و سپس جمع درست را در «جستجوی کالا» وارد کنید.
            </p>
            {conflicts.map((conflict) => (
              <div
                key={conflict.productId}
                className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/40"
              >
                <p className="text-sm">
                  <span className="font-semibold">«{nameOf(conflict.productId)}»</span> را{' '}
                  {conflict.byName ?? 'کاربر دیگری'} در {ROUND_LABELS[round]} با عدد{' '}
                  <span className="font-bold">{conflict.theirs ?? '—'}</span> ثبت کرده است. عدد شما:{' '}
                  <span className="font-bold">{conflict.mine ?? '—'}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => resolve(conflict, 'theirs')}>
                    عدد او را قبول کن
                  </Button>
                  <Button type="button" size="sm" onClick={() => resolve(conflict, 'mine')}>
                    عدد من ثبت شود
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {refused.map((refusal) => (
          <div
            key={refusal.productId}
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:bg-red-950/40"
          >
            <span className="font-semibold">«{nameOf(refusal.productId)}»</span> ثبت نشد (عدد {refusal.count ?? '—'}):{' '}
            {refusal.reason}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---- Scanning ----

let audioContext: AudioContext | null = null;

/** A short high beep for a count, a low buzz for anything that needs a look. */
function playTone(kind: 'ok' | 'bad') {
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const seconds = kind === 'ok' ? 0.09 : 0.35;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'ok' ? 'sine' : 'square';
    oscillator.frequency.value = kind === 'ok' ? 1200 : 140;
    gain.gain.setValueAtTime(0.2, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + seconds);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + seconds);
  } catch {
    // No audio on this device; the colours still show the result.
  }
}

const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image']);

function isTextEntry(element: Element): boolean {
  if (element instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(element.type);
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

/** A phone or tablet, where focusing the scan box from code opens the on-screen keyboard over the page. */
const onTouchScreen = () => window.matchMedia('(pointer: coarse)').matches;

/** Focusing the scan box from code opens no on-screen keyboard: not a touch screen, or the box asks for none. */
const mayFocusFromCode = (input: HTMLInputElement) => input.inputMode === 'none' || !onTouchScreen();

/**
 * Gives focus back to the scan box after any click or tap and whenever focus lands on something else (a button, a
 * toast, a closing dialog), so the scanner never types into a button and its Enter never presses one. Typing fields,
 * open dialogs, Tab moves, a hidden box and a scan box that would open the on-screen keyboard are left alone.
 */
function useScanFocus(scanRef: RefObject<HTMLInputElement>) {
  useEffect(() => {
    let timer: number | undefined;
    let tabbedAt = 0;
    const refocus = () => {
      const input = scanRef.current;
      if (!input || input.disabled || input.offsetParent === null || !mayFocusFromCode(input)) return;
      const active = document.activeElement;
      if (active === input || (active && isTextEntry(active))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
      input.focus({ preventScroll: true });
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refocus, 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') tabbedAt = Date.now();
    };
    const onFocusIn = () => {
      if (Date.now() - tabbedAt > 100) soon();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', soon);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', soon);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [scanRef]);
}

type Feedback =
  | { kind: 'counted'; productId: string; change: string }
  | { kind: 'undone'; productId: string }
  | { kind: 'unknown'; raw: string; persianLayout: boolean }
  | { kind: 'ambiguous'; code: string; productIds: string[]; quantity: number }
  | { kind: 'notice'; message: string };

type RecentEntry = { id: number; productId: string; change: string; total: number | null; undone: boolean };

const ROUND_BANNER: Record<Round, string> = {
  1: 'bg-blue-700 text-white',
  2: 'bg-amber-600 text-white',
  3: 'bg-purple-700 text-white',
};

const QUANTITY_HELP =
  'در «تعداد» فقط عددی از 1 تا 999 بنویسید، یا آن را خالی بگذارید تا هر اسکن 1 عدد باشد. دوباره اسکن کنید.';

function panelTone(feedback: Feedback | null): string {
  switch (feedback?.kind) {
    case 'unknown':
      return 'border-red-500 bg-red-50 dark:bg-red-950/40';
    case 'ambiguous':
    case 'notice':
      return 'border-amber-500 bg-amber-50 dark:bg-amber-950/40';
    case 'counted':
    case 'undone':
      return 'border-green-600 bg-background';
    default:
      return 'border-dashed border-muted-foreground/30 bg-background';
  }
}

type ScanPanelProps = {
  items: AuditCountItem[];
  round: Round;
  queue: AuditCountQueue | null;
  onRoundChange: (round: Round) => void;
};

/** Round banner, scan box, last scan, recent scans, and the product search. Render with key={round}. */
export function AuditScanPanel({ items, round, queue, onRoundChange }: ScanPanelProps) {
  const scanRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const nextId = useRef(1);
  const [quantity, setQuantity] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'bad' | null; id: number }>({ kind: null, id: 0 });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [touchScreen, setTouchScreen] = useState(false);
  // A round chosen while counts were still unsaved.
  const [wantedRound, setWantedRound] = useState<Round | null>(null);

  const scanIndex = useMemo(
    () =>
      buildScanIndex(
        items.map((item) => ({
          productId: item.productId,
          barcode: item.product.barcode,
          sku: item.product.sku,
          webId: item.product.webId,
        }))
      ),
    [items]
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.productId, item] as const)), [items]);
  const results = useMemo(() => {
    const query = foldSearchText(search);
    return query ? items.filter((item) => matchesSearch(item, query)).slice(0, SEARCH_LIMIT + 1) : [];
  }, [items, search]);

  useScanFocus(scanRef);
  useEffect(
    () => () => {
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(flashTimer.current);
    },
    []
  );

  // On a touch screen only once the scan box asks for no on-screen keyboard; before that, focusing it opens one.
  const focusScan = () => {
    const input = scanRef.current;
    if (input && mayFocusFromCode(input)) input.focus({ preventScroll: true });
  };

  // A typing field hands focus back after a pause, so a scan made right after typing does not land in it.
  const returnFocusWhenIdle = (field: HTMLInputElement) => {
    window.clearTimeout(idleTimer.current);
    if (onTouchScreen()) return;
    idleTimer.current = window.setTimeout(() => {
      if (document.activeElement === field) focusScan();
    }, RETURN_FOCUS_MS);
  };

  // Known only in the browser.
  useEffect(() => {
    setTouchScreen(onTouchScreen());
  }, []);
  // A panel mounted for a new round takes the focus; on a touch screen once the scan box asks for no keyboard.
  useEffect(() => {
    focusScan();
  }, [touchScreen]);

  // A round is left only with every count saved, so nothing is asked while the scanner can type into the answer. A
  // round chosen before that is kept and taken once they are saved; scans are refused until then, so none goes into
  // the round being left. Choosing the current round again stays in it.
  const roundNotice =
    wantedRound !== null && queue ? roundChangeBlock(queue.pendingCount(), queue.conflicts().length) : null;
  useEffect(() => {
    if (wantedRound === null || roundNotice) return;
    setWantedRound(null);
    onRoundChange(wantedRound);
  }, [wantedRound, roundNotice]);

  const changeRound = (next: Round) => {
    if (next === round) setWantedRound(null);
    else if (queue && roundChangeBlock(queue.pendingCount(), queue.conflicts().length)) setWantedRound(next);
    else onRoundChange(next);
  };

  const signal = (kind: 'ok' | 'bad') => {
    playTone(kind);
    window.clearTimeout(flashTimer.current);
    setFlash((previous) => ({ kind, id: previous.id + 1 }));
    flashTimer.current = window.setTimeout(() => setFlash((previous) => ({ kind: null, id: previous.id })), 400);
  };

  const waitingForRound = () => {
    if (wantedRound === null) return false;
    setFeedback({
      kind: 'notice',
      message: `در حال رفتن به «${ROUND_LABELS[wantedRound]}»؛ پس از ذخیره دوباره اسکن کنید. برای ماندن در «${ROUND_LABELS[round]}» روی آن بزنید.`,
    });
    signal('bad');
    return true;
  };

  const record = (productId: string, change: string, before: number | null, after: number | null) => {
    if (before === after) return;
    const id = nextId.current++;
    setRecent((list) => [{ id, productId, change, total: after, undone: false }, ...list].slice(0, 10));
  };

  const notReady = () => {
    setFeedback({ kind: 'notice', message: 'صفحه هنوز آماده ثبت نیست؛ چند ثانیه بعد دوباره اسکن کنید.' });
    signal('bad');
  };

  const addToTotal = (productId: string, amount: number) => {
    if (waitingForRound()) return;
    if (!queue) return notReady();
    const before = queue.getTotal(productId);
    const after = queue.add(productId, amount);
    record(productId, `+${amount}`, before, after);
    setFeedback({ kind: 'counted', productId, change: `+${amount}` });
    signal('ok');
  };

  const setTotal = (productId: string, total: number) => {
    if (!queue) return notReady();
    const before = queue.getTotal(productId);
    queue.setTotal(productId, total);
    record(productId, `= ${total}`, before, total);
    setFeedback({ kind: 'counted', productId, change: `= ${total}` });
    signal('ok');
  };

  const scanQuantity = (text: string): number | null => {
    if (text.trim() === '') return 1;
    const n = parseWholeNumber(text);
    return n !== null && n >= 1 && n <= MAX_SCAN_QUANTITY ? n : null;
  };

  const submitScan = (raw: string) => {
    const result = resolveScan(scanIndex, raw);
    if (result.kind === 'empty' || waitingForRound()) return;
    if (result.kind === 'unknown') {
      setFeedback({ kind: 'unknown', raw, persianLayout: result.persianLayout });
      signal('bad');
      return;
    }
    const amount = scanQuantity(quantity);
    if (amount === null) {
      setQuantity('');
      setFeedback({ kind: 'notice', message: QUANTITY_HELP });
      signal('bad');
      return;
    }
    if (!queue) return notReady();
    setQuantity('');
    if (result.kind === 'ambiguous') {
      setFeedback({ kind: 'ambiguous', code: result.code, productIds: result.productIds, quantity: amount });
      signal('bad');
      return;
    }
    addToTotal(result.productId, amount);
  };

  const undo = () => {
    if (!queue) return;
    const productId = queue.undoLast();
    if (!productId) {
      setFeedback({ kind: 'notice', message: 'موردی برای برگشت نیست.' });
      return;
    }
    setRecent((list) => {
      const at = list.findIndex((entry) => entry.productId === productId && !entry.undone);
      return at === -1 ? list : list.map((entry, i) => (i === at ? { ...entry, undone: true } : entry));
    });
    setFeedback({ kind: 'undone', productId });
  };

  const submitDraft = (productId: string) => {
    if (waitingForRound()) return;
    const total = parseWholeNumber(drafts[productId] ?? '');
    if (total === null || total > MAX_TOTAL) {
      setFeedback({ kind: 'notice', message: 'جمع باید عدد صحیح از 0 تا 100000 باشد.' });
      signal('bad');
      return;
    }
    setTotal(productId, total);
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[productId];
      return next;
    });
  };

  const shownItem =
    feedback?.kind === 'counted' || feedback?.kind === 'undone' ? byId.get(feedback.productId) : undefined;
  // null: not counted in this round, which undoing its first scan gives back.
  const shownTotal = shownItem && queue ? queue.getTotal(shownItem.productId) : null;

  return (
    <>
      <Card className="overflow-hidden">
        <div className={cn('flex flex-wrap items-center justify-between gap-3 px-4 py-3', ROUND_BANNER[round])}>
          <div>
            <p className="text-xs opacity-80">مرحله شمارش</p>
            <p className="text-2xl font-bold sm:text-3xl">{ROUND_LABELS[round]}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {ROUNDS.map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'hover:scale-100',
                  r === round
                    ? 'bg-white text-gray-900 hover:bg-white hover:text-gray-900'
                    : 'bg-white/15 text-white hover:bg-white/25 hover:text-white'
                )}
                onClick={() => changeRound(r)}
              >
                {ROUND_LABELS[r]}
              </Button>
            ))}
          </div>
          {wantedRound !== null && roundNotice && (
            <p
              role="status"
              className="flex basis-full items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-amber-800"
            >
              <TriangleAlert className="h-4 w-4 shrink-0" />
              در حال رفتن به «{ROUND_LABELS[wantedRound]}»: {roundNotice}
            </p>
          )}
        </div>

        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="audit-scan-code" className="flex items-center gap-2">
                <ScanBarcode className="h-4 w-4" />
                اسکن بارکد
              </Label>
              <Input
                id="audit-scan-code"
                ref={scanRef}
                // No on-screen keyboard on a touch screen; a paired scanner types into the box all the same.
                inputMode={touchScreen ? 'none' : undefined}
                dir="ltr"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="enter"
                placeholder="بارکد، SKU یا کد وب"
                className="h-14 text-center font-mono text-xl placeholder:font-sans placeholder:text-base"
                onKeyDown={(event) => {
                  if ((event.key !== 'Enter' && event.key !== 'Tab') || event.nativeEvent.isComposing) return;
                  const raw = event.currentTarget.value;
                  if (event.key === 'Tab' && raw === '') return;
                  event.preventDefault();
                  event.currentTarget.value = '';
                  submitScan(raw);
                }}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="audit-scan-quantity">تعداد</Label>
                <Input
                  id="audit-scan-quantity"
                  inputMode="numeric"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="1"
                  className="h-14 w-20 text-center text-xl"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    returnFocusWhenIdle(event.target);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== 'Tab') return;
                    event.preventDefault();
                    if (scanQuantity(quantity) === null) {
                      setQuantity('');
                      setFeedback({ kind: 'notice', message: QUANTITY_HELP });
                      signal('bad');
                    }
                    focusScan();
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-14 flex-1 gap-2 text-base sm:flex-none"
                onClick={undo}
                disabled={!queue}
              >
                <Undo2 className="h-5 w-5" />
                برگشت
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            هر اسکن 1 عدد به جمع این مرحله اضافه می‌کند. برای چند عدد از یک مدل، عدد را در «تعداد» بنویسید و یک بار اسکن کنید.
          </p>

          <div
            key={flash.id}
            className={cn(
              'min-h-[8.5rem] rounded-lg border-2 p-4 transition-colors duration-700',
              panelTone(feedback),
              flash.kind === 'ok' && 'border-green-500 bg-green-200 transition-none dark:bg-green-900',
              flash.kind === 'bad' && 'border-red-600 bg-red-200 transition-none dark:bg-red-900'
            )}
          >
            {!feedback && (
              <div className="flex min-h-[6rem] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <ScanBarcode className="h-8 w-8" />
                <p>آماده اسکن؛ کالا را اسکن کنید.</p>
              </div>
            )}

            {shownItem && (feedback?.kind === 'counted' || feedback?.kind === 'undone') && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="break-words text-2xl font-bold sm:text-3xl">{shownItem.product.name}</p>
                    <p className="mt-1 text-muted-foreground">
                      SKU: <bdi>{shownItem.product.sku}</bdi>
                    </p>
                    {feedback.kind === 'undone' && (
                      <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">آخرین ثبت این کالا برگشت خورد.</p>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">جمع {ROUND_LABELS[round]}</p>
                    {shownTotal === null ? (
                      <p className="text-2xl font-bold sm:text-3xl">{NOT_COUNTED}</p>
                    ) : (
                      <p className="text-5xl font-extrabold tabular-nums sm:text-6xl">{shownTotal}</p>
                    )}
                    {feedback.kind === 'counted' && (
                      <p className="text-lg font-semibold text-green-700 dark:text-green-400" dir="ltr">
                        {feedback.change}
                      </p>
                    )}
                  </div>
                </div>
                {shownItem.finalQuantity != null && (
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    این کالا قبلاً نهایی شده است (مقدار نهایی: {shownItem.finalQuantity})؛ شمارش جدید مقدار نهایی را
                    تغییر نمی‌دهد.
                  </p>
                )}
              </div>
            )}

            {feedback?.kind === 'unknown' && (
              <div className="space-y-2">
                <p className="text-xl font-bold text-red-700 dark:text-red-400">کالایی با این کد در این انبارگردانی نیست</p>
                <p className="break-all rounded bg-background/70 px-2 py-1 font-mono text-lg" dir="auto">
                  {feedback.raw}
                </p>
                {feedback.persianLayout ? (
                  <p className="font-semibold text-red-700 dark:text-red-400">
                    کیبورد روی فارسی است؛ آن را انگلیسی کنید (Alt+Shift) و دوباره اسکن کنید.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    کالا را کنار بگذارید و با «جستجوی کالا» در همین صفحه ثبت کنید.
                  </p>
                )}
              </div>
            )}

            {feedback?.kind === 'ambiguous' && (
              <div className="space-y-3">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  کد <bdi className="font-mono">{feedback.code}</bdi> به چند کالا تعلق دارد. کالای درست را انتخاب کنید
                  {feedback.quantity > 1 ? ` (${feedback.quantity} عدد)` : ''}:
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {feedback.productIds.map((productId) => {
                    const item = byId.get(productId);
                    const amount = feedback.quantity;
                    return (
                      <Button
                        key={productId}
                        type="button"
                        variant="outline"
                        className="h-auto justify-start whitespace-normal py-2 text-start hover:scale-100"
                        onClick={() => addToTotal(productId, amount)}
                      >
                        <span>
                          <span className="block font-medium">{item?.product.name ?? productId}</span>
                          <span className="block text-xs text-muted-foreground">
                            <bdi>{item?.product.sku}</bdi>
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {feedback?.kind === 'notice' && (
              <p className="flex items-start gap-2 font-medium text-amber-800 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                {feedback.message}
              </p>
            )}
          </div>

          {recent.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">آخرین شمارش‌ها</p>
              <ul className="divide-y rounded-lg border text-sm">
                {recent.map((entry) => (
                  <li
                    key={entry.id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2',
                      entry.undone && 'text-muted-foreground line-through'
                    )}
                  >
                    <span className="min-w-0 truncate">{byId.get(entry.productId)?.product.name ?? entry.productId}</span>
                    <span className="flex shrink-0 items-center gap-3 tabular-nums">
                      <span dir="ltr">{entry.change}</span>
                      <span>جمع: {entry.total ?? '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            جستجوی کالا
          </CardTitle>
          <CardDescription>
            برای کالایی که برچسب ندارد یا اسکن نمی‌شود: بخشی از نام، SKU، کد وب یا بارکد را بنویسید، سپس +1 بزنید یا جمع را
            وارد کنید.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
          <Input
            value={search}
            autoComplete="off"
            placeholder="نام، SKU، کد وب یا بارکد..."
            onChange={(event) => {
              setSearch(event.target.value);
              returnFocusWhenIdle(event.target);
            }}
            onKeyDown={(event) => {
              // A scan that landed here is counted as if it had gone into the scan box.
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              const raw = event.currentTarget.value;
              const kind = resolveScan(scanIndex, raw).kind;
              if (kind !== 'match' && kind !== 'ambiguous') return;
              event.preventDefault();
              setSearch('');
              submitScan(raw);
              focusScan();
            }}
          />
          {search.trim() !== '' && results.length === 0 && (
            <p className="text-sm text-muted-foreground">کالایی پیدا نشد.</p>
          )}
          <div className="space-y-2">
            {results.slice(0, SEARCH_LIMIT).map((item) => {
              const draft = drafts[item.productId] ?? '';
              const total = queue?.getTotal(item.productId) ?? null;
              return (
                <div key={item.productId} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="break-words font-medium">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <bdi>{[item.product.sku, item.product.webId].filter(Boolean).join(' · ')}</bdi>
                    </p>
                  </div>
                  <div className="min-w-12 text-center">
                    <p className="text-xs text-muted-foreground">جمع</p>
                    {total === null ? (
                      <p className="text-sm text-muted-foreground">{NOT_COUNTED}</p>
                    ) : (
                      <p className="text-xl font-bold tabular-nums">{total}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-10 min-w-12 text-base"
                      disabled={!queue}
                      onClick={() => addToTotal(item.productId, 1)}
                    >
                      <span dir="ltr">+1</span>
                    </Button>
                    <Input
                      inputMode="numeric"
                      dir="ltr"
                      autoComplete="off"
                      placeholder="جمع"
                      aria-label={`جمع ${item.product.name}`}
                      className="h-10 w-20 text-center"
                      value={draft}
                      // Also when nothing is typed, so a scan after a stray click does not become this total.
                      onFocus={(event) => returnFocusWhenIdle(event.currentTarget)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setDrafts((previous) => ({ ...previous, [item.productId]: value }));
                        returnFocusWhenIdle(event.target);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        if (!queue || draft.trim() === '') return;
                        submitDraft(item.productId);
                        focusScan();
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-10"
                      disabled={!queue || draft.trim() === ''}
                      onClick={() => submitDraft(item.productId)}
                    >
                      ثبت جمع
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {results.length > SEARCH_LIMIT && (
            <p className="text-xs text-muted-foreground">فقط 20 مورد اول نشان داده شد؛ دقیق‌تر جستجو کنید.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
