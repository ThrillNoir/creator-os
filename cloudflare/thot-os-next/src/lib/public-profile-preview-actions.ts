import { validateBookingConfig } from "../../../shared/booking-contract.ts";

export type ProfilePreviewAction = { kind: "booking" | "more"; label: string };
type AdultVersion = { id: string; creatorId: string; status: string };

export function previewAdultVersion(versions: AdultVersion[], creatorId: string) {
  return ["draft", "approved", "published"].map((status) => versions.find((version) => version.creatorId === creatorId && version.status === status)).find(Boolean) ?? null;
}

export function localPreviewAdultVersion(versions: AdultVersion[], creatorId: string) {
  return ["draft", "approved"].map((status) => versions.find((version) => version.creatorId === creatorId && version.status === status)).find(Boolean) ?? null;
}

export function profilePreviewActions({ bookingConfig, hasBookingPhone, hasBookingEmail, hasAdultProfile, displayName }: {
  bookingConfig: unknown;
  hasBookingPhone: boolean;
  hasBookingEmail: boolean;
  hasAdultProfile: boolean;
  displayName: string;
}): ProfilePreviewAction[] {
  const actions: ProfilePreviewAction[] = [];
  if (hasBookingPhone && hasBookingEmail) {
    try {
      const config = validateBookingConfig(typeof bookingConfig === "string" ? JSON.parse(bookingConfig) : bookingConfig);
      if (config.enabled) actions.push({ kind: "booking", label: `Preview only — ${config.label}` });
    } catch {
      // Malformed private settings must not create a preview affordance.
    }
  }
  if (hasAdultProfile) actions.push({ kind: "more", label: `Preview only — More from ${displayName || "this creator"}` });
  return actions;
}
