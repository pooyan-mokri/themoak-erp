import { z } from 'zod';

/**
 * A consignment partner sells in more than one way — online, in the shop — and
 * takes a different cut for each. Those ways are the partner's channels, and a
 * channel's rate is what the commission on a sale through it is computed with.
 *
 * The partner form sends them as one JSON field; create and edit both read them
 * here, so they agree on the rules: at least one channel, names unique, exactly
 * one default, and the default is active.
 * Pure (no server imports), so the form components share it.
 */

export const CHANNELS_FIELD = 'channels';
export const DEFAULT_CHANNEL_NAME = 'پیش‌فرض';

export interface ChannelInput {
  /** An existing channel's id; absent for a row just added in the form. */
  id?: string;
  name: string;
  commissionRate: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

const RowSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(40),
  commissionRate: z.coerce.number().min(0).max(100),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/** The partner's channels as the form sent them, or a Persian message saying what is wrong. */
export function readChannels(value: unknown): { channels: ChannelInput[] } | { error: string } {
  if (value === undefined || value === null || value === '') return { channels: [] };
  let raw: unknown;
  try {
    raw = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return { error: 'کانال‌های فروش خوانده نشد.' };
  }
  const parsed = z.array(RowSchema).safeParse(raw);
  if (!parsed.success) {
    return { error: 'کانال فروش باید نام داشته باشد و درصد کمیسیون بین ۰ تا ۱۰۰ باشد.' };
  }

  const rows = parsed.data;
  if (rows.length === 0) return { error: 'حداقل یک کانال فروش لازم است.' };
  const names = rows.map((row) => row.name.trim());
  if (new Set(names).size !== names.length) return { error: 'نام کانال‌های فروش نباید تکراری باشد.' };

  const channels: ChannelInput[] = rows.map((row, index) => ({
    id: row.id,
    name: row.name.trim(),
    commissionRate: row.commissionRate,
    isDefault: row.isDefault === true,
    isActive: row.isActive !== false,
    sortOrder: index,
  }));

  const active = channels.filter((channel) => channel.isActive);
  if (active.length === 0) return { error: 'حداقل یک کانال فروش باید فعال باشد.' };
  const defaults = active.filter((channel) => channel.isDefault);
  if (defaults.length > 1) return { error: 'فقط یک کانال فروش می‌تواند پیش‌فرض باشد.' };
  // A default among the inactive ones, or none at all, means the first active one.
  for (const channel of channels) channel.isDefault = false;
  (defaults[0] ?? active[0]).isDefault = true;

  return { channels };
}

type StoredChannel = { id: string; name: string; commissionRate: number; isDefault: boolean; isActive: boolean };

/** The channel a sale goes through when none was picked. */
export function defaultChannelOf<T extends StoredChannel>(channels: readonly T[]): T | undefined {
  const active = channels.filter((channel) => channel.isActive);
  return active.find((channel) => channel.isDefault) ?? active[0];
}

/** «آنلاین ۳۰٪ · حضوری ۳۵٪» — how a partner's channels read in a list. */
export function channelSummary(channels: readonly StoredChannel[]): string {
  return channels
    .filter((channel) => channel.isActive)
    .map((channel) => `${channel.name} ${channel.commissionRate.toLocaleString('fa-IR')}٪`)
    .join(' · ');
}
