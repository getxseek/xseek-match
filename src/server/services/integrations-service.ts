import { join } from 'node:path';
import { connectionFromInput } from '../lib/connection-input.js';
import {
  IntegrationsStore,
  toPublicConnection,
  type ConnectionRecord as Connection,
  type PublicConnectionRecord as PublicConnection,
} from '../storage/integrations-store.js';
import { probeConnection, requestConnection } from './connection-client.js';
import { QuiFeatures, validateHashes, validateReleases } from './qui-service.js';
import { SonarrAliases } from './sonarr-aliases.js';
import { parseLookupRequest, TitleLookup, type LookupTarget } from './title-lookup.js';

type Input = Record<string, unknown>;

const MAX_LOOKUP_INSTANCES = 8;
const CONNECTION_FIELDS = ['kind', 'name', 'baseUrl', 'apiKey', 'enabled'] as const;

function requireConnectionId(input: Input): string {
  if (typeof input.id !== 'string') throw new Error('Choose a connection.');
  return input.id;
}

function servesTarget(connection: PublicConnection, target: LookupTarget): boolean {
  const tv = connection.capabilities.includes('tv-title-lookup');
  const movie = connection.capabilities.includes('movie-title-lookup');
  if (target === 'sonarr') return tv;
  if (target === 'radarr') return movie;
  return tv || movie;
}

/** Sonarr, Radarr and qui connections: CRUD, probing, title lookup and qui presence. */
export class Integrations {
  private store: IntegrationsStore;
  private qui = new QuiFeatures(requestConnection);
  private aliases = new SonarrAliases(() => this.titles.invalidate());
  private titles = new TitleLookup(this.aliases);
  private operations = new Set<Promise<unknown>>();
  private closing = false;

  private readonly actions: Record<string, (input: Input) => Promise<unknown> | unknown> = {
    lookup: (input) => this.lookupTitle(input),
    presence: (input) => this.qui.presence(this.quiConnections(), validateHashes(input.hashes)),
    'release-presence': (input) => this.releasePresence(input),
    delete: (input) => this.deleteConnection(input),
    enabled: (input) => this.setEnabled(input),
    save: (input) => this.saveConnection(input),
    test: (input) => this.testConnection(input),
  };

  constructor(
    dataDir: string,
    private probe = probeConnection,
  ) {
    this.store = new IntegrationsStore(join(dataDir, 'match.sqlite'));
  }

  list(): PublicConnection[] {
    return this.store.list();
  }

  /** Runs one action from the integrations API; shutdown waits for every running action. */
  execute(input: Input): Promise<unknown> {
    if (this.closing) return Promise.reject(new Error('Service is shutting down.'));
    const action = this.actions[String(input.action)];
    if (!action) return Promise.reject(new Error('Unknown action.'));

    const pending = Promise.resolve().then(() => action(input));
    this.operations.add(pending);
    void pending.finally(() => this.operations.delete(pending)).catch(() => {});
    return pending;
  }

  async warmAliases(): Promise<void> {
    const aliasSources = this.enabledConnections().filter((connection) =>
      connection.capabilities.includes('library-aliases'),
    );
    await Promise.all(aliasSources.map((connection) => this.aliases.load(this.get(connection.id))));
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.operations, this.aliases.settled(), this.titles.settled()]);
    await this.qui.close();
    this.store.close();
  }

  private get(id: string): Connection {
    return this.store.get(id);
  }

  private enabledConnections(): PublicConnection[] {
    return this.list().filter((connection) => connection.enabled);
  }

  private quiConnections(): Connection[] {
    return this.enabledConnections()
      .filter((connection) => connection.kind === 'qui')
      .map((connection) => this.get(connection.id));
  }

  private lookupTitle(input: Input) {
    const { title, target } = parseLookupRequest(input);
    const connections = this.enabledConnections()
      .filter((connection) => servesTarget(connection, target))
      .slice(0, MAX_LOOKUP_INSTANCES)
      .map((connection) => this.get(connection.id));
    return this.titles.lookup(title, target, connections);
  }

  private releasePresence(input: Input) {
    if (typeof input.title !== 'string' || input.title.length > 200) {
      throw new Error('Invalid search title');
    }
    return this.qui.releasePresence(
      this.quiConnections(),
      validateReleases(input.releases),
      input.title,
    );
  }

  private deleteConnection(input: Input) {
    this.qui.clear();
    const id = requireConnectionId(input);
    this.get(id);
    this.store.delete(id);
    return { ok: true };
  }

  private setEnabled(input: Input) {
    this.qui.clear();
    if (typeof input.id !== 'string' || typeof input.enabled !== 'boolean') {
      throw new Error('Invalid enabled state.');
    }
    this.get(input.id);
    this.store.updateEnabled(input.id, input.enabled);
    return { ok: true };
  }

  private async probeOrThrow(connection: Connection, onFailure?: () => void): Promise<string> {
    try {
      return await this.probe(connection);
    } catch (error) {
      onFailure?.();
      throw new Error(error instanceof Error ? error.message : 'Could not connect.');
    }
  }

  private async saveConnection(input: Input) {
    this.qui.clear();
    const connection = this.connectionFrom(input);
    const detail = await this.probeOrThrow(connection);
    const saved: Connection = { ...connection, checkedAt: Date.now(), status: 'connected', detail };
    this.store.save(saved);
    return { ok: true, connection: toPublicConnection(saved) };
  }

  /**
   * Probes a draft connection. When only an id is given (re-testing a saved connection),
   * the outcome is also recorded as that connection's status.
   */
  private async testConnection(input: Input) {
    const connection = this.connectionFrom(input);
    const isSavedProbe =
      typeof input.id === 'string' && CONNECTION_FIELDS.every((key) => input[key] === undefined);
    const recordFailure = () =>
      this.store.updateStatus(connection.id, Date.now(), 'failed', 'Connection failed');

    const detail = await this.probeOrThrow(connection, isSavedProbe ? recordFailure : undefined);
    if (isSavedProbe) this.store.updateStatus(connection.id, Date.now(), 'connected', detail);
    return { ok: true, detail };
  }

  private connectionFrom(input: Input): Connection {
    const existing = typeof input.id === 'string' ? this.get(input.id) : undefined;
    return connectionFromInput(input, existing);
  }
}
