"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Megaphone, User, FileText, GraduationCap, ClipboardList, Calendar, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchNotifications, updateNotificationCompleted } from "@/lib/notifications";
import { getNotificationDataOrigin } from "@/lib/notification-origin";
import { DataOriginBadge } from "@/components/dashboard/data-origin-badge";
import { toast } from "sonner";
import type { Notification } from "@/lib/types";
import { AddEventModal } from "./add-event-modal";
import {
  eventTypeColors,
  urgencyColors,
  type CalendarEvent,
  type EventType,
  type Urgency,
} from "@/lib/calendar-data";

const eventTypeIcons: Record<EventType, typeof Megaphone> = {
  announcement: Megaphone,
  personal: User,
  exam: FileText,
  event: Calendar,
  assignment: ClipboardList,
  grade: GraduationCap,
};

const eventTypeLabels: Record<EventType, string> = {
  announcement: "Announcement",
  personal: "Personal",
  exam: "Exam",
  event: "Event",
  assignment: "Assignment",
  grade: "Grade",
};

const urgencyLabels: Record<Urgency, string> = {
  urgent: "Urgent",
  medium: "Medium",
  low: "Low",
};

/**
 * Parse event_date and event_time into a Date object
 * Uses local timezone to avoid date shifting issues
 */
function parseNotificationDate(eventDate: string, eventTime: string, createdAt: string): Date {
  if (!eventDate || eventDate === "EMPTY") {
    return new Date(createdAt);
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
    return new Date(createdAt);
  }
}

/**
 * Map notification category to calendar EventType
 */
function mapCategoryToEventType(category: string): EventType {
  const mapping: Record<string, EventType> = {
    announcement: "announcement",
    assignment: "assignment",
    exam: "exam",
    event: "event",
    personal: "personal",
    grade: "grade",
  };
  return mapping[category] || "event";
}

/**
 * Map notification urgency to calendar Urgency
 */
