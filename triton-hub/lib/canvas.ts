import { toCanvasProxyUrl } from './canvas-proxy-url';

const CANVAS_UCSD_URL = 'https://canvas.ucsd.edu';

export async function syncCanvasData(accessToken: string, canvasUrl: string = CANVAS_UCSD_URL) {
    if (!accessToken) throw new Error('Access Token is required');

    const getCanvasApiBase = (url: string) => url.replace(/\/$/, '');
    const base = getCanvasApiBase(canvasUrl);

    const headers = { Authorization: `Bearer ${accessToken}` };

    // 1. Fetch Courses
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

    // 2. Fetch Assignments & Announcements
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

    return { classes, assignments, grades, announcements };
}
