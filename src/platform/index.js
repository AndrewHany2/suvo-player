export { PlatformProvider, usePlatform } from "./PlatformProvider";
export { detectPlatform } from "./configs/detectPlatform";
// Load-bearing: importing TVOptimizations runs its module-level auto-apply IIFE
// that injects the TV CSS. Do not drop this re-export.
export { TVOptimizations } from "./optimization/TVOptimizations";
