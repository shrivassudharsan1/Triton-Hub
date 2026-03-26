"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2, ExternalLink, Calendar as CalendarIcon, Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchNotifications, updateNotificationCompleted } from "@/lib/notifications";
import type { Notification } from "@/lib/types";
import { toast } from "sonner";

interface AssignmentItem {
    id: string;
    notificationId: number;
    courseName: string;
    courseCode: string;
    name: string;
    dueAt: Date | null;
    htmlUrl: string;
    completed: boolean;
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function parseDueDate(notification: Notification): Date | null {
    if (!notification.event_date || notification.event_date === "EMPTY") return null;
    try {
        const [year, month, day] = notification.event_date.split("-").map(Number);
        if (!notification.event_time || notification.event_time === "EMPTY") {
            return new Date(year, month - 1, day, 12, 0, 0);
        }
        const timeMatch = notification.event_time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const period = timeMatch[3].toUpperCase();
            if (period === "PM" && hours !== 12) hours += 12;
            if (period === "AM" && hours === 12) hours = 0;
            return new Date(year, month - 1, day, hours, minutes, 0);
        }
        return new Date(year, month - 1, day, 12, 0, 0);
    } catch {
        return null;
    }
}

export function AssignmentView() {
    const [assignments, setAssignments] = useState<AssignmentItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<Set<number>>(new Set());
    const [showForgotSection, setShowForgotSection] = useState(false);

    useEffect(() => {
        const loadAssignments = async () => {
            setLoading(true);
            setError(null);

            try {
                const { notifications } = await fetchNotifications();

                // Filter for assignments only
                const assignmentNotifs = notifications.filter(
                    (n: Notification) => n.category === "assignment"
                );

                // Transform to AssignmentItem format
                const items: AssignmentItem[] = assignmentNotifs.map((n: Notification) => {
                    return {
                        id: `notif-${n.id}`,
                        notificationId: n.id,
                        courseName: n.source,
                        courseCode: n.source,
                        name: n.summary,
                        dueAt: parseDueDate(n),
                        htmlUrl: n.link !== "EMPTY" ? n.link : "",
                        completed: n.completed ?? false,
                    };
                });

                // Sort by due date (nearest first)
                items.sort((a, b) => {
                    if (!a.dueAt) return 1;
                    if (!b.dueAt) return -1;
                    return a.dueAt.getTime() - b.dueAt.getTime();
                });

                setAssignments(items);
            } catch (err: any) {
                console.error(err);
                setError(err.message || "Failed to fetch assignments");
            } finally {
                setLoading(false);
            }
        };

        loadAssignments();
    }, []);

    const formatDate = (date: Date | null) => {
        if (!date) return 'No due date';
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const pendingAssignments = useMemo(
        () => (assignments ?? []).filter((a) => !a.completed),
        [assignments]
    );

    const forgotToCheckOff = useMemo(() => {
        const now = Date.now();
        return pendingAssignments.filter((a) => {
            if (!a.dueAt) return false;
            return now - a.dueAt.getTime() > TWO_WEEKS_MS;
        });
    }, [pendingAssignments]);

    const forgotIds = useMemo(() => new Set(forgotToCheckOff.map((a) => a.id)), [forgotToCheckOff]);

    const activePending = useMemo(
        () => pendingAssignments.filter((a) => !forgotIds.has(a.id)),
        [pendingAssignments, forgotIds]
    );

    const handleToggleDone = async (notificationId: number, currentCompleted: boolean) => {
        setUpdating((prev) => new Set(prev).add(notificationId));
        try {
            if (notificationId >= 0) {
                await updateNotificationCompleted(notificationId, !currentCompleted);
            }
            setAssignments((prev) =>
                (prev ?? []).map((a) =>
                    a.notificationId === notificationId ? { ...a, completed: !currentCompleted } : a
                )
            );
            toast.success(currentCompleted ? "Assignment marked incomplete" : "Assignment marked done");
        } catch (err) {
            console.error(err);
            toast.error("Failed to update assignment");
        } finally {
            setUpdating((prev) => {
                const next = new Set(prev);
                next.delete(notificationId);
                return next;
            });
        }
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
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Assignments</p>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Upcoming work, organized by urgency</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                            Keep active work front and center, then collapse old unchecked items into a dedicated follow-up section.
                        </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-secondary/80 px-3 py-1 text-xs font-semibold text-secondary-foreground">
                        {activePending.length} Pending
                    </span>
                </div>
            </div>

            {assignments && assignments.length > 0 ? (
                <div className="flex flex-col gap-4">
                    {activePending.map((a) => {
                        const isUpdating = updating.has(a.notificationId);
                        return (
                        <div key={a.id} className="group relative flex flex-col gap-3 rounded-[24px] border border-white/10 bg-card/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                                        {a.courseCode}
                                    </span>
                                    <span className={cn("text-xs font-medium", !a.dueAt ? 'text-muted-foreground' : 'text-orange-600 dark:text-orange-400')}>
                                        {formatDate(a.dueAt)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggleDone(a.notificationId, a.completed)}
                                        disabled={isUpdating}
                                        className="inline-flex h-9 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-60"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                        {isUpdating ? "Saving..." : "Done"}
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
                                    {a.name}
                                </h3>
                                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                                    {a.courseName}
                                </p>
                            </div>
                        </div>
                    )})}

                    {forgotToCheckOff.length > 0 && (
                        <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/5 shadow-sm">
                            <button
                                onClick={() => setShowForgotSection((v) => !v)}
                                className="flex w-full items-center justify-between px-5 py-4 text-left"
                            >
                                <div>
                                    <p className="text-sm font-semibold text-foreground">Forgot to check off</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {forgotToCheckOff.length} overdue assignment{forgotToCheckOff.length === 1 ? "" : "s"} (2+ weeks)
                                    </p>
                                </div>
                                {showForgotSection ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>

                            {showForgotSection && (
                                <div className="space-y-3 px-5 pb-5">
                                    {forgotToCheckOff.map((a) => {
                                        const isUpdating = updating.has(a.notificationId);
                                        return (
                                            <div key={a.id} className="rounded-2xl border border-white/10 bg-card/75 p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium truncate">{a.name}</p>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {a.courseName} - due {formatDate(a.dueAt)}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleToggleDone(a.notificationId, a.completed)}
                                                        disabled={isUpdating}
                                                        className="inline-flex h-9 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-60"
                                                    >
                                                        <Check className="h-3.5 w-3.5" />
                                                        {isUpdating ? "Saving..." : "Done"}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex h-64 flex-col items-center justify-center rounded-[28px] border border-white/10 bg-card/80">
                    <CalendarIcon className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground font-medium">No upcoming assignments found!</p>
                    <p className="text-xs text-muted-foreground mt-1">You're all caught up.</p>
                </div>
            )}
        </div>
    );
}
