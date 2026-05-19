import type {
  CdxRepository,
  FetchPendingOptions,
  RetryEntryRow,
} from '../../cdx/repository';
import type { DownloadTask } from '../../request/downloader';

export type IsSyncDone = () => boolean;

const RETRY_TASK_PAGE_SIZE = 128;

/**
 * Feeds DownloadTasks to the consumer while honouring a concurrency cap.
 * The generator pauses before yielding the next task whenever `ongoing`
 * reaches `concurrency`, and resumes once a slot is freed via `onTaskDone()`.
 * This prevents fetching DB pages faster than tasks are being processed.
 *
 * Single-use: `run()` must be called at most once per instance. Create a
 * new instance for each run.
 */
export class RetryTaskQueue {
  private ongoing = 0;
  private hasRun = false;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly cdxRepo: CdxRepository,
    private readonly domains: string[],
    private readonly fetchPendingOptions: FetchPendingOptions,
    private readonly outputFolder: string,
    private readonly replayBaseUrl: string,
    private readonly runId: string,
    private readonly isSyncDone: IsSyncDone,
    /**
     * Per-task runner. If it rejects for any task, `run()` rethrows that
     * first error immediately, without waiting for in-flight tasks to
     * finish. Already-started tasks keep running in the background until
     * they settle; their results and any later rejections are silently
     * dropped.
     */
    private readonly runTask: (task: DownloadTask) => Promise<void>,
  ) {}

  private onTaskDone(): void {
    this.ongoing--;
    this.waiters.shift()?.();
  }

  private waitForSlot(): Promise<void> | void {
    if (this.ongoing < this.concurrency) return;
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private async *emitPageTasks(
    page: RetryEntryRow[],
  ): AsyncGenerator<DownloadTask> {
    for (const entry of page) {
      await this.waitForSlot();
      this.ongoing++;
      yield {
        runId: this.runId,
        timestamp: entry.timestamp,
        original: entry.url,
        domainName: entry.domain_name,
        normalizedDomain: entry.normalized_name,
        outputFolder: this.outputFolder,
        replayBaseUrl: this.replayBaseUrl,
      };
    }
  }

  private async *tasks(): AsyncGenerator<DownloadTask> {
    while (true) {
      await this.waitForSlot();

      const page = this.cdxRepo.findRetryTasksPage({
        domainIds: this.domains,
        runId: this.runId,
        fetchPendingOptions: this.fetchPendingOptions,
        limit: RETRY_TASK_PAGE_SIZE,
      });

      if (page.length === 0) {
        if (!this.isSyncDone()) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }

      yield* this.emitPageTasks(page);
    }
  }

  async run(): Promise<void> {
    if (this.hasRun) {
      throw new Error('RetryTaskQueue.run() can only be called once');
    }
    this.hasRun = true;

    const inflight = new Set<Promise<void>>();
    const tasks = this.tasks();

    // Rejects on the first task failure, letting `run()` throw
    // immediately without waiting for in-flight tasks to finish.
    const { promise: failure, reject: failNow } =
      Promise.withResolvers<never>();

    const loop = (async () => {
      for await (const task of tasks) {
        const taskRun: Promise<void> = this.runTask(task).finally(() => {
          this.onTaskDone();
          inflight.delete(taskRun);
        });
        inflight.add(taskRun);
        // First failure: abort the generator and reject `run()` ASAP.
        // Later failures are absorbed here (this handler returns void),
        // so they don't become unhandled rejections. In-flight tasks
        // keep running in the background; their `.finally` still drains
        // `ongoing`/`inflight`, but the caller has already moved on.
        taskRun.catch((err) => {
          tasks.return(undefined);
          failNow(err);
        });
      }
    })();
    // After a failure the race settles via `failure` and nobody is
    // awaiting `loop` anymore. If the generator then throws (e.g. the
    // next `findRetryTasksPage` call fails) the rejection would be
    // unhandled, so absorb it here.
    loop.catch(() => {});

    await Promise.race([loop, failure]);
  }
}
