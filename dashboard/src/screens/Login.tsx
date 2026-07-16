import React, { useState } from "react";
import { signIn, apiErrorMessage } from "../api";
import { useAuth } from "../auth";
import { Button, Field } from "../ui";

export default function Login() {
  const { error: authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      // On success, supabase's onAuthStateChange (wired in AuthProvider) picks
      // up the new session and loads `me` — no navigation needed here.
    } catch (e) {
      setError(apiErrorMessage((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  }

  // Prefer the error from this submit attempt; fall back to the auth gate's
  // error (e.g. a non-provider account that was just rejected).
  const message = error ?? authError;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Suvo Dashboard</h1>
        {message && <p className="field-error">{message}</p>}
        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" disabled={submitting} className="login-submit">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
