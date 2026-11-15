// The connector for Claude Desktop (mcp-server/server.mjs) and its download from «کلیدهای Claude» in
// تنظیمات ← کاربران (src/app/api/connector/route.ts). Pooyan, 2026-11-15: the connector file is downloaded there,
// one file for macOS and Windows. It is a .mcpb bundle (a zip: manifest + server) with no key in it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { NextRequest } from 'next/server';
import { setTestRole } from '../stubs/auth';
import { GET } from '@/app/api/connector/route';
import { CONNECTOR_SERVER, CONNECTOR_VERSION, connectorBundle, connectorManifest, erpAddress, zip } from '@/lib/connector-bundle';

const ROOT = process.cwd();
const SERVER_FILE = join(ROOT, 'mcp-server', 'server.mjs');
const source = readFileSync(SERVER_FILE, 'utf8');

after(() => setTestRole('ADMIN'));

/** Reads a zip the way an unzip tool does: from its end record and central directory, checking every size. */
function unzip(archive: Buffer): Record<string, string> {
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50, 'end record');
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  assert.equal(at + archive.readUInt32LE(end + 12), end, 'the directory ends where the end record starts');
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(archive.readUInt32LE(at), 0x02014b50, 'directory entry');
    const packedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(archive.readUInt32LE(local), 0x04034b50, 'local header');
    assert.equal(archive.readUInt32LE(local + 14), archive.readUInt32LE(at + 16), 'the same checksum in both headers');
    const data = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const content = inflateRawSync(archive.subarray(data, data + packedSize));
    assert.equal(content.length, size);
    files[name] = content.toString('utf8');
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  return files;
}

test('the copy the ERP serves is mcp-server/server.mjs as it is', () => {
  assert.equal(CONNECTOR_SERVER, source, 'run `node mcp-server/embed.mjs` after changing mcp-server/server.mjs');
  assert.match(source, new RegExp(`^const VERSION = '${CONNECTOR_VERSION.replace(/\./g, '\\.')}';$`, 'm'));
});

test('every tool runs an action the ERP API has, and each tool name is used once', () => {
  const route = readFileSync(join(ROOT, 'src/app/api/erp/route.ts'), 'utf8');
  const tools = [...source.matchAll(/name: '(erp_\w+)',\n\s+action: '(\w+)',\n\s+method: '(GET|POST)'/g)].map(([, name, action, method]) => ({ name, action, method }));
  assert.ok(tools.length >= 24, `${tools.length} tools`);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const tool of tools) assert.match(route, new RegExp(`case '${tool.action}'`), `${tool.name} → ${tool.action}`);
  // The two ways to pay stay apart: a customer's sale, and a supplier's purchase order.
  assert.deepEqual(
    ['erp_record_payment', 'erp_pay_purchase_order', 'erp_add_purchase_order_cost'].map((name) => tools.find((t) => t.name === name)?.action),
    ['recordOrderPayment', 'payPurchaseOrder', 'addPurchaseOrderCost'],
  );
});

test('the bundle is a zip Claude Desktop can read: a manifest, the server, and no key', () => {
  const files = unzip(connectorBundle('https://erp.example.com'));
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'package.json', 'server/index.mjs']);
  assert.equal(files['server/index.mjs'], source);
  assert.equal(JSON.parse(files['package.json']).type, 'module');

  const manifest = JSON.parse(files['manifest.json']);
  assert.deepEqual(manifest, connectorManifest('https://erp.example.com'));
  assert.deepEqual([manifest.name, manifest.version, manifest.server.type, manifest.server.entry_point], ['themoak-erp', CONNECTOR_VERSION, 'node', 'server/index.mjs']);
  assert.deepEqual(manifest.server.mcp_config, {
    command: 'node',
    args: ['${__dirname}/server/index.mjs'],
    env: { ERP_API_URL: '${user_config.erp_url}', ERP_API_KEY: '${user_config.api_key}' },
  });
  // The ERP's own address is offered; the key is asked for, kept secret, and never in the file.
  assert.equal(manifest.user_config.erp_url.default, 'https://erp.example.com');
  assert.deepEqual([manifest.user_config.api_key.sensitive, manifest.user_config.api_key.required, 'default' in manifest.user_config.api_key], [true, true, false]);
  for (const platform of ['darwin', 'win32']) assert.ok(manifest.compatibility.platforms.includes(platform), platform);

  // The same content is the same file, and Persian names and text survive the zip.
  assert.deepEqual(connectorBundle('https://erp.example.com'), connectorBundle('https://erp.example.com'));
  assert.deepEqual(unzip(zip([{ name: 'پوشه/فایل.txt', content: 'سلام\n'.repeat(500) }, { name: 'empty', content: '' }])), { 'پوشه/فایل.txt': 'سلام\n'.repeat(500), empty: '' });
});

