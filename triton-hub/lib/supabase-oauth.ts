import { supabase } from "@/lib/supabase";

/**
 * Public URL of the Next app (no trailing slash). Set on Vercel to your production
 * domain so OAuth never falls back to Supabase "Site URL" when it is still localhost.
 *
 * Supabase must allow `redirect_to`: add `${origin}/auth/callback` under Authentication → Redirect URLs
 * and set Site URL to the same production origin.
 */
function getOAuthRedirectOrigin(): string {
  if (typeof window === "undefined") return "";
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return window.location.origin;
}

/**
 * Start the Google OAuth flow via Supabase Auth (no separate backend required).
 * Configure the Google provider + redirect URLs in the Supabase dashboard.
 *
 * With flowType "pkce" on the client, GoTrue redirects the browser automatically;
 * do not call window.location again (that can duplicate navigation).
 */
export async function signInWithGoogle(): Promise<void> {
  const origin = getOAuthRedirectOrigin();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) throw error;
}
