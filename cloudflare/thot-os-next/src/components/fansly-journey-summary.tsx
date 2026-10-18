import { fanslyJourney, type FanslyJourneyInput } from "@/lib/fansly-journey";

export function FanslyJourneySummary({ creatorName, actorLabel, lastSeenLabel, ...input }: FanslyJourneyInput & { creatorName: string; actorLabel: string; lastSeenLabel: string }) {
  const journey = fanslyJourney(input);
  return <section className="fansly-journey" aria-labelledby="fansly-journey-title">
    <div className="section-heading"><div><span className="eyebrow">CURRENT WORKSPACE</span><h2 id="fansly-journey-title">Fansly setup for {creatorName}</h2><p>Working as {actorLabel}. Account: {input.accountLabel || "not configured"}. Chrome profile: {input.profileLabel || "not assigned"}.</p></div></div>
    <ol className="fansly-journey-steps">{journey.steps.map((step) => <li className={`fansly-step-${step.state}`} key={step.label}><span aria-hidden="true" className="fansly-step-mark">{step.state === "done" ? "✓" : step.state === "blocked" ? "!" : "·"}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>
    {input.lastSeenAt && <p className="fansly-last-seen">Last recorded browser check-in: {lastSeenLabel}.</p>}
    <p className="fansly-next-action"><strong>Next step</strong><span>{journey.nextAction}</span></p>
  </section>;
}
