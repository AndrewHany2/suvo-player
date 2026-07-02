import { createContext, useContext, useMemo } from "react";
import { detectPlatform } from "./configs/detectPlatform";

const PlatformContext = createContext(null);

export function PlatformProvider({ children }) {
  const value = useMemo(() => {
    const platform = detectPlatform();
    return { platform, isTV: platform === "tv" };
  }, []);

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
