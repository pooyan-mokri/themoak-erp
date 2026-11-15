// Writes src/lib/connector-server.generated.ts from server.mjs: the copy of the connector the ERP serves for
// download (src/lib/connector-bundle.ts). Run after every change to server.mjs:
//
//   node mcp-server/embed.mjs
//
// tests/platform/connector.test.ts fails while the two differ. A string in a module, not a file read at run time:
// Liara runs Next's standalone output, which holds only what the pages import.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'server.mjs'), 'utf8');
const version = /^const VERSION = '([^']+)';$/m.exec(source)?.[1];
if (!version) throw new Error("server.mjs has no line «const VERSION = '…';»");

writeFileSync(
  join(here, '..', 'src', 'lib', 'connector-server.generated.ts'),
  `// Generated from mcp-server/server.mjs by \`node mcp-server/embed.mjs\`. Do not edit: change that file and run it again.\n` +
    `export const CONNECTOR_VERSION = ${JSON.stringify(version)};\n` +
    `export const CONNECTOR_SERVER = ${JSON.stringify(source)};\n`,
);
console.log(`connector ${version} embedded (${source.length} characters)`);
