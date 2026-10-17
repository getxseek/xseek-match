const CONCURRENCY = 6;
const PER_ICON_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 20_000;

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(resolve, PER_ICON_TIMEOUT_MS);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onload = settle;
    image.onerror = settle;
    image.src = src;
  });
}

/**
 * Loads every indexer icon once so the server caches it and the browser can show it at once.
 * Missing or slow icons never fail the warm-up; it simply ends at the overall time limit.
 */
export async function warmIndexerIcons(sources: string[]): Promise<void> {
  let next = 0;

  const worker = async () => {
    while (next < sources.length) {
      const source = sources[next++]!;
      await loadImage(source);
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker);
  await Promise.race([
    Promise.all(workers),
    new Promise((resolve) => setTimeout(resolve, OVERALL_TIMEOUT_MS)),
  ]);
}
