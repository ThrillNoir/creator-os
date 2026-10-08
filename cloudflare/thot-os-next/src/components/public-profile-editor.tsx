"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { publishPublicProfileAction, savePublicProfileDraftAction, type PublicProfileDraftState, type PublicProfileDraftValues } from "@/app/actions";
import { ProfileAppearanceEditor, type ProfileImageAttachment } from "@/components/profile-appearance-editor";
import type { ProfileAppearance } from "@/lib/profile-appearance-contract";
import { bookingFieldNames, effectiveBookingFields, type BookingConfig, type BookingField, type BookingOption } from "../../../shared/booking-contract.ts";
import { BOOKING_REPLY_ATTACHMENT_MAX_BYTES, BOOKING_REPLY_ATTACHMENT_MAX_COUNT, validateReplyAttachments, type BookingReplyAttachment } from "../../../shared/booking-reply-attachments.ts";
import { profilePreviewActions } from "@/lib/public-profile-preview-actions";

type LinkValue = { id: string; label: string; destination: string; stableId: string };

const defaultBookingReply = { enabled: false, subject: "Thanks for your enquiry", body: "Hello {first name},\n\nThank you for your enquiry. Your booking is not yet confirmed.", attachments: [] as BookingReplyAttachment[] };
const REPLY_ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

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
  adultPreviewAvailable: boolean;
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
  const [bookingConfig, setBookingConfig] = useState<BookingConfig>(props.bookingConfig);
  const [activeTab, setActiveTab] = useState<"creator" | "enquiry" | "email">("creator");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const attachmentUpload = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error" && state.values) setValues(state.values);
  }, [state]);
  useEffect(() => {
    if (state.status !== "error") return;
    if (state.reasonCode === "reply_attachment_unavailable") setActiveTab("email");
    else if (Object.keys(state.fieldErrors).some((field) => field === "bookingConfig" || field === "bookingPhone" || field === "bookingEmail")) setActiveTab("enquiry");
    else setActiveTab("creator");
    errorSummary.current?.focus();
  }, [state.status, state.fieldErrors, state.reasonCode]);
  useEffect(() => { if (!bookingConfig.enabled && activeTab === "email") setActiveTab("enquiry"); }, [activeTab, bookingConfig.enabled]);
  const error = (field: string) => state.fieldErrors[field];
  const fieldProps = (field: string) => error(field) ? { "aria-invalid": true, "aria-describedby": errorId(field) } : {};
  const update = (field: keyof PublicProfileDraftValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const updateLink = (field: "linkLabels" | "linkDestinations", index: number, value: string) => setValues((current) => ({ ...current, [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item) }));
  const updateBooking = (field: "enabled" | "label" | "rules", value: boolean | string) => setBookingConfig((current) => ({ ...current, [field]: value }));
  const updateBookingReply = (field: "enabled" | "subject" | "body", value: boolean | string) => setBookingConfig((current) => ({ ...current, reply: { ...(current.reply ?? defaultBookingReply), [field]: value } }));
  const uploadReplyAttachment = async (file: File) => {
    const attachments = bookingConfig.reply?.attachments ?? [];
    if (attachmentUpload.current) return;
    if (attachments.length >= BOOKING_REPLY_ATTACHMENT_MAX_COUNT) { setAttachmentError("Remove an attachment before adding another. You can attach up to 3 files."); return; }
    if (!REPLY_ATTACHMENT_ACCEPT.split(",").includes(file.type)) { setAttachmentError("Choose a PDF, JPEG, PNG, or WebP file."); return; }
    if (file.size > BOOKING_REPLY_ATTACHMENT_MAX_BYTES) { setAttachmentError("This file is larger than the 2 MiB limit."); return; }
    if (attachments.reduce((total, item) => total + item.byteSize, 0) + file.size > BOOKING_REPLY_ATTACHMENT_MAX_BYTES) { setAttachmentError("Attachments must be 2 MiB or less in total. Choose a smaller file."); return; }
    attachmentUpload.current = true;
    setAttachmentBusy(true);
    setAttachmentError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/booking-reply-attachment", { method: "POST", body: form });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string; attachment?: unknown } | null;
      if (!response.ok || !result?.ok || !result.attachment) throw new Error(result?.error ?? "upload_failed");
      let attachment: BookingReplyAttachment;
      try { attachment = validateReplyAttachments([result.attachment])[0]; }
      catch { throw new Error("upload_failed"); }
      let nextAttachments: BookingReplyAttachment[];
      try { nextAttachments = validateReplyAttachments([...attachments, attachment]); }
      catch { throw new Error("total_too_large"); }
      setBookingConfig((current) => ({ ...current, reply: { ...(current.reply ?? defaultBookingReply), attachments: nextAttachments } }));
    } catch (caught) {
      setAttachmentError(caught instanceof Error && caught.message === "total_too_large" ? "Attachments must be 2 MiB or less in total. Remove a file and try again." : "The attachment could not be uploaded. Check the file and try again.");
    } finally {
      attachmentUpload.current = false;
      setAttachmentBusy(false);
    }
  };
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
  const previewActions = profilePreviewActions({ bookingConfig, hasBookingPhone: Boolean(values.bookingPhone.trim()), hasBookingEmail: Boolean(values.bookingEmail.trim()), hasAdultProfile: props.adultPreviewAvailable, displayName: values.displayName });
  const tabs: Array<{ id: "creator" | "enquiry" | "email"; label: string }> = [{ id: "creator", label: "Creator link page" }, { id: "enquiry", label: "Enquiry" }, ...(bookingConfig.enabled ? [{ id: "email" as const, label: "Email" }] : [])];
  const bookingReply = { ...defaultBookingReply, ...bookingConfig.reply, attachments: bookingConfig.reply?.attachments ?? [] };
  const selectAdjacentTab = (index: number, direction: number) => {
    const nextIndex = (index + direction + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };
  return <>
    {state.status === "error" && <div className="error" role="alert" tabIndex={-1} ref={errorSummary}>
      <b>{state.message}</b>{state.reasonCode && <span> Reference: {state.reasonCode}.</span>}{errorCount > 0 && <span> Review the {errorCount === 1 ? "highlighted field" : "highlighted fields"} below.</span>}
    </div>}
    <form action={formAction} className="inline-form public-profile-form" id={formId} noValidate>
      <div className="profile-editor-tabs wide" role="tablist" aria-label="Public profile editor sections">
        {tabs.map((tab, index) => <button key={tab.id} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" id={`public-profile-${tab.id}-tab`} aria-controls={`public-profile-${tab.id}-panel`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? "selected" : ""} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); selectAdjacentTab(index, 1); }
          if (event.key === "ArrowLeft") { event.preventDefault(); selectAdjacentTab(index, -1); }
          if (event.key === "Home") { event.preventDefault(); setActiveTab(tabs[0].id); tabRefs.current[0]?.focus(); }
          if (event.key === "End") { event.preventDefault(); setActiveTab(tabs[tabs.length - 1].id); tabRefs.current[tabs.length - 1]?.focus(); }
        }}>{tab.label}</button>)}
      </div>
      <div className="public-profile-tab-panel" role="tabpanel" id="public-profile-creator-panel" aria-labelledby="public-profile-creator-tab" hidden={activeTab !== "creator"}>
      <label>Public URL slug
        {props.slugLocked && <input type="hidden" name="slug" value={values.slug} />}
        <input name={props.slugLocked ? undefined : "slug"} required maxLength={80} value={values.slug} onChange={(event) => update("slug", event.target.value)} autoComplete="off" disabled={props.slugLocked} {...fieldProps("slug")} />
        <small>{props.slugLocked ? "Published public URL slugs are stable. Unpublish the current profile before changing its URL." : "Lowercase letters, numbers and single hyphens only."}</small>{error("slug") && <span className="field-error" id={errorId("slug")}>{error("slug")}</span>}
      </label>
      <label>Display name <small>(optional)</small><input name="displayName" maxLength={120} value={values.displayName} onChange={(event) => update("displayName", event.target.value)} {...fieldProps("displayName")} />{error("displayName") && <span className="field-error" id={errorId("displayName")}>{error("displayName")}</span>}</label>
      <label className="wide">Headline<input name="headline" maxLength={280} value={values.headline} onChange={(event) => update("headline", event.target.value)} {...fieldProps("headline")} />{error("headline") && <span className="field-error" id={errorId("headline")}>{error("headline")}</span>}</label>
      <label className="wide">Bio<textarea name="bio" maxLength={2000} value={values.bio} onChange={(event) => update("bio", event.target.value)} {...fieldProps("bio")} />{error("bio") && <span className="field-error" id={errorId("bio")}>{error("bio")}</span>}</label>
      <div className="section-divider wide"><b>Links</b><span>Add social or other public destinations. Blank rows are not shown, and only approved HTTPS links can be published.</span>{error("links") && <span className="field-error" id={errorId("links")}>{error("links")}</span>}</div>
      {slots.map((index) => <div className="public-link-fields" key={values.linkStableIds[index] || `new-${index}`}>
        <input type="hidden" name="linkStableId" value={values.linkStableIds[index] ?? ""} />
        <label>Label<input name="linkLabel" maxLength={80} value={values.linkLabels[index] ?? ""} onChange={(event) => updateLink("linkLabels", index, event.target.value)} placeholder="Official site" {...fieldProps(`linkLabel.${index}`)} />{error(`linkLabel.${index}`) && <span className="field-error" id={errorId(`linkLabel.${index}`)}>{error(`linkLabel.${index}`)}</span>}</label>
        <label>HTTPS destination<input name="linkDestination" type="url" value={values.linkDestinations[index] ?? ""} onChange={(event) => updateLink("linkDestinations", index, event.target.value)} placeholder="https://example.com" {...fieldProps(`linkDestination.${index}`)} />{error(`linkDestination.${index}`) && <span className="field-error" id={errorId(`linkDestination.${index}`)}>{error(`linkDestination.${index}`)}</span>}</label>
      </div>)}
      <div aria-invalid={Boolean(error("appearance")) || undefined} aria-describedby={error("appearance") ? errorId("appearance") : undefined}>
        <ProfileAppearanceEditor surface="sfw" initialAppearance={props.appearance} displayName={values.displayName} sampleLinks={values.linkLabels} previewActions={previewActions} versionId={props.draftVersionId} initialImages={props.images} imageUploadsEnabled={props.imageUploadsEnabled} />
      </div>
      {error("appearance") && <span className="field-error wide" id={errorId("appearance")}>{error("appearance")}</span>}
      </div>
      <div className="public-profile-tab-panel" role="tabpanel" id="public-profile-enquiry-panel" aria-labelledby="public-profile-enquiry-tab" hidden={activeTab !== "enquiry"}>
      <div className="section-divider wide"><b>Booking enquiries</b><span>For non-sexual event staffing and entertainment. Approved options and rules appear on your enquiry form. Contact details are excluded from your public profile; the phone number is shared in messaging drafts after submission.</span></div>
      <input type="hidden" name="bookingConfig" value={JSON.stringify(bookingConfig)} />
      <label className="wide booking-checkbox"><input type="checkbox" checked={bookingConfig.enabled} onChange={(event) => updateBooking("enabled", event.target.checked)} /> Enable booking enquiries</label>
      <label>Enquiry label<input maxLength={80} value={bookingConfig.label} onChange={(event) => updateBooking("label", event.target.value)} {...fieldProps("bookingConfig")} /></label>
      <label className="wide">Rules and expectations<textarea maxLength={6000} value={bookingConfig.rules} onChange={(event) => updateBooking("rules", event.target.value)} {...fieldProps("bookingConfig")} />{error("bookingConfig") && <span className="field-error" id={errorId("bookingConfig")}>{error("bookingConfig")}</span>}</label>
      <div className="wide"><div className="section-heading"><div><b>Enquiry fields</b><p>Choose what people see and what they must complete.</p></div></div>{bookingFieldNames.map((field) => { const setting = effectiveBookingFields(bookingConfig)[field], label = ({ phone: "Phone", date: "Date", time: "Start time", endTime: "End time", timezone: "Timezone", address: "Street address", suburb: "Suburb", guests: "Guests", occasion: "Occasion", wear: "Uniform", extras: "Extras", specialRequests: "Special requests" } as Record<BookingField, string>)[field], fixed = field === "specialRequests" && bookingConfig.fields; return <div className="booking-field-row" key={field}><b>{label}</b><label className="booking-checkbox"><input type="checkbox" aria-label={`Show ${label}`} checked={setting.visible} disabled={Boolean(fixed)} onChange={(event) => updateBookingField(field, "visible", event.target.checked)} /> Show field</label><label className="booking-checkbox"><input type="checkbox" aria-label={`Require ${label}`} checked={setting.required} disabled={!setting.visible || Boolean(fixed)} onChange={(event) => updateBookingField(field, "required", event.target.checked)} /> Required</label></div>; })}</div>
      {(["wear", "extras"] as const).map((group) => <div className="wide" key={group}><div className="section-heading"><div><b>{group === "wear" ? "Uniform" : "Extras"}</b><p>Optional plain-text choices for the event enquiry.</p></div><button type="button" className="secondary-action" onClick={() => addOption(group)} disabled={bookingConfig[group].length >= 12}>Add option</button></div>{bookingConfig[group].map((option, index) => <div className="public-link-fields booking-option-row" key={option.id}><label>Label<input maxLength={80} value={option.label} onChange={(event) => updateOption(group, index, "label", event.target.value)} /></label><label>Description <small>(optional)</small><input maxLength={1000} value={option.description} onChange={(event) => updateOption(group, index, "description", event.target.value)} /></label><button type="button" className="secondary-action" onClick={() => removeOption(group, index)}>Remove</button></div>)}</div>)}
      <div className="section-divider wide"><b>Booking contact</b><span>Both fields are required when booking enquiries are enabled.</span></div>
      <label>Phone <small>(optional)</small><input name="bookingPhone" type="tel" inputMode="tel" maxLength={20} value={values.bookingPhone} onChange={(event) => update("bookingPhone", event.target.value)} placeholder="+61400000000" autoComplete="tel" {...fieldProps("bookingPhone")} />{error("bookingPhone") && <span className="field-error" id={errorId("bookingPhone")}>{error("bookingPhone")}</span>}</label>
      <label>Email <small>(optional)</small><input name="bookingEmail" type="email" maxLength={254} value={values.bookingEmail} onChange={(event) => update("bookingEmail", event.target.value)} placeholder="bookings@example.com" autoComplete="email" {...fieldProps("bookingEmail")} />{error("bookingEmail") && <span className="field-error" id={errorId("bookingEmail")}>{error("bookingEmail")}</span>}</label>
      </div>
      <div className="public-profile-tab-panel" role="tabpanel" id="public-profile-email-panel" aria-labelledby="public-profile-email-tab" hidden={activeTab !== "email"}>
        <div className="section-divider wide"><b>Sender: {values.displayName.trim() || "Creator"} via THOT OS</b><span>Reply-To: {values.bookingEmail.trim() || "Add a booking email in Enquiry"}</span><span>Save these changes, then publish the profile to activate this template.</span></div>
        <label className="wide booking-checkbox"><input type="checkbox" checked={bookingReply.enabled} onChange={(event) => updateBookingReply("enabled", event.target.checked)} /> Enable enquiry reply</label>
        <label className="wide">Subject<input maxLength={200} value={bookingReply.subject} onChange={(event) => updateBookingReply("subject", event.target.value)} /></label>
        <label className="wide">Email body<textarea maxLength={12000} value={bookingReply.body} onChange={(event) => updateBookingReply("body", event.target.value)} /><small>Plain text. Use {"{first name}"} to include the enquirer’s first name.</small></label>
        <div className="reply-attachments wide" aria-labelledby="reply-attachments-title">
          <div><b id="reply-attachments-title">Attachments</b><small>PDF, JPEG, PNG, or WebP · up to 3 files · 2 MiB total. Images are converted to WebP; PDFs are sent as uploaded. Save, then publish to activate them.</small></div>
          {bookingReply.attachments.length > 0 && <ul>{bookingReply.attachments.map((attachment) => <li key={attachment.id}><span><b>{attachment.filename}</b><small>{Math.ceil(attachment.byteSize / 1024)} KiB</small></span><button type="button" className="secondary-action" disabled={attachmentBusy} onClick={() => setBookingConfig((current) => ({ ...current, reply: { ...(current.reply ?? defaultBookingReply), attachments: (current.reply?.attachments ?? []).filter((item) => item.id !== attachment.id) } }))}>Remove</button></li>)}</ul>}
          <label htmlFor="booking-reply-attachment">Choose attachment</label>
          <input id="booking-reply-attachment" type="file" accept={REPLY_ATTACHMENT_ACCEPT} disabled={attachmentBusy || bookingReply.attachments.length >= BOOKING_REPLY_ATTACHMENT_MAX_COUNT} aria-describedby={attachmentError ? "booking-reply-attachment-error" : undefined} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void uploadReplyAttachment(file); input.value = ""; }} />
          {attachmentBusy && <span role="status" aria-live="polite">Uploading and processing attachment…</span>}
          {attachmentError && <span className="field-error" id="booking-reply-attachment-error" role="alert">{attachmentError}</span>}
        </div>
      </div>
    </form>
    <div className="profile-action-bar wide" aria-label="Profile actions">
      <div><b>{props.versionForPublishId ? "Saved privately" : "Not saved yet"}</b><span>Save changes here, then publish when ready.</span></div>
      <div className="profile-action-buttons">
        <button className="secondary-action" type="submit" form={formId} disabled={isPending || attachmentBusy}>{isPending ? "Saving…" : "Save"}</button>
        {props.canPublish && props.versionForPublishId && <form action={publishPublicProfileAction}><input type="hidden" name="versionId" value={props.versionForPublishId} /><button className="primary" type="submit" disabled={!props.publishingConfigured || isPending || attachmentBusy}>Publish</button></form>}
      </div>
      {!props.publishingConfigured && props.canPublish && <small>Publishing will become available when the staging release service is configured.</small>}
    </div>
  </>;
}
