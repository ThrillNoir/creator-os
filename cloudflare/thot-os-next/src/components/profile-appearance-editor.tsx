"use client";

import { useMemo, useState } from "react";
import {
  PROFILE_BUTTON_STYLES,
  PROFILE_RADIUS_SCALES,
  PROFILE_THEMES,
  appearanceCss,
  appearanceForTheme,
  type ProfileAppearance,
  type ProfileButtonStyle,
  type ProfileRadiusScale,
  type ProfileThemeKey,
} from "@/lib/profile-appearance-contract";
import type { ProfilePreviewAction } from "@/lib/public-profile-preview-actions";

type Surface = "sfw" | "adult";
type ImageRole = "avatar" | "background";
type ImageOperation = { role: ImageRole; action: "uploading" | "removing" } | null;

type Props = {
  initialAppearance: ProfileAppearance;
  inheritedAppearance?: ProfileAppearance | null;
  surface: Surface;
  displayName: string;
  sampleLinks: string[];
  previewActions?: ProfilePreviewAction[];
  versionId?: string;
  initialImages?: ProfileImageAttachment[];
  imageUploadsEnabled?: boolean;
};
export type ProfileImageAttachment = { id: string; role: "avatar" | "background"; previewUrl: string };

const PROFILE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const PROFILE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

function imageRoleLabel(role: ImageRole) {
  return role === "avatar" ? "Profile image" : "Background image";
}

function imageErrorMessage(reason: string | undefined) {
  const messages: Record<string, string> = {
    animated_not_supported: "Animated images are not supported. Choose a still image instead.",
    draft_required: "Save this profile as a draft before changing its images.",
    file_too_large: "This image is larger than the 12 MB limit.",
    image_processing_failed: "This image could not be processed. Try another image.",
    image_too_large: "This image is too large. Choose a smaller image.",
    invalid_upload_request: "This image upload could not be accepted. Try again.",
    profile_image_processing_unavailable: "Image uploads are unavailable in this environment.",
    same_origin_required: "Image uploads must be started from this profile editor.",
    unsupported_image_type: "Choose a JPEG, PNG, WebP, or AVIF image.",
  };
  return messages[reason ?? ""] ?? "Image upload failed. Try again.";
}

const buttonLabels: Record<ProfileButtonStyle, string> = {
  "solid-rounded": "Solid rounded",
  "full-pill": "Full pill",
  "minimal-outline": "Minimal outline",
  "soft-card-icon": "Soft card + icon",
  "elevated-shadow-tile": "Elevated tile",
};

const radiusLabels: Record<ProfileRadiusScale, string> = { compact: "Compact", comfortable: "Comfortable", round: "Round" };

function buttonClass(style: ProfileButtonStyle) {
  if (style === "full-pill") return "profile-preview-button profile-preview-pill";
  if (style === "minimal-outline") return "profile-preview-button profile-preview-outline";
  if (style === "soft-card-icon") return "profile-preview-button profile-preview-soft";
  if (style === "elevated-shadow-tile") return "profile-preview-button profile-preview-elevated";
  return "profile-preview-button";
}

