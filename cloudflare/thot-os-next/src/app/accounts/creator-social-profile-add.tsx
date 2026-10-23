"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCreatorSocialProfileAction } from "@/app/onboarding/actions";
import { selfServeSocialPlatforms, type SelfServeSocialPlatform } from "@/lib/social-profile-handles";

const names: Record<SelfServeSocialPlatform, string> = { instagram: "Instagram", tiktok: "TikTok", reddit: "Reddit" };

export function CreatorSocialProfileAdd({ hasPin }: { hasPin: boolean }) {
  const router = useRouter();
  const [platform, setPlatform] = useState<SelfServeSocialPlatform>("instagram");
  const [username, setUsername] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pin, setPin] = useState("");
  const [pinReady, setPinReady] = useState(hasPin);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function confirmPin(action: "setup_pin" | "step_up") {
    const response = await fetch("/api/access/credentials", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, pin }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Account PIN could not be confirmed.");
  }

  async function addProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      if (!/^\d{4}$/.test(pin)) throw new Error("Enter your four-digit Account PIN.");
      if (!pinReady) { await confirmPin("setup_pin"); setPinReady(true); }
      await confirmPin("step_up");
      const form = new FormData();
      form.set("platform", platform); form.set("username", username); form.set("purpose", purpose);
      await createCreatorSocialProfileAction(form);
      setUsername(""); setPurpose(""); setPin("");
      setMessage(`${names[platform]} profile saved. It is awaiting agency review before it can be connected.`);
      router.refresh();
    } catch (error) {
      setPin("");
      setMessage(error instanceof Error ? error.message : "Could not add the profile.");
    } finally { setBusy(false); }
  }

  return <section className="panel connection-setup" id="add-social-profile">
    <div className="section-heading"><div><span className="eyebrow">YOUR SOCIAL PROFILES</span><h2>Add a profile</h2>
      <p>Add as many Instagram, TikTok and Reddit profiles as you use. Record the username now; connect supported platforms after review. No platform password is needed here.</p></div></div>
    <form className="inline-form" onSubmit={addProfile}>
      <label>Platform<select value={platform} onChange={(event) => setPlatform(event.target.value as SelfServeSocialPlatform)}>{selfServeSocialPlatforms.map((item) => <option key={item} value={item}>{names[item]}</option>)}</select></label>
      <label>Username<input autoComplete="off" maxLength={120} required value={username} onChange={(event) => setUsername(event.target.value)} placeholder={platform === "reddit" ? "u/yourname" : "@yourname"} /></label>
      <label>Used for (optional)<input maxLength={400} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Main, backup, or a content theme" /></label>
      <label>{pinReady ? "Account PIN" : "Create your four-digit Account PIN"}<input autoComplete="off" inputMode="numeric" pattern="[0-9]{4}" type="password" maxLength={4} required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label>
      <button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : "Add profile"}</button>
    </form>
    <p className="privacy-note">Adding a username does not prove ownership or grant posting access. Instagram and Reddit use their own sign-in when you connect; TikTok connection is not available yet.</p>
    <p aria-live="polite" role="status">{message}</p>
  </section>;
}
