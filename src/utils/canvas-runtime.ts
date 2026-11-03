/**
 * Lazy loader for `@napi-rs/canvas`.
 *
 * The package ships per-platform native binaries, so it is external in the
 * esbuild bundle and may be missing on a host that skipped `npm install`.
 * Loading it lazily keeps a missing native addon from crashing the bot: the
 * callers (rank card / leaderboard) fall back to plain embeds instead.
 */
export type CanvasModule = typeof import('@napi-rs/canvas');

let loading: Promise<CanvasModule | null> | null = null;

export function loadCanvas(): Promise<CanvasModule | null> {
  if (!loading) {
    loading = import('@napi-rs/canvas')
      .then((mod) => {
        // In the CJS bundle the dynamic import may surface the package as
        // `default` instead of named exports depending on the loader heuristics.
        const candidate = mod as unknown as { createCanvas?: unknown; default?: unknown };
        if (typeof candidate.createCanvas === 'function') return mod;
        const fallback = candidate.default as CanvasModule | undefined;
        if (fallback && typeof fallback.createCanvas === 'function') return fallback;
        throw new Error('module did not expose createCanvas');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Canvas] @napi-rs/canvas is unavailable (${message}); rank cards will use embeds.`,
        );
        return null;
      });
  }
  return loading;
}
