import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { call, signOut, apiErrorMessage } from "./api";
import { supabase } from "./supabase";
import { shouldRejectSession, isAllowedRole } from "./authGate";

type Me = { role: string; name: string; quota: { used: number; max: number } };
const Ctx = createContext<{ me: Me | null; loading: boolean; error: string | null; refresh: () => void; logout: () => void }>(null!);

const GATE_MESSAGE = "This login is not a provider account.";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reject = useCallback(async () => {
    await signOut();
    setMe(null);
    setError(GATE_MESSAGE);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setMe(null); setLoading(false); return; }
    try {
      const result = await call<Me>("me");
      // Defense-in-depth: even though the backend never resolves `me` for a
      // customer, don't rely on that alone — reject any non-allowed role.
      if (isAllowedRole(result.role)) setMe(result);
      else await reject();
    } catch (e) {
      const code = (e as Error).message;
      if (shouldRejectSession(code)) {
        // Not allowed in (FORBIDDEN / Unauthorized) → tear down the session.
        await reject();
      } else {
        // Transient / backend error (SERVER_ERROR, HTTP_*, network): keep the
        // session and surface a retryable error — don't mislabel a real provider.
        setError(apiErrorMessage(code));
      }
    } finally {
      setLoading(false);
    }
  }, [reject]);

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // The explicit load() above already covers the initial session; ignoring
      // INITIAL_SESSION avoids a duplicate `me` round-trip on every page load.
      if (event === "INITIAL_SESSION") return;
      load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const logout = useCallback(() => { signOut(); setMe(null); }, []);
  return <Ctx.Provider value={{ me, loading, error, refresh: load, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
