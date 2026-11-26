let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
/**
 * The reply's JSON. An error reply without JSON (a restart, a proxy error page) reads as
 * `{}`, so callers show their own message instead of a parser error.
 */
export async function responseJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    if (response.ok) throw new Error('Unexpected reply from the server. Try again.');
    return {};
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && csrf)
    headers.set('X-CSRF-Token', csrf);
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (
    response.status === 401 &&
    (String(input).startsWith('/api/match/') ||
      ['/api/auth/connection', '/api/auth/onboarding', '/api/auth/logout'].includes(String(input)))
  )
    window.dispatchEvent(new Event('auth-required'));
  return response;
}
