"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { importFinanceCsvAction, type FinanceImportResult } from "@/app/money-actions";

export async function submitFinanceCsv(
  action: () => Promise<FinanceImportResult>,
  setResult: (result: FinanceImportResult) => void,
  resetForm: () => void,
  refresh: () => void,
) {
  try {
    const next = await action();
    setResult(next);
    if (next.kind === "imported" || next.kind === "duplicate") {
      resetForm();
      refresh();
    }
  } catch {
    setResult({ kind: "error", message: "The server did not confirm the import. Your file is still selected; check recent imports before retrying. Exact duplicate exports are skipped." });
  }
}

export function FinanceCsvImportForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<FinanceImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setResult(null);
    startTransition(async () => {
      await submitFinanceCsv(
        () => importFinanceCsvAction(formData),
        setResult,
        () => formRef.current?.reset(),
        () => router.refresh(),
      );
    });
  }

  return <>
    <form ref={formRef} className="finance-import-form" onSubmit={submit}>
      <label>Platform<select name="platform" required><option value="onlyfans">OnlyFans</option><option value="fansly">Fansly</option><option value="stripe">Stripe</option></select></label>
      <label>CSV export<input name="file" type="file" accept=".csv,text/csv" required /></label>
      <button className="primary" type="submit" disabled={pending}>{pending ? "Checking and importing…" : "Import reviewed earnings"}</button>
    </form>
    {result?.kind === "error" && <p className="connection-banner attention" role="alert">{result.message} The selected file remains available while you check the result.</p>}
    {result?.kind === "imported" && <p className="success" role="status">The reviewed CSV was imported. Matching platform, date and currency rows were updated instead of counted twice.</p>}
    {result?.kind === "duplicate" && <p className="success" role="status">That exact export was already imported. No rows were counted twice; choose a corrected export to try again.</p>}
  </>;
}
