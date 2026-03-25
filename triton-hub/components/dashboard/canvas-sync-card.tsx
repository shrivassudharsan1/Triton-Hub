"use client";

import { useState, useEffect } from "react";
import { Loader2, Key, Link as LinkIcon, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toCanvasProxyUrl } from "@/lib/canvas-proxy-url";

const TOKEN_STORAGE_KEY = 'canvas_token';
const URL_STORAGE_KEY = 'canvas_url';
const CANVAS_UCSD_URL = 'https://canvas.ucsd.edu';

interface CanvasSyncCardProps {
    onSyncComplete: (data: { classes: any[], assignments: any[], grades: any[], announcements: any[] }) => void;
    className?: string;
}

export function CanvasSyncCard({ onSyncComplete, className }: CanvasSyncCardProps) {
    const [accessToken, setAccessToken] = useState('');
    const [canvasUrl, setCanvasUrl] = useState(CANVAS_UCSD_URL);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
        const storedUrl = sessionStorage.getItem(URL_STORAGE_KEY);
        if (storedToken) setAccessToken(storedToken);
        if (storedUrl) setCanvasUrl(storedUrl);
    }, []);

    const handleSync = async () => {
        if (!accessToken || !canvasUrl) {
            setError('Please provide both Canvas URL and Access Token.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const getCanvasApiBase = (url: string) => url.replace(/\/$/, '');
            const base = getCanvasApiBase(canvasUrl);

            const headers = { Authorization: `Bearer ${accessToken}` };

            // 1. Fetch Courses with total_scores inclusion
            const coursesUrl = toCanvasProxyUrl(`${base}/api/v1/courses?include[]=total_scores&include[]=teachers&include[]=term&include[]=enrollments&enrollment_type=student&enrollment_state=active&per_page=50`);
            const coursesRes = await fetch(coursesUrl, { headers });

            if (!coursesRes.ok) throw new Error(`Canvas API error: ${coursesRes.status}`);
            const courses = await coursesRes.json();

            // Find common term
            const termCounts = new Map<string, number>();
            courses.forEach((c: any) => {
                if (c.term?.name) termCounts.set(c.term.name, (termCounts.get(c.term.name) || 0) + 1);
            });
            let commonTerm: string | null = null;
            let maxCount = 0;
            termCounts.forEach((count, name) => {
                if (count > maxCount) { maxCount = count; commonTerm = name; }
            });

            const filteredCourses = commonTerm ? courses.filter((c: any) => c.term?.name === commonTerm) : courses;

            // 2. Fetch Assignments & Announcements for each course
            const assignmentPromises = filteredCourses.map(async (course: any) => {
                const url = toCanvasProxyUrl(`${base}/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=50&order_by=due_at`);
                const res = await fetch(url, { headers });
                return res.ok ? await res.json() : [];
            });

            const annPromises = filteredCourses.map(async (course: any) => {
                const url = toCanvasProxyUrl(`${base}/api/v1/announcements?context_codes[]=course_${course.id}&per_page=10`);
                const res = await fetch(url, { headers });
                return res.ok ? await res.json() : [];
            });

            const [allAssignsRaw, allAnnsRaw] = await Promise.all([
                Promise.all(assignmentPromises),
                Promise.all(annPromises)
            ]);

            const assignments = allAssignsRaw.flat().map((a: any) => {
                const course = filteredCourses.find((c: any) => c.id === a.course_id);
                return {
                    id: a.id,
                    courseId: a.course_id,
                    courseName: course?.name || 'Unknown',
                    courseCode: course?.course_code || '',
                    name: a.name,
                    dueAt: a.due_at,
                    pointsPossible: a.points_possible,
                    score: a.submission?.score ?? null,
                    submittedAt: a.submission?.submitted_at ?? null,
                    workflowState: a.submission?.workflow_state ?? null,
                    htmlUrl: a.html_url,
                };
            });

            const announcements = allAnnsRaw.flat().map((a: any) => {
                const courseId = parseInt(a.context_code.replace('course_', ''));
                const course = filteredCourses.find((c: any) => c.id === courseId);
                return {
                    id: a.id,
                    title: a.title,
                    message: a.message,
                    postedAt: a.posted_at,
                    courseName: course?.name,
                    courseCode: course?.course_code,
                    htmlUrl: a.html_url,
                };
            });

            const grades = filteredCourses.map((c: any) => {
                const enrollment = c.enrollments?.[0];
                return {
                    id: c.id,
                    name: c.name,
                    courseCode: c.course_code ?? '',
                    currentScore: enrollment?.computed_current_score ?? enrollment?.grades?.current_score ?? null,
                    finalScore: enrollment?.computed_final_score ?? enrollment?.grades?.final_score ?? null,
                    currentGrade: enrollment?.computed_current_grade ?? enrollment?.grades?.current_grade ?? null,
                    finalGrade: enrollment?.computed_final_grade ?? enrollment?.grades?.final_grade ?? null,
                    gradesUrl: enrollment?.grades?.html_url ?? null,
                };
            });

            const classes = filteredCourses.map((c: any) => {
                const enrollment = c.enrollments?.[0];
                return {
                    id: c.id,
                    name: c.name,
                    courseCode: c.course_code ?? '',
                    professor: c.teachers?.[0]?.display_name ?? null,
                    term: c.term?.name ?? null,
                    currentScore: enrollment?.computed_current_score ?? enrollment?.grades?.current_score ?? null,
                    currentGrade: enrollment?.computed_current_grade ?? enrollment?.grades?.current_grade ?? null,
                };
            });

            // Save credentials
            sessionStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
            sessionStorage.setItem(URL_STORAGE_KEY, canvasUrl);

            onSyncComplete({ classes, assignments, grades, announcements });
        } catch (err: any) {
            setError(err.message || 'Failed to sync with Canvas');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={cn("rounded-2xl border border-border bg-card p-6 shadow-xl space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500", className)}>
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400">
                    <RefreshCw className={cn("h-6 w-6", loading && "animate-spin")} />
                </div>
                <div>
                    <h3 className="font-bold text-xl tracking-tight">Sync Canvas Data</h3>
                    <p className="text-sm text-muted-foreground">Connect your Canvas account to see real-time updates.</p>
                </div>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                        <LinkIcon className="h-4 w-4" /> Canvas URL
                    </label>
                    <input
                        type="text"
                        className="w-full flex h-11 rounded-xl border border-input bg-background/50 px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                        placeholder="https://canvas.ucsd.edu"
                        value={canvasUrl}
                        onChange={(e) => setCanvasUrl(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-semibold flex items-center gap-2">
                        <Key className="h-4 w-4" /> Access Token
                    </label>
                    <input
                        type="password"
                        className="w-full flex h-11 rounded-xl border border-input bg-background/50 px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                        placeholder="Paste your personal access token..."
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground pl-1">
                        Find this in Canvas Settings → Approved Integrations → New Access Token
                    </p>
                </div>
            </div>

            {error && (
                <div className="rounded-xl bg-destructive/10 p-4 border border-destructive/20 flex items-center gap-3 text-sm text-destructive font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                </div>
            )}

            <Button
                onClick={handleSync}
                disabled={loading}
                className="w-full h-11 rounded-xl font-bold text-sm bg-orange-600 hover:bg-orange-700 text-white shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98]"
            >
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing Courses & Assignments...
                    </>
                ) : (
                    "Apply Connection"
                )}
            </Button>
        </div>
    );
}
