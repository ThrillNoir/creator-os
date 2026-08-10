"use client";

import {useState} from "react";
import {updateAssetTagsAction} from "@/app/library/actions";

const ASSET_DESTINATIONS=["instagram","facebook","tiktok","threads","x","reddit","subscription","ppv"] as const;
type AssetDestination=(typeof ASSET_DESTINATIONS)[number];
type AssetSafety="sfw"|"nsfw"|null;

const labels:Record<AssetDestination,string>={
  instagram:"Instagram",facebook:"Facebook",tiktok:"TikTok",threads:"Threads",
  x:"X",reddit:"Reddit",subscription:"Subscription",ppv:"PPV",
};
const nsfwDestinations=new Set<AssetDestination>(["x","reddit","subscription","ppv"]);

type Friend={id:number;name:string;handles:string};
type RelatedAsset={id:string;basename:string};

export function AssetClassificationForm({assetId,initial,creatorFriends,relatedAssets,hasTeaserCount,compact=false,returnTo}:{
  assetId:string;
  initial:{safety:AssetSafety;destinations:AssetDestination[];isTeaser:boolean;isMulti:boolean;teaserForAssetId:string|null;notes:string;personIds:number[]};
  creatorFriends:Friend[];
  relatedAssets:RelatedAsset[];
  hasTeaserCount:number;
  compact?:boolean;
  returnTo?:string;
}){
  const [safety,setSafety]=useState<AssetSafety>(initial.safety);
  const [destinations,setDestinations]=useState<AssetDestination[]>(initial.destinations);
  const [isTeaser,setIsTeaser]=useState(initial.isTeaser);
  const [isMulti,setIsMulti]=useState(initial.isMulti);
  const available=safety==="nsfw"?ASSET_DESTINATIONS.filter((item)=>nsfwDestinations.has(item)):ASSET_DESTINATIONS;
  const chooseSafety=(value:Exclude<AssetSafety,null>)=>{
    const next=safety===value?null:value;
    setSafety(next);
    if(!next)setDestinations([]);
    if(next==="nsfw")setDestinations((current)=>current.filter((item)=>nsfwDestinations.has(item)));
  };
  const toggleDestination=(destination:AssetDestination)=>setDestinations((current)=>current.includes(destination)?current.filter((item)=>item!==destination):[...current,destination]);

  return <form action={updateAssetTagsAction} className={`asset-tag-form classification-form ${compact?"compact-list-classification":""}`}>
    <input type="hidden" name="assetId" value={assetId}/><input type="hidden" name="safety" value={safety??""}/>
    {returnTo&&<input type="hidden" name="returnTo" value={returnTo}/>}
    <div className="classification-title"><div><h2>{compact?"Classification":"Asset classification"}</h2><p>Save records the review. The source file stays untouched.</p></div>{hasTeaserCount>0&&<b>Has teaser{hasTeaserCount>1?`s (${hasTeaserCount})`:""}</b>}</div>
    <fieldset><legend>Safety</legend><div className="safety-choice-row">
      <label className={safety==="sfw"?"selected":""}><input type="checkbox" checked={safety==="sfw"} onChange={()=>chooseSafety("sfw")}/> SFW</label>
      <label className={safety==="nsfw"?"selected":""}><input type="checkbox" checked={safety==="nsfw"} onChange={()=>chooseSafety("nsfw")}/> NSFW</label>
    </div>{!safety&&<small className="derived-review-state">Needs review — choose one when this asset has been checked.</small>}</fieldset>
    {safety&&<fieldset><legend>Suitable destinations</legend><div className="destination-choice-grid">{available.map((destination)=><label className={destinations.includes(destination)?"selected":""} key={destination}><input type="checkbox" name="destinations" value={destination} checked={destinations.includes(destination)} onChange={()=>toggleDestination(destination)}/>{labels[destination]}</label>)}</div>{safety==="nsfw"&&<small className="derived-review-state">Public SFW-only destinations are hidden automatically.</small>}</fieldset>}
    <fieldset><legend>Asset traits</legend><div className="trait-choice-row">
      <label className={isTeaser?"selected":""}><input type="checkbox" name="isTeaser" value="yes" checked={isTeaser} onChange={(event)=>setIsTeaser(event.target.checked)}/> Teaser</label>
      <label className={isMulti?"selected":""}><input type="checkbox" name="isMulti" value="yes" checked={isMulti} onChange={(event)=>setIsMulti(event.target.checked)}/> Multi</label>
    </div></fieldset>
    {isTeaser&&<label className="classification-field">Teaser for <span>(optional)</span><select name="teaserForAssetId" defaultValue={initial.teaserForAssetId??""}><option value="">Choose the main asset</option>{relatedAssets.map((asset)=><option value={asset.id} key={asset.id}>{asset.basename}</option>)}</select></label>}
    {isMulti&&<fieldset className="creator-friend-field"><legend>Creator friends in this asset</legend>{creatorFriends.length?<div>{creatorFriends.map((friend)=><label key={friend.id}><input type="checkbox" name="personIds" value={friend.id} defaultChecked={initial.personIds.includes(friend.id)}/><span><strong>{friend.name}</strong><small>{friend.handles||"No handles recorded"}</small></span></label>)}</div>:<small className="derived-review-state">Add creator friends under People &amp; tags first.</small>}</fieldset>}
    <label className="classification-field">Optional notes<textarea name="notes" defaultValue={initial.notes} placeholder="Private handling, context or usage notes"/></label>
    <button className="primary-button">{compact?"Save in list":"Save classification"}</button>
  </form>;
}
