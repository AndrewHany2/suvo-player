// Chooses the base list to merge remote data onto when loading a profile's
// library (watch history / favorites).
//
// The in-memory list is only a trustworthy base when it belongs to the SAME
// key being loaded — otherwise it holds the *previous* profile's data and would
// bleed across profiles (see loadLibrary in AppContext). When the key changed,
// always start from disk instead.
export function pickLibraryBase({ sameKey, inMemory, onDisk }) {
  if (!sameKey) return onDisk;
  return inMemory.length >= onDisk.length ? inMemory : onDisk;
}
