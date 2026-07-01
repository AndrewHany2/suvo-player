// Pure device-binding decision. The atomic INSERT lives in the claim-device
// Edge Function; this is the decision made from its result, kept pure so it can
// be unit-tested in isolation and mirrored server-side.
//
//   insertedRow   the row returned by INSERT ... ON CONFLICT DO NOTHING RETURNING *
//                 (truthy only when THIS login just claimed the device), else null
//   existingRow   the row re-selected on conflict ({ device_id }), else null
//   callerDeviceId the primary device anchor the caller presented
function evaluateBinding({ insertedRow, existingRow, callerDeviceId }) {
  if (insertedRow) return { status: "bound" };
  if (!callerDeviceId) return { status: "denied" };
  if (existingRow && existingRow.device_id === callerDeviceId)
    return { status: "ok" };
  return { status: "denied" };
}

module.exports = { evaluateBinding };
