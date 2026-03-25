import { supabase } from "@/lib/supabase";

/**
 * Start the Google OAuth flow via Supabase Auth (no separate backend required).
 * Configure the Google provider + redirect URLs in the Supabase dashboard.
 *
 * With flowType "pkce" on the client, GoTrue redirects the browser automatically;
 * do not call window.location again (that can duplicate navigation).
 */
export async function signInWithGoogle(): Promise<void> {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });
  if (error) throw error;
}
