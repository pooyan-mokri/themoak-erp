/**
 * Where the browser goes after signing in: the dashboard page the login page
 * was sent from (the middleware adds it as ?callbackUrl=, as a full address),
 * or the dashboard. Only the path is kept, so a callbackUrl can never lead to
 * another site. Pure, so the login page and its action share it.
 */
export const AFTER_LOGIN_PATH = '/dashboard';

export function loginRedirectPath(callbackUrl: unknown): string {
  if (typeof callbackUrl !== 'string' || !callbackUrl) return AFTER_LOGIN_PATH;
  let url: URL;
  try {
    url = new URL(callbackUrl, 'http://erp.invalid');
  } catch {
    return AFTER_LOGIN_PATH;
  }
  if (url.pathname !== AFTER_LOGIN_PATH && !url.pathname.startsWith(`${AFTER_LOGIN_PATH}/`)) return AFTER_LOGIN_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}
