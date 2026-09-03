"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Presentation only: saving is not agency approval or activation.
export function OnboardingSection({ id, heading, saved, children, className = "" }: { id: string; heading: ReactNode; saved: boolean; children: ReactNode; className?: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [saveCount, setSaveCount] = useState(0);
  useEffect(() => {
    const element = details.current;
    const onSaved = () => setSaveCount((count) => count + 1);
    const revealTarget = () => {
      if (window.location.hash === `#${id}` && element) element.open = true;
    };
    element?.addEventListener("onboarding:saved", onSaved);
    window.addEventListener("hashchange", revealTarget);
    revealTarget();
    return () => { element?.removeEventListener("onboarding:saved", onSaved); window.removeEventListener("hashchange", revealTarget); };
  }, [id]);
  useEffect(() => {
    if (!saveCount || !saved || !details.current) return;
    details.current.open = false;
    details.current.querySelector("summary")?.focus();
  }, [saveCount, saved]);
  return <details ref={details} id={id} className={`panel onboarding-section ${className}`} open={!saved}>
    <summary>{heading}<span className="onboarding-section-toggle"><span className="when-closed">Expand to review or edit</span><span className="when-open">Collapse section</span></span></summary>
    <div className="onboarding-section-body">{children}</div>
  </details>;
}

export function OnboardingForm({ action, className, children }: { action: (form: FormData) => Promise<unknown>; className?: string; children: ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return <form ref={formRef} className={className} onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(""); setSaving(true);
    try {
      await action(form);
      formRef.current?.dispatchEvent(new Event("onboarding:saved", { bubbles: true }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save. Your answers are still here.");
    } finally { setSaving(false); }
  }}><fieldset disabled={saving} className="onboarding-form-fields">{children}</fieldset>{saving && <p role="status">Saving…</p>}{error && <p role="alert" className="creator-review-missing">{error}</p>}</form>;
}
