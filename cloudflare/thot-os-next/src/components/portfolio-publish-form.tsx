"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { PortfolioEditLink } from "./portfolio-edit-link";

export type PortfolioPublishChoice = {
  id: string;
  title: string;
  video: boolean;
  ready: boolean;
  message: string;
  issues: { message: string; href: string }[];
};

function PublishButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return <button className="primary" type="submit" disabled={!enabled || pending}>{pending ? "Starting publication…" : "Approve and publish selected previews"}</button>;
}

export function PortfolioPublishForm({ action, items, profileReady }: {
  action: (form: FormData) => Promise<void>;
  items: PortfolioPublishChoice[];
  profileReady: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [telegram, setTelegram] = useState("");
  const [email, setEmail] = useState("");
  const [approved, setApproved] = useState(false);
  const selectedVideo = items.some((item) => item.video && selected.includes(item.id));
  const contactReady = !selectedVideo || Boolean(telegram.trim() || email.trim());
  const enabled = profileReady && selected.length > 0 && contactReady && approved;
  const readyCount = items.filter((item) => item.ready).length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? current.length < 24 ? [...current, id] : current : current.filter((value) => value !== id));
  }

  return <form action={action} className="portfolio-release-form">
    <fieldset className="portfolio-release-choices">
      <legend>Select previews to publish</legend>
      <p>Select up to 24 cards. These are the only cards this approval will cover; your other draft items stay private.</p>
      {items.length ? <div className="portfolio-release-choice-list">{items.map((item) => <div className={`portfolio-release-choice${item.ready ? "" : " is-blocked"}`} key={item.id}>
        <label><input type="checkbox" name="assetIds" value={item.id} checked={selected.includes(item.id)} disabled={!item.ready} onChange={(event) => toggle(item.id, event.target.checked)} />
          <span><strong>{item.title}</strong><small>{item.ready ? "Ready for final release checks" : item.message}</small></span></label>
        {!item.ready && <ul className="portfolio-release-issues">{item.issues.map((issue) => <li key={issue.message + issue.href}>
          {issue.href.startsWith("#portfolio-item-")
            ? <PortfolioEditLink id={issue.href.slice(1)}>{issue.message} →</PortfolioEditLink>
            : <Link href={issue.href}>{issue.message} →</Link>}
        </li>)}</ul>}
      </div>)}</div> : <p className="portfolio-release-empty">Add an item from the Content Library to start.</p>}
      <p className="portfolio-release-count" aria-live="polite">{selected.length} selected · {readyCount} of {items.length} available for final checks{selected.length === 24 ? " · 24 item limit reached" : ""}</p>
    </fieldset>

    <div className="portfolio-release-next"><h3>How visitors can contact you</h3><p>Needed when your selection includes video. Visitors review and send the prepared full-length request from their own Telegram or email app.</p>
      <div className="portfolio-release-contact"><label>Telegram username <span>(optional)</span><input name="telegramUsername" value={telegram} onChange={(event) => setTelegram(event.target.value)} placeholder="@creatorname" pattern="@?[A-Za-z0-9_]{5,32}" title="Use 5 to 32 letters, numbers or underscores, with an optional @" maxLength={33} autoComplete="off" /></label>
        <label>Contact email <span>(optional)</span><input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" /></label></div>
      {selectedVideo && !contactReady && <p className="portfolio-release-hint" role="status">Add a Telegram username or email address for full-length video requests.</p>}
    </div>

    <div className="portfolio-release-approval"><h3>Final approval</h3><p>Only selected previews and thumbnails can go to the public, age-gated More page. Full-length originals stay private. We check the media, teaser links, rights and consent again before anything appears.</p>
      <label><input type="checkbox" name="publicRightsApproved" value="yes" required checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span>I confirm that I have the right to publish each selected preview and thumbnail on my public 18+ More page, and that everyone shown has consented to this public use.</span></label>
      {!profileReady && <p className="portfolio-release-hint">First <Link href="/adult-profile">publish your 18+ profile</Link>. Your Portfolio selection will stay private until then.</p>}
      <div className="portfolio-release-submit"><PublishButton enabled={enabled} /><small>Publishing starts after you approve. If a final check fails, the release stays private and its status appears here.</small></div>
    </div>
  </form>;
}
