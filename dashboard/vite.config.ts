import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Security headers for the built app. Applied to `vite preview` (which serves
// the production build) so CSP violations surface BEFORE deploy. The dev server
// (`vite`) is intentionally left unconstrained — a strict CSP blocks Vite's HMR
// client. Your HOST must send the equivalent headers in production; see
// public/_headers (Netlify / Cloudflare Pages form — translate to nginx/vercel
// as needed). frame-ancestors + X-Frame-Options can ONLY come from real response
// headers, not a <meta> tag, so they live here and in _headers, not index.html.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
};

export default defineConfig({
  plugins: [react()],
  preview: { headers: SECURITY_HEADERS },
});