test('the ERP\'s address in the bundle is the one the browser used, or AUTH_URL when set', () => {
  const request = (headers: Record<string, string>) => ({ url: 'http://localhost:3000/api/connector', headers: new Headers(headers) });
  const before = process.env.AUTH_URL;
  try {
    delete process.env.AUTH_URL;
    assert.equal(erpAddress(request({ host: 'localhost:3000' })), 'http://localhost:3000');
    assert.equal(erpAddress(request({ host: 'localhost:3000', 'x-forwarded-host': 'erp.themoak.com', 'x-forwarded-proto': 'https' })), 'https://erp.themoak.com');
    assert.equal(erpAddress(request({ 'x-forwarded-host': 'erp.themoak.com, proxy.internal', 'x-forwarded-proto': 'https, http' })), 'https://erp.themoak.com');
    process.env.AUTH_URL = 'https://erp.themoak.com/';
    assert.equal(erpAddress(request({ host: 'localhost:3000' })), 'https://erp.themoak.com');
    process.env.AUTH_URL = 'not an address';
    assert.equal(erpAddress(request({ host: 'localhost:3000' })), 'http://localhost:3000');
  } finally {
    if (before === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = before;
  }
});

test('the download needs a sign-in; signed in, it is the bundle, or the server file alone', async () => {
  const download = (query = '') => GET(new NextRequest(`http://localhost/api/connector${query}`, { headers: { host: 'erp.example.com', 'x-forwarded-proto': 'https' } }));
  setTestRole(null);
  assert.equal((await download()).status, 401);
  assert.equal((await download('?file=server')).status, 401);

  // Any signed-in user: the file holds nothing of the ERP's.
  setTestRole('SALES');
  const bundle = await download();
  assert.equal(bundle.status, 200);
  assert.equal(bundle.headers.get('content-disposition'), 'attachment; filename="themoak-erp.mcpb"');
  assert.equal(bundle.headers.get('cache-control'), 'no-store');
  const files = unzip(Buffer.from(await bundle.arrayBuffer()));
  assert.equal(JSON.parse(files['manifest.json']).user_config.erp_url.default, 'https://erp.example.com');

  const alone = await download('?file=server');
  assert.equal(alone.headers.get('content-disposition'), 'attachment; filename="themoak-erp-server.mjs"');
  assert.equal(await alone.text(), source);
});

// ── The server itself, run as Claude Desktop runs it, against a stand-in for /api/erp ──

type Seen = { method: string; url: string; auth: string; body: any };

async function withConnector(
  erp: (seen: Seen) => { status: number; body: unknown },
  run: (rpc: (method: string, params?: unknown) => Promise<any>, seen: Seen[]) => Promise<void>,
) {
  const seen: Seen[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let text = '';
      req.on('data', (chunk) => (text += chunk));
      req.on('end', () => resolve(text));
    });
  const http = createServer(async (req, res) => {
    const text = await read(req);
    const call = { method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? '', body: text ? JSON.parse(text) : null };
    seen.push(call);
    const answer = erp(call);
    res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: { ...process.env, ERP_API_URL: `http://127.0.0.1:${port}/`, ERP_API_KEY: 'moak_test_key', ERP_API_SECRET: '' },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const waiting = new Map<number, (message: any) => void>();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      waiting.get(message.id)?.(message);
    }
  });
  let next = 1;
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 10_000);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await run(rpc, seen);
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => http.close(resolve));
  }
}

