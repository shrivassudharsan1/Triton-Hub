import type { NextConfig } from "next";

if (
  process.env.VERCEL_ENV === "production" &&
  !process.env.NEXT_PUBLIC_SITE_URL?.trim()
) {
  throw new Error(
    "NEXT_PUBLIC_SITE_URL is required on Vercel production. Set it in Project Settings → Environment Variables to your canonical origin (no trailing slash), e.g. https://triton-hub.vercel.app, then redeploy. Also set the same URL as Supabase Authentication → URL Configuration → Site URL and add https://YOUR-APP/auth/callback under Redirect URLs."
  );
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/canvas-api/:path*',
        destination: 'https://canvas.ucsd.edu/:path*',
      },
    ];
  },
};

export default nextConfig;
