/** True on TV builds — the build's index.html sets globalThis.__TV__. */
export const isTV = () =>
  typeof globalThis !== "undefined" && globalThis.__TV__ === true;
