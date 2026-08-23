"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { initialPublicProfileDraftState, publishPublicProfileAction, savePublicProfileDraftAction, type PublicProfileDraftValues } from "@/app/actions";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import type { ProfileAppearance } from "@/lib/profile-appearance-contract";

type LinkValue = { id: string; label: string; destination: string; stableId: string };

type Props = {
  defaultSlug: string;
  displayName: string;
  headline: string;
  bio: string;
  phone: string;
  email: string;
  links: LinkValue[];
  appearance: ProfileAppearance;
  images: ProfileImageAttachment[];
  draftVersionId?: string;
  versionForPublishId?: string;
  canApprove: boolean;
  publishingConfigured: boolean;
  imageUploadsEnabled: boolean;
};

function initialValues(props: Props): PublicProfileDraftValues {
  const slots = Array.from({ length: Math.max(4, Math.min(8, props.links.length + 1)) }, (_, index) => props.links[index] ?? { id: `new-${index}`, label: "", destination: "", stableId: "" });
  return {
    slug: props.defaultSlug,
    displayName: props.displayName,
    headline: props.headline,
    bio: props.bio,
    bookingPhone: props.phone,
    bookingEmail: props.email,
    linkLabels: slots.map((link) => link.label),
    linkDestinations: slots.map((link) => link.destination),
    linkStableIds: slots.map((link) => link.stableId),
  };
}

function errorId(field: string) { return `public-profile-error-${field.replaceAll(".", "-")}`; }

