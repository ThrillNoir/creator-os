"use client";

import { useState, type ReactNode } from "react";
import { destinations, type AssetRow, type Destination } from "@/lib/library";

const nsfwDestinations = new Set<Destination>(["x", "reddit", "subscription", "ppv"]);

export function AttributeFields({ asset, multiFields }: { asset?: AssetRow; multiFields?: ReactNode }) {
  const [safety, setSafety] = useState<"sfw" | "nsfw" | "">(asset?.safety === "sfw" || asset?.safety === "nsfw" ? asset.safety : "");
  const [selected, setSelected] = useState(() => new Set(asset?.destinations.split("|").filter((value): value is Destination => destinations.includes(value as Destination)) ?? []));
  const [isMulti, setIsMulti] = useState(Boolean(asset?.is_multi));
  const visibleDestinations = safety === "nsfw" ? destinations.filter((destination) => nsfwDestinations.has(destination)) : destinations;
  const paidUse = selected.has("subscription") || selected.has("ppv");

  function chooseSafety(next: "sfw" | "nsfw") {
    const value = safety === next ? "" : next;
    setSafety(value);
    if (value === "nsfw") setSelected((current) => new Set([...current].filter((destination) => nsfwDestinations.has(destination))));
  }

  function toggleDestination(destination: Destination) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(destination)) next.delete(destination); else next.add(destination);
      return next;
    });
  }

  return <div className="attribute-fields">
    <input type="hidden" name="safety" value={safety} />
    {multiFields && !isMulti && <input type="hidden" name="peopleMode" value="replace" />}
    <fieldset><legend>1 · Safety</legend><div className="choice-row"><button className={safety === "sfw" ? "selected sfw" : ""} type="button" aria-pressed={safety === "sfw"} onClick={() => chooseSafety("sfw")}>SFW</button><button className={safety === "nsfw" ? "selected nsfw" : ""} type="button" aria-pressed={safety === "nsfw"} onClick={() => chooseSafety("nsfw")}>NSFW</button></div><p className="field-help">{safety ? "Select the same option again to return this asset to Needs review." : "Nothing selected — this asset needs review."}</p></fieldset>
    {safety ? <fieldset><legend>2 · Suitable destinations</legend><div className="choice-row">{visibleDestinations.map((destination) => <label className={selected.has(destination) ? "selected" : ""} key={destination}><input type="checkbox" name="destination" value={destination} checked={selected.has(destination)} onChange={() => toggleDestination(destination)} /> {destination}</label>)}</div>{safety === "nsfw" && <p className="field-help">Only destinations that accept this classification are shown.</p>}</fieldset> : <div className="next-step"><b>Destinations appear after safety is set</b><span>This keeps unsuitable platforms out of the workflow.</span></div>}
    <fieldset><legend>{safety ? "3" : "2"} · Content traits</legend><div className="choice-row"><label><input type="checkbox" name="isTeaser" defaultChecked={Boolean(asset?.is_teaser)} /> Has teaser</label><label className={isMulti ? "selected" : ""}><input type="checkbox" name="isMulti" checked={isMulti} onChange={(event) => setIsMulti(event.target.checked)} /> Multiple creators</label></div></fieldset>
    {isMulti && multiFields && <div className={`multi-extra ${paidUse ? "paid-use" : ""}`}><div className="section-divider"><b>Creator friends</b><span>Add the people shown in this asset.</span></div>{multiFields}</div>}
    <label className="notes">Optional notes<textarea name="notes" defaultValue={asset?.notes ?? ""} maxLength={2000} /></label>
  </div>;
}
