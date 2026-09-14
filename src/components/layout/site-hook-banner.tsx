import type { SiteHookHold, SiteHookStatus } from '@/lib/site-hook';

/** Failing for this long is no longer a passing blip. */
const FAILING_ALERT_MS = 30 * 60_000;

const fa = (n: number) => n.toLocaleString('fa-IR');

/**
 * What an admin needs to hear about the stock push, one short line each.
 * Nothing while pushing is switched off: nothing is being sent then.
 * getSiteHookAlerts reads the stored state for it; SiteHookAlerts shows the lines.
 */
export function siteHookAlerts(
  input: { enabled: boolean; status: Partial<SiteHookStatus> | null; hold: SiteHookHold | null },
  now: number = Date.now(),
): string[] {
  const { enabled, status, hold } = input;
  if (!enabled) return [];
  const alerts: string[] = [];
  if (hold?.state === 'held' && hold.webIds.length > 0) {
    alerts.push(`${fa(hold.webIds.length)} فریم منتظر تأیید شما برای ناموجود شدن در سایت است.`);
  }
  if (status?.paused) {
    alerts.push(`ارسال موجودی به سایت متوقف شده است: ${status.paused.why}`);
  } else if (status?.failingSince && now - Date.parse(status.failingSince) > FAILING_ALERT_MS) {
    const minutes = Math.floor((now - Date.parse(status.failingSince)) / 60_000);
    const age = minutes < 120 ? `${fa(minutes)} دقیقه` : `${fa(Math.floor(minutes / 60))} ساعت`;
    alerts.push(`ارسال موجودی به سایت از ${age} پیش ناموفق است${status.lastMessage ? `: ${status.lastMessage}` : '.'}`);
  }
  return alerts;
}
