"use client";

import { useMemo, useState } from "react";

type Community = { id: number; name: string; flair_required: number; flairs_checked_at: string | null };
type Flair = { community_id: number; flair_id: string; flair_text: string };

export function RedditCommunityAndFlairFields({
  communities,
  flairs,
  defaultCommunityId,
  defaultFlairId,
}: {
  communities: Community[];
  flairs: Flair[];
  defaultCommunityId?: number | null;
  defaultFlairId?: string | null;
}) {
  const [communityId, setCommunityId] = useState(defaultCommunityId ? String(defaultCommunityId) : "");
  const [flairId, setFlairId] = useState(() => defaultFlairId && flairs.some((flair) => flair.flair_id === defaultFlairId && flair.community_id === defaultCommunityId) ? defaultFlairId : "");
  const community = communities.find((item) => String(item.id) === communityId);
  const choices = useMemo(() => flairs.filter((flair) => String(flair.community_id) === communityId), [communityId, flairs]);
  const flairRequired = community?.flair_required === 1;
  const unavailable = Boolean(communityId && !choices.length);

  return <>
    <label>Subreddit<select name="communityId" required value={communityId} onChange={(event) => { setCommunityId(event.target.value); setFlairId(""); }}><option value="" disabled>Choose a community</option>{communities.map((item) => <option value={item.id} key={item.id}>r/{item.name}{item.flair_required ? " · flair required" : ""}</option>)}</select></label>
    <label>Post flair<select name="flairId" value={flairId} required={flairRequired} disabled={!communityId} onChange={(event) => setFlairId(event.target.value)}><option value="">{unavailable && flairRequired ? "Refresh required flairs first" : flairRequired ? "Choose required flair" : "No flair"}</option>{choices.map((flair) => <option value={flair.flair_id} key={flair.flair_id}>{flair.flair_text}</option>)}</select><small>{!communityId ? "Choose a subreddit first." : unavailable ? `No selectable flairs saved. Refresh r/${community?.name} in Communities.` : flairRequired ? "Reddit requires one of these flairs." : "Optional for this subreddit."}</small></label>
  </>;
}
