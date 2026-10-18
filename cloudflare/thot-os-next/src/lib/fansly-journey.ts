export type FanslyJourneyInput = {
  accountLabel?: string | null;
  profileLabel?: string | null;
  profileStatus?: string | null;
  identityConfirmed?: boolean;
  credentialActive?: boolean;
  pairingVerified?: boolean;
  lastSeenAt?: string | null;
  role: "agency" | "creator" | "staff";
};

export type FanslyJourneyStep = {
  label: string;
  state: "done" | "waiting" | "blocked";
  detail: string;
};

export function fanslyJourney(input: FanslyJourneyInput): { steps: FanslyJourneyStep[]; nextAction: string } {
  const account = Boolean(input.accountLabel);
  const revoked = input.profileStatus === "revoked";
  const profile = Boolean(input.profileLabel) && !revoked;
  const identity = profile && Boolean(input.identityConfirmed);
  const paired = identity && Boolean(input.credentialActive && input.pairingVerified && input.profileStatus === "paired");
  const seen = paired && Boolean(input.lastSeenAt);
  const steps: FanslyJourneyStep[] = [
    { label: "Fansly account", state: account ? "done" : "waiting", detail: account ? input.accountLabel! : "No active Fansly account recorded" },
    { label: "Assigned Chrome profile", state: revoked ? "blocked" : profile ? "done" : "waiting", detail: revoked ? `${input.profileLabel || "Assigned profile"} was revoked` : profile ? input.profileLabel! : "No active profile assigned" },
    { label: "Signed-in identity", state: identity ? "done" : "waiting", detail: identity ? "Confirmed by an agency administrator" : "Visible Fansly handle still needs confirmation" },
    { label: "Bridge pairing", state: paired ? "done" : "waiting", detail: paired ? "Paired and verified" : input.credentialActive ? "Credential issued; pairing not verified" : "No active paired credential recorded" },
    { label: "Check-in record", state: seen ? "done" : "waiting", detail: seen ? "Last recorded check-in is shown below; current browser activity is not confirmed" : "No verified check-in recorded" },
  ];

  if (!account) return { steps, nextAction: input.role === "agency" ? "Add this creator’s Fansly account and assign the intended Chrome profile." : "Ask an agency administrator to add this creator’s Fansly account." };
  if (revoked || !profile) return { steps, nextAction: input.role === "agency" ? "Assign a valid Chrome profile, then confirm the visible Fansly identity." : "Ask an agency administrator to assign the correct Chrome profile." };
  if (!identity) return { steps, nextAction: input.role === "agency" ? "In the assigned Chrome profile, check the visible Fansly handle and confirm it below." : "Ask an agency administrator to confirm the signed-in Fansly identity." };
  if (!paired) return { steps, nextAction: input.role === "agency" ? input.credentialActive ? "Check the existing pairing tab and credential before trying again." : "Pair the assigned profile from this page; verify the popup installation ID first." : "Ask an agency administrator to complete and verify bridge pairing." };
  if (!seen) return { steps, nextAction: "Open the assigned Chrome profile and check the bridge popup. Pairing is recorded, but no check-in is recorded." };
  return { steps, nextAction: "Review the Fansly upload queue. Check the extension popup for its current mode before any upload." };
}
