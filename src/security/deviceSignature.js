// Device signature for native RN targets (iOS, Android). Returns
// { primary, platform, secondary }.
//
//   primary   iOS identifierForVendor / Android SSAID — the access anchor.
//             (Plan 2 upgrades this to hardware attestation: App Attest /
//             Play Integrity, which is unforgeable.)
//   secondary informational composite fingerprint (never gates access).
import * as Application from "expo-application";
import { Platform } from "react-native";
import { fingerprintHash } from "./secondaryFingerprint.js";

export async function getDeviceSignature() {
  const platform = Platform.OS; // 'ios' | 'android'
  let primary;
  if (platform === "ios") {
    primary = await Application.getIosIdForVendorAsync();
  } else {
    primary = Application.getAndroidId();
  }
  const secondary = fingerprintHash({
    os: platform,
    osVersion: Platform.Version,
    appVersion: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
  });
  return { primary: primary || "unknown", platform, secondary };
}
