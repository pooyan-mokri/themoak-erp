/**
 * The connector for Claude Desktop as one file to download: an MCP bundle (.mcpb), which is a zip holding a
 * manifest and the server. Claude Desktop installs it on macOS and on Windows alike (Settings → Extensions, or a
 * double click), runs it with the Node it ships, asks for the settings the manifest names and keeps the key in the
 * system's keychain. The server is mcp-server/server.mjs, copied into src/lib/connector-server.generated.ts.
 *
 * The bundle holds no key: the person installing it pastes their own, made in the same dialog.
 */
import { deflateRawSync } from 'node:zlib';
import { CONNECTOR_SERVER, CONNECTOR_VERSION } from '@/lib/connector-server.generated';

export const CONNECTOR_FILE_NAME = 'themoak-erp.mcpb';
/** The server alone, for a manual install (docs: mcp-server/README.md). */
export const CONNECTOR_SERVER_FILE_NAME = 'themoak-erp-server.mjs';
export { CONNECTOR_SERVER, CONNECTOR_VERSION };

/** The manifest Claude Desktop reads. `erpUrl` is this ERP's own address, offered as the default. */
export function connectorManifest(erpUrl: string) {
  return {
    manifest_version: '0.2',
    name: 'themoak-erp',
    display_name: 'TheMoak ERP',
    version: CONNECTOR_VERSION,
    description: 'اتصال Claude به ERP دِموک: حساب‌ها، فروش، موجودی، خرید و پرداخت‌ها، با کلید شخصی هر کاربر.',
    long_description:
      'هر کاری که Claude با این کانکتور انجام می‌دهد با کلید شخصی شما، به نام شما و با دسترسی‌های نقش شما در ERP ثبت می‌شود. کلید را مدیر سیستم در «تنظیمات ← کاربران ← کلیدهای Claude» می‌سازد.',
    author: { name: 'TheMoak' },
    server: {
      type: 'node',
      entry_point: 'server/index.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.mjs'],
        env: { ERP_API_URL: '${user_config.erp_url}', ERP_API_KEY: '${user_config.api_key}' },
      },
    },
    user_config: {
      erp_url: {
        type: 'string',
        title: 'آدرس ERP',
        description: 'آدرس ERP، بدون چیزی بعد از دامنه.',
        default: erpUrl,
        required: true,
      },
      api_key: {
        type: 'string',
        title: 'کلید Claude',
        description: 'کلید شخصی شما از ERP (تنظیمات ← کاربران ← کلیدهای Claude). فقط یک بار نشان داده می‌شود.',
        sensitive: true,
        required: true,
      },
    },
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
  };
}

// ── A zip, written here: three small files do not need a library ─────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1 January 2026, 00:00, as a zip stores a time: the same bundle for the same content, whenever it is made. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
/** Deflated, names in UTF-8. */
const METHOD = 8;
const FLAGS = 0x0800;

/** A zip archive of text files (deflate, no zip64: far below its limits). */
export function zip(files: Array<{ name: string; content: string }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const packed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(METHOD, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    parts.push(local, name, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(FLAGS, 8);
    entry.writeUInt16LE(METHOD, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal and external attributes: all 0.
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** The .mcpb for this ERP. */
export function connectorBundle(erpUrl: string): Buffer {
  return zip([
    { name: 'manifest.json', content: JSON.stringify(connectorManifest(erpUrl), null, 2) + '\n' },
    { name: 'server/index.mjs', content: CONNECTOR_SERVER },
    // The server is an ES module whatever a folder above the install says.
    { name: 'package.json', content: JSON.stringify({ name: 'themoak-erp', version: CONNECTOR_VERSION, private: true, type: 'module' }, null, 2) + '\n' },
  ]);
}

/**
 * This ERP's address as the person's browser knows it: AUTH_URL when set (as the sign-in links use it), else the
 * address the request came to. Behind Liara's proxy that is the forwarded host, not the container's own.
 */
export function erpAddress(request: { headers: Headers; url: string }): string {
  const configured = (process.env.AUTH_URL ?? '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Not an address: the request's own, below.
    }
  }
  const first = (value: string | null) => (value ?? '').split(',')[0].trim();
  const host = first(request.headers.get('x-forwarded-host')) || first(request.headers.get('host'));
  const url = new URL(request.url);
  if (!host) return url.origin;
  const proto = first(request.headers.get('x-forwarded-proto')) || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
