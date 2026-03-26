"use client";

import { useState, useCallback, useEffect } from "react";
import { fetchAndTransformNotifications } from "@/lib/notifications";
import type { Update, Category } from "@/lib/types";
import { CanvasSetupGuard } from "@/components/canvas-setup-guard";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { UpdateCard } from "./update-card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";

interface CategoryFeedProps {
  category: Category;
  title: string;
  description: string;
}

export function CategoryFeed({ category, title, description }: CategoryFeedProps) {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const { updates: allUpdates } = await fetchAndTransformNotifications();
      // Filter by category, mapping "personal" to "event" as done in notifications.ts
      const filtered = allUpdates.filter((u) => u.category === category);
      setUpdates(filtered);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = useCallback((id: string) => {
    setUpdates((prev) =>
      prev.map((update) =>
        update.id === id ? { ...update, unread: false } : update
      )
    );
  }, []);

  const handleRefresh = useCallback(() => {
    loadNotifications();
  }, [loadNotifications]);

  const unreadCount = updates.filter((u) => u.unread).length;

  return (
    <CanvasSetupGuard>
    <div className="min-h-screen bg-background">
      <Navbar />
      <Sidebar />

      <main className="pt-16 pb-20 sm:pb-0 sm:pl-56 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
          {/* Header */}
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
              <div>
                <h1 className="text-2xl font-bold text-foreground">{title}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {description}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {unreadCount} unread
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {/* Feed */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : updates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                <svg
                  className="h-8 w-8 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">
                No {title.toLowerCase()} found
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                You're all caught up! No {title.toLowerCase()} at the moment.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {updates.map((update) => (
                <UpdateCard
                  key={update.id}
                  update={update}
                  onMarkRead={handleMarkRead}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
    </CanvasSetupGuard>
  );
}
