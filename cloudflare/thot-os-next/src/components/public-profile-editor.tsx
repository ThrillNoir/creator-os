"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { publishPublicProfileAction, savePublicProfileDraftAction, type PublicProfileDraftState, type PublicProfileDraftValues } from "@/app/actions";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import type { ProfileAppearance } from "@/lib/profile-appearance-contract";
import { bookingFieldNames, effectiveBookingFields, type BookingConfig, type BookingField, type BookingOption } from "../../../shared/booking-contract.ts";

type LinkValue = { id: string; label: string; destination: string; stableId: string };

const initialPublicProfileDraftState: PublicProfileDraftState = {
  status: "idle",
  message: null,
  reasonCode: null,
  fieldErrors: {},
  values: null,
};

type Props = {
  defaultSlug: string;
  displayName: string;
  headline: string;
  bio: string;
  phone: string;
  email: string;
  bookingConfig: BookingConfig;
  links: LinkValue[];
  appearance: ProfileAppearance;
  images: ProfileImageAttachment[];
  draftVersionId?: string;
  versionForPublishId?: string;
  canPublish: boolean;
  publishingConfigured: boolean;
  imageUploadsEnabled: boolean;
  slugLocked: boolean;
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
    bookingConfig: JSON.stringify(props.bookingConfig),
    linkLabels: slots.map((link) => link.label),
    linkDestinations: slots.map((link) => link.destination),
    linkStableIds: slots.map((link) => link.stableId),
  };
}

function errorId(field: string) { return `public-profile-error-${field.replaceAll(".", "-")}`; }

