"use client";

import { useState, useEffect } from "react";
import { Loader2, Megaphone, ExternalLink, Check } from "lucide-react";
import { fetchNotifications } from "@/lib/notifications";
import { format } from "date-fns";
import type { Notification } from "@/lib/types";
import type { DataOrigin } from "@/lib/notification-origin";
import { getNotificationDataOrigin } from "@/lib/notification-origin";
import { DataOriginBadge } from "@/components/dashboard/data-origin-badge";
import { cn } from "@/lib/utils";

interface AnnouncementItem {
    id: string;
    title: string;
    message: string;
    postedAt: string | null;
    courseName?: string;
    courseCode?: string;
    htmlUrl: string;
    dataOrigin: DataOrigin;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
const READ_ANNOUNCEMENTS_KEY = "triton_read_announcements";

export function AnnouncementView() {
    const [announcements, setAnnouncements] = useState<AnnouncementItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [readIds, setReadIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const stored = localStorage.getItem(READ_ANNOUNCEMENTS_KEY);
        if (stored) {
            try {
                setReadIds(new Set(JSON.parse(stored)));
            } catch {
                localStorage.removeItem(READ_ANNOUNCEMENTS_KEY);
            }
        }
    }, []);

    useEffect(() => {
        const loadAnnouncements = async () => {
            setLoading(true);
            setError(null);

            try {
                const { notifications } = await fetchNotifications();

                // Filter for announcements only
                const announcementNotifs = notifications.filter(
                    (n: Notification) => n.category === "announcement"
                );

                // Transform to AnnouncementItem format
                const items: AnnouncementItem[] = announcementNotifs.map((n: Notification) => ({
                    id: `notif-${n.id}`,
                    title: n.summary,
                    message: n.summary,
                    postedAt: n.created_at,
                    courseName: n.source,
                    courseCode: n.source,
                    htmlUrl: n.link !== "EMPTY" ? n.link : "",
                    dataOrigin: getNotificationDataOrigin(n),
                }));

                // Sort by postedAt descending (newest first)
                items.sort((a, b) => {
                    if (!a.postedAt) return 1;
                    if (!b.postedAt) return -1;
                    return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
                });

                setAnnouncements(items);
            } catch (err: any) {
                console.error(err);
                setError(err.message || "Failed to fetch announcements");
            } finally {
                setLoading(false);
            }
        };

        loadAnnouncements();
    }, []);

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Unknown date';
        return format(new Date(dateStr), 'MMM d, h:mm a');
    };

    const toggleRead = (id: string) => {
        setReadIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            localStorage.setItem(READ_ANNOUNCEMENTS_KEY, JSON.stringify([...next]));
            return next;
        });
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive font-medium">
                Error: {error}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-card/80 p-6 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Announcements</p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Recent updates across your classes</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                            Email-origin and Canvas-origin updates are grouped in one calmer view so you can read, triage, and move on.
                        </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-secondary/80 px-3 py-1 text-xs font-semibold text-secondary-foreground">
                    {announcements?.length || 0} Total
                    </span>
                </div>
            </div>

            {announcements && announcements.length > 0 ? (
                <div className="space-y-4">
                    {announcements.map((a) => (
                        <div
                            key={a.id}
                            className={cn(
                                "group relative flex flex-col gap-3 rounded-[24px] border border-white/10 bg-card/80 p-6 shadow-sm transition-all",
                                readIds.has(a.id) ? "opacity-65" : "hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md"
                            )}
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <DataOriginBadge origin={a.dataOrigin} size="sm" />
                                    <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {a.courseCode || a.courseName}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatDate(a.postedAt)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => toggleRead(a.id)}
                                        className={cn(
                                            "inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors",
                                            readIds.has(a.id)
                                                ? "bg-green-500/20 text-green-600 dark:text-green-400"
                                                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                        )}
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                        {readIds.has(a.id) ? "Read" : "Mark as read"}
                                    </button>
                                    {a.htmlUrl ? (
                                        <a href={a.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                                            <ExternalLink className="h-4 w-4" />
                                        </a>
                                    ) : null}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold leading-tight tracking-tight text-foreground transition-all group-hover:text-primary">
                                    {a.title}
                                </h3>
                                <div className="mt-2 text-sm leading-7 text-muted-foreground">
                                    {a.message}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-[28px] border border-white/10 bg-card/80">
                    <Megaphone className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground font-medium">No announcements found!</p>
                </div>
            )}
        </div>
    );
}
