'use client';

import { useCallback, useState } from 'react';

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A random id for one submission of a money form (see src/lib/request-id.ts).
 * Send it with the form; call renew() after a successful save, so the next
 * entry typed into the same form is a new submission.
 */
export function useRequestId(): [string, () => void] {
  const [id, setId] = useState(newId);
  const renew = useCallback(() => setId(newId()), []);
  return [id, renew];
}

/** The hidden field a server action reads with readRequestId(formData.get('requestId')). */
export function RequestIdField({ value }: { value: string }) {
  return <input type="hidden" name="requestId" value={value} />;
}