function mapUrgency(urgency: string): Urgency {
  if (urgency === "high") return "urgent";
  if (urgency === "medium") return "medium";
  return "low";
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export function CalendarView() {
  /** Assignments only (no announcements on calendar). */
  const [assignmentEvents, setAssignmentEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingEvents, setUpdatingEvents] = useState<Set<number>>(new Set());

  // UI State
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [filterUrgency, setFilterUrgency] = useState<Urgency | "all">("all");

  // Toggle event completion
  const handleToggleComplete = useCallback(async (notificationId: number, currentCompleted: boolean) => {
    setUpdatingEvents((prev) => new Set(prev).add(notificationId));
    try {
      if (notificationId >= 0) {
        await updateNotificationCompleted(notificationId, !currentCompleted);
      }
      setAssignmentEvents((prev) =>
        prev.map((event) =>
          event.notificationId === notificationId
            ? { ...event, completed: !currentCompleted }
            : event
        )
      );
      toast.success(currentCompleted ? "Event marked as incomplete" : "Event marked as done");
    } catch (error) {
      console.error("Failed to update event:", error);
      toast.error("Failed to update event");
    } finally {
      setUpdatingEvents((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
    }
  }, []);

  // Load events function
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications } = await fetchNotifications();

      const assignmentNotifs = notifications.filter(
        (n: Notification) => n.category === "assignment"
      );

      const calendarEvents: CalendarEvent[] = assignmentNotifs.map((notif: Notification) => {
        const date = parseNotificationDate(notif.event_date, notif.event_time, notif.created_at);
        const eventType = mapCategoryToEventType(notif.category);
        const urgency = mapUrgency(notif.urgency);

        // Extract time string for display
        let startTime: string | undefined;
        if (notif.event_time && notif.event_time !== "EMPTY") {
          startTime = notif.event_time.replace(/\s*(PST|PDT|EST|EDT|CST|CDT|MST|MDT)$/i, "").trim();
        }

        return {
          id: `notif-${notif.id}`,
          notificationId: notif.id,
          title: notif.summary,
          description: notif.summary,
          date,
          startTime,
          type: eventType,
          urgency,
          course: notif.source,
          dataOrigin: getNotificationDataOrigin(notif),
          link: notif.link !== "EMPTY" ? notif.link : undefined,
          completed: notif.completed ?? false,
        };
      });

      setAssignmentEvents(calendarEvents);
    } catch (error) {
      console.error("Failed to fetch calendar events:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch notifications from Supabase on mount
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);


  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // Get the day of week for the first day (0 = Sunday)
  const startDayOfWeek = startOfMonth(currentMonth).getDay();

  /** Incomplete assignments due more than 2 weeks ago — not shown on the grid. */
  const forgotToCheckOff = useMemo(() => {
    const now = Date.now();
    return assignmentEvents.filter((e) => {
      if (e.completed) return false;
      const t = e.date.getTime();
      if (Number.isNaN(t)) return false;
      return now - t > TWO_WEEKS_MS;
    });
  }, [assignmentEvents]);

  const forgotIds = useMemo(() => new Set(forgotToCheckOff.map((e) => e.id)), [forgotToCheckOff]);

  const onCalendarEvents = useMemo(
    () => assignmentEvents.filter((e) => !forgotIds.has(e.id)),
    [assignmentEvents, forgotIds]
  );

  const filteredEvents = useMemo(() => {
    return onCalendarEvents.filter((event) => {
      if (filterUrgency !== "all" && event.urgency !== filterUrgency) return false;
      return true;
    });
  }, [filterUrgency, onCalendarEvents]);

  const filteredForgotToCheckOff = useMemo(() => {
    const list =
      filterUrgency === "all"
        ? forgotToCheckOff
        : forgotToCheckOff.filter((e) => e.urgency === filterUrgency);
    return [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [forgotToCheckOff, filterUrgency]);

  const getEventsForDay = (day: Date) => {
    return filteredEvents.filter((event) => isSameDay(event.date, day));
  };

  const selectedDateEvents = selectedDate
    ? filteredEvents
      .filter((event) => isSameDay(event.date, selectedDate))
      .sort((a, b) => {
        // Completed events go to the bottom
        if (a.completed !== b.completed) {
          return a.completed ? 1 : -1;
        }
        // Sort by urgency (urgent > medium > low)
        const urgencyOrder = { urgent: 0, medium: 1, low: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      })
    : [];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Calendar Grid */}
      <div className="flex-1">
        {/* Month Navigation */}
        <div className="mb-6 flex items-center justify-between rounded-[28px] border border-white/10 bg-card/80 p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Month view</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
            {format(currentMonth, "MMMM yyyy")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <AddEventModal
              onEventAdded={loadEvents}
              selectedDate={selectedDate}
              triggerLabel="Add assignment or reminder"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4 rounded-[28px] border border-white/10 bg-card/80 p-5 shadow-sm">
          <p className="text-sm text-muted-foreground w-full sm:w-auto sm:mr-2">
            Showing <span className="font-medium text-foreground">assignments</span> only. Announcements stay on the Announcements page.
          </p>

          {/* Urgency Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Urgency:</span>
            <div className="flex gap-1">
              <Button
                variant={filterUrgency === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilterUrgency("all")}
              >
                All
              </Button>
              {(Object.keys(urgencyLabels) as Urgency[]).map((urgency) => (
                <Button
                  key={urgency}
                  variant={filterUrgency === urgency ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilterUrgency(urgency)}
                  className="gap-1"
                >
                  <span className={cn("h-2 w-2 rounded-full", urgencyColors[urgency].dot)} />
                  <span className="hidden sm:inline">{urgencyLabels[urgency]}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-card/80 shadow-sm">
          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b border-white/10">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className="p-3 text-center text-sm font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7">
            {/* Empty cells for days before the first of the month */}
            {Array.from({ length: startDayOfWeek }).map((_, index) => (
              <div
                key={`empty-${index}`}
                className="min-h-[100px] p-2 border-b border-r border-border bg-muted/30"
              />
            ))}

            {days.map((day) => {
              const dayEvents = getEventsForDay(day);
              const isSelected = selectedDate && isSameDay(day, selectedDate);
              const isCurrentDay = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(day)}
                  className={cn(
                    "min-h-[100px] p-2 border-b border-r border-border cursor-pointer transition-colors",
                    !isSameMonth(day, currentMonth) && "bg-muted/30 text-muted-foreground",
                    isSelected && "bg-primary/10",
                    !isSelected && "hover:bg-muted/50"
                  )}
                >
                  <div
                    className={cn(
                      "text-sm font-medium mb-1 w-7 h-7 flex items-center justify-center rounded-full",
                      isCurrentDay && "bg-primary text-primary-foreground"
                    )}
                  >
                    {format(day, "d")}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <div
                        key={event.id}
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded truncate border-l-2",
                          eventTypeColors[event.type].bg,
                          eventTypeColors[event.type].border,
                          event.completed && "opacity-50 line-through"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full inline-block mr-0.5 align-middle shrink-0",
                            event.dataOrigin === "canvas" ? "bg-orange-500" : "bg-blue-500"
                          )}
                          title={event.dataOrigin === "canvas" ? "Canvas (live)" : "Email / inbox"}
                        />
                        <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-1", urgencyColors[event.urgency].dot)} />
                        {event.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-xs text-muted-foreground px-1.5">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Event type</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1.5">
                <div className={cn("w-3 h-3 rounded border-l-2", eventTypeColors.assignment.bg, eventTypeColors.assignment.border)} />
                <ClipboardList className={cn("h-3 w-3", eventTypeColors.assignment.text)} />
                <span className="text-xs text-muted-foreground">{eventTypeLabels.assignment}</span>
              </div>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Urgency</p>
            <div className="flex flex-wrap gap-3">
              {(Object.keys(urgencyLabels) as Urgency[]).map((urgency) => (
                <div key={urgency} className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", urgencyColors[urgency].dot)} />
                  <span className="text-xs text-muted-foreground">{urgencyLabels[urgency]}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Source</p>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs text-muted-foreground">Email / inbox sync</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
                <span className="text-xs text-muted-foreground">Canvas (live)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Day Events Panel */}
      <div className="lg:w-80">
        <div className="sticky top-20 rounded-[28px] border border-white/10 bg-card/80 p-5 shadow-sm">
          <h3 className="font-semibold text-foreground mb-1">
            {selectedDate ? format(selectedDate, "EEEE, MMMM d") : "Select a date"}
          </h3>
          {selectedDate && isToday(selectedDate) && (
            <p className="text-xs text-primary mb-3">Today</p>
          )}

          {selectedDateEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No events scheduled for this day.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {selectedDateEvents.map((event) => {
                const Icon = eventTypeIcons[event.type];
                const isUpdating = updatingEvents.has(event.notificationId);
                return (
                  <div
                    key={event.id}
                    className={cn(
                      "rounded-2xl border-l-4 p-3 transition-opacity",
                      eventTypeColors[event.type].bg,
                      eventTypeColors[event.type].border,
                      event.completed && "opacity-60"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <button
                          onClick={() => handleToggleComplete(event.notificationId, event.completed)}
                          disabled={isUpdating}
                          className={cn(
                            "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                            event.completed
                              ? "bg-green-500 border-green-500 text-white"
                              : "border-muted-foreground/50 hover:border-green-500"
                          )}
                        >
                          {isUpdating ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : event.completed ? (
                            <Check className="h-3 w-3" />
                          ) : null}
                        </button>
                        <Icon className={cn("h-4 w-4 shrink-0", eventTypeColors[event.type].text)} />
                        <span className={cn(
                          "font-medium text-sm",
                          event.completed && "line-through text-muted-foreground"
                        )}>
                          {event.title}
                        </span>
                        <DataOriginBadge origin={event.dataOrigin} size="sm" />
                      </div>
                      <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", urgencyColors[event.urgency].dot)} />
                    </div>
                    {event.course && (
                      <p className={cn(
                        "text-xs text-muted-foreground mt-1 ml-12",
                        event.completed && "line-through"
                      )}>
                        {event.course}
                      </p>
                    )}
                    {event.startTime && (
                      <p className={cn(
                        "text-xs text-muted-foreground mt-1 ml-12",
                        event.completed && "line-through"
                      )}>
                        {event.startTime}
                        {event.endTime && ` - ${event.endTime}`}
                      </p>
                    )}
                    <p className={cn(
                      "text-xs text-muted-foreground mt-2 ml-12",
                      event.completed && "line-through"
                    )}>
                      {event.description}
                    </p>
                    <div className="flex items-center gap-2 mt-2 ml-12">
                      {event.completed && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                          Done
                        </span>
                      )}
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", urgencyColors[event.urgency].bg, urgencyColors[event.urgency].text)}>
                        {urgencyLabels[event.urgency]}
                      </span>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded", eventTypeColors[event.type].bg, eventTypeColors[event.type].text)}>
                        {eventTypeLabels[event.type]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredForgotToCheckOff.length > 0 && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <h4 className="text-sm font-semibold text-foreground mb-1">Forgot to check off?</h4>
              <p className="text-xs text-muted-foreground mb-4">
                These assignments were due more than two weeks ago and are still incomplete. They are hidden from the month grid so recent work stays visible.
              </p>
              <div className="space-y-3">
                {filteredForgotToCheckOff.map((event) => {
                  const Icon = eventTypeIcons[event.type];
                  const isUpdating = updatingEvents.has(event.notificationId);
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "rounded-2xl border-l-4 border-amber-500/40 bg-amber-500/5 p-3 transition-opacity",
                        eventTypeColors[event.type].bg,
                        eventTypeColors[event.type].border
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <button
                            onClick={() => handleToggleComplete(event.notificationId, event.completed)}
                            disabled={isUpdating}
                            className={cn(
                              "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                              event.completed
                                ? "bg-green-500 border-green-500 text-white"
                                : "border-muted-foreground/50 hover:border-green-500"
                            )}
                          >
                            {isUpdating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : event.completed ? (
                              <Check className="h-3 w-3" />
                            ) : null}
                          </button>
                          <Icon className={cn("h-4 w-4 shrink-0", eventTypeColors[event.type].text)} />
                          <span className="font-medium text-sm">{event.title}</span>
                          <DataOriginBadge origin={event.dataOrigin} size="sm" />
                        </div>
                      </div>
                      {event.course && (
                        <p className="text-xs text-muted-foreground mt-1 ml-12">{event.course}</p>
                      )}
                      <p className="text-xs text-amber-600/90 dark:text-amber-400/90 mt-1 ml-12">
                        Was due {format(event.date, "MMM d, yyyy")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
