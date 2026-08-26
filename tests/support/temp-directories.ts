import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TemporaryDirectoryTracker {
  readonly cleanup: () => Promise<void>;
  readonly create: (prefix: string) => Promise<string>;
}

export function createTemporaryDirectoryTracker(): TemporaryDirectoryTracker {
  const directories = new Set<string>();

  return {
    async cleanup() {
      const paths = [...directories];
      directories.clear();
      await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
    },
    async create(prefix) {
      const directory = await mkdtemp(join(tmpdir(), prefix));
      directories.add(directory);
      return directory;
    },
  };
}
