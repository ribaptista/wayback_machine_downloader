import { isMainThread, parentPort } from 'worker_threads';
import { toPlainNonFatalWorkerError } from './error';

export { isMainThread };

export function workerMain<TRequest, TResponse>(
  handler: (req: TRequest) => TResponse | Promise<TResponse>,
): void {
  if (parentPort === null)
    throw new Error('workerMain called from main thread');
  const port = parentPort;
  port.on('message', async (req: TRequest) => {
    try {
      port.postMessage(await handler(req));
    } catch (err) {
      port.postMessage(toPlainNonFatalWorkerError(err));
    }
  });
}
