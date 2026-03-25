import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client: PKCE + session state live in cookies (via @supabase/ssr),
 * which survives the Google redirect. Plain createClient() stored the verifier in
 * localStorage and broke exchangeCodeForSession on return.
 */
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      flowType: "pkce",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);
