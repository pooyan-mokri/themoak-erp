'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Expand, HelpCircle, LocateFixed, Minus, Plus, RotateCcw, RotateCw, Shrink, X } from 'lucide-react';
import { canAccessRoute } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { WorldData, WorldEvent } from '@/lib/world-types';
import { planWorld, DISTRICT_LABELS, type DistrictKey, type Point } from '@/components/world/world-layout';
import { ago, districtCard, EVENT_LABELS, eventLine, thingCard, type Card } from '@/components/world/world-describe';
import type { WorldEngine } from '@/components/world/world-engine';

/** How often the world asks for a fresh snapshot while the tab is in view. */
const POLL_MS = 20_000;
/** One past event crosses the map this often, round and round the last 7 days. */
const REPLAY_MS = 1_900;
const HELP_KEY = 'erp-world-help-seen';

/** The thing an event's destination stands for, so a click on the feed goes there. */
function placeThing(place: string): string {
  if (place.startsWith('wh:')) return `warehouse:${place.slice(3)}`;
  if (place.startsWith('sup:')) return `supplier:${place.slice(4)}`;
  if (place === 'site') return 'site';
  if (place === 'out') return 'out';
  if (place === 'customers' || place === 'treasury' || place === 'hq') return `district:${place}`;
  return 'district:hq';
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A private window: the help shows again next time.
  }
}

