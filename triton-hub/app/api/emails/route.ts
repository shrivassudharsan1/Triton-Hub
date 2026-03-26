import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type GmailMessageList = { messages?: { id: string }[] };

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

type ClientTokens = {
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

function headerFromPayload(msg: GmailMessage, name: string): string {
  const headers = msg.payload?.headers;
  if (!headers) return "";
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return typeof data.access_token === "string" ? data.access_token : null;
}

async function fetchMessageList(
  accessToken: string,
  listUrl: string
): Promise<{ ok: boolean; status: number; ids: string[] }> {
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    return { ok: false, status: listRes.status, ids: [] };
  }
  const listData = (await listRes.json()) as GmailMessageList;
  const ids = (listData.messages ?? []).map((m) => m.id).filter(Boolean);
  return { ok: true, status: 200, ids };
}

type InboxDebug = {
  inboxLabelCount: number;
  inboxLabelStatus: number;
  fallbackQueryCount: number | null;
  fallbackQueryStatus: number | null;
  metadataFetched: number;
  metadataSucceeded: number;
};

async function fetchInboxWithAccessToken(accessToken: string) {
  const debug: InboxDebug = {
    inboxLabelCount: 0,
    inboxLabelStatus: 0,
    fallbackQueryCount: null,
    fallbackQueryStatus: null,
    metadataFetched: 0,
    metadataSucceeded: 0,
  };

  // Try primary: INBOX label
  const inboxUrl =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=25";
  const primary = await fetchMessageList(accessToken, inboxUrl);
  debug.inboxLabelStatus = primary.status;
  if (!primary.ok) {
    return { ok: false as const, status: primary.status, emails: [] as EmailRow[], debug };
  }
  debug.inboxLabelCount = primary.ids.length;

  let ids = primary.ids;

  // Fallback: q=is:inbox (catches non-standard inbox setups)
  if (ids.length === 0) {
    const qUrl = encodeURIComponent("is:inbox");
    const fallbackUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${qUrl}&maxResults=25`;
    const fallback = await fetchMessageList(accessToken, fallbackUrl);
    debug.fallbackQueryStatus = fallback.status;
    debug.fallbackQueryCount = fallback.ids.length;
    if (!fallback.ok) {
      return { ok: false as const, status: fallback.status, emails: [] as EmailRow[], debug };
    }
    ids = fallback.ids;
  }

  // Tertiary: recent mail (any label) — catches archived-inbox setups
  if (ids.length === 0) {
    const anyUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10";
    const anyList = await fetchMessageList(accessToken, anyUrl);
    if (anyList.ok && anyList.ids.length > 0) {
      ids = anyList.ids;
    }
  }

  if (ids.length === 0) {
    return { ok: true as const, status: 200, emails: [] as EmailRow[], debug };
  }

  debug.metadataFetched = ids.length;
  const details = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!r.ok) return null;
      return (await r.json()) as GmailMessage;
    })
  );

  const emails: EmailRow[] = [];
  for (const msg of details) {
    if (!msg?.id) continue;
    emails.push({
      id: msg.id,
      snippet: msg.snippet ?? "",
      subject: headerFromPayload(msg, "Subject"),
      from: headerFromPayload(msg, "From"),
      date: headerFromPayload(msg, "Date") || null,
    });
  }
  debug.metadataSucceeded = emails.length;
  return { ok: true as const, status: 200, emails, debug };
}

type EmailRow = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string | null;
};

async function parseClientTokens(request: Request): Promise<ClientTokens | null> {
  if (request.method !== "POST") return null;
  try {
    const json = (await request.json()) as Record<string, unknown>;
    return {
      provider_token:
        typeof json.provider_token === "string" ? json.provider_token : null,
      provider_refresh_token:
        typeof json.provider_refresh_token === "string"
          ? json.provider_refresh_token
          : null,
    };
  } catch {
    return null;
  }
}

async function handleEmails(request: Request) {
  const clientTokens = await parseClientTokens(request);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ignore when called from route without mutable cookies
          }
        },
      },
    }
  );

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.user) {
    return NextResponse.json({ emails: [] }, { status: 401 });
  }

  const clientPt = clientTokens?.provider_token?.trim() || null;
  const clientRt = clientTokens?.provider_refresh_token?.trim() || null;

  let accessToken =
    clientPt || (session.provider_token && session.provider_token.trim()) || null;
  const sessionRefresh =
    clientRt ||
    (session.provider_refresh_token && session.provider_refresh_token.trim()) ||
    null;

  let profileSchemaOutdated = false;
  if (sessionRefresh) {
    const { error: persistErr } = await supabase
      .from("profiles")
      .update({
        google_refresh_token: sessionRefresh,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.user.id);
    if (persistErr) {
      const msg = persistErr.message || "";
      const code = (persistErr as { code?: string }).code;
      if (
        code === "42703" ||
        /google_refresh_token/i.test(msg) ||
        /does not exist/i.test(msg)
      ) {
        profileSchemaOutdated = true;
      }
    }
  }

  if (!accessToken && sessionRefresh) {
    accessToken = await refreshGoogleAccessToken(sessionRefresh);
  }

  if (!accessToken) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("google_refresh_token")
      .eq("id", session.user.id)
      .maybeSingle();
    const stored = profile?.google_refresh_token?.trim();
    if (stored) {
      accessToken = await refreshGoogleAccessToken(stored);
    }
  }

  if (!accessToken) {
    if (profileSchemaOutdated) {
      return NextResponse.json({
        emails: [],
        error: "schema_outdated",
        message:
          "Add column google_refresh_token to public.profiles (run supabase/gmail_refresh_token.sql in the Supabase SQL editor), then reload.",
      });
    }
    return NextResponse.json({
      emails: [],
      error: "no_provider_token",
      message:
        "Gmail access is not available yet. Sign out and sign in with Google again (Gmail permission). In Google Cloud, add gmail.readonly to the OAuth client used by Supabase; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Vercel for token refresh.",
    });
  }

  let result = await fetchInboxWithAccessToken(accessToken);

  if (!result.ok && result.status === 401) {
    const altRefresh =
      sessionRefresh ||
      (
        await supabase
          .from("profiles")
          .select("google_refresh_token")
          .eq("id", session.user.id)
          .maybeSingle()
      ).data?.google_refresh_token?.trim();
    if (altRefresh) {
      const next = await refreshGoogleAccessToken(altRefresh);
      if (next) {
        result = await fetchInboxWithAccessToken(next);
      }
    }
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        emails: [],
        error: "gmail_api_error",
        message: "Could not load Gmail. Try signing out and signing in again.",
        debug: result.debug,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ emails: result.emails, debug: result.debug });
}

export async function GET() {
  return handleEmails(new Request("http://localhost", { method: "GET" }));
}

export async function POST(request: Request) {
  return handleEmails(request);
}
