/**
 * Rewrites Canvas API URLs to the Next.js same-origin proxy (see next.config rewrites).
 * Direct browser requests to canvas.ucsd.edu fail CORS in production; dev previously
 * used the proxy only — we always proxy UCSD Canvas in the browser.
 */
export function toCanvasProxyUrl(url: string): string {
  if (!url.includes("canvas.ucsd.edu")) {
    return url;
  }
  try {
    const u = new URL(url);
    return `/canvas-api${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
