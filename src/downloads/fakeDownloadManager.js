export function createFakeDownloadManager() {
  const handlers = new Set();
  const started = [];
  return {
    started,
    start(task) { started.push(task.id); },
    pause() {},
    resume() {},
    cancel() {},
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async reattach() {},
    async freeBytes() { return 64 * 1e9; },
    // test helper
    emit(event) { handlers.forEach((h) => h(event)); },
  };
}