export function PublicProfileEditor(props: Props) {
  const [state, formAction, isPending] = useActionState(savePublicProfileDraftAction, initialPublicProfileDraftState);
  const [values, setValues] = useState(() => initialValues(props));
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error" && state.values) setValues(state.values);
  }, [state]);
  useEffect(() => { if (state.status === "error") errorSummary.current?.focus(); }, [state.status]);
  const error = (field: string) => state.fieldErrors[field];
  const fieldProps = (field: string) => error(field) ? { "aria-invalid": true, "aria-describedby": errorId(field) } : {};
  const update = (field: keyof PublicProfileDraftValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const updateLink = (field: "linkLabels" | "linkDestinations", index: number, value: string) => setValues((current) => ({ ...current, [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item) }));
  const slots = Array.from({ length: Math.max(4, Math.min(8, values.linkLabels.length || 4)) }, (_, index) => index);
  const formId = "public-profile-editor";
  const errorCount = Object.keys(state.fieldErrors).length;
  return <>
    {state.status === "error" && <div className="error" role="alert" tabIndex={-1} ref={errorSummary}>
      <b>{state.message}</b>{state.reasonCode && <span> Reference: {state.reasonCode}.</span>}{errorCount > 0 && <span> Review the {errorCount === 1 ? "highlighted field" : "highlighted fields"} below.</span>}
    </div>}
    <form action={formAction} className="inline-form public-profile-form" id={formId} noValidate>
      <label>Public URL slug<input name="slug" required maxLength={80} value={values.slug} onChange={(event) => update("slug", event.target.value)} autoComplete="off" {...fieldProps("slug")} /><small>Lowercase letters, numbers and single hyphens only.</small>{error("slug") && <span className="field-error" id={errorId("slug")}>{error("slug")}</span>}</label>
      <label>Display name <small>(optional)</small><input name="displayName" maxLength={120} value={values.displayName} onChange={(event) => update("displayName", event.target.value)} {...fieldProps("displayName")} />{error("displayName") && <span className="field-error" id={errorId("displayName")}>{error("displayName")}</span>}</label>
      <label className="wide">Headline<input name="headline" maxLength={280} value={values.headline} onChange={(event) => update("headline", event.target.value)} {...fieldProps("headline")} />{error("headline") && <span className="field-error" id={errorId("headline")}>{error("headline")}</span>}</label>
      <label className="wide">Bio<textarea name="bio" maxLength={2000} value={values.bio} onChange={(event) => update("bio", event.target.value)} {...fieldProps("bio")} />{error("bio") && <span className="field-error" id={errorId("bio")}>{error("bio")}</span>}</label>
      <div className="section-divider wide"><b>Booking contact</b><span>These values are stored only for the isolated booking flow. They are never included in the safe public-profile page or its public snapshot. Booking-contact publication remains disabled.</span></div>
      <label>Phone <small>(optional)</small><input name="bookingPhone" type="tel" inputMode="tel" maxLength={20} value={values.bookingPhone} onChange={(event) => update("bookingPhone", event.target.value)} placeholder="+61400000000" autoComplete="tel" {...fieldProps("bookingPhone")} />{error("bookingPhone") && <span className="field-error" id={errorId("bookingPhone")}>{error("bookingPhone")}</span>}</label>
      <label>Email <small>(optional)</small><input name="bookingEmail" type="email" maxLength={254} value={values.bookingEmail} onChange={(event) => update("bookingEmail", event.target.value)} placeholder="bookings@example.com" autoComplete="email" {...fieldProps("bookingEmail")} />{error("bookingEmail") && <span className="field-error" id={errorId("bookingEmail")}>{error("bookingEmail")}</span>}</label>
      <div className="section-divider wide"><b>Links</b><span>Add social or other public destinations. Blank rows are not shown, and only approved HTTPS links can be published.</span>{error("links") && <span className="field-error" id={errorId("links")}>{error("links")}</span>}</div>
      {slots.map((index) => <div className="public-link-fields" key={values.linkStableIds[index] || `new-${index}`}>
        <input type="hidden" name="linkStableId" value={values.linkStableIds[index] ?? ""} />
        <label>Label<input name="linkLabel" maxLength={80} value={values.linkLabels[index] ?? ""} onChange={(event) => updateLink("linkLabels", index, event.target.value)} placeholder="Official site" {...fieldProps(`linkLabel.${index}`)} />{error(`linkLabel.${index}`) && <span className="field-error" id={errorId(`linkLabel.${index}`)}>{error(`linkLabel.${index}`)}</span>}</label>
        <label>HTTPS destination<input name="linkDestination" type="url" value={values.linkDestinations[index] ?? ""} onChange={(event) => updateLink("linkDestinations", index, event.target.value)} placeholder="https://example.com" {...fieldProps(`linkDestination.${index}`)} />{error(`linkDestination.${index}`) && <span className="field-error" id={errorId(`linkDestination.${index}`)}>{error(`linkDestination.${index}`)}</span>}</label>
      </div>)}
      <div aria-invalid={Boolean(error("appearance")) || undefined} aria-describedby={error("appearance") ? errorId("appearance") : undefined}>
        <ProfileAppearanceEditor surface="sfw" initialAppearance={props.appearance} displayName={values.displayName} sampleLinks={values.linkLabels} versionId={props.draftVersionId} initialImages={props.images} imageUploadsEnabled={props.imageUploadsEnabled} />
      </div>
      {error("appearance") && <span className="field-error wide" id={errorId("appearance")}>{error("appearance")}</span>}
    </form>
    <div className="profile-action-bar wide" aria-label="Profile actions">
      <div><b>{props.versionForPublishId ? "Saved privately" : "Not saved yet"}</b><span>Save changes here, then publish when ready.</span></div>
      <div className="profile-action-buttons">
        <button className="secondary-action" type="submit" form={formId} disabled={isPending}>{isPending ? "Saving…" : "Save"}</button>
        {props.canApprove && props.versionForPublishId && <form action={publishPublicProfileAction}><input type="hidden" name="versionId" value={props.versionForPublishId} /><button className="primary" type="submit" disabled={!props.publishingConfigured || isPending}>Publish</button></form>}
      </div>
      {!props.publishingConfigured && props.canApprove && <small>Publishing will become available when the staging release service is configured.</small>}
      {!props.canApprove && <small>Save changes here. An agency administrator can publish them.</small>}
    </div>
  </>;
}
