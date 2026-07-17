import { supabase } from "./supabase";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin`;

const MESSAGES: Record<string, string> = {
  QUOTA_EXCEEDED: "Account quota reached — raise the provider's limit to add more.",
  PROVIDER_HAS_ACCOUNTS: "Delete or reassign this provider's accounts first.",
  CANNOT_DELETE_SELF: "You can't delete your own account.",
  NOT_A_PROVIDER: "That account can't be deleted here.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID_INPUT: "Some fields are invalid — check and try again.",
  CREATE_FAILED: "Could not create — the email may already exist.",
  UPDATE_FAILED: "Could not save your changes — please try again.",
  UNKNOWN_ACTION: "That action isn't supported.",
  SERVER_ERROR: "Something went wrong on our end — please try again.",
  Unauthorized: "Your session expired — please sign in again.",
};
export function apiErrorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function call<T = any>(action: string, payload: unknown = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Unauthorized");
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error ?? `HTTP_${res.status}`);
    // Preserve per-field validation errors (e.g. INVALID_INPUT → {fields:[...]})
    // so callers like the CreateAccount form can highlight the bad inputs.
    (err as any).fields = body?.fields;
    throw err;
  }
  return body as T;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}
export async function signOut() { await supabase.auth.signOut(); }
