const STATUS_COPY: Record<string, string> = {
  approved: "Waiting for the signed Fansly browser",
  claimed: "Transfer is in progress",
  staged: "Paired browser reported that Fansly accepted the transfer",
  verified: "Paired browser receipt reports a saved vault record",
  failed: "Needs review before retrying",
  cancelled: "Cancelled",
};

function parseReceipt(receipt: unknown): Record<string, unknown> | null {
  let value = receipt;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasUncertainReceipt(receipt: unknown): boolean {
  const record = parseReceipt(receipt);
  return record?.outcome === "uncertain" || record?.reconciliationRequired === true || record?.uploadStarted === true;
}

export function vaultJobStatusCopy(status: string, receipt?: unknown): string {
  if ((status === "claimed" || status === "failed") && hasUncertainReceipt(receipt)) {
    return "Upload outcome uncertain — check Fansly’s vault before retrying. This job is held for reconciliation.";
  }
  return STATUS_COPY[status] ?? status;
}

export function canRetryVaultJob(status: string, receipt: unknown): boolean {
  if (status !== "failed") return false;
  const record = parseReceipt(receipt);
  if (!record) return false;
  return record.outcome !== "uncertain" && record.reconciliationRequired !== true && record.uploadStarted !== true;
}

export function vaultJobNextAction(status: string, receipt: unknown, isCreator: boolean): string {
  if ((status === "claimed" || status === "failed") && hasUncertainReceipt(receipt)) {
    return "Ask an agency administrator to reconcile this upload against the native Fansly vault before any retry.";
  }
  if (status === "verified") {
    return "The saved vault receipt is recorded. Returning to Inspection mode after a one-shot upload is expected.";
  }
  if (status === "approved") {
    return "Open the assigned signed-in Fansly browser, check the extension popup, and complete the permitted manual upload.";
  }
  if (status === "claimed" || status === "staged") {
    return "Wait for the final receipt. Check the current job before attempting any further upload.";
  }
  if (status === "failed") {
    return isCreator ? "Ask an agency operator to review this failed upload before another attempt." : "Review the failure and native vault before using the available retry control.";
  }
  return "Review the current job and its receipt before taking another action.";
}
