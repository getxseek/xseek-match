import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

/** Only disposable search files are eligible, never the database or settings. */
export async function pruneSearchCache(
  dir: string,
  ttlMs: number,
  budgetBytes = 128 * 1024 * 1024,
): Promise<void> {
  const files = await readdir(dir).catch(() => []);
  const entries = await Promise.all(
    files
      .filter((name) => /^search-[a-f0-9]{64}\.json$/.test(name))
      .map(async (name) => {
        const path = join(dir, name);
        const meta = await stat(path).catch(() => null);
        return meta?.isFile() ? { path, at: meta.mtimeMs, size: meta.size } : null;
      }),
  );

  const sortedEntries = entries
    .filter((entry) => entry !== null)
    .sort((left, right) => right.at - left.at);

  let retainedBytes = 0;
  for (const entry of sortedEntries) {
    const isExpired = Date.now() - entry.at >= ttlMs;
    const exceedsBudget = retainedBytes + entry.size > budgetBytes;
    if (isExpired || exceedsBudget) {
      await rm(entry.path, { force: true });
    } else {
      retainedBytes += entry.size;
    }
  }
}