export function WorldClient({ role }: { role: string | null }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const seenRef = useRef<Set<string> | null>(null);
  const replayRef = useRef(0);
  const avatarRef = useRef<Point>({ x: 0, z: 4.5 });
  const yawRef = useRef(Math.PI / 4);

  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [district, setDistrict] = useState<DistrictKey | null>(null);
  const [toasts, setToasts] = useState<WorldEvent[]>([]);
  const [showFeed, setShowFeed] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // ── The engine ────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let engine: WorldEngine | null = null;
    import('@/components/world/world-engine')
      .then(({ WorldEngine }) => {
        if (disposed || !canvasRef.current || !labelsRef.current) return;
        try {
          engine = new WorldEngine(canvasRef.current, labelsRef.current, {
            onHover: setHovered,
            onSelect: setSelected,
            onDistrict: setDistrict,
            onAvatar: (p, yaw) => {
              avatarRef.current = p;
              yawRef.current = yaw;
            },
          }, document.documentElement.classList.contains('dark'));
          engineRef.current = engine;
          setData((current) => {
            if (current) engine!.setData(current);
            return current;
          });
        } catch (e) {
          console.error('[World] WebGL failed:', e);
          setWebglFailed(true);
        }
      })
      .catch(() => setWebglFailed(true));
    const observer = new MutationObserver(() => engineRef.current?.setDark(document.documentElement.classList.contains('dark')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (!readStorage(HELP_KEY)) setShowHelp(true);
    return () => {
      disposed = true;
      observer.disconnect();
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  // ── Always current: a fresh snapshot every 20 s in view, and at once on return ──
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/world', { cache: 'no-store', signal });
      if (res.status === 401) {
        window.location.assign(`/login?callbackUrl=${encodeURIComponent('/dashboard/world')}`);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as WorldData;
      const seen = seenRef.current;
      if (seen) {
        const fresh = next.events.filter((e) => !seen.has(e.id)).reverse();
        if (fresh.length) {
          for (const e of fresh.slice(-6)) engineRef.current?.spawn(e, true);
          setToasts((t) => [...fresh.slice(-3).reverse(), ...t].slice(0, 3));
        }
      }
      seenRef.current = new Set(next.events.map((e) => e.id));
      engineRef.current?.setData(next);
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError('اتصال برقرار نشد؛ دوباره تلاش می‌شود.');
    }
  }, []);

  useEffect(() => {
    let controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      controller.abort();
      controller = new AbortController();
      load(controller.signal);
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  // The last 7 days, replayed one by one.
  useEffect(() => {
    if (!data?.events.length) return;
    const ordered = [...data.events].reverse();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const event = ordered[replayRef.current % ordered.length];
      replayRef.current += 1;
      engineRef.current?.spawn(event);
    }, REPLAY_MS);
    return () => window.clearInterval(timer);
  }, [data]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = window.setTimeout(() => setToasts((t) => t.slice(0, -1)), 7_000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ── The minimap ───────────────────────────────────────────────────────────
  const plan = useMemo(() => (data ? planWorld(data) : null), [data]);
  useEffect(() => {
    if (!plan) return;
    const canvas = minimapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let stopped = false;
    let timer = 0;
    const draw = () => {
      if (stopped) return;
      timer = window.setTimeout(() => requestAnimationFrame(draw), 120);
      const w = canvas.width;
      const h = canvas.height;
      const scale = Math.min(w, h) / (2 * Math.hypot(plan.halfX, plan.halfZ)) * 1.05;
      const dark = document.documentElement.classList.contains('dark');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // The way the view faces: the minimap turns with it.
      ctx.setTransform(scale, 0, 0, scale, w / 2, h / 2);
      ctx.rotate(yawRef.current);
      ctx.fillStyle = dark ? '#2a303c' : '#f1ece3';
      ctx.fillRect(-plan.halfX, -plan.halfZ, plan.halfX * 2, plan.halfZ * 2);
      for (const d of plan.districts) {
        ctx.fillStyle = d.key === district ? (dark ? '#5b8def' : '#9bb8f2') : dark ? '#3c4452' : '#ddd5c8';
        ctx.fillRect(d.center.x - d.width / 2, d.center.z - d.depth / 2, d.width, d.depth);
      }
      const p = avatarRef.current;
      ctx.fillStyle = '#f0a14a';
      ctx.beginPath();
      ctx.arc(p.x, p.z, 4 / scale, 0, Math.PI * 2);
      ctx.fill();
    };
    draw();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [plan, district]);

  const onMinimap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!plan) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = e.currentTarget.width;
    const h = e.currentTarget.height;
    const scale = Math.min(w, h) / (2 * Math.hypot(plan.halfX, plan.halfZ)) * 1.05;
    const u = ((e.clientX - rect.left) * (w / rect.width) - w / 2) / scale;
    const v = ((e.clientY - rect.top) * (h / rect.height) - h / 2) / scale;
    // Undo the minimap's turn.
    const yaw = yawRef.current;
    const x = u * Math.cos(yaw) + v * Math.sin(yaw);
    const z = -u * Math.sin(yaw) + v * Math.cos(yaw);
    const hit = plan.districts.find((d) => Math.abs(x - d.center.x) <= d.width / 2 && Math.abs(z - d.center.z) <= d.depth / 2);
    if (hit) engineRef.current?.jump(hit.key);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  const closeHelp = () => {
    setShowHelp(false);
    writeStorage(HELP_KEY, '1');
  };

  // What the panel shows: the thing picked, else the thing under the pointer, else where the figure stands.
  const card: (Card & { id: string }) | null = useMemo(() => {
    if (!data) return null;
    for (const id of [selected, hovered]) {
      if (!id) continue;
      const c = thingCard(id, data);
      if (c) return { ...c, id };
    }
    const key = district ?? 'hq';
    if (key !== 'hq' && !plan?.districts.some((d) => d.key === key)) return null;
    return { ...districtCard(key, data), id: `district:${key}` };
  }, [data, selected, hovered, district, plan]);

  const districts = plan?.districts.map((d) => d.key) ?? [];

  return (
    <div
      ref={frameRef}
      dir="rtl"
      className={cn(
        'relative isolate overflow-hidden rounded-xl border bg-card',
        fullscreen ? 'h-screen w-screen rounded-none border-0' : 'h-[calc(100dvh-10.5rem)] md:h-[calc(100dvh-6.5rem)]',
      )}
    >
      <div ref={canvasRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto rounded-xl border bg-card/90 px-2.5 py-1.5 shadow-sm backdrop-blur md:px-3 md:py-2">
          <h1 className="hidden text-[15px] font-semibold leading-6 md:block">دنیای کسب‌وکار</h1>
          <p className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted-foreground" title={updatedAt ? `به‌روز شده ${ago(new Date(updatedAt).toISOString(), now)}` : undefined}>
            <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', error ? 'bg-amber-500' : 'animate-pulse bg-emerald-500')} />
            {error ? (
              <span className="max-w-[12rem] truncate md:max-w-none">{error}</span>
            ) : updatedAt ? (
              <span>زنده<span className="hidden md:inline"> · به‌روز شده {ago(new Date(updatedAt).toISOString(), now)}</span></span>
            ) : (
              'در حال خواندن…'
            )}
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-card/90 p-1 shadow-sm backdrop-blur">
          <IconButton label="چرخش به چپ (Q)" onClick={() => engineRef.current?.rotate(-1)}><RotateCcw className="h-4 w-4" /></IconButton>
          <IconButton label="چرخش به راست (E)" onClick={() => engineRef.current?.rotate(1)}><RotateCw className="h-4 w-4" /></IconButton>
          <IconButton label="بزرگ‌نمایی (+)" onClick={() => engineRef.current?.zoomBy(1.25)}><Plus className="h-4 w-4" /></IconButton>
          <IconButton label="کوچک‌نمایی (−)" onClick={() => engineRef.current?.zoomBy(0.8)}><Minus className="h-4 w-4" /></IconButton>
          <IconButton label="کل نقشه" onClick={() => engineRef.current?.overview()}><LocateFixed className="h-4 w-4" /></IconButton>
          <span className="hidden md:contents">
            <IconButton label="فعالیت‌ها" onClick={() => setShowFeed((v) => !v)} active={showFeed}><Activity className="h-4 w-4" /></IconButton>
          </span>
          <IconButton label="راهنما" onClick={() => setShowHelp(true)}><HelpCircle className="h-4 w-4" /></IconButton>
          <IconButton label={fullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'} onClick={toggleFullscreen}>
            {fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </IconButton>
        </div>
      </div>

      {/* New events, as they happen */}
      <div className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-1.5 px-3">
        {toasts.map((e) => (
          <div key={e.id} className="rounded-full border border-amber-300 bg-card/95 px-3 py-1 text-[12px] font-medium shadow-md">
            <span className="text-amber-600">تازه · </span>
            {eventLine(e)}
          </div>
        ))}
      </div>

      {/* The card of what is picked, hovered, or around the figure */}
      {card && (
        <div
          className={cn(
            'absolute bottom-[3.75rem] right-3 max-h-[45%] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-auto md:top-20 md:block md:max-h-[calc(100%-10rem)]',
            !selected && 'hidden',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className={cn('truncate text-[14px] font-semibold', card.tone === 'bad' && 'text-red-600', card.tone === 'warn' && 'text-amber-600', card.tone === 'good' && 'text-emerald-600')}>
                {card.title}
              </h2>
              {card.subtitle && <p className="truncate text-[12px] text-muted-foreground">{card.subtitle}</p>}
            </div>
            {selected && (
              <button type="button" onClick={() => engineRef.current?.select(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="بستن">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <dl className="mt-2 space-y-1 text-[12.5px]">
            {card.rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-left font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {card.href && canAccessRoute(role, card.href.split('?')[0]) && (
            <Link href={card.href} className="mt-2.5 inline-block text-[12.5px] font-medium text-primary hover:underline">
              باز کردن صفحه ←
            </Link>
          )}
        </div>
      )}

      {/* Activity of the last 7 days */}
      {showFeed && data && (
        <div className="absolute left-3 top-20 hidden w-72 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur md:block">
          <h2 className="text-[13px] font-semibold">فعالیت‌های اخیر</h2>
          {data.events.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">در ۷ روز اخیر فعالیتی ثبت نشده است.</p>
          ) : (
            <ul className="mt-2 max-h-[min(16rem,32vh)] space-y-1 overflow-y-auto">
              {data.events.slice(0, 20).map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => engineRef.current?.goTo(placeThing(e.to))}
                    className="w-full rounded-md px-1.5 py-1 text-right text-[12px] hover:bg-muted"
                  >
                    <span className="block truncate font-medium">{eventLine(e)}</span>
                    <span className="text-[11px] text-muted-foreground">{EVENT_LABELS[e.kind]} · {ago(e.at, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Minimap */}
      {plan && (
        <canvas
          ref={minimapRef}
          width={176}
          height={132}
          onClick={onMinimap}
          className="absolute bottom-[4.5rem] left-3 hidden cursor-pointer rounded-lg border bg-card/90 shadow-sm md:block"
          aria-label="نقشهٔ کوچک: برای رفتن به یک بخش رویش بزنید"
        />
      )}

      {/* Districts: a tap goes there */}
      <div className="absolute inset-x-0 bottom-0 flex gap-1.5 overflow-x-auto p-3 [scrollbar-width:none]">
        {districts.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => engineRef.current?.jump(key)}
            className={cn(
              'shrink-0 rounded-full border bg-card/95 px-3 py-1.5 text-[12.5px] font-medium shadow-sm backdrop-blur transition-colors hover:bg-muted',
              district === key && 'border-primary text-primary',
            )}
          >
            {DISTRICT_LABELS[key]}
          </button>
        ))}
      </div>

      {!data && !error && !webglFailed && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">در حال ساختن دنیا…</div>
      )}

      {webglFailed && data && (
        <div className="absolute inset-0 overflow-y-auto bg-card p-4">
          <p className="mb-3 text-[13px] text-muted-foreground">این مرورگر نقشهٔ سه‌بعدی را نمی‌تواند نشان دهد. خلاصهٔ همان داده‌ها:</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {districts.map((key) => {
              const c = districtCard(key, data);
              return (
                <div key={key} className="rounded-xl border p-3">
                  <h2 className="text-[14px] font-semibold">{c.title}</h2>
                  <dl className="mt-1 space-y-1 text-[12.5px]">
                    {c.rows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showHelp && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="راهنما">
          <div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-lg">
            <h2 className="text-[15px] font-semibold">چطور بگردیم؟</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-6">
              <li><b>راه رفتن:</b> کلیدهای W A S D یا فلش‌ها؛ با Shift تندتر. یا روی زمین بزنید.</li>
              <li><b>دیدن جزئیات:</b> روی هر چیز (انبار، کالا، حساب، تأمین‌کننده، مشتری…) بزنید.</li>
              <li><b>جابه‌جایی نما:</b> نقشه را بکشید؛ با چرخ ماوس یا دو انگشت بزرگ و کوچک کنید؛ Q و E می‌چرخانند.</li>
              <li><b>رفتن به یک بخش:</b> دکمه‌های پایین صفحه یا نقشهٔ کوچک.</li>
              <li><b>زنده:</b> هر ۲۰ ثانیه تازه می‌شود؛ کار تازه به شکل بستهٔ درخشان روی نقشه می‌رود.</li>
            </ul>
            <button type="button" onClick={closeHelp} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground">
              بزن بریم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn('grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', active && 'bg-muted text-foreground')}
    >
      {children}
    </button>
  );
}
