import fs from 'fs';
import path from 'path';

/**
 * Writes `data` to `filePath`, creating parent directories as needed.
 * Assumes the caller has exclusive access (no tmp-rename dance needed).
 */
export async function saveFileUnsafe(
  filePath: string,
  data: Buffer,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, data);
}

/**
 * Writes `data` to `tmpPath` then renames it to `finalPath`.
 * If `finalPath` already exists (EEXIST), the tmp file is removed and the
 * function returns `false`. Returns `true` when the file was newly created.
 * Parent directory of `finalPath` must already exist (or be created by the caller).
 */
export async function saveFileSafe(
  finalPath: string,
  tmpPath: string,
  data: Buffer,
): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.promises.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.promises.writeFile(tmpPath, data);
  return renameTmpOrDiscard(tmpPath, finalPath);
}

/**
 * Attempts to rename `tmpPath` to `finalPath`.
 * If `finalPath` already exists (EEXIST), removes `tmpPath` and returns `false`.
 * Returns `true` when the rename succeeded.
 */
export async function renameTmpOrDiscard(
  tmpPath: string,
  finalPath: string,
): Promise<boolean> {
  try {
    await fs.promises.rename(tmpPath, finalPath);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'EEXIST') {
      throw err;
    }
    await fs.promises.unlink(tmpPath).catch(() => {
      console.warn(`Failed to remove tmp file ${tmpPath}:`, err);
    });
    return false;
  }
}
