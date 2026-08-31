"use client";

import { useActionState, useEffect, useState } from "react";
import { INTERVIEW_QUESTIONS, nextInterviewIndex } from "@/lib/onboarding-interview";

type SaveResult = { ok: boolean; message: string };
type SaveAction = (previous: SaveResult, form: FormData) => Promise<SaveResult>;
type AiResult = { reply: string; proposals: { field: string; value: string }[] };

export function GuidedOnboardingInterview({ values, saveAction, accountAction }: { values: Record<string, string>; saveAction: SaveAction; accountAction: (form: FormData) => Promise<void> }) {
  const [index, setIndex] = useState(() => nextInterviewIndex(values));
  const [review, setReview] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(values);
  const [ai, setAi] = useState({ pending: false, message: "" });
  const [state, action, pending] = useActionState(saveAction, { ok: true, message: "" });
  const question = INTERVIEW_QUESTIONS[index];
  const shown = answer ?? (question.field ? confirmed[question.field] ?? "" : "");

  const go = (next: number) => {
    setAnswer(null);
    setReview(false);
    setAi({ pending: false, message: "" });
    setIndex(Math.max(0, Math.min(INTERVIEW_QUESTIONS.length - 1, next)));
  };

  useEffect(() => {
    if (state.ok && state.message) {
      if (question.field) setConfirmed((current) => ({ ...current, [question.field!]: answer ?? "" }));
      go(index + 1);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function askAi() {
    if (!question.field || !shown.trim() || ai.pending) return;
    setAi({ pending: true, message: "Drafting…" });
    try {
      const response = await fetch("/api/onboarding/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questionId: question.id, question: question.prompt, answer: shown, drafts: confirmed }) });
      const body = await response.json() as { ok?: boolean; result?: AiResult; error?: string };
      if (!response.ok || !body.ok || !body.result) throw new Error(body.error || "The assistant is unavailable.");
      const proposal = body.result.proposals.find((item) => item.field === question.field);
      if (proposal) setAnswer(proposal.value);
      setAi({ pending: false, message: `${body.result.reply} Edit the draft, then save it when it feels right.` });
    } catch (error) {
      setAi({ pending: false, message: error instanceof Error ? error.message : "The assistant is unavailable. Your answer is still here." });
    }
  }

  return <section className="panel guided-interview" aria-labelledby="guided-interview-title">
    <div className="section-heading"><div><span className="eyebrow">GUIDED SETUP</span><h2 id="guided-interview-title">One friendly question at a time</h2><p>Step {index + 1} of {INTERVIEW_QUESTIONS.length}. Confirmed answers stay in existing onboarding fields.</p></div><span aria-live="polite">{pending ? "Saving…" : state.message}</span></div>
    {review ? <div aria-live="polite"><h3>Confirmed values</h3><dl>{INTERVIEW_QUESTIONS.filter((item) => item.field).map((item) => <div key={item.id}><dt>{item.title}</dt><dd>{confirmed[item.field!] || "Not answered yet"}</dd></div>)}</dl><p>Missing items can be completed with Edit manually. The agency handles compliance and activation.</p><button className="secondary-action" type="button" onClick={() => setReview(false)}>Back to interview</button></div> : <>
      <form action={action}><p className="eyebrow">{question.chapter}</p><h3>{question.title}</h3><p>{question.prompt}</p><p className="muted">{question.help}</p>{question.field ? <label>Confirm your answer<textarea name="answer" value={shown} maxLength={question.maxLength} onChange={(event) => setAnswer(event.target.value)} aria-describedby="guided-save-feedback guided-ai-feedback" autoFocus /></label> : <input type="hidden" name="answer" value="" />}<input type="hidden" name="field" value={question.field ?? ""} /><div className="form-actions"><button className="secondary-action" type="button" onClick={() => go(index - 1)} disabled={index === 0}>Back</button><button className="compact-action" type="button" onClick={() => go(index + 1)}>Skip for now</button>{question.field && <><button className="secondary-action" type="button" disabled={ai.pending || !shown.trim()} onClick={askAi}>{ai.pending ? "Drafting…" : "Polish with my AI"}</button><button className="primary" type="submit" disabled={pending}>Save and continue</button></>}<button className="secondary-action" type="button" onClick={() => setReview(true)}>Review</button></div><p id="guided-ai-feedback" role="status" aria-live="polite">{ai.message}</p><p id="guided-save-feedback" role="status" aria-live="polite">{state.ok ? "" : state.message}</p></form>
      <form action={accountAction} className="inline-form"><h3>Map an account</h3><p className="muted">Descriptive only: no connection, publishing or messaging authority.</p><input type="hidden" name="accountKind" value="social" /><label>Platform<input name="platform" placeholder="instagram, reddit, x, fansly…" required /></label><label>Label<input name="label" required /></label><label>Username or handle<input name="username" /></label><label>Purpose<input name="purpose" /></label><button className="secondary-action" type="submit">Add descriptive account</button></form>
    </>}
  </section>;
}
