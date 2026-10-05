'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, CloudRain, Cloud, Expand, HelpCircle, Home, Minus, Pause, Play, Plus, RotateCcw, RotateCw,
  Search, Shrink, Sparkles, Sun, Users, Volume2, VolumeX, X, Clapperboard, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { canAccessRoute } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { tomanTick } from '@/lib/chart-format';
import type { WorldData, WorldEvent } from '@/lib/world-types';
import type { WorldHistory } from '@/lib/world-history';
import { DISTRICT_LABELS, planCity, type DistrictKey, type Point } from '@/components/world/world-city';
import { ago, CHANNEL_LABELS, districtCard, EVENT_LABELS, eventLine, thingCard, type Card } from '@/components/world/world-describe';
import { buildIssues, businessWeather, chime, dayView, orderSteps, searchWorld, type Issue } from '@/components/world/world-hud';
import type { WorldEngine } from '@/components/world/world-engine';

/** How often the world asks for a fresh snapshot while the tab is in view. */
const POLL_MS = 20_000;
/** One of the last 7 days' events crosses the map this often, round and round. */
const REPLAY_MS = 1_700;
const PRESENCE_MS = 3_000;
const TOUR_MS = 6_500;
const HELP_KEY = 'erp-world-help-seen-v2';
const SOUND_KEY = 'erp-world-sound';
const EFFECTS_KEY = 'erp-world-effects';

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');

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
    // A private window: forgotten next time.
  }
}

/** The thing an event's destination stands for, so a click in the feed goes there. */
function placeThing(place: string): string {
  if (place.startsWith('wh:')) return `warehouse:${place.slice(3)}`;
  if (place.startsWith('sup:')) return `supplier:${place.slice(4)}`;
  if (place === 'site') return 'site';
  if (place === 'customers' || place === 'treasury' || place === 'hq') return `district:${place}`;
  return 'district:hq';
}

const KIND_LABELS: Record<string, string> = {
  warehouse: 'انبار',
  product: 'کالا',
  account: 'حساب',
  supplier: 'تأمین‌کننده',
  customer: 'مشتری',
  crowd: 'مشتری‌ها',
  site: 'وب‌سایت',
  office: 'دفتر',
  port: 'بندر',
  home: 'خانه‌ها',
  day: 'روز فروش',
  top: 'پرفروش',
  flow: 'جریان پول',
  district: 'منطقه',
};

const TOUR: DistrictKey[] = ['hq', 'warehouse', 'consignment', 'treasury', 'site', 'customers', 'port', 'suppliers'];