test('the connector speaks MCP: it offers a personal key only the tools its role may use, and calls the ERP with the key', async () => {
  const actions = ['whoami', 'accounts', 'orders', 'createOrder', 'recordOrderPayment', 'purchaseOrders'];
  await withConnector(
    (call) => {
      if (call.url.includes('action=whoami')) return { status: 200, body: { name: 'سارا', role: 'SALES', actions } };
      if (call.url.includes('action=purchaseOrders')) return { status: 200, body: { purchaseOrders: [] } };
      if (call.body?.action === 'recordOrderPayment') return { status: 200, body: { success: true, order: 12 } };
      return { status: 403, body: { error: 'Forbidden for this key' } };
    },
    async (rpc, seen) => {
      const hello = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      assert.deepEqual(hello.result.serverInfo, { name: 'themoak-erp', version: CONNECTOR_VERSION });
      assert.deepEqual([hello.result.protocolVersion, hello.result.capabilities], ['2025-06-18', { tools: {} }]);
      assert.deepEqual((await rpc('ping')).result, {});

      const listed = (await rpc('tools/list')).result.tools;
      assert.deepEqual(
        listed.map((t: any) => t.name).sort(),
        ['erp_accounts', 'erp_create_order', 'erp_orders', 'erp_purchase_orders', 'erp_record_payment', 'erp_whoami'],
      );
      for (const tool of listed) assert.deepEqual(Object.keys(tool).sort(), ['description', 'inputSchema', 'name']);
      assert.ok(seen.every((call) => call.auth === 'Bearer moak_test_key'));

      // A read: its filters go in the address, and nothing else does.
      const read = await rpc('tools/call', { name: 'erp_purchase_orders', arguments: { status: 'PENDING_PAYMENT', tag: 'PI:2026-031', limit: 5, other: 'x' } });
      assert.deepEqual(JSON.parse(read.result.content[0].text), { purchaseOrders: [] });
      assert.equal(seen.at(-1)!.url, '/api/erp?action=purchaseOrders&status=PENDING_PAYMENT&tag=PI%3A2026-031&limit=5');

      // A write that moves money gets a requestId of its own; one given is passed on as it is.
      await rpc('tools/call', { name: 'erp_record_payment', arguments: { orderNumber: 12, account: 'صندوق', amount: 500_000 } });
      const { requestId, ...sent } = seen.at(-1)!.body;
      assert.deepEqual(sent, { action: 'recordOrderPayment', orderNumber: 12, account: 'صندوق', amount: 500_000 });
      assert.match(requestId, /^[0-9a-f-]{36}$/);
      await rpc('tools/call', { name: 'erp_record_payment', arguments: { orderNumber: 12, account: 'صندوق', amount: 500_000, requestId: 'retry-0001' } });
      assert.equal(seen.at(-1)!.body.requestId, 'retry-0001');

      // A refusal is the tool's answer, not a protocol error, and says how to retry safely.
      const refused = await rpc('tools/call', { name: 'erp_pay_purchase_order', arguments: { order: 8, account: 'حساب ذخیره دلاری', amount: 2000, currency: 'CNY', accountRate: 6.6703, requestId: 'po8-pay-0001' } });
      assert.equal(refused.result.isError, true);
      assert.match(refused.result.content[0].text, /ERP 403/);
      assert.match(refused.result.content[0].text, /requestId: po8-pay-0001/);
      assert.deepEqual(seen.at(-1)!.body, { action: 'payPurchaseOrder', order: 8, account: 'حساب ذخیره دلاری', amount: 2000, currency: 'CNY', accountRate: 6.6703, requestId: 'po8-pay-0001' });

      assert.equal((await rpc('tools/call', { name: 'erp_nothing', arguments: {} })).result.isError, true);
      assert.equal((await rpc('resources/list')).error.code, -32601);
    },
  );
});

test('the owner\'s full key gets every tool but the ones done in a user\'s name; with the ERP unreachable every tool is offered', async () => {
  const personal = ['erp_create_customer', 'erp_create_order', 'erp_record_payment', 'erp_return_order_item', 'erp_transfer_stock'];
  await withConnector(
    () => ({ status: 200, body: { owner: true, name: 'کلید کامل', role: 'ADMIN' } }),
    async (rpc) => {
      const names: string[] = (await rpc('tools/list')).result.tools.map((t: any) => t.name);
      assert.deepEqual(names.filter((name) => personal.includes(name) || name === 'erp_whoami'), []);
      for (const name of ['erp_pay_purchase_order', 'erp_add_purchase_order_cost', 'erp_create_purchase_order', 'erp_deposit']) assert.ok(names.includes(name), name);
    },
  );
  await withConnector(
    () => ({ status: 500, body: { error: 'down' } }),
    async (rpc) => {
      const names: string[] = (await rpc('tools/list')).result.tools.map((t: any) => t.name);
      for (const name of [...personal, 'erp_pay_purchase_order', 'erp_whoami']) assert.ok(names.includes(name), name);
      // Money without its currency is stopped before the ERP is asked.
      const refused = await rpc('tools/call', { name: 'erp_expense', arguments: { accountId: 'a', amount: 5, description: 'x' } });
      assert.equal(refused.result.isError, true);
      assert.match(refused.result.content[0].text, /currency is required/);
    },
  );
});
