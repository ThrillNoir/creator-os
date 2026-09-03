"use client";

import { useFormStatus } from "react-dom";

export function MessageRefreshButton({ label = "Check for new messages" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <button className="compact-action" type="submit" disabled={pending}>{pending ? "Checking…" : label}</button>;
}