export function PublicProfileEditor(props: Props) {
  const [state, formAction, isPending] = useActionState(savePublicProfileDraftAction, initialPublicProfileDraftState);
  const [values, setValues] = useState(() => initialValues(props));
  const [bookingConfig, setBookingConfig] = useState(props.bookingConfig);
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error" && state.values) setValues(state.values);
  }, [state]);
  useEffect(() => { if (state.status === "error") errorSummary.current?.focus(); }, [state.status]);
  const error = (field: string) => state.fieldErrors[field];
  const fieldProps = (field: string) => error(field) ? { "aria-invalid": true, "aria-describedby": errorId(field) } : {};
  const update = (field: keyof PublicProfileDraftValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const updateLink = (field: "linkLabels" | "linkDestinations", index: number, value: string) => setValues((current) => ({ ...current, [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item) }));
  const updateBooking = (field: "enabled" | "label" | "rules", value: boolean | string) => setBookingConfig((current) => ({ ...current, [field]: value }));
  const updateBookingField = (field: BookingField, key: "visible" | "required", value: boolean) => setBookingConfig((current) => {
    const fields = effectiveBookingFields(current), setting = { ...fields[field], [key]: value };
    if (key === "visible" && !value) setting.required = false;
    return { ...current, fields: { ...fields, [field]: setting, specialRequests: { visible: true, required: true } } };
  });
  const updateOption = (group: "wear" | "extras", index: number, field: keyof BookingOption, value: string) => setBookingConfig((current) => ({ ...current, [group]: current[group].map((option, optionIndex) => optionIndex === index ? { ...option, [field]: value } : option) }));
  const addOption = (group: "wear" | "extras") => setBookingConfig((current) => current[group].length >= 12 ? current : { ...current, [group]: [...current[group], { id: crypto.randomUUID(), label: "", description: "" }] });
  const removeOption = (group: "wear" | "extras", index: number) => setBookingConfig((current) => ({ ...current, [group]: current[group].filter((_, optionIndex) => optionIndex !== index) }));
  const slots = Array.from({ length: Math.max(4, Math.min(8, values.linkLabels.length || 4)) }, (_, index) => index);
  const formId = "public-profile-editor";
  const errorCount = Object.keys(state.fieldErrors).length;
  return <>
    {state.status === "error" && <div className="error" role="alert" tabIndex={-1} ref={errorSummary}>
      <b>{state.message}</b>{state.reasonCode && <span> Reference: {state.reasonCode}.</span>}{errorCount > 0 && <span> Review the {errorCount === 1 ? "highlighted field" : "highlighted fields"} below.</span>}
    </div>}
    <form action={formAction} className="inline-form public-profile-form" id={formId} noValidate>
      <label>Public URL slug
        {props.slugLocked && <input type="hidden" name="slug" value={values.slug} />}
        <input name={props.slugLocked ? undefined : "slug"} required maxLength={80} value={values.slug} onChange={(event) => update("slug", event.target.value)} autoComplete="off" disabled={props.slugLocked} {...fieldProps("slug")} />
        <small>{props.slugLocked ? "Published public URL slugs are stable. Unpublish the current profile before changing its URL." : "Lowercase letters, numbers and single hyphens only."}</small>{error("slug") && <span className="field-error" id={errorId("slug")}>{error("slug")}</span>}
      </label>
      <label>Display name <small>(optional)</small><input name="displayName" maxLength={120} value={values.displayName} onChange={(event) => update("displayName", event.target.value)} {...fieldProps("displayName")} />{error("displayName") && <span className="field-error" id={errorId("displayName")}>{error("displayName")}</span>}</label>
      <label className="wide">Headline<input name="headline" maxLength={280} value={values.headline} onChange={(event) => update("headline", event.target.value)} {...fieldProps("headline")} />{error("headline") && <span className="field-error" id={errorId("headline")}>{error("headline")}</span>}</label>
      <label className="wide">Bio<textarea name="bio" maxLength={2000} value={values.bio} onChange={(event) => update("bio", event.target.value)} {...fieldProps("bio")} />{error("bio") && <span className="field-error" id={errorId("bio")}>{error("bio")}</span>}</label>
      <div className="section-divider wide"><b>Booking enquiries</b><span>For non-sexual event staffing and entertainment. Approved options and rules appear on your enquiry form. Contact details are excluded from your public profile; the phone number is shared in messaging drafts after submission.</span></div>
      <input type="hidden" name="bookingConfig" value={JSON.stringify(bookingConfig)} />
      <label className="wide booking-checkbox"><input type="checkbox" checked={bookingConfig.enabled} onChange={(event) => updateBooking("enabled", event.target.checked)} /> Enable booking enquiries</label>
      <label>Enquiry label<input maxLength={80} value={bookingConfig.label} onChange={(event) => updateBooking("label", event.target.value)} {...fieldProps("bookingConfig")} /></label>
      <label className="wide">Rules and expectations<textarea maxLength={6000} value={bookingConfig.rules} onChange={(event) => updateBooking("rules", event.target.value)} {...fieldProps("bookingConfig")} />{error("bookingConfig") && <span className="field-error" id={errorId("bookingConfig")}>{error("bookingConfig")}</span>}</label>
      <div className="wide"><div className="section-heading"><div><b>Enquiry fields</b><p>Choose what people see and what they must complete.</p></div></div>{bookingFieldNames.map((field) => { const setting = effectiveBookingFields(bookingConfig)[field], label = ({ phone: "Phone", date: "Date", time: "Time", timezone: "Timezone", address: "Street address", suburb: "Suburb", guests: "Guests", occasion: "Occasion", wear: "What to wear", extras: "Extra spice", specialRequests: "Special requests" } as Record<BookingField, string>)[field], fixed = field === "specialRequests" && bookingConfig.fields; return <div className="booking-field-row" key={field}><b>{label}</b><label className="booking-checkbox"><input type="checkbox" aria-label={`Show ${label}`} checked={setting.visible} disabled={Boolean(fixed)} onChange={(event) => updateBookingField(field, "visible", event.target.checked)} /> Show field</label><label className="booking-checkbox"><input type="checkbox" aria-label={`Require ${label}`} checked={setting.required} disabled={!setting.visible || Boolean(fixed)} onChange={(event) => updateBookingField(field, "required", event.target.checked)} /> Required</label></div>; })}</div>
      {(["wear", "extras"] as const).map((group) => <div className="wide" key={group}><div className="section-heading"><div><b>{group === "wear" ? "What to wear" : "Extra spice"}</b><p>Optional plain-text choices for the event enquiry.</p></div><button type="button" className="secondary-action" onClick={() => addOption(group)} disabled={bookingConfig[group].length >= 12}>Add option</button></div>{bookingConfig[group].map((option, index) => <div className="public-link-fields booking-option-row" key={option.id}><label>Label<input maxLength={80} value={option.label} onChange={(event) => updateOption(group, index, "label", event.target.value)} /></label><label>Description <small>(optional)</small><input maxLength={1000} value={option.description} onChange={(event) => updateOption(group, index, "description", event.target.value)} /></label><button type="button" className="secondary-action" onClick={() => removeOption(group, index)}>Remove</button></div>)}</div>)}
      <div className="section-divider wide"><b>Booking contact</b><span>Both fields are required when booking enquiries are enabled.</span></div>
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
        {props.canPublish && props.versionForPublishId && <form action={publishPublicProfileAction}><input type="hidden" name="versionId" value={props.versionForPublishId} /><button className="primary" type="submit" disabled={!props.publishingConfigured || isPending}>Publish</button></form>}
      </div>
      {!props.publishingConfigured && props.canPublish && <small>Publishing will become available when the staging release service is configured.</small>}
    </div>
  </>;
}