export function ProfileAppearanceEditor({ initialAppearance, inheritedAppearance, surface, displayName, sampleLinks, previewActions = [], versionId, initialImages = [], imageUploadsEnabled = true }: Props) {
  const [appearance, setAppearance] = useState(initialAppearance);
  const [inheritSfwTheme, setInheritSfwTheme] = useState(initialAppearance.inheritSfwTheme);
  const [activePanel, setActivePanel] = useState<"design" | "images" | "preview">("design");
  const [images, setImages] = useState(initialImages);
  const [imageOperation, setImageOperation] = useState<ImageOperation>(null);
  const [draggingRole, setDraggingRole] = useState<ImageRole | null>(null);
  const [imageError, setImageError] = useState("");
  const effectiveAppearance = inheritSfwTheme && inheritedAppearance ? { ...inheritedAppearance, inheritSfwTheme: true } : appearance;
  const css = useMemo(() => appearanceCss(effectiveAppearance), [effectiveAppearance]);
  const update = <K extends keyof ProfileAppearance>(key: K, value: ProfileAppearance[K]) => setAppearance((current) => ({ ...current, [key]: value }));
  const selectTheme = (themeKey: ProfileThemeKey) => setAppearance({ ...appearanceForTheme(themeKey), inheritSfwTheme: false });

  const uploadImage = async (role: ImageRole, file: File) => {
    if (!versionId || !imageUploadsEnabled || imageOperation) return;
    if (file.type && !PROFILE_IMAGE_ACCEPT.split(",").includes(file.type)) {
      setImageError("Choose a JPEG, PNG, WebP, or AVIF image.");
      return;
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      setImageError("This image is larger than the 12 MB limit.");
      return;
    }

    setImageError("");
    setImageOperation({ role, action: "uploading" });
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("surface", surface === "sfw" ? "public_sfw" : "adult_profile");
      form.set("role", role);
      form.set("versionId", versionId);
      const response = await fetch("/api/profile-image", { method: "POST", body: form });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string; attachment?: ProfileImageAttachment } | null;
      if (!response.ok || !result?.ok || !result.attachment) throw new Error(result?.error ?? "image_processing_failed");
      setImages((current) => [...current.filter((item) => item.role !== role), result.attachment!]);
    } catch (error) {
      setImageError(imageErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setImageOperation(null);
    }
  };

  const removeImage = async (image: ProfileImageAttachment) => {
    if (imageOperation) return;
    setImageError("");
    setImageOperation({ role: image.role, action: "removing" });
    try {
      const response = await fetch(`/api/profile-image/${image.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("image_remove_failed");
      setImages((current) => current.filter((item) => item.id !== image.id));
    } catch {
      setImageError("Image could not be removed from this draft. Try again.");
    } finally {
      setImageOperation(null);
    }
  };

  return <section className="profile-design-editor wide" aria-labelledby={`${surface}-design-title`}>
    <div className="section-divider"><b id={`${surface}-design-title`}>Profile design</b><span>Choose from fixed, readable design tokens. Custom CSS, embeds, tracking parameters, and external image URLs are not accepted.</span></div>
    <input type="hidden" name="appearanceInheritSfwTheme" value={inheritSfwTheme ? "yes" : "no"} />
    <input type="hidden" name="appearanceThemeKey" value={effectiveAppearance.themeKey} />
    <input type="hidden" name="appearanceButtonStyle" value={effectiveAppearance.buttonStyle} />
    <input type="hidden" name="appearanceBackgroundMode" value={effectiveAppearance.backgroundMode} />
    <input type="hidden" name="appearanceBackgroundColor" value={effectiveAppearance.backgroundColor} />
    <input type="hidden" name="appearancePrimaryColor" value={effectiveAppearance.primaryColor} />
    <input type="hidden" name="appearanceTextColor" value={effectiveAppearance.textColor} />
    <input type="hidden" name="appearanceCardColor" value={effectiveAppearance.cardColor} />
    <input type="hidden" name="appearanceRadiusScale" value={effectiveAppearance.radiusScale} />
    <div className="profile-editor-tabs" role="tablist" aria-label="Profile editor sections">
      {(["design", "images", "preview"] as const).map((panel) => <button type="button" key={panel} className={activePanel === panel ? "selected" : ""} role="tab" aria-selected={activePanel === panel} onClick={() => setActivePanel(panel)}>{panel === "design" ? "Design" : panel === "images" ? "Images" : "Preview"}</button>)}
    </div>
    {activePanel === "design" && <div className="profile-editor-grid">
      <div className="profile-design-controls">
        {surface === "adult" && <label className="profile-inherit-toggle"><input type="checkbox" checked={inheritSfwTheme} onChange={(event) => setInheritSfwTheme(event.target.checked)} disabled={!inheritedAppearance} /> Use the safe-profile design <small>{inheritedAppearance ? "Adult wording, links, and media remain independent." : "Save a safe-profile draft first to make its design available."}</small></label>}
        <fieldset disabled={inheritSfwTheme}><legend>Theme</legend><div className="profile-theme-grid">{PROFILE_THEMES.map((theme) => <button type="button" key={theme.themeKey} className={appearance.themeKey === theme.themeKey ? "profile-theme selected" : "profile-theme"} onClick={() => selectTheme(theme.themeKey)}><span style={{ background: `linear-gradient(135deg, ${theme.backgroundColor}, ${theme.primaryColor})` }} /><b>{theme.name}</b></button>)}</div></fieldset>
        <fieldset disabled={inheritSfwTheme}><legend>Button layout</legend><div className="profile-choice-grid">{PROFILE_BUTTON_STYLES.map((style) => <label key={style} className={appearance.buttonStyle === style ? "selected" : ""}><input type="radio" value={style} checked={appearance.buttonStyle === style} onChange={() => update("buttonStyle", style)} />{buttonLabels[style]}</label>)}</div></fieldset>
        <fieldset disabled={inheritSfwTheme}><legend>Background and shape</legend><div className="profile-choice-grid"><label className={appearance.backgroundMode === "solid" ? "selected" : ""}><input type="radio" value="solid" checked={appearance.backgroundMode === "solid"} onChange={() => update("backgroundMode", "solid")} />Solid</label><label className={appearance.backgroundMode === "gradient" ? "selected" : ""}><input type="radio" value="gradient" checked={appearance.backgroundMode === "gradient"} onChange={() => update("backgroundMode", "gradient")} />Gradient</label>{PROFILE_RADIUS_SCALES.map((radius) => <label key={radius} className={appearance.radiusScale === radius ? "selected" : ""}><input type="radio" value={radius} checked={appearance.radiusScale === radius} onChange={() => update("radiusScale", radius)} />{radiusLabels[radius]}</label>)}</div></fieldset>
        <fieldset disabled={inheritSfwTheme}><legend>Colours</legend><div className="profile-colour-grid">{(["backgroundColor", "primaryColor", "textColor", "cardColor"] as const).map((key) => <label key={key}>{key === "backgroundColor" ? "Background" : key === "primaryColor" ? "Accent" : key === "textColor" ? "Text" : "Card"}<input type="color" value={appearance[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div></fieldset>
      </div>
      <PhonePreview appearance={effectiveAppearance} css={css} displayName={displayName} sampleLinks={sampleLinks} previewActions={previewActions} surface={surface} images={images} />
    </div>}
    {activePanel === "images" && <div className="profile-image-adapter">
      <b>Private images</b>
      <p>{imageUploadsEnabled ? "Images are decoded, stripped, and re-encoded before a private derivative is attached to this draft. Saving the draft does not publish an image." : "Image uploads are unavailable in this environment until a Workers-compatible private image processor is approved."}</p>
      {(["avatar", "background"] as const).map((role) => {
        const image = images.find((item) => item.role === role);
        const inputId = `${surface}-${role}-image`;
        const isBusy = imageOperation?.role === role;
        const isDisabled = !imageUploadsEnabled || !versionId || imageOperation !== null;
        const helperText = !imageUploadsEnabled
            ? "Unavailable in this environment"
            : !versionId
              ? "Save a draft before changing its images."
              : image
                ? "Ready for private preview"
                : "JPEG, PNG, WebP, or AVIF · 12 MB max";
        return <div className={`profile-upload-card${draggingRole === role ? " is-dragging" : ""}`} key={role} onDragOver={(event) => { if (!isDisabled) { event.preventDefault(); setDraggingRole(role); } }} onDragLeave={() => setDraggingRole((current) => current === role ? null : current)} onDrop={(event) => { event.preventDefault(); setDraggingRole(null); if (isDisabled) return; const file = event.dataTransfer.files.item(0); if (file) void uploadImage(role, file); }}>
          <div className="profile-upload-copy">
            <b>{imageRoleLabel(role)}</b>
            <small>{isBusy ? imageOperation?.action === "uploading" ? "Uploading and processing…" : "Removing image…" : helperText}</small>
          </div>
          {image && <img src={image.previewUrl} alt="" />}
          {image && <button type="button" className="profile-image-remove" onClick={() => void removeImage(image)} disabled={isDisabled}>Remove</button>}
          <input id={inputId} className="profile-image-input" type="file" accept={PROFILE_IMAGE_ACCEPT} disabled={isDisabled} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void uploadImage(role, file); input.value = ""; }} />
          <button type="button" className="profile-image-select" disabled={isDisabled} onClick={() => document.getElementById(inputId)?.click()}>{image ? "Replace image" : "Choose image"}</button>
          <small className="profile-image-drop-hint">or drag an image here</small>
        </div>;
      })}
      {imageOperation && <span role="status" aria-live="polite">{imageOperation.action === "uploading" ? `Uploading and processing the ${imageRoleLabel(imageOperation.role).toLowerCase()}…` : `Removing the ${imageRoleLabel(imageOperation.role).toLowerCase()}…`}</span>}
      {imageError && <span role="alert">{imageError}</span>}
      <span>Original files, metadata, and storage keys are never included in public snapshots or returned to the browser.</span>
    </div>}
    {activePanel === "preview" && <div className="profile-preview-panel"><PhonePreview appearance={effectiveAppearance} css={css} displayName={displayName} sampleLinks={sampleLinks} previewActions={previewActions} surface={surface} images={images} /></div>}
  </section>;
}

function PhonePreview({ appearance, css, displayName, sampleLinks, previewActions, surface, images }: { appearance: ProfileAppearance; css: Record<string, string>; displayName: string; sampleLinks: string[]; previewActions: ProfilePreviewAction[]; surface: Surface; images: ProfileImageAttachment[] }) {
  const labels = sampleLinks.filter(Boolean).slice(0, 4);
  const avatar = images.find((image) => image.role === "avatar");
  const background = images.find((image) => image.role === "background");
  return <div className="profile-phone" style={{ ...css, ...(background ? { backgroundImage: `linear-gradient(#0002,#0002),url(${background.previewUrl})` } : {}) } as React.CSSProperties}><div className="profile-phone-notch" /><div className="profile-phone-content"><span className="profile-preview-eyebrow">{surface === "adult" ? "18+ PRIVATE PREVIEW" : "SAFE PROFILE PREVIEW"}</span><div className="profile-preview-avatar">{avatar ? <img src={avatar.previewUrl} alt="" /> : displayName.slice(0, 1).toUpperCase() || "T"}</div><h3>{displayName || "Creator"}</h3><p>Saved drafts stay private until published.</p>{labels.length ? <div>{labels.map((label, index) => <div className={buttonClass(appearance.buttonStyle)} key={`${label}-${index}`}><span>{label}</span><i aria-hidden="true">↗</i></div>)}</div> : <div className={buttonClass(appearance.buttonStyle)}><span>Creator link</span><i aria-hidden="true">↗</i></div>}{previewActions.map((action) => <span className={`${buttonClass(appearance.buttonStyle)} profile-preview-action-disabled`} aria-disabled="true" key={action.kind}>{action.label}</span>)}</div></div>;
}
