export interface AggregatedStats {
  count: number;
  total: number;
  avg: number;
  max: number;
}

export function aggregateStats(durations: number[]): AggregatedStats {
  const count = durations.length;
  const total = durations.reduce((a, b) => a + b, 0);
  const max = count ? Math.max(...durations) : 0;
  const avg = count ? Math.round(total / count) : 0;
  return { count, total, avg, max };
}

export function withTimingLog(prefix: string) {
  return function t<T>(label: string, fn: () => T): T {
    const start = Date.now();
    const result = fn();
    console.log(`[${prefix}] ${label}: ${Date.now() - start}ms`);
    return result;
  };
}
