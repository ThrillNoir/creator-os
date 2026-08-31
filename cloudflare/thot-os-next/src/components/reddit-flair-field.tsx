"use client";

import { useMemo, useState } from "react";

type Community = { id: number; name: string; flair_required: number; flairs_checked_at: string | null };
type Flair = { community_id: number; flair_id: string; flair_text: string };

export function RedditCommunityAndFlairFields({
  communities,
  flairs,
  defaultCommunityId,
  defaultFlairId,
  defaultTargetType,
  accountHandle,
  profileAvailable = false,
}: {
  communities: Community[];
  flairs: Flair[];
  defaultCommunityId?: number | null;
  defaultFlairId?: string | null;
  defaultTargetType?: "profile" | "subreddit";
  accountHandle?: string | null;
  profileAvailable?: boolean;
}) {
  const profileHandle = accountHandle?.replace(/^u\//i, "") ?? "";
  const [targetType, setTargetType] = useState<"profile" | "subreddit">(defaultTargetType ?? "subreddit");
  const [communityId, setCommunityId] = useState(defaultCommunityId ? String(defaultCommunityId) : "");
  const [flairId, setFlairId] = useState(() => defaultFlairId && flairs.some((flair) => flair.flair_id === defaultFlairId && flair.community_id === defaultCommunityId) ? defaultFlairId : "");
  const community = communities.find((item) => String(item.id) === communityId);
  const choices = useMemo(() => flairs.filter((flair) => String(flair.community_id) === communityId), [communityId, flairs]);
  const flairRequired = community?.flair_required === 1;
  const unavailable = Boolean(communityId && !choices.length);

  return <>
    <fieldset className="wide"><legend>Publish target</legend><label><input type="radio" name="targetType" value="profile" checked={targetType === "profile"} disabled={!profileAvailable} onChange={() => { setTargetType("profile"); setCommunityId(""); setFlairId(""); }} /> Creator profile {profileHandle ? `(u/${profileHandle})` : "(verified account required)"}</label><label><input type="radio" name="targetType" value="subreddit" checked={targetType === "subreddit"} onChange={() => { setTargetType("subreddit"); setCommunityId(""); setFlairId(""); }} /> Saved subreddit</label></fieldset>
    {targetType === "subreddit" ? <><label>Subreddit<select name="communityId" required value={communityId} onChange={(event) => { setCommunityId(event.target.value); setFlairId(""); }}><option value="" disabled>Choose a community</option>{communities.map((item) => <option value={item.id} key={item.id}>r/{item.name}{item.flair_required ? " · flair required" : ""}</option>)}</select></label>
      <label>Post flair<select name="flairId" value={flairId} required={flairRequired} disabled={!communityId} onChange={(event) => setFlairId(event.target.value)}><option value="">{unavailable && flairRequired ? "Refresh required flairs first" : flairRequired ? "Choose required flair" : "No flair"}</option>{choices.map((flair) => <option value={flair.flair_id} key={flair.flair_id}>{flair.flair_text}</option>)}</select><small>{!communityId ? "Choose a subreddit first." : unavailable ? `No selectable flairs saved. Refresh r/${community?.name} in Communities.` : flairRequired ? "Reddit requires one of these flairs." : "Optional for this subreddit."}</small></label></> : <p className="wide">Profile posts use the selected account’s verified Reddit identity. Subreddit rules and flair do not apply.</p>}
  </>;
}
