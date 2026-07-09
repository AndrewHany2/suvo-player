// Native (iOS/Android) DownloadManager implementation. Wraps
// @kesha-antonov/react-native-background-downloader (true background transfers)
// and expo-file-system/legacy (paths, free space, delete) behind the
// DownloadManager contract (see ./DownloadManager.js). No other module should
// import either library directly.
//
// NOTE: expo-file-system's default export (Expo SDK 54) is the new API and
// does not expose documentDirectory / getFreeDiskStorageAsync /
// makeDirectoryAsync / deleteAsync — those live in the legacy submodule.
import * as FileSystem from 'expo-file-system/legacy';
import {
  createDownloadTask,
  getExistingDownloadTasks,
} from '@kesha-antonov/react-native-background-downloader';

export const documentDirectory = FileSystem.documentDirectory;

/** @returns {import('./DownloadManager.js').DownloadManager} */
export function createNativeDownloadManager() {
  const handlers = new Set();
  const tasks = new Map(); // id -> task

  const emit = (e) => handlers.forEach((h) => h(e));

  function wire(task) {
    tasks.set(task.id, task);
    task
      .begin(({ expectedBytes }) =>
        emit({ id: task.id, type: 'progress', bytesDone: 0, bytesTotal: expectedBytes || 0 }))
      .progress(({ bytesDownloaded, bytesTotal }) =>
        emit({ id: task.id, type: 'progress', bytesDone: bytesDownloaded, bytesTotal }))
      .done(() => {
        emit({ id: task.id, type: 'done' });
        tasks.delete(task.id);
      })
      .error(({ error }) => {
        emit({ id: task.id, type: 'error', error: String(error) });
        tasks.delete(task.id);
      });
    return task;
  }

  async function ensureDir(localPath) {
    const dir = localPath.slice(0, localPath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  }

  return {
    async start({ id, url, localPath }) {
      await ensureDir(localPath);
      const destination = localPath.replace('file://', '');
      const task = wire(createDownloadTask({ id, url, destination }));
      task.start();
    },
    pause(id) {
      tasks.get(id)?.pause?.();
    },
    resume(id) {
      tasks.get(id)?.resume?.();
    },
    async cancel(id) {
      const t = tasks.get(id);
      await t?.stop?.();
      tasks.delete(id);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async reattach() {
      const existing = await getExistingDownloadTasks();
      existing.forEach((task) => wire(task));
    },
    async freeBytes() {
      return FileSystem.getFreeDiskStorageAsync();
    },
  };
}
