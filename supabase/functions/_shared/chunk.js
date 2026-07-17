// Split an array into consecutive chunks of at most `size`. Used to keep
// PostgREST `.in(...)` filters — which serialize into the request URL — under
// practical URL-length limits when batching lookups over many ids. Pure; no I/O
// and no imports, so it runs under BOTH the Deno edge runtime and node:test.
export function chunk(arr, size) {
  const list = Array.isArray(arr) ? arr : [];
  const n = Number.isInteger(size) && size > 0 ? size : list.length || 1;
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
