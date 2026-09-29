import { Client } from 'basic-ftp';
import type { Readable, Writable } from 'node:stream';

/**
 * An FTP server in memory, standing in for basic-ftp's Client in these tests:
 * src/lib/ftp.ts makes `new Client()` for every operation, and every method it
 * calls is replaced here, so no test ever opens a connection.
 */
export const fakeFtp = {
  files: new Map<string, Buffer>(),
  dirs: new Set<string>(),
  /** What each login was made with. */
  logins: [] as Array<Record<string, unknown>>,
  /** When set, every login fails with it (an unreachable or refusing server). */
  failWith: null as Error | null,
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.logins = [];
    this.failWith = null;
  },
};

const noSuchFile = (path: string) => Object.assign(new Error(`550 ${path}: No such file or directory`), { code: 550 });

const client = Client.prototype as any;
client.access = async (options: Record<string, unknown>) => {
  if (fakeFtp.failWith) throw fakeFtp.failWith;
  fakeFtp.logins.push(options);
  return { code: 230, message: '230 Logged in' };
};
client.ensureDir = async (dir: string) => {
  fakeFtp.dirs.add(dir);
};
client.uploadFrom = async (source: Readable, path: string) => {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  fakeFtp.files.set(path, Buffer.concat(chunks));
  return { code: 226, message: '226 Transfer complete' };
};
client.downloadTo = async (destination: Writable, path: string) => {
  const bytes = fakeFtp.files.get(path);
  if (!bytes) throw noSuchFile(path);
  await new Promise<void>((resolve, reject) => destination.write(bytes, (error) => (error ? reject(error) : resolve())));
  return { code: 226, message: '226 Transfer complete' };
};
client.list = async (dir = '') => {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  const inside = [...fakeFtp.files.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
  const root = prefix === '/';
  if (inside.length === 0 && !root && !fakeFtp.dirs.has(dir)) throw noSuchFile(dir);
  return inside.map((path) => ({ name: path.slice(prefix.length), size: fakeFtp.files.get(path)!.length, isFile: true, modifiedAt: undefined }));
};
client.remove = async (path: string) => {
  if (!fakeFtp.files.delete(path)) throw noSuchFile(path);
  return { code: 250, message: '250 Deleted' };
};
client.close = () => {};

export const FTP_SETTINGS = { host: 'ftp.example.test', port: 21, user: 'moak', password: 'ftp-secret', secure: false };
