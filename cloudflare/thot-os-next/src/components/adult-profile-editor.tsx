"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { publishAdultProfileAction, saveAdultProfileDraftAction, type AdultProfileDraftState, type AdultProfileDraftValues } from "@/app/actions";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import type { ProfileAppearance } from "@/lib/profile-appearance-contract";

type LinkValue = { id: string; label: string; destination: string; stableId: string };

type Props = {
  bio: string;
  links: LinkValue[];
  appearance: ProfileAppearance;
  inheritedAppearance: ProfileAppearance | null;
  displayName: string;
  images: ProfileImageAttachment[];
  draftVersionId?: string;
  viewVersionId?: string;
  versionForPublishId?: string;
  published: boolean;
  canPublish: boolean;
  publishingConfigured: boolean;
  imageUploadsEnabled: boolean;
  liveBackgroundPresent: boolean;
};

const initialAdultProfileDraftState: AdultProfileDraftState = {
  status: "idle",
  message: null,
  reasonCode: null,
  fieldErrors: {},
  values: null,
};

function initialValues(props: Props): AdultProfileDraftValues {
  const slots = Array.from({ length: Math.max(4, Math.min(12, props.links.length || 4)) }, (_, index) => props.links[index] ?? { id: `new-${index}`, label: "", destination: "", stableId: "" });
  return {
    bio: props.bio,
    linkLabels: slots.map((link) => link.label),
    linkDestinations: slots.map((link) => link.destination),
    linkStableIds: slots.map((link) => link.stableId),
  };
}

function errorId(field: string) { return `adult-profile-error-${field.replaceAll(".", "-")}`; }

export function AdultProfileEditor(props: Props) {
  const [state, formAction, isPending] = useActionState(saveAdultProfileDraftAction, initialAdultProfileDraftState);
  const [values, setValues] = useState(() => initialValues(props));
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error" && state.values) setValues(state.values);
  }, [state]);
  useEffect(() => { if (state.status === "error") errorSummary.current?.focus(); }, [state.status]);
  const error = (field: string) => state.fieldErrors[field];
  const fieldProps = (field: string) => error(field) ? { "aria-invalid": true, "aria-describedby": errorId(field) } : {};
  const updateLink = (field: "linkLabels" | "linkDestinations", index: number, value: string) => setValues((current) => ({ ...current, [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item) }));
  const slots = Array.from({ length: Math.max(4, Math.min(12, values.linkLabels.length || 4)) }, (_, index) => index);
  const formId = "adult-profile-editor";
  const errorCount = Object.keys(state.fieldErrors).length;
  return <>
    {state.status === "error" && <div className="error" role="alert" tabIndex={-1} ref={errorSummary}>
      <b>{state.message}</b>{state.reasonCode && <span> Reference: {state.reasonCode}.</span>}{errorCount > 0 && <span> Review the {errorCount === 1 ? "highlighted field" : "highlighted fields"} below.</span>}
    </div>}
    <form action={formAction} className="inline-form public-profile-form" id={formId} noValidate>
      <label className="wide">Adult bio <small>(optional)</small><textarea name="adultBio" maxLength={2000} value={values.bio} onChange={(event) => setValues((current) => ({ ...current, bio: event.target.value }))} {...fieldProps("adultBio")} />{error("adultBio") && <span className="field-error" id={errorId("adultBio")}>{error("adultBio")}</span>}</label>
      <div className="section-divider wide"><b>Creator links</b><span>Use generic labels and final HTTPS destinations. Fansly, OnlyFans, and future platforms are values, not schema fields.</span>{error("links") && <span className="field-error" id={errorId("links")}>{error("links")}</span>}</div>
      {slots.map((index) => <div className="public-link-fields" key={values.linkStableIds[index] || `new-${index}`}>
        <input type="hidden" name="adultLinkStableId" value={values.linkStableIds[index] ?? ""} />
        <label>Label<input name="adultLinkLabel" maxLength={80} value={values.linkLabels[index] ?? ""} onChange={(event) => updateLink("linkLabels", index, event.target.value)} placeholder="Creator page" {...fieldProps(`adultLinkLabel.${index}`)} />{error(`adultLinkLabel.${index}`) && <span className="field-error" id={errorId(`adultLinkLabel.${index}`)}>{error(`adultLinkLabel.${index}`)}</span>}</label>
        <label>HTTPS destination<input name="adultLinkDestination" type="url" value={values.linkDestinations[index] ?? ""} onChange={(event) => updateLink("linkDestinations", index, event.target.value)} placeholder="https://example.com" {...fieldProps(`adultLinkDestination.${index}`)} />{error(`adultLinkDestination.${index}`) && <span className="field-error" id={errorId(`adultLinkDestination.${index}`)}>{error(`adultLinkDestination.${index}`)}</span>}</label>
      </div>)}
      <div aria-invalid={Boolean(error("appearance")) || undefined} aria-describedby={error("appearance") ? errorId("appearance") : undefined}>
        <ProfileAppearanceEditor surface="adult" initialAppearance={props.appearance} inheritedAppearance={props.inheritedAppearance} displayName={props.displayName} sampleLinks={values.linkLabels} versionId={props.draftVersionId} viewVersionId={props.viewVersionId} draftFormId={formId} initialImages={props.images} imageUploadsEnabled={props.imageUploadsEnabled} liveBackgroundPresent={props.liveBackgroundPresent} />
      </div>
      {error("appearance") && <span className="field-error wide" id={errorId("appearance")}>{error("appearance")}</span>}
    </form>
    <div className="profile-action-bar wide" aria-label="18+ profile actions">
      <div><b>{props.published ? props.draftVersionId ? "Unpublished changes" : "Live" : props.versionForPublishId ? "Saved privately" : "Not saved yet"}</b><span>{props.published && !props.draftVersionId ? "Your protected 18+ profile is live." : "Save your changes, then publish when ready."}</span></div>
      <div className="profile-action-buttons">
        <button className="secondary-action" type="submit" form={formId} disabled={isPending}>{isPending ? "Saving…" : "Save"}</button>
        {props.canPublish && props.versionForPublishId && <form action={publishAdultProfileAction}><input type="hidden" name="adultVersionId" value={props.versionForPublishId} /><button className="primary" type="submit" disabled={!props.publishingConfigured || isPending}>Publish</button></form>}
      </div>
      {!props.publishingConfigured && props.canPublish && <small>Publishing will become available when the protected staging release service is configured.</small>}
    </div>
  </>;
}
