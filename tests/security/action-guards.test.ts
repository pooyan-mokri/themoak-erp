import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Every export of a 'use server' file is a POST endpoint that any browser can
 * call, whatever page it came from. This reads the source and checks that each
 * exported action checks access before it does anything:
 * - an action that writes (by its name or by a Prisma write in its body) must
 *   check a permission or a role;
 * - an action that only reads must at least require a signed-in user.
 * Checks inside same-file helpers the action calls count.
 */

const ROOT = process.cwd();

/** Open to strangers by design. */
const PUBLIC: Record<string, string> = {
  'src/actions/login.ts:authenticate': 'the sign-in form',
  'src/actions/password-reset.ts:requestPasswordReset': 'the forgotten-password form',
  'src/actions/password-reset.ts:verifyResetToken': 'the reset link, checked by its token',
  'src/actions/password-reset.ts:resetPassword': 'the reset form, checked by its token',
};

/** Writes only the signed-in user's own records, so a signed-in check is enough. */
const OWN_DATA: Record<string, string> = {
  'src/actions/user.ts:updateProfile': 'their own profile',
  'src/actions/user.ts:changePassword': 'their own password',
  'src/actions/ai-assistant.ts:createConversation': 'their own AI conversation',
  'src/actions/ai-assistant.ts:deleteConversation': 'their own AI conversation',
};

const PERMISSION_CHECK = [
  /\b(requirePermission|checkPermission|requirePagePermission|requireRouteAccess)\s*\(/,
  /!\s*\(?\s*await\s+hasPermission\s*\(/,
  /\.role\s*(===|!==|==|!=)/,
  /(===|!==|==|!=)\s*(Role\.ADMIN|['"]ADMIN['"])/,
];
const SIGNED_IN_CHECK = [/\bauth\s*\(\s*\)/, /\bgetCurrentUser\s*\(/, /\bgetCurrentRole\s*\(/, /\bhasPermission\s*\(/];
const WRITE_NAME =
  /^(create|update|delete|remove|save|add|set|record|post|issue|finalize|generate|replace|import|transfer|pay|settle|archive|unarchive|restore|cancel|approve|reject|receive|adjust|upload|move|mark|convert|assign|unassign|close|reopen|start|complete|send|sync|toggle|bulk|distribute|withdraw|deposit|process|reset|seed|apply|link|unlink|change|edit|submit|confirm|duplicate|merge|register|return|exchange|clear|run|execute|perform|void|refund|write|rename|reorder|upsert|finish|ensure|recalculate|rebuild|fix|backup|release|retry|enable|disable|resync|test|log|allocate|depreciate|attach|detach)/i;
const PRISMA_WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const printer = ts.createPrinter({ removeComments: true });

type Action = { id: string; name: string; code: string };

function serverActions(): Action[] {
  const actions: Action[] = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const first = sf.statements[0];
    const useServer =
      first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server';
    if (!useServer) continue;

    const functions = new Map<string, ts.Node>();
    const exported = new Set<string>();
    const isExported = (node: ts.Node) =>
      ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        functions.set(statement.name.text, statement);
        if (isExported(statement)) exported.add(statement.name.text);
      } else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
          functions.set(decl.name.text, decl);
          if (isExported(statement)) exported.add(decl.name.text);
        }
      } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const spec of statement.exportClause.elements) exported.add((spec.propertyName ?? spec.name).text);
      }
    }

    // The action's own code plus every same-file function it calls, transitively.
    const codeOf = (name: string) => {
      const seen = new Set<string>();
      const parts: string[] = [];
      const visit = (fn: string) => {
        const node = functions.get(fn);
        if (!node || seen.has(fn)) return;
        seen.add(fn);
        parts.push(printer.printNode(ts.EmitHint.Unspecified, node, sf));
        const walk = (n: ts.Node) => {
          if (ts.isIdentifier(n) && functions.has(n.text)) visit(n.text);
          ts.forEachChild(n, walk);
        };
        walk(node);
      };
      visit(name);
      return parts.join('\n');
    };

    const rel = relative(ROOT, file);
    for (const name of exported) {
      if (functions.has(name)) actions.push({ id: `${rel}:${name}`, name, code: codeOf(name) });
    }
  }
  return actions;
}

test('every exported server action checks access before acting', () => {
  const actions = serverActions();
  // Guard against the scan silently finding nothing.
  assert.ok(actions.length > 200, `found only ${actions.length} actions`);

  const unguarded: string[] = [];
  for (const action of actions) {
    if (PUBLIC[action.id]) continue;
    const writes = !OWN_DATA[action.id] && (WRITE_NAME.test(action.name) || PRISMA_WRITE.test(action.code));
    const checksPermission = PERMISSION_CHECK.some((re) => re.test(action.code));
    const checksSignedIn = checksPermission || SIGNED_IN_CHECK.some((re) => re.test(action.code));
    if (writes ? !checksPermission : !checksSignedIn) {
      unguarded.push(`${action.id} (${writes ? 'writes: needs a permission check' : 'reads: needs a signed-in check'})`);
    }
  }
  assert.deepEqual(unguarded, []);
});

test('every listed exception is still exported', () => {
  const ids = new Set(serverActions().map((a) => a.id));
  assert.deepEqual(
    [...Object.keys(PUBLIC), ...Object.keys(OWN_DATA)].filter((id) => !ids.has(id)),
    [],
  );
});
