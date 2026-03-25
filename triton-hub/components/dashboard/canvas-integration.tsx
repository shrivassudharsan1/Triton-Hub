"use client";

import { useState, useEffect } from "react";
import { Loader2, ExternalLink, GraduationCap, ClipboardList, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClassItem {
    id: number;
    name: string;
    courseCode: string;
    professor: string | null;
    term: string | null;
}

interface CourseGrade {
    id: number;
    name: string;
    courseCode: string;
    currentScore: number | null;
    finalScore: number | null;
    currentGrade: string | null;
    finalGrade: string | null;
    gradesUrl: string | null;
}

interface AssignmentItem {
    id: number;
    courseId: number;
    courseName: string;
    courseCode: string;
    name: string;
    dueAt: string | null;
    pointsPossible: number | null;
    score: number | null;
    submittedAt: string | null;
    workflowState: string | null;
    htmlUrl: string;
}

const TOKEN_STORAGE_KEY = 'canvas_token';
const URL_STORAGE_KEY = 'canvas_url';
const CANVAS_UCSD_URL = 'https://canvas.ucsd.edu';

export function CanvasIntegration() {
    const [accessToken, setAccessToken] = useState('');
    const [canvasUrl, setCanvasUrl] = useState(CANVAS_UCSD_URL);

    const [classes, setClasses] = useState<ClassItem[] | null>(null);
    const [grades, setGrades] = useState<CourseGrade[] | null>(null);
    const [assignments, setAssignments] = useState<AssignmentItem[] | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<'classes' | 'grades'>('classes');
    const [showConfig, setShowConfig] = useState(true);

    // Load from session storage
    useEffect(() => {
        const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
        const storedUrl = sessionStorage.getItem(URL_STORAGE_KEY);
        if (storedToken) {
            setAccessToken(storedToken);
            setShowConfig(false); // Hide config if token exists
        }
        if (storedUrl) setCanvasUrl(storedUrl);
    }, []);

    // Auto-fetch when token is present and config is hidden
    useEffect(() => {
        if (accessToken && !showConfig) {
            fetchAllData();
        }
    }, [accessToken, showConfig]);

    // Save to session storage
    useEffect(() => {
        if (accessToken) sessionStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
        if (canvasUrl) sessionStorage.setItem(URL_STORAGE_KEY, canvasUrl);
    }, [accessToken, canvasUrl]);

    const headers = () => ({
        Authorization: `Bearer ${accessToken}`,
    });

    const getApiBase = () => {
        const normalized = canvasUrl.replace(/\/$/, '');
        const isUcsd = normalized === CANVAS_UCSD_URL || normalized.includes('canvas.ucsd.edu');
        // Same-origin proxy (next.config rewrite) — required in production (Canvas blocks cross-origin browser fetches)
        if (isUcsd) {
            return '/canvas-api';
        }
        return normalized;
    };

    const fetchAllData = async () => {
        if (!accessToken || !canvasUrl) {
            setError('Please provide both Canvas URL and Access Token.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const base = getApiBase();

            // 1. Fetch Classes (and determine common term)
            const coursesRes = await fetch(`${base}/api/v1/courses?enrollment_type=student&enrollment_state=active&include[]=teachers&include[]=term&include[]=total_scores&per_page=50`, {
                headers: headers()
            });
            if (!coursesRes.ok) throw new Error(`Canvas API error: ${coursesRes.status}`);
            const coursesJson = await coursesRes.json();

            // Find common term
            const termCounts = new Map<string, number>();
            coursesJson.forEach((c: any) => {
                if (c.term?.name) termCounts.set(c.term.name, (termCounts.get(c.term.name) || 0) + 1);
            });
            let commonTerm: string | null = null;
            let maxCount = 0;
            termCounts.forEach((count, name) => {
                if (count > maxCount) {
                    maxCount = count;
                    commonTerm = name;
                }
            });

            const filteredCourses = commonTerm
                ? coursesJson.filter((c: any) => c.term?.name === commonTerm)
                : coursesJson;

            // Map Classes
            setClasses(filteredCourses.map((c: any) => ({
                id: c.id,
                name: c.name,
                courseCode: c.course_code ?? '',
                professor: c.teachers?.[0]?.display_name ?? null,
                term: c.term?.name ?? null
            })));

            // Map Grades
            setGrades(filteredCourses.map((course: any) => {
                const enrollment = course.enrollments?.[0];
                const g = enrollment?.grades;
                return {
                    id: course.id,
                    name: course.name,
                    courseCode: course.course_code ?? '',
                    currentScore: enrollment?.computed_current_score ?? g?.current_score ?? null,
                    finalScore: enrollment?.computed_final_score ?? g?.final_score ?? null,
                    currentGrade: enrollment?.computed_current_grade ?? g?.current_grade ?? null,
                    finalGrade: enrollment?.computed_final_grade ?? g?.final_grade ?? null,
                    gradesUrl: g?.html_url ?? null,
                };
            }));

            // 2. Fetch Assignments for these courses
            const assignmentPromises = filteredCourses.map(async (course: any) => {
                const res = await fetch(`${base}/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=50&order_by=due_at`, {
                    headers: headers()
                });
                if (!res.ok) return [];
                const assigns = await res.json();
                return assigns.map((a: any) => ({
                    id: a.id,
                    courseId: course.id,
                    courseName: course.name,
                    courseCode: course.course_code ?? '',
                    name: a.name,
                    dueAt: a.due_at,
                    pointsPossible: a.points_possible,
                    score: a.submission?.score ?? null,
                    submittedAt: a.submission?.submitted_at ?? null,
                    workflowState: a.submission?.workflow_state ?? null,
                    htmlUrl: a.html_url,
                }));
            });

            const allAssigns = (await Promise.all(assignmentPromises)).flat();
            // Sort upcoming (due in future or null due date at end)
            allAssigns.sort((a, b) => {
                if (!a.dueAt) return 1;
                if (!b.dueAt) return -1;
                return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
            });
            setAssignments(allAssigns.filter(a => !a.submittedAt)); // Show only upcoming/unsubmitted

        } catch (err: any) {
            setError(err.message || 'Failed to sync with Canvas');
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'No due date';
        return new Date(dateStr).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="space-y-6">
            {/* Configuration Section */}
            {/* Header / Config Toggle */}
            <div className="flex items-center justify-between">
                {!showConfig && (
                    <button
                        onClick={() => setShowConfig(true)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
                        Configure Canvas
                    </button>
                )}
            </div>

            {/* Configuration Section */}
            {showConfig && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Canvas Configuration</h3>
                        {accessToken && (
                            <button
                                onClick={() => setShowConfig(false)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                Hide
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Canvas Link</label>
                            <input
                                type="text"
                                className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="https://canvas.ucsd.edu"
                                value={canvasUrl}
                                onChange={(e) => setCanvasUrl(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Access Token</label>
                            <input
                                type="password"
                                className="w-full flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                placeholder="Paste your token here..."
                                value={accessToken}
                                onChange={(e) => setAccessToken(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                        <p className="text-xs text-muted-foreground">
                            Token can be found in Canvas Settings → Approved Integrations
                        </p>
                        <button
                            onClick={() => {
                                fetchAllData();
                                setShowConfig(false);
                            }}
                            disabled={loading}
                            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading ? "Syncing..." : "Sync Canvas Data"}
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive font-medium">
                    {error}
                </div>
            )}

            {/* Navigation Sub-Tabs */}
            <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-fit">
                <button
                    onClick={() => setActiveSubTab('classes')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                        activeSubTab === 'classes' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <BookOpen className="h-4 w-4" /> Classes
                </button>
                <button
                    onClick={() => setActiveSubTab('grades')}
                    className={cn(
                        "flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-all",
                        activeSubTab === 'grades' ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                >
                    <GraduationCap className="h-4 w-4" /> Grades
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[300px]">
                {activeSubTab === 'classes' && (
                    <div className="space-y-4">
                        {classes ? (
                            <div className="grid grid-cols-1 gap-4">
                                {classes.map((cls) => (
                                    <div key={cls.id} className="p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors flex items-center justify-between group">
                                        <div>
                                            <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{cls.name}</h4>
                                            <p className="text-sm text-muted-foreground">{cls.courseCode} • {cls.professor ?? 'Unknown Professor'}</p>
                                        </div>
                                        <div className="text-xs font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground">
                                            {cls.term}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <EmptyState message="Sync your Canvas data to see your classes." />
                        )}
                    </div>
                )}

                {activeSubTab === 'grades' && (
                    <div className="space-y-4">
                        {grades ? (
                            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-muted text-muted-foreground font-medium">
                                        <tr>
                                            <th className="px-6 py-3">Course</th>
                                            <th className="px-6 py-3">Current Score</th>
                                            <th className="px-6 py-3">Current Grade</th>
                                            <th className="px-6 py-3 text-right">Link</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {grades.map((g) => (
                                            <tr key={g.id} className="hover:bg-muted/50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="font-medium text-foreground">{g.name}</div>
                                                    <div className="text-xs text-muted-foreground">{g.courseCode}</div>
                                                </td>
                                                <td className="px-6 py-4 font-mono font-medium">
                                                    {g.currentScore != null ? `${g.currentScore}%` : '—'}
                                                </td>
                                                <td className="px-6 py-4 font-medium">
                                                    <span className={cn(
                                                        "px-2 py-1 rounded text-xs",
                                                        g.currentGrade ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                                    )}>
                                                        {g.currentGrade ?? 'N/A'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {g.gradesUrl && (
                                                        <a href={g.gradesUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                                                            Canvas <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <EmptyState message="Sync your Canvas data to see your grades." />
                        )}
                    </div>
                )}


            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-border rounded-xl">
            <p className="text-muted-foreground text-sm">{message}</p>
        </div>
    );
}
