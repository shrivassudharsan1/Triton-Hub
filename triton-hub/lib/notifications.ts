import { supabase } from "./supabase";
import type { Update, Category, Notification } from "./types";
import { getNotificationDataOrigin } from "./notification-origin";
import { getNotificationSourceFilter } from "./user-preferences";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

type BackendEmailItem = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string | null;
};

export type InboxEmailFetchResult = {
  emails: BackendEmailItem[];
  error?: string;
  message?: string;
};

async function postInboxEmailsOnce(): Promise<InboxEmailFetchResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch("/api/emails", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_token: session?.provider_token ?? null,
      provider_refresh_token: session?.provider_refresh_token ?? null,
    }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      return {
        emails: [],
        error: "unauthorized",
        message: "Please sign in with Google to view emails",
      };
    }
    return { emails: [] };
  }
  const data = (await res.json()) as {
    emails?: unknown;
    error?: string;
    message?: string;
  };
  return {
    emails: Array.isArray(data.emails) ? (data.emails as BackendEmailItem[]) : [],
    error: typeof data.error === "string" ? data.error : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
  };
}

/**
 * Loads inbox via POST /api/emails with Google tokens from the browser session.
 * Server cookie session often omits provider_token; the client must send it.
 * Runs initialize(), then retries once after refreshSession() if Gmail tokens are still missing.
 */
export async function fetchInboxEmailsFromApi(): Promise<InboxEmailFetchResult> {
  if (typeof window === "undefined") {
    return { emails: [] };
  }
  try {
    await supabase.auth.initialize();
    let result = await postInboxEmailsOnce();

    if (
      result.emails.length === 0 &&
      result.error === "no_provider_token"
    ) {
      await supabase.auth.refreshSession();
      result = await postInboxEmailsOnce();
    }

    return result;
  } catch {
    return { emails: [] };
  }
}

export type FetchNotificationsResult = {
  notifications: Notification[];
  inbox: InboxEmailFetchResult;
};

function getBackendSessionToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem("triton_session_token");
}

function parseFromField(from: string): string {
  if (!from) return "Email";
  const match = from.match(/^(.+?)\s*<.+>$/);
  if (match) return match[1].replace(/"/g, "");
  return from;
}

function emailIdToSyntheticNotificationId(id: string, index: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1_000_000_000;
  }
  return 2_000_000_000 + hash + index;
}

function mergeRawEmailsIntoNotifications(rows: Notification[], emails: BackendEmailItem[]): Notification[] {
  if (emails.length === 0) return rows;

  const seenSummaries = new Set(
    rows.map((row) => (row.summary ?? "").trim().toLowerCase())
  );
  const merged = [...rows];

  emails.forEach((email, index) => {
    const subject = (email.subject || "(No Subject)").trim();
    const summaryKey = subject.toLowerCase();
    if (seenSummaries.has(summaryKey)) return;

    merged.push({
      id: emailIdToSyntheticNotificationId(email.id, index),
      created_at: email.date || new Date().toISOString(),
      source: parseFromField(email.from),
      category: "announcement",
      event_date: "EMPTY",
      event_time: "EMPTY",
      urgency: "medium",
      link: "",
      summary: subject,
      snippet: email.snippet || "",
      user_id: "email",
      completed: false,
    });
    seenSummaries.add(summaryKey);
  });

  return merged.sort((a, b) => safeParseDate(b.created_at).getTime() - safeParseDate(a.created_at).getTime());
}

/**
 * Fetch notifications for the current authenticated user.
 * Uses Supabase session when signed in with email/password, or backend session token when signed in with Google OAuth.
 */
export async function fetchNotifications(): Promise<FetchNotificationsResult> {
  let rows: Notification[] = [];
  const emptyInbox: InboxEmailFetchResult = { emails: [] };

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching notifications:", error);
      throw error;
    }
    rows = data || [];
  } else {
    const backendToken = getBackendSessionToken();
    if (backendToken) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/profile/notifications`, {
          headers: { Authorization: `Bearer ${backendToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          rows = Array.isArray(data) ? data : [];
        }
      } catch (e) {
        console.error("Error fetching notifications from backend:", e);
      }
    }
  }

  const inbox =
    typeof window !== "undefined"
      ? await fetchInboxEmailsFromApi()
      : emptyInbox;
  rows = mergeRawEmailsIntoNotifications(rows, inbox.emails);

  if (typeof window !== "undefined") {
    try {
      const { fetchCanvasMergeNotifications, mergeNotificationsDedupe } = await import("./canvas-feed");
      const canvas = await fetchCanvasMergeNotifications();
      const merged = mergeNotificationsDedupe(rows, canvas);
      return { notifications: applySourceFilter(merged), inbox };
    } catch {
      return { notifications: applySourceFilter(rows), inbox };
    }
  }

  return { notifications: rows, inbox };
}

function applySourceFilter(rows: Notification[]): Notification[] {
  const sourceFilter = getNotificationSourceFilter();
  if (sourceFilter === "both") return rows;
  return rows.filter((n) => getNotificationDataOrigin(n) === sourceFilter);
}

/**
 * Parse event_date and event_time from notifications table into a Date object.
 * Uses local timezone to avoid date shifting issues.
 * Returns null if the date is "EMPTY" or invalid.
 */
