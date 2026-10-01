// On Liara the ERP runs in Iran and every AI provider is outside it: a provider can be filtered, unreachable,
// or refuse the server's country. The assistant must say so in Persian, never hang, and fail only its own request.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createAIProvider, PROVIDER_TIMEOUT_MS } from '@/lib/ai-providers';
import { sendMessage } from '@/actions/ai-chat';

// The provider code logs the failures these tests provoke on purpose.
console.error = () => {};

const realFetch = globalThis.fetch;
const PROVIDERS = [
  ['OPENAI', 'OpenAI', 'api.openai.com'],
  ['ANTHROPIC', 'Anthropic', 'api.anthropic.com'],
  ['GEMINI', 'Gemini', 'generativelanguage.googleapis.com'],
  ['GROQ', 'Groq', 'api.groq.com'],
] as const;
const PERSIAN = /[؀-ۿ]/;

let calls: Array<{ url: string; signal: unknown }> = [];
function stubFetch(answer: (url: string) => Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal });
    return answer(String(input));
  }) as typeof fetch;
}
const networkFailure = (code: string) => async () => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
};
const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ask = (provider: (typeof PROVIDERS)[number][0]) =>
  createAIProvider(provider, 'test-key', 'test-model').sendMessage([{ role: 'user', content: 'سلام' }]);

afterEach(() => {
  globalThis.fetch = realFetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
});

test('a provider the server cannot reach fails in Persian, naming the provider and the network error', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']) {
    stubFetch(networkFailure(code));
    for (const [id, name, host] of PROVIDERS) {
      await assert.rejects(ask(id), (error: Error) => {
        assert.match(error.message, PERSIAN);
        assert.ok(error.message.includes(name), error.message);
        assert.ok(error.message.includes(code), error.message);
        assert.ok(error.message.includes('مسدود'), error.message);
        return true;
      });
      assert.ok(calls.at(-1)!.url.includes(host));
    }
  }
});

test('every provider call carries a time limit, and running out of it reads in Persian', async () => {
  stubFetch(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  for (const [id, name] of PROVIDERS) {
    await assert.rejects(ask(id), (error: Error) => {
      assert.match(error.message, PERSIAN);
      assert.ok(error.message.includes(name) && error.message.includes(String(PROVIDER_TIMEOUT_MS / 1000)), error.message);
      return true;
    });
    assert.ok(calls.at(-1)!.signal instanceof AbortSignal, `${name} is called with an abort signal`);
  }
});

test("a provider that refuses the server's country says so in Persian", async () => {
  const refusals = {
    OPENAI: json(403, { error: { code: 'unsupported_country_region_territory', message: 'Country, region, or territory not supported', type: 'request_forbidden' } }),
    ANTHROPIC: json(403, { error: { type: 'forbidden', message: 'Request not allowed' } }),
    GEMINI: json(400, { error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }),
    GROQ: json(403, { error: { message: 'Forbidden' } }),
  } as const;
  for (const [id, name] of PROVIDERS) {
    stubFetch(refusals[id]);
    await assert.rejects(ask(id), (error: Error) => {
      assert.match(error.message, PERSIAN);
      assert.ok(error.message.includes(name) && error.message.includes('ایران'), error.message);
      return true;
    });
  }
});

test('other provider errors keep their own messages (a wrong key is not called a country block)', async () => {
  stubFetch(json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }));
  await assert.rejects(ask('OPENAI'), /Incorrect API key provided/);
  stubFetch(json(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
  await assert.rejects(ask('ANTHROPIC'), /invalid x-api-key/);
});

beforeEach(async () => {
  setTestRole('ADMIN');
});

test('the assistant action answers a blocked provider with the Persian message and fails nothing else', async () => {
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'admin@local.test', password: 'x', role: 'ADMIN' } });
  await prisma.aISettings.create({ data: { provider: 'OPENAI', apiKey: 'test-key', model: 'gpt-4o', enabled: true } });
  const conversation = await prisma.aIConversation.create({ data: { userId: 'test-user', title: 'مکالمه ۱' } });

  stubFetch(networkFailure('ECONNRESET'));
  const result: any = await sendMessage(conversation.id, 'موجودی انبار چقدر است؟');
  assert.equal(result.success, false);
  assert.match(result.message, PERSIAN);
  assert.ok(result.message.includes('OpenAI') && result.message.includes('ECONNRESET'), result.message);
  // The question is kept; no answer is invented; the conversation still opens.
  const messages = await prisma.aIMessage.findMany({ where: { conversationId: conversation.id } });
  assert.deepEqual(messages.map((m: { role: string }) => m.role), ["USER"]);
  globalThis.fetch = realFetch;
  assert.equal((await prisma.aIConversation.count()), 1);
});
