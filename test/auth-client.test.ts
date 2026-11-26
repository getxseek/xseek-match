import { expect, it } from 'vitest';
import { responseJson } from '../src/web/match/auth/auth-client';

it('reads an error reply without JSON as an empty object, so callers show their own message', async () => {
  expect(await responseJson(new Response('', { status: 503 }))).toEqual({});
  expect(await responseJson(new Response('Internal server error', { status: 500 }))).toEqual({});
  expect(await responseJson(Response.json({ error: 'Nope' }, { status: 400 }))).toEqual({
    error: 'Nope',
  });
  expect(await responseJson(Response.json({ ok: true }))).toEqual({ ok: true });
  await expect(responseJson(new Response('<html>', { status: 200 }))).rejects.toThrow(
    'Unexpected reply',
  );
});
