"use client";

import { useState } from "react";
import { ShieldCheck, Tags, UsersRound } from "lucide-react";
import { updateAssetTagsAction } from "@/app/library/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ASSET_DESTINATIONS = ["instagram", "facebook", "tiktok", "threads", "x", "reddit", "subscription", "ppv"] as const;
type AssetDestination = (typeof ASSET_DESTINATIONS)[number];
type AssetSafety = "sfw" | "nsfw" | null;

const labels: Record<AssetDestination, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  threads: "Threads",
  x: "X",
  reddit: "Reddit",
  subscription: "Subscription",
  ppv: "PPV",
};
const nsfwDestinations = new Set<AssetDestination>(["x", "reddit", "subscription", "ppv"]);

type Friend = {
  id: number;
  name: string;
  handles: string;
  consentStatus: string;
  taggingPreference: string;
};
type RelatedAsset = { id: string; basename: string };

export function AssetClassificationForm({
  assetId,
  initial,
  creatorFriends,
  relatedAssets,
  hasTeaserCount,
  compact = false,
  returnTo,
}: {
  assetId: string;
  initial: { safety: AssetSafety; destinations: AssetDestination[]; isTeaser: boolean; isMulti: boolean; teaserForAssetId: string | null; notes: string; personIds: number[] };
  creatorFriends: Friend[];
  relatedAssets: RelatedAsset[];
  hasTeaserCount: number;
  compact?: boolean;
  returnTo?: string;
}) {
  const [safety, setSafety] = useState<AssetSafety>(initial.safety);
  const [destinations, setDestinations] = useState<AssetDestination[]>(initial.destinations);
  const [isTeaser, setIsTeaser] = useState(initial.isTeaser);
  const [isMulti, setIsMulti] = useState(initial.isMulti);
  const availableDestinations = safety === "nsfw" ? ASSET_DESTINATIONS.filter((item) => nsfwDestinations.has(item)) : ASSET_DESTINATIONS;

  function chooseSafety(value: Exclude<AssetSafety, null>) {
    const next = safety === value ? null : value;
    setSafety(next);
    if (!next) setDestinations([]);
    if (next === "nsfw") setDestinations((current) => current.filter((item) => nsfwDestinations.has(item)));
  }

  function toggleDestination(destination: AssetDestination) {
    setDestinations((current) => current.includes(destination) ? current.filter((item) => item !== destination) : [...current, destination]);
  }

  return (
    <form action={updateAssetTagsAction} className={`media-classification-form ${compact ? "media-classification-form-compact" : ""}`}>
      <input name="assetId" type="hidden" value={assetId} />
      <input name="safety" type="hidden" value={safety ?? ""} />
      {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}

      <div className="media-classification-heading">
        <div>
          <p className="media-overline">Classification record</p>
          <h2>{compact ? "Review this asset" : "Asset classification"}</h2>
          <p>Saving updates the review record. The source file remains untouched.</p>
        </div>
        {hasTeaserCount > 0 ? <Badge className="shadow-none" variant="info">Has teaser{hasTeaserCount > 1 ? `s (${hasTeaserCount})` : ""}</Badge> : null}
      </div>

      <fieldset className="media-classification-group">
        <legend><ShieldCheck aria-hidden="true" />Safety</legend>
        <div className="media-safety-controls">
          <Button aria-pressed={safety === "sfw"} onClick={() => chooseSafety("sfw")} size="sm" type="button" variant={safety === "sfw" ? "secondary" : "outline"}>SFW</Button>
          <Button aria-pressed={safety === "nsfw"} onClick={() => chooseSafety("nsfw")} size="sm" type="button" variant={safety === "nsfw" ? "destructive" : "outline"}>NSFW</Button>
        </div>
        {!safety ? <p className="media-field-note">Needs review — choose a safety state only after the asset has been checked.</p> : null}
      </fieldset>

      {safety ? <fieldset className="media-classification-group">
        <legend><Tags aria-hidden="true" />Suitable destinations</legend>
        <div className="media-destination-grid">
          {availableDestinations.map((destination) => <label className="media-toggle-choice" key={destination}>
            <input checked={destinations.includes(destination)} name="destinations" onChange={() => toggleDestination(destination)} type="checkbox" value={destination} />
            <span>{labels[destination]}</span>
          </label>)}
        </div>
        {safety === "nsfw" ? <p className="media-field-note">Public SFW-only destinations are hidden automatically.</p> : null}
      </fieldset> : null}

      <fieldset className="media-classification-group">
        <legend>Asset traits</legend>
        <div className="media-trait-controls">
          <label className="media-toggle-choice"><input checked={isTeaser} name="isTeaser" onChange={(event) => setIsTeaser(event.target.checked)} type="checkbox" value="yes" /><span>Teaser</span></label>
          <label className="media-toggle-choice"><input checked={isMulti} name="isMulti" onChange={(event) => setIsMulti(event.target.checked)} type="checkbox" value="yes" /><span>Multi creator</span></label>
        </div>
      </fieldset>

      {isTeaser ? <div className="media-field-stack">
        <Label htmlFor={`teaser-for-${assetId}`}>Teaser for <span className="media-optional">(optional)</span></Label>
        <select className="media-select" defaultValue={initial.teaserForAssetId ?? ""} id={`teaser-for-${assetId}`} name="teaserForAssetId">
          <option value="">Choose the main asset</option>
          {relatedAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.basename}</option>)}
        </select>
      </div> : null}

      {isMulti ? <fieldset className="media-classification-group">
        <legend><UsersRound aria-hidden="true" />Creator friends in this asset</legend>
        {creatorFriends.length ? <div className="media-person-choice-list">
          {creatorFriends.map((friend) => <label className="media-person-choice" key={friend.id}>
            <input defaultChecked={initial.personIds.includes(friend.id)} name="personIds" type="checkbox" value={friend.id} />
            <span><strong>{friend.name}</strong><small>{friend.handles || "No handles recorded"}</small><em>Consent: {friend.consentStatus.replaceAll("_", " ")} · Tagging: {friend.taggingPreference.replaceAll("_", " ")}</em></span>
          </label>)}
        </div> : <p className="media-field-note">Add creator friends and recorded preferences under People &amp; tags first.</p>}
      </fieldset> : null}

      <div className="media-field-stack">
        <Label htmlFor={`asset-notes-${assetId}`}>Optional notes</Label>
        <Textarea defaultValue={initial.notes} id={`asset-notes-${assetId}`} name="notes" placeholder="Private handling, context, or usage notes" />
      </div>

      <Button type="submit">{compact ? "Save in list" : "Save classification"}</Button>
    </form>
  );
}
