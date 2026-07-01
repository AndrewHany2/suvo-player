// Pure device-claim decision — mirror of the claim_device SQL function
// (the SQL, guarded by a per-user advisory lock, is authoritative). Kept pure
// so the intended semantics stay unit-tested in isolation.
//
//   deviceId           the primary device anchor the caller presented
//   deviceAlreadyBound this (user_id, device_id) already has a binding row
//   currentCount       how many devices this account currently holds
//   limit              effective device limit (per-account override ?? global default)
//
// Access uses the PRIMARY anchor only; the secondary composite never gates.
function evaluateClaim({ deviceId, deviceAlreadyBound, currentCount, limit }) {
  if (!deviceId) return "denied";
  if (deviceAlreadyBound) return "ok"; // known device, refresh last_seen
  if (currentCount < limit) return "bound"; // free slot → claim
  return "denied"; // at limit, admin-only unbind
}

module.exports = { evaluateClaim };