function parseEventDateTime(eventDate: string, eventTime: string): Date | null {
  if (!eventDate || eventDate === "EMPTY") {
    return null;
  }

  try {
    // Parse date parts to create date in local timezone (not UTC)
    const [year, month, day] = eventDate.split("-").map(Number);

    if (!eventTime || eventTime === "EMPTY") {
      // Create date at noon local time to avoid any timezone edge cases
      return new Date(year, month - 1, day, 12, 0, 0);
    }

    // Parse time like "11:59 PM" or "11:59 PM PST"
    const timeMatch = eventTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const period = timeMatch[3].toUpperCase();

      if (period === "PM" && hours !== 12) hours += 12;
      if (period === "AM" && hours === 12) hours = 0;

      return new Date(year, month - 1, day, hours, minutes, 0);
    }

    // Fallback: create date at noon local time
    return new Date(year, month - 1, day, 12, 0, 0);
  } catch {
    return null;
  }
}

/**
 * Map notification category to Update category.
 * "personal" maps to "event" for display purposes.
 */
function mapCategory(category: string): Category {
  const validCategories: Category[] = ["announcement", "exam", "assignment", "event", "grade", "personal"];
  if (validCategories.includes(category as Category)) {
    // "personal" items are displayed as events
    if (category === "personal") return "event";
    return category as Category;
  }
  return "event"; // Default fallback
}

/**
 * Safely parse a date string, returning current date if invalid.
 */
function safeParseDate(dateString: string): Date {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return new Date(); // Return current date as fallback
  }
  return date;
}

/**
 * Transform Supabase notifications into the Update[] format used by the dashboard.
 */
export function transformToUpdates(notifications: Notification[]): Update[] {
  const now = new Date();

  return notifications.map((notif) => {
    const eventDateTime = parseEventDateTime(notif.event_date, notif.event_time);
    const category = mapCategory(notif.category);

    // Determine priority based on urgency
    const priority: "urgent" | "normal" = notif.urgency === "high" ? "urgent" : "normal";

    // Use event date/time if available, otherwise fall back to created_at
    const timestamp = eventDateTime || safeParseDate(notif.created_at);

    // For assignments, check if they're urgent (due within 2 days)
    const isAssignment = category === "assignment";
    const isUrgentByDate = isAssignment && eventDateTime &&
      (eventDateTime.getTime() - now.getTime() < 86400000 * 2) &&
      (eventDateTime.getTime() > now.getTime());

    const dataOrigin = getNotificationDataOrigin(notif);
    return {
      id: `notif-${notif.id}`,
      // Filter + badge: live Canvas API vs inbox / DB (Gmail pipeline, manual events)
      source: dataOrigin === "canvas" ? ("canvas" as const) : ("email" as const),
      category,
      title: notif.summary,
      snippet: notif.snippet?.trim() || notif.summary,
      timestamp,
      url: notif.link !== "EMPTY" ? notif.link : "",
      unread: true, // Default to unread
      priority: isUrgentByDate ? "urgent" : priority,
      course: notif.source, // Use source field as course name
      dueDate: eventDateTime || undefined,
      isCompleted: notif.completed ?? false,
    };
  });
}

/**
 * Fetch notifications and transform them to Update[] format in one call.
 */
export async function fetchAndTransformNotifications(): Promise<{
  updates: Update[];
  inbox: InboxEmailFetchResult;
}> {
  const { notifications, inbox } = await fetchNotifications();
  return { updates: transformToUpdates(notifications), inbox };
}

/**
 * Input type for creating a new notification/event.
 */
export type CreateNotificationInput = {
  source: string;
  category: string;
  event_date: string; // Format: "YYYY-MM-DD" or "EMPTY"
  event_time: string; // Format: "HH:MM AM/PM" or "EMPTY"
  urgency: "high" | "medium" | "low";
  link: string;
  summary: string;
};

/**
 * Create a new notification for the current authenticated user.
 * Returns the created notification or throws an error.
 */
export async function createNotification(input: CreateNotificationInput): Promise<Notification> {
  const { data: { session } } = await supabase.auth.getSession();

  const insertData = {
    source: input.source,
    category: input.category,
    event_date: input.event_date || "EMPTY",
    event_time: input.event_time || "EMPTY",
    urgency: input.urgency,
    link: input.link || "EMPTY",
    summary: input.summary,
    completed: false,
  };

  if (session) {
    const { data, error } = await supabase
      .from("notifications")
      .insert({ ...insertData, user_id: session.user.id })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create event: ${error.message}`);
    }
    return data as Notification;
  }

  const backendToken = getBackendSessionToken();
  if (backendToken) {
    const res = await fetch(`${BACKEND_URL}/api/profile/notifications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${backendToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(insertData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Failed to create event");
    }
    return (await res.json()) as Notification;
  }

  throw new Error("You must be logged in to create an event");
}

/**
 * Update a notification's completed status.
 * Returns the updated notification or throws an error.
 */
export async function updateNotificationCompleted(
  notificationId: number,
  completed: boolean
): Promise<Notification> {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    const { data, error } = await supabase
      .from("notifications")
      .update({ completed })
      .eq("id", notificationId)
      .eq("user_id", session.user.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update event: ${error.message}`);
    }
    return data as Notification;
  }

  const backendToken = getBackendSessionToken();
  if (backendToken) {
    const res = await fetch(`${BACKEND_URL}/api/profile/notifications`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${backendToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: notificationId, completed }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || "Failed to update event");
    }
    return (await res.json()) as Notification;
  }

  throw new Error("You must be logged in to update an event");
}