export function WorldClient({ role }: { role: string | null }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const seenRef = useRef<Set<string> | null>(null);
  const replayRef = useRef(0);
  const viewRef = useRef<{ p: Point; yaw: number }>({ p: { x: 0, z: 0 }, yaw: 0 });
  const audioRef = useRef<AudioContext | null>(null);
  const dayRef = useRef<number | null>(null);

  const [data, setData] = useState<WorldData | null>(null);
  const [history, setHistory] = useState<WorldHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [district, setDistrict] = useState<DistrictKey | null>(null);
  const [toasts, setToasts] = useState<WorldEvent[]>([]);
  const [tab, setTab] = useState<'events' | 'places' | 'issues'>('events');
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sound, setSound] = useState(false);
  const [effects, setEffects] = useState(true);
  const [tour, setTour] = useState(false);
  const [day, setDay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [people, setPeople] = useState<Array<{ userId: string; name: string; district: string | null }>>([]);
  const [query, setQuery] = useState('');
  const [orderIndex, setOrderIndex] = useState(0);
  const [picker, setPicker] = useState(false);

  // ── The engine ────────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let engine: WorldEngine | null = null;
    import('@/components/world/world-engine')
      .then(({ WorldEngine }) => {
        if (disposed || !canvasRef.current || !labelsRef.current) return;
        try {
          engine = new WorldEngine(
            canvasRef.current,
            labelsRef.current,
            {
              onHover: setHovered,
              onSelect: setSelected,
              onDistrict: (key) => setDistrict(key),
              onView: (p, yaw) => {
                viewRef.current = { p, yaw };
              },
            },
            document.documentElement.classList.contains('dark'),
          );
          engineRef.current = engine;
          if (readStorage(EFFECTS_KEY) === 'off') {
            engine.setEffects(false);
            setEffects(false);
          } else setEffects(engine.effectsOn);
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
    setSound(readStorage(SOUND_KEY) === 'on');
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
      const live = dayRef.current === null;
      if (seen && live) {
        const fresh = next.events.filter((e) => !seen.has(e.id)).reverse();
        if (fresh.length) {
          for (const e of fresh.slice(-6)) engineRef.current?.spawn(e, true);
          setToasts((t) => [...fresh.slice(-3).reverse(), ...t].slice(0, 3));
          if (audioRef.current && fresh.some((e) => e.kind === 'order' || e.kind === 'income')) chime(audioRef.current);
        }
      }
      seenRef.current = new Set(next.events.map((e) => e.id));
      if (live) engineRef.current?.setData(next);
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

  // The time machine's past, read now and again.
  useEffect(() => {
    let stop = false;
    const read = async () => {
      try {
        const res = await fetch('/api/world/history', { cache: 'no-store' });
        if (res.ok && !stop) setHistory((await res.json()) as WorldHistory);
      } catch {
        // No past this time: the slider waits.
      }
    };
    read();
    const timer = window.setInterval(read, 10 * 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  // Who else is here: report where this view is, show everyone else.
  useEffect(() => {
    let stop = false;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { p, yaw } = viewRef.current;
        const res = await fetch('/api/world/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: Number(p.x.toFixed(1)), z: Number(p.z.toFixed(1)), yaw: Number(yaw.toFixed(2)), district }),
        });
        if (!res.ok || stop) return;
        const { others } = await res.json();
        engineRef.current?.setPeople(others);
        setPeople(others.map((o: any) => ({ userId: o.userId, name: o.name, district: o.district })));
      } catch {
        // The next beat tries again.
      }
    };
    const timer = window.setInterval(beat, PRESENCE_MS);
    beat();
    return () => {
      stop = true;
      window.clearInterval(timer);
      fetch('/api/world/presence', { method: 'DELETE', keepalive: true }).catch(() => {});
    };
  }, [district]);

  // The last 7 days, replayed one by one (live only).
  useEffect(() => {
    if (!data?.events.length || day !== null) return;
    const ordered = [...data.events].reverse();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const event = ordered[replayRef.current % ordered.length];
      replayRef.current += 1;
      engineRef.current?.spawn(event);
    }, REPLAY_MS);
    return () => window.clearInterval(timer);
  }, [data, day]);

  // The time machine: a past day on the map, or back to now.
  useEffect(() => {
    dayRef.current = day;
    if (!data) return;
    if (day === null || !history) engineRef.current?.setData(data);
    else {
      const view = dayView(data, history, day);
      engineRef.current?.setData(view);
      for (const e of view.events.slice(0, 8)) engineRef.current?.spawn(e);
    }
  }, [day, history]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing || !history) return;
    const timer = window.setInterval(() => {
      setDay((d) => {
        const next = (d ?? 0) + 1;
        if (next >= history.days.length - 1) {
          setPlaying(false);
          return null;
        }
        return next;
      });
    }, 1_400);
    return () => window.clearInterval(timer);
  }, [playing, history]);

  // The tour: one district after another, until anything is touched.
  useEffect(() => {
    if (!tour || !data) return;
    const keys = TOUR.filter((k) => planCity(data).districts.some((d) => d.key === k));
    let i = 0;
    const next = () => engineRef.current?.jump(keys[i++ % keys.length]);
    next();
    const timer = window.setInterval(next, TOUR_MS);
    const stop = () => setTour(false);
    const frame = frameRef.current;
    frame?.addEventListener('pointerdown', stop, { capture: true });
    window.addEventListener('keydown', stop);
    return () => {
      window.clearInterval(timer);
      frame?.removeEventListener('pointerdown', stop, { capture: true });
      window.removeEventListener('keydown', stop);
    };
  }, [tour]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    writeStorage(SOUND_KEY, on ? 'on' : 'off');
    if (on) {
      try {
        audioRef.current ??= new AudioContext();
        chime(audioRef.current);
      } catch {
        // No audio here.
      }
    }
  };

  const toggleEffects = () => {
    const on = !effects;
    engineRef.current?.setEffects(on);
    setEffects(on);
    writeStorage(EFFECTS_KEY, on ? 'on' : 'off');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  const go = (id: string) => {
    setTour(false);
    engineRef.current?.goTo(id);
  };

  const plan = useMemo(() => (data ? planCity(data) : null), [data]);
  const issues = useMemo(() => (data ? buildIssues(data) : []), [data]);
  const hits = useMemo(() => (data ? searchWorld(data, query) : []), [data, query]);
  const weather = useMemo(() => (data ? businessWeather(data) : null), [data]);
  const shown = useMemo(() => (data && history && day !== null ? dayView(data, history, day) : data), [data, history, day]);

  // The panel: what is picked, else under the pointer, else the district in view, else the whole business.
  const card: (Card & { id: string }) | null = useMemo(() => {
    if (!shown) return null;
    for (const id of [selected, hovered]) {
      if (!id) continue;
      const c = thingCard(id, shown, plan);
      if (c) return { ...c, id };
    }
    const key = district && plan?.districts.some((d) => d.key === district) ? district : 'hq';
    return { ...districtCard(key, shown), id: `district:${key}` };
  }, [shown, selected, hovered, district, plan]);

  const recent = shown?.sales?.recentOrders ?? [];
  const order = recent.length ? recent[Math.min(orderIndex, recent.length - 1)] : null;
  const districtsHere = plan?.districts.map((d) => d.key) ?? [];
  const tehranTime = new Date(now).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });
  const glass = 'rounded-2xl bg-white/90 shadow-[0_8px_30px_rgba(15,23,42,0.10)] ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/85 dark:ring-white/10';
  const dayLabel = history && day !== null ? new Date(`${history.days[day]}T12:00:00+03:30`).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }) : null;
  const metric = (key: DistrictKey): string | null => {
    if (!shown) return null;
    if (key === 'warehouse') return shown.stock ? `${fa(shown.stock.warehouses.filter((w) => !w.virtual).reduce((s, w) => s + w.units, 0))} عدد` : null;
    if (key === 'consignment') return shown.stock ? `${fa(shown.stock.warehouses.filter((w) => w.virtual).length)} فروشگاه` : null;
    if (key === 'treasury') return shown.finance ? tomanTick(shown.finance.total) : null;
    if (key === 'customers') return shown.customers ? `${fa(shown.customers.total)} مشتری` : null;
    if (key === 'suppliers') return shown.suppliers ? `${fa(shown.suppliers.suppliers.length)} کارخانه` : null;
    return null;
  };
  const yesterday = shown?.sales?.days.at(-2)?.total ?? 0;

  return (
    <div
      ref={frameRef}
      dir="rtl"
      className={cn(
        'relative isolate overflow-hidden bg-[#e9eff7] dark:bg-[#111723]',
        fullscreen ? 'h-screen w-screen' : 'h-[calc(100dvh-10.5rem)] rounded-2xl border md:h-[calc(100dvh-6.5rem)]',
      )}
    >
      <div ref={canvasRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className={cn('absolute inset-x-3 top-3 z-10 flex items-center gap-2 px-2.5 py-2', glass)}>
        <div className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2f6fe0] text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="currentColor" d="M2 9.5h20v1.2l-1 .3-.6 3.3a3 3 0 0 1-3 2.5h-1.9a3 3 0 0 1-2.9-2.2L12 12.4l-.6 2.2a3 3 0 0 1-2.9 2.2H6.6a3 3 0 0 1-3-2.5L3 11l-1-.3z" /></svg>
          </span>
          <div className="hidden leading-tight lg:block">
            <div className="text-[14px] font-bold">دنیای دموک</div>
            <div className="text-[11px] text-muted-foreground">کسب‌وکار، زنده</div>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 md:max-w-sm">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) {
                go(hits[0].id);
                setQuery('');
              }
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="جستجوی کالا، فروشگاه، مشتری، تأمین‌کننده…"
            className="h-9 w-full rounded-xl bg-slate-100/80 pr-8 pl-3 text-[13px] outline-none ring-[#2f6fe0]/40 placeholder:text-muted-foreground focus:ring-2 dark:bg-slate-800/80"
            aria-label="جستجو در دنیا"
          />
          {hits.length > 0 && (
            <ul className={cn('absolute inset-x-0 top-11 max-h-72 overflow-y-auto p-1', glass)}>
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => { go(h.id); setQuery(''); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-right text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="truncate font-medium">{h.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{h.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="relative hidden md:block">
          <button type="button" onClick={() => setPicker((v) => !v)} className="flex h-9 items-center gap-2 rounded-xl bg-slate-100/80 px-2.5 text-[13px] dark:bg-slate-800/80">
            <span className="rounded-md bg-[#2f6fe0] px-1.5 py-0.5 text-[10.5px] font-bold text-white">{district ? '●' : 'همه'}</span>
            <span className="font-semibold">{district ? DISTRICT_LABELS[district] : 'کل کسب‌وکار'}</span>
            {district && metric(district) && <span className="text-[11.5px] text-muted-foreground">{metric(district)}</span>}
          </button>
          {picker && (
            <ul className={cn('absolute right-0 top-11 w-64 p-1', glass)}>
              <li>
                <button type="button" onClick={() => { engineRef.current?.overview(); setPicker(false); }} className="flex w-full justify-between rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800">
                  <span className="font-medium">کل کسب‌وکار</span>
                </button>
              </li>
              {districtsHere.map((key) => (
                <li key={key}>
                  <button type="button" onClick={() => { setTour(false); engineRef.current?.jump(key); setPicker(false); }} className="flex w-full justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="font-medium">{DISTRICT_LABELS[key]}</span>
                    <span className="text-[11.5px] text-muted-foreground">{metric(key)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mr-auto flex shrink-0 items-center gap-1.5">
          {weather && (
            <span className="hidden items-center gap-1 rounded-full bg-slate-100/80 px-2 py-1 text-[11.5px] md:flex dark:bg-slate-800/80" title={weather.change === null ? 'فروش ۳۰ روز قبل برای مقایسه نیست' : `فروش ۳۰ روز ${fa(Math.abs(weather.change * 100))}٪ ${weather.change >= 0 ? 'بیشتر' : 'کمتر'} از ۳۰ روز قبل`}>
              {weather.weather === 'sunny' ? <Sun className="h-3.5 w-3.5 text-amber-500" /> : weather.weather === 'cloudy' ? <Cloud className="h-3.5 w-3.5 text-slate-500" /> : <CloudRain className="h-3.5 w-3.5 text-sky-600" />}
              {weather.change === null ? 'آفتابی' : `${weather.change >= 0 ? '+' : '−'}${fa(Math.abs(weather.change * 100))}٪`}
              {weather.rainbow && <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" />}
            </span>
          )}
          {people.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11.5px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" title={people.map((p) => p.name).join('، ')}>
              <Users className="h-3.5 w-3.5" />
              {fa(people.length + 1)}
            </span>
          )}
          <button type="button" onClick={() => setTab('issues')} className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" title="مشکلات امروز" aria-label="مشکلات امروز">
            <Bell className="h-4 w-4" />
            {issues.length > 0 && <span className="absolute -left-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{fa(Math.min(99, issues.length))}</span>}
          </button>
          <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-medium', error ? 'bg-amber-50 text-amber-800' : day !== null ? 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200')} title={updatedAt ? `به‌روز شده ${ago(new Date(updatedAt).toISOString(), now)}` : undefined}>
            <span className={cn('h-2 w-2 rounded-full', error ? 'bg-amber-500' : day !== null ? 'bg-violet-500' : 'animate-pulse bg-emerald-500')} />
            {error ? 'قطع' : day !== null ? 'گذشته' : 'زنده'} <span className="tabular-nums">{tehranTime}</span>
          </span>
        </div>
      </div>

      {/* ── Figures ─────────────────────────────────────────────────────── */}
      {shown && (
        <div className="absolute right-3 top-[4.4rem] z-0 flex max-w-[calc(100%-1.5rem)] gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:max-w-[calc(100%-24rem)]">
          {shown.stock && (
            <Kpi glass={glass} label="موجودی کالا" value={fa(shown.stock.totals.units)} unit="عدد" note={`${fa(shown.stock.totals.low)} کم · ${fa(shown.stock.totals.out)} ناموجود`} tone={shown.stock.totals.out ? 'warn' : 'ok'} />
          )}
          {shown.sales && (
            <Kpi glass={glass} label={day !== null ? 'فروش آن روز' : 'فروش امروز'} value={tomanTick(shown.sales.today.total)} unit="تومان" note={`${fa(shown.sales.today.orders)} سفارش`} delta={day === null && yesterday > 0 ? (shown.sales.today.total - yesterday) / yesterday : undefined} />
          )}
          {shown.sales && day === null && (
            <Kpi glass={glass} label="فروش ۳۰ روز" value={tomanTick(shown.sales.window.total)} unit="تومان" note={`${fa(shown.sales.window.orders)} سفارش`} delta={weather?.change ?? undefined} />
          )}
          {shown.finance && <Kpi glass={glass} label="موجودی کل" value={tomanTick(shown.finance.total)} unit="تومان" note={`${fa(shown.finance.accounts.length)} حساب`} />}
        </div>
      )}

      {/* ── The panel: what is picked, under the pointer, or in view ───── */}
      {card && (
        <div className={cn('absolute z-10 overflow-y-auto p-3.5', glass, 'inset-x-3 bottom-3 max-h-[46%] md:inset-x-auto md:bottom-auto md:left-3 md:top-[4.4rem] md:max-h-[calc(100%-22rem)] md:w-[20rem]', !selected && 'hidden md:block')}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded-md bg-[#2f6fe0]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#2f6fe0]">{KIND_LABELS[card.id.split(':')[0]] ?? 'منطقه'}</span>
                {card.tone && <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold', card.tone === 'good' && 'bg-emerald-50 text-emerald-700', card.tone === 'warn' && 'bg-amber-50 text-amber-700', card.tone === 'bad' && 'bg-red-50 text-red-700')}>{card.tone === 'good' ? 'سالم' : card.tone === 'warn' ? 'نیاز به توجه' : 'مشکل'}</span>}
              </div>
              <h2 className="truncate text-[16px] font-bold leading-6">{card.title}</h2>
              {card.subtitle && <p className="truncate text-[12px] text-muted-foreground">{card.subtitle}</p>}
            </div>
            {selected && (
              <button type="button" onClick={() => engineRef.current?.select(null)} className="rounded-lg p-1 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="بستن">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {card.rows.slice(0, 4).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
                <dt className="truncate text-[11px] text-muted-foreground">{k}</dt>
                <dd className="break-words text-[13px] font-bold leading-5 tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {card.rows.length > 4 && (
            <dl className="mt-2 space-y-1 text-[12.5px]">
              {card.rows.slice(4).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-left font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {shown && <Inventory id={card.id} data={shown} onPick={go} />}
          {card.href && canAccessRoute(role, card.href.split('?')[0]) && (
            <Link href={card.href} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#2f6fe0] hover:underline">
              باز کردن صفحه <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className={cn('absolute right-3 top-[9.2rem] z-10 flex flex-col gap-0.5 p-1 md:left-[21.5rem] md:right-auto md:top-[4.4rem]', glass)}>
        <Ctl label="نزدیک‌تر (+)" onClick={() => engineRef.current?.zoomBy(1.4)}><Plus className="h-4 w-4" /></Ctl>
        <Ctl label="دورتر (−)" onClick={() => engineRef.current?.zoomBy(1 / 1.4)}><Minus className="h-4 w-4" /></Ctl>
        <Ctl label="چرخش (Q)" onClick={() => engineRef.current?.rotate(-1)}><RotateCcw className="h-4 w-4" /></Ctl>
        <Ctl label="چرخش (E)" onClick={() => engineRef.current?.rotate(1)}><RotateCw className="h-4 w-4" /></Ctl>
        <Ctl label="کل نقشه (Home)" onClick={() => { setTour(false); engineRef.current?.overview(); }}><Home className="h-4 w-4" /></Ctl>
        <span className="mx-1 my-0.5 h-px bg-slate-200 dark:bg-slate-700" />
        <Ctl label={tour ? 'توقف تور' : 'تور سینمایی'} active={tour} onClick={() => setTour((t) => !t)}><Clapperboard className="h-4 w-4" /></Ctl>
        <Ctl label={sound ? 'بی‌صدا' : 'صدای فروش'} active={sound} onClick={toggleSound}>{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Ctl>
        <Ctl label={effects ? 'خاموش کردن جلوه‌ها' : 'روشن کردن جلوه‌ها'} active={effects} onClick={toggleEffects}><Sparkles className="h-4 w-4" /></Ctl>
        <Ctl label="راهنما" onClick={() => setShowHelp(true)}><HelpCircle className="h-4 w-4" /></Ctl>
        <Ctl label={fullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'} onClick={toggleFullscreen}>{fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</Ctl>
      </div>

      {/* ── Order tracker ───────────────────────────────────────────────── */}
      {order && (
        <div className={cn('absolute bottom-3 right-3 z-10 hidden w-[31rem] p-3.5 xl:block', glass)}>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px] font-bold">پیگیری سفارش</div>
            <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <button type="button" className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800" disabled={orderIndex <= 0} onClick={() => setOrderIndex((i) => Math.max(0, i - 1))} aria-label="سفارش جدیدتر"><ChevronRight className="h-4 w-4" /></button>
              <span className="tabular-nums">{fa(Math.min(orderIndex, recent.length - 1) + 1)} از {fa(recent.length)}</span>
              <button type="button" className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800" disabled={orderIndex >= recent.length - 1} onClick={() => setOrderIndex((i) => Math.min(recent.length - 1, i + 1))} aria-label="سفارش قدیمی‌تر"><ChevronLeft className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex items-stretch gap-3">
            <ol className="flex flex-1 items-start">
              {orderSteps(order).map((s, i, all) => (
                <li key={s.label} className="relative flex flex-1 flex-col items-center text-center">
                  {i < all.length - 1 && <span className={cn('absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2', s.state === 'done' ? 'bg-[#2f6fe0]' : 'bg-slate-200 dark:bg-slate-700')} />}
                  <span className={cn('relative z-10 grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold', s.state === 'done' && 'bg-[#2f6fe0] text-white', s.state === 'now' && 'bg-white text-[#2f6fe0] ring-2 ring-[#2f6fe0] dark:bg-slate-900', s.state === 'todo' && 'bg-slate-100 text-slate-400 dark:bg-slate-800', s.state === 'off' && 'bg-red-50 text-red-500')}>
                    {s.state === 'done' ? '✓' : fa(i + 1)}
                  </span>
                  <span className="mt-1 text-[11px] font-medium leading-4">{s.label}</span>
                  {s.note && <span className="text-[10.5px] text-muted-foreground">{s.note}</span>}
                </li>
              ))}
            </ol>
            <div className="w-36 shrink-0 rounded-xl bg-slate-50 p-2.5 text-[12px] dark:bg-slate-800/60">
              <div className="font-bold">#{fa(order.number)}</div>
              <div className="truncate text-muted-foreground">{order.customer ?? 'فروش بی‌نام'}</div>
              <div className="mt-1 font-semibold tabular-nums">{tomanTick(order.net)} تومان</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', order.status === 'CANCELLED' ? 'bg-red-500' : order.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-500')} />
                {CHANNEL_LABELS[order.channel]} · {ago(order.createdAt, now)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lists: activity, places, problems ───────────────────────────── */}
      {shown && (
        <div className={cn('absolute bottom-3 left-3 z-10 hidden h-[17rem] w-[20rem] flex-col p-2.5 md:flex', glass)}>
          <div className="mb-2 flex gap-1 rounded-xl bg-slate-100/80 p-1 text-[12px] font-semibold dark:bg-slate-800/70">
            {([['events', 'فعالیت‌ها', shown.events.length], ['places', 'انبارها', shown.stock?.warehouses.length ?? 0], ['issues', 'مشکلات', issues.length]] as const).map(([key, label, count]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={cn('flex flex-1 items-center justify-center gap-1 rounded-lg py-1', tab === key ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-muted-foreground')}>
                {label}
                <span className={cn('rounded-full px-1.5 text-[10.5px]', key === 'issues' && count ? 'bg-red-100 text-red-700' : 'bg-slate-200/70 dark:bg-slate-700')}>{fa(count)}</span>
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {tab === 'events' &&
              (shown.events.length === 0 ? (
                <li className="p-2 text-[12px] text-muted-foreground">{day !== null ? 'در این روز فعالیتی نیست (فقط ۷ روز اخیر ثبت است).' : 'در ۷ روز اخیر فعالیتی ثبت نشده است.'}</li>
              ) : (
                shown.events.slice(0, 30).map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => go(placeThing(e.to))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-slate-100 dark:hover:bg-slate-800">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: EVENT_DOT[e.kind] }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{eventLine(e)}</span>
                        <span className="text-[11px] text-muted-foreground">{EVENT_LABELS[e.kind]} · {ago(e.at, now)}</span>
                      </span>
                    </button>
                  </li>
                ))
              ))}
            {tab === 'places' &&
              (shown.stock?.warehouses ?? []).map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => go(`warehouse:${w.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{w.partner ?? w.name}</span>
                      <span className="text-[11px] text-muted-foreground">{w.virtual ? 'فروشگاه امانی' : 'انبار'} · {fa(w.products)} کالا</span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-[12px] font-bold tabular-nums dark:bg-slate-800">{fa(w.units)}</span>
                  </button>
                </li>
              ))}
            {tab === 'issues' &&
              (issues.length === 0 ? (
                <li className="p-2 text-[12px] text-muted-foreground">امروز مشکلی دیده نمی‌شود.</li>
              ) : (
                issues.slice(0, 60).map((issue: Issue) => (
                  <li key={issue.key}>
                    <button type="button" onClick={() => go(issue.target)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-right hover:bg-slate-100 dark:hover:bg-slate-800">
                      <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', issue.tone === 'bad' ? 'text-red-500' : 'text-amber-500')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium">{issue.title}</span>
                        <span className="text-[11px] text-muted-foreground">{issue.detail}</span>
                      </span>
                      <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))
              ))}
          </ul>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5 text-[10.5px] text-muted-foreground dark:border-slate-700">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#e0443e]" />طلب ما</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#f2a33a]" />بدهی ما</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#d9534f]" />ناموجود</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#f0a14a]" />کم</span>
          </div>
        </div>
      )}

      {/* ── Time machine ────────────────────────────────────────────────── */}
      {history && history.days.length > 1 && (
        <div className={cn('absolute bottom-3 left-1/2 z-10 flex w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-2 px-3 py-2 md:left-[22rem] md:right-3 md:w-auto md:translate-x-0 xl:right-[33rem]', glass, selected && 'hidden md:flex')}>
          <button type="button" onClick={() => { if (playing) setPlaying(false); else { setDay((d) => (d === null ? 0 : d)); setPlaying(true); } }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2f6fe0] text-white" aria-label={playing ? 'توقف' : 'پخش ۳۰ روز'}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={history.days.length - 1}
              value={day ?? history.days.length - 1}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPlaying(false);
                setDay(v >= history.days.length - 1 ? null : v);
              }}
              className="w-full accent-[#2f6fe0]"
              dir="ltr"
              aria-label="ماشین زمان: ۳۰ روز گذشته"
            />
            <div className="flex justify-between text-[10.5px] text-muted-foreground">
              <span>{dayLabel ?? 'امروز، زنده'}</span>
              <span>ماشین زمان · ۳۰ روز</span>
            </div>
          </div>
          {day !== null && (
            <button type="button" onClick={() => { setPlaying(false); setDay(null); }} className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
              زنده
            </button>
          )}
        </div>
      )}

      {/* ── New events, as they happen ──────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-x-0 top-[4.6rem] z-20 flex flex-col items-center gap-1.5 px-3">
        {toasts.map((e) => (
          <div key={e.id} className="rounded-full border border-amber-300 bg-white/95 px-3 py-1 text-[12px] font-medium shadow-lg dark:bg-slate-900/95">
            <span className="text-amber-600">تازه · </span>
            {eventLine(e)}
          </div>
        ))}
      </div>

      {!data && !error && !webglFailed && <div className="absolute inset-0 grid place-items-center text-[13px] text-muted-foreground">در حال ساختن شهر…</div>}

      {webglFailed && data && (
        <div className="absolute inset-0 z-30 overflow-y-auto bg-card p-4 pt-20">
          <p className="mb-3 text-[13px] text-muted-foreground">این مرورگر نقشهٔ سه‌بعدی را نمی‌تواند نشان دهد. خلاصهٔ همان داده‌ها:</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {districtsHere.map((key) => {
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
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="راهنما">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
            <h2 className="text-[16px] font-bold">به دنیای دموک خوش آمدید</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">کل کسب‌وکار، زنده: هر ۲۰ ثانیه تازه می‌شود.</p>
            <ul className="mt-3 space-y-1.5 text-[13px] leading-6">
              <li><b>جابه‌جایی:</b> نقشه را بکشید یا W A S D. <b>چرخش:</b> کلیک راست و کشیدن، دو انگشت، یا Q و E. <b>بزرگ‌نمایی:</b> چرخ ماوس یا دو انگشت.</li>
              <li><b>جزئیات:</b> روی هر چیز بزنید: انبار، پالت هر کالا، فروشگاه، حساب، کارخانه، خانهٔ مشتری. دوبار کلیک روی زمین، دوربین را آنجا می‌برد.</li>
              <li><b>زنده:</b> هر سفارش، انتقال و خرید با ون، کامیون، کشتی یا هواپیما روی نقشه می‌رود؛ کار تازه با کاغذ رنگی می‌رسد.</li>
              <li><b>ماشین زمان:</b> با نوار پایین ۳۰ روز گذشته را ببینید یا پخش کنید.</li>
              <li><b>آب‌وهوا:</b> آفتابی یعنی فروش ۳۰ روز از ۳۰ روز قبلش بیشتر است؛ باران یعنی کمتر.</li>
              <li><b>همکارها:</b> هر کس دنیا را باز کرده باشد، با اسمش روی نقشه است.</li>
            </ul>
            <button type="button" onClick={() => { setShowHelp(false); writeStorage(HELP_KEY, '1'); }} className="mt-4 w-full rounded-xl bg-[#2f6fe0] px-3 py-2.5 text-[13.5px] font-bold text-white">
              بزن بریم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const EVENT_DOT: Record<WorldEvent['kind'], string> = {
  order: '#2f6fe0', sale: '#2f6fe0', transfer: '#f08a3c', purchase: '#8a6a4f', return: '#8e5bd6', adjust: '#9aa4b2', income: '#2ecc71', expense: '#d9534f',
};

function Kpi({ glass, label, value, unit, note, delta, tone }: { glass: string; label: string; value: string; unit: string; note?: string; delta?: number; tone?: 'ok' | 'warn' }) {
  return (
    <div className={cn('w-44 shrink-0 px-3 py-2.5', glass)}>
      <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span>{label}</span>
        {delta !== undefined && Number.isFinite(delta) && (
          <span className={cn('rounded-md px-1 text-[10.5px] font-bold', delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {delta >= 0 ? '↑' : '↓'} {fa(Math.abs(delta * 100))}٪
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[19px] font-extrabold tabular-nums">{value}</span>
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </div>
      {note && <div className={cn('text-[11px]', tone === 'warn' ? 'text-amber-700' : 'text-muted-foreground')}>{note}</div>}
    </div>
  );
}

function Ctl({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={cn('grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800', active && 'bg-[#2f6fe0]/10 text-[#2f6fe0]')}>
      {children}
    </button>
  );
}

/** A warehouse's or a store's goods, the most first, with their state. */
function Inventory({ id, data, onPick }: { id: string; data: WorldData; onPick: (id: string) => void }) {
  if (!id.startsWith('warehouse:') || !data.stock) return null;
  const wid = id.slice('warehouse:'.length);
  const virtual = data.stock.warehouses.find((w) => w.id === wid)?.virtual;
  const rows = data.stock.products
    .map((p) => ({ p, q: p.byWarehouse[wid] ?? 0 }))
    .filter((r) => r.q > 0 || (!virtual && r.p.level === 'OUT'))
    .sort((a, b) => b.q - a.q)
    .slice(0, 12);
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
        <span className="font-semibold">موجودی</span>
        <span>عدد</span>
      </div>
      <ul className="space-y-0.5">
        {rows.map(({ p, q }) => (
          <li key={p.id}>
            <button type="button" onClick={() => !virtual && onPick(`product:${wid}:${p.id}`)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-right hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-100 text-[10px] font-bold text-amber-800">{p.family.slice(0, 2)}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.name}</span>
              <span className="text-[12px] font-bold tabular-nums">{fa(q)}</span>
              <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', p.level === 'OK' ? 'bg-emerald-50 text-emerald-700' : p.level === 'LOW' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>
                {p.level === 'OK' ? 'موجود' : p.level === 'LOW' ? 'کم' : 'ناموجود'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
