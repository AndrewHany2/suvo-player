// Module-level cache of the primary device anchor, set once at boot (after the
// device signature resolves) and read by every `data` Edge Function call as the
// `x-device-id` header.
let _deviceId = null;

export function setDeviceId(id) {
  _deviceId = id;
}

export function getDeviceId() {
  return _deviceId || "";
}
