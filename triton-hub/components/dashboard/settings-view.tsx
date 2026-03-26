"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { setStoredProfilePreferences } from "@/lib/profile-preferences";
import {
  getLocalAvatarUrl,
  getLocalDisplayName,
  getNotificationSourceFilter,
  setLocalAvatarUrl,
  setLocalDisplayName,
  setNotificationSourceFilter,
  type NotificationSourceFilter,
} from "@/lib/user-preferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

type ProfileState = {
  email: string;
  username: string;
  avatarUrl: string;
};

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TS";
  const parts = cleaned.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "TS";
}

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<NotificationSourceFilter>("both");
  const [profile, setProfile] = useState<ProfileState>({ email: "", username: "", avatarUrl: "" });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [hasSupabasePasswordAuth, setHasSupabasePasswordAuth] = useState(false);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        setSourceFilter(getNotificationSourceFilter());

        const localName = getLocalDisplayName();
        const localAvatar = getLocalAvatarUrl();

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const provider = session.user.app_metadata?.provider;
          setHasSupabasePasswordAuth(provider !== "google");

          const { data: row } = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", session.user.id)
            .maybeSingle();

          const username = row?.full_name || localName || "";
          const avatarUrl = (session.user.user_metadata?.avatar_url as string | undefined) || localAvatar || "";
          setProfile({
            email: row?.email || session.user.email || "",
            username,
            avatarUrl,
          });
          setStoredProfilePreferences({ displayName: username, avatarUrl });
          return;
        }

        setHasSupabasePasswordAuth(false);
        const backendToken =
          typeof sessionStorage !== "undefined" ? sessionStorage.getItem("triton_session_token") : null;
        if (!backendToken) {
          setProfile({ email: "", username: localName, avatarUrl: localAvatar });
          return;
        }

        const res = await fetch(`${BACKEND_URL}/api/profile/me`, {
          headers: { Authorization: `Bearer ${backendToken}` },
        });
        if (!res.ok) {
          setProfile({ email: "", username: localName, avatarUrl: localAvatar });
          return;
        }
        const data = await res.json();
        const resolvedName = data.full_name || localName || "";
        const resolvedAvatar = localAvatar;
        setProfile({
          email: data.email || "",
          username: resolvedName,
          avatarUrl: resolvedAvatar,
        });
        setStoredProfilePreferences({ displayName: resolvedName, avatarUrl: resolvedAvatar });
      } catch {
        toast.error("Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const avatarFallback = useMemo(() => getInitials(profile.username || profile.email), [profile.username, profile.email]);

  const handleSaveContent = () => {
    setNotificationSourceFilter(sourceFilter);
    toast.success("Content preferences saved");
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { error } = await supabase
          .from("profiles")
          .update({ full_name: profile.username })
          .eq("id", session.user.id);
        if (error) throw error;

        if (profile.avatarUrl.trim()) {
          await supabase.auth.updateUser({
            data: {
              avatar_url: profile.avatarUrl.trim(),
              full_name: profile.username,
            },
          });
        }
      } else {
        const backendToken =
          typeof sessionStorage !== "undefined" ? sessionStorage.getItem("triton_session_token") : null;
        if (!backendToken) throw new Error("Not authenticated");
        const res = await fetch(`${BACKEND_URL}/api/profile/me`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${backendToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ full_name: profile.username }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "Failed to update profile");
        }
      }

      setStoredProfilePreferences({
        displayName: profile.username.trim(),
        avatarUrl: profile.avatarUrl.trim(),
      });
      setLocalDisplayName(profile.username);
      setLocalAvatarUrl(profile.avatarUrl);
      toast.success("Profile updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save profile");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!hasSupabasePasswordAuth) return;
    if (!passwords.next || passwords.next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.error("Passwords do not match");
      return;
    }

    setIsSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.next });
      if (error) throw error;
      setPasswords({ current: "", next: "", confirm: "" });
      toast.success("Password updated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to change password");
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-white/10 bg-card/80 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">Personalize your Triton Hub workspace</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
          Choose what appears in your feed, tune the visual theme, and keep your profile details aligned across the app.
        </p>
      </div>

      <section className="rounded-[28px] border border-white/10 bg-card/80 p-6 space-y-4 shadow-sm">
        <h2 className="text-lg font-semibold">Content</h2>
        <div className="space-y-2">
          <Label>Show updates from</Label>
          <div className="flex flex-wrap gap-2">
            {(["email", "canvas", "both"] as NotificationSourceFilter[]).map((opt) => (
              <Button
                key={opt}
                type="button"
                variant={sourceFilter === opt ? "default" : "outline"}
                onClick={() => setSourceFilter(opt)}
              >
                {opt === "both" ? "Show both" : `Show ${opt} only`}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Applies to announcements, assignments, and calendar views. &quot;Show canvas only&quot; hides Gmail-merged
            items from your feed.
          </p>
        </div>
        <Button type="button" className="rounded-full px-5" onClick={handleSaveContent}>Save content preferences</Button>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-card/80 p-6 space-y-4 shadow-sm">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex gap-2">
          <Button type="button" className="rounded-full px-5" variant={theme === "light" ? "default" : "outline"} onClick={() => setTheme("light")}>
            Light mode
          </Button>
          <Button type="button" className="rounded-full px-5" variant={theme === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")}>
            Dark mode
          </Button>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-card/80 p-6 space-y-4 shadow-sm">
        <h2 className="text-lg font-semibold">Profile</h2>
        <form className="space-y-4" onSubmit={handleSaveProfile}>
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage src={profile.avatarUrl || undefined} alt={profile.username || "User"} />
              <AvatarFallback>{avatarFallback}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{profile.username || "Triton Student"}</p>
              <p className="text-xs text-muted-foreground">{profile.email || "No email available"}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={profile.username}
              onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value }))}
              placeholder="Your display name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar">Profile photo URL</Label>
            <Input
              id="avatar"
              value={profile.avatarUrl}
              onChange={(e) => setProfile((p) => ({ ...p, avatarUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          <Button type="submit" className="rounded-full px-5" disabled={isSavingProfile}>
            {isSavingProfile ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-card/80 p-6 space-y-4 shadow-sm">
        <h2 className="text-lg font-semibold">Security</h2>
        {hasSupabasePasswordAuth ? (
          <form className="space-y-3" onSubmit={handleChangePassword}>
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                value={passwords.current}
                onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                value={passwords.next}
                onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={passwords.confirm}
                onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            <Button type="submit" className="rounded-full px-5" disabled={isSavingPassword}>
              {isSavingPassword ? "Updating..." : "Change password"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            You are signed in with Google OAuth. Manage password/security from your Google account.
          </p>
        )}
      </section>
    </div>
  );
}
