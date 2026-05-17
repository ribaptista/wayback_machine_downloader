import { isMainThread, workerMain } from '../../worker/worker_utils';
import {
  getFileMatches,
  type SearchCondition,
  type FileMatches,
} from './file_search';

export interface WorkerRequest {
  filePath: string;
  conditions: SearchCondition[];
}

export type FileSearchSuccessfulResult = FileMatches & { result: 'success' };

if (!isMainThread) {
  workerMain<WorkerRequest, FileSearchSuccessfulResult>((req) => ({
    result: 'success',
    ...getFileMatches(req.filePath, req.conditions),
  }));
}
