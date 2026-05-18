import cliProgress from 'cli-progress';

export type ProgressStats = {
  total: number;
  metrics: BarMetrics;
};

type BarMetrics = {
  succeeded: number;
  failed: number;
  scanned: number;
  newEntries: number;
};

export class ProgressTracker {
  private total: number;
  private metrics: BarMetrics = {
    succeeded: 0,
    failed: 0,
    scanned: 0,
    newEntries: 0,
  };

  private multiBar: cliProgress.MultiBar;
  private bar: cliProgress.SingleBar | null = null;

  constructor(total: number) {
    this.total = total;
    this.multiBar = new cliProgress.MultiBar(
      {
        format:
          'Progress |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed} | cdx scanned: {scanned} | new: {newEntries} | ETA: {eta_formatted}',
        clearOnComplete: false,
        hideCursor: true,
        forceRedraw: true,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  startProgressBar(): void {
    this.bar = this.multiBar.create(this.total, 0, this.metrics);
  }

  stopProgressBar(): void {
    this.multiBar.stop();
  }

  log(msg: string): void {
    this.multiBar.log(msg + '\n');
  }

  getStats(): ProgressStats {
    return {
      total: this.total,
      metrics: this.metrics,
    };
  }

  onEntriesSynced(scanned: number, newEntries: number): void {
    this.metrics.scanned += scanned;
    this.metrics.newEntries += newEntries;
    if (newEntries > 0) {
      this.total += newEntries;
      this.bar?.setTotal(this.total);
    }
    this.bar?.update(this.metrics);
  }

  pushResult(ok: boolean): void {
    if (ok) this.metrics.succeeded++;
    else this.metrics.failed++;
    this.bar?.increment(this.metrics);
  }
}
