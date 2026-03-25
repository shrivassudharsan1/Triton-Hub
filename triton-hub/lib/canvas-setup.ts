import { supabase } from "@/lib/supabase";

const DEFAULT_CANVAS_URL = "https://canvas.ucsd.edu";

/**
 * Reads the user's Canvas token from Supabase `profiles` and mirrors it into
 * `sessionStorage` (where Canvas API helpers read from). Call after Google login
 * and on dashboard routes so fetches work even when `sessionStorage` was empty.
 *
 * @returns true if a non-empty token exists and was written to sessionStorage
 */
export async function hydrateCanvasTokenFromSupabase(
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("canvas_token")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("hydrateCanvasTokenFromSupabase:", error);
    return false;
  }

  const t = data?.canvas_token?.trim();
  if (!t) return false;

  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("canvas_token", t);
    sessionStorage.setItem("canvas_url", DEFAULT_CANVAS_URL);
  }
  return true;
}

/**
 * True when the user must visit /setup (no Canvas token stored on the profile).
 * When a token exists, this also hydrates sessionStorage — same as a successful
 * `hydrateCanvasTokenFromSupabase` call.
 */
export async function needsCanvasSetup(userId: string): Promise<boolean> {
  return !(await hydrateCanvasTokenFromSupabase(userId));
}
