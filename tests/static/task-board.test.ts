import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { TaskBoard } from '@/components/projects/task-board';

// Every project page rendered its task board on the server, where createPortal(…, document.body) threw
// "document is not defined" and the page answered 500. The drag overlay is portalled only after mount.

(globalThis as any).React = React;
console.log = () => {};

test('the task board renders on the server, with its tasks and no portal', () => {
  assert.equal(typeof (globalThis as any).document, 'undefined');
  const task = { id: 't1', title: 'طراحی قاب', status: 'TODO', priority: 'HIGH', projectId: 'p1', createdAt: new Date('2026-09-20T08:00:00Z'), updatedAt: new Date('2026-09-20T08:00:00Z') };
  // The board's cards use the App Router, as they do under the page.
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const html = renderToString(
    React.createElement(AppRouterContext.Provider, { value: router as any },
      React.createElement(TaskBoard, { tasks: [task as any], projectId: 'p1', users: [] })),
  );
  assert.ok(html.includes('طراحی قاب'));
});
