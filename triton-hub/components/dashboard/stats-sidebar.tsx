"use client";

import { useEffect, useState } from "react";
import { fetchAndTransformNotifications } from "@/lib/notifications";
import { Clock, Bell, AlertTriangle, BookOpen, Megaphone, Calendar, Sparkles } from "lucide-react";

export function StatsSidebar() {
  const [stats, setStats] = useState({
    upcomingDeadlines: 0,
    unreadNotifications: 0,
    urgentItems: 0,
    assignments: 0,
    announcements: 0,
    events: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const { updates } = await fetchAndTransformNotifications();
        const now = new Date();

        setStats({
          upcomingDeadlines: updates.filter((u) => u.category === "assignment" && u.dueDate && u.dueDate > now).length,
          unreadNotifications: updates.filter((u) => u.unread).length,
          urgentItems: updates.filter((u) => u.priority === "urgent").length,
          assignments: updates.filter((u) => u.category === "assignment").length,
          announcements: updates.filter((u) => u.category === "announcement").length,
          events: updates.filter((u) => u.category === "event").length,
        });
      } catch (error) {
        console.error("Failed to load stats:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStats();
  }, []);

  return (
    <aside className="hidden xl:block fixed right-0 top-16 h-[calc(100vh-4rem)] w-80 border-l border-white/10 bg-background/70 p-6 backdrop-blur-xl">
      <div className="rounded-[28px] border border-white/10 bg-card/75 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Quick stats</p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">Your student pulse</h2>
          </div>
          <div className="rounded-full border border-primary/15 bg-primary/10 p-2 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-secondary/40 p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/15">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{isLoading ? "–" : stats.upcomingDeadlines}</p>
              <p className="text-xs text-muted-foreground">Upcoming deadlines</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-secondary/40 p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/15">
              <Bell className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{isLoading ? "–" : stats.unreadNotifications}</p>
              <p className="text-xs text-muted-foreground">Unread notifications</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-secondary/40 p-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/15">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground">{isLoading ? "–" : stats.urgentItems}</p>
              <p className="text-xs text-muted-foreground">Urgent items</p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-background/55 p-4">
          <h3 className="text-sm font-semibold text-foreground">By category</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span className="flex items-center gap-2">
                <BookOpen className="h-3.5 w-3.5" /> Assignments
              </span>
              <span className="font-medium text-foreground">{isLoading ? "–" : stats.assignments}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span className="flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5" /> Announcements
              </span>
              <span className="font-medium text-foreground">{isLoading ? "–" : stats.announcements}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" /> Events
              </span>
              <span className="font-medium text-foreground">{isLoading ? "–" : stats.events}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-secondary/35 p-4">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isLoading ? "bg-yellow-500" : "bg-green-500"} animate-pulse`} />
            <span className="text-xs font-medium text-foreground">
              {isLoading ? "Syncing your workspace..." : "Everything looks synced"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Counts reflect the same feed logic used across your dashboard cards and filtered views.
          </p>
        </div>
      </div>
    </aside>
  );
}
