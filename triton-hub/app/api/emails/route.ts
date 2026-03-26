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

const BLOCKED_FROM_PATTERNS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "notifications@github",
  "@github.com",
  "notifications@linkedin",
  "notify@twitter",
  "notify@x.com",
  "notification@instagram",
  "facebookmail.com",
  "amazonses.com",
  "bounce.",
  "postmaster@",
];

const BLOCKED_SUBJECT_PATTERNS = [
  /^\[github\]/i,
  /^\[google\]/i,
  /^\[linkedin\]/i,
  /^\[twitter\]/i,
  /^\[instagram\]/i,
  /^\[facebook\]/i,
  /^\[slack\]/i,
  /verification code/i,
  /confirm your email/i,
  /\botp\b/i,
  /one-time password/i,
  /one time password/i,
  /sign-in link/i,
  /magic link/i,
  /login attempt/i,
  /security alert/i,
  /password reset/i,
  /account recovery/i,
  /has been added to your account/i,
  /authorized to access your account/i,
  /third-party.*application/i,
  /unsubscribe/i,
];

const BLOCKED_SNIPPET_PATTERNS = [
  /unsubscribe/i,
  /opt.?out/i,
  /view in browser/i,
];

/**
 * Deterministic pre-filter — always runs, no API key needed.
 * Drops obvious automated/junk emails by sender and subject patterns.
 */
function preFilterEmails(emails: EmailRow[]): EmailRow[] {
  return emails.filter((e) => {
    const fromLower = (e.from || "").toLowerCase();
    if (BLOCKED_FROM_PATTERNS.some((p) => fromLower.includes(p))) return false;

    const subject = e.subject || "";
    if (BLOCKED_SUBJECT_PATTERNS.some((p) => p.test(subject))) return false;

    const snippet = e.snippet || "";
    if (BLOCKED_SNIPPET_PATTERNS.some((p) => p.test(snippet))) return false;

    return true;
  });
}

/**
 * Uses Gemini Flash to filter the email list down to only items relevant to a student:
 * professor/TA messages, course updates, academic deadlines, career/internship emails, etc.
 * Verification codes, newsletters, promotions, and automated receipts are discarded.
 * Falls back to returning all emails unchanged if GEMINI_API_KEY is not set or the call fails.
 */
async function filterEmailsWithGemini(emails: EmailRow[]): Promise<EmailRow[]> {
  // Layer 1: always-on deterministic filter (no API key needed)
  const preFiltered = preFilterEmails(emails);

  // Layer 2: Gemini refines further if key is available
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || preFiltered.length === 0) return preFiltered;

  const emailList = preFiltered
    .map((e) => `ID: ${e.id}\nFrom: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`)
    .join("\n---\n");

  const prompt = `You are a strict email filter for a college student dashboard. Be conservative — when in doubt, SKIP.

Only mark an email IMPORTANT if it clearly fits one of these categories:
1. CLASS emails — a real human (professor, TA, instructor) directly emailing about coursework, grades, office hours, exams, or assignments. Canvas/Gradescope/Piazza assignment or grade notifications also count.
2. CLUB / STUDENT ORG emails — a student club, organization, or campus group emailing about meetings, events, or opportunities.
3. INTERNSHIP / RESEARCH / JOB emails — a recruiter, company, or research lab reaching out about a specific opportunity, application status, or interview.

SKIP everything else, including:
- Security alerts, login notifications, OAuth app additions, account activity (GitHub, Google, any platform)
- Verification codes, OTPs, magic links, "confirm your email" messages
- Newsletters, digests, product updates, marketing from any company
- Social media notifications (likes, follows, comments, digests) from Instagram, LinkedIn, Twitter, etc.
- Automated receipts, order confirmations, shipping updates
- University-wide mass blast emails (parking, campus construction, general IT notices)
- Any "no-reply" automated email that is not a direct Canvas/Gradescope/Piazza academic notification

Respond ONLY with a JSON array of IDs for IMPORTANT emails. Example: ["id1","id2"]
If none qualify, respond with [].

Emails to classify:
${emailList}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );
    if (!res.ok) return preFiltered;

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const importantIds = new Set<string>(JSON.parse(text) as string[]);
    return preFiltered.filter((e) => importantIds.has(e.id));
  } catch {
    return preFiltered;
  }
}

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

  const filtered = await filterEmailsWithGemini(result.emails);
  return NextResponse.json({ emails: filtered, debug: result.debug });
}

export async function GET() {
  return handleEmails(new Request("http://localhost", { method: "GET" }));
}

export async function POST(request: Request) {
  return handleEmails(request);
}
