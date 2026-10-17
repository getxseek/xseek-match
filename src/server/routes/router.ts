import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/** Exact-path registry; http.ts dispatches on pathname and passes the query string as req.url. */
export interface Router {
  use(path: string, handler: Handler): void;
}
