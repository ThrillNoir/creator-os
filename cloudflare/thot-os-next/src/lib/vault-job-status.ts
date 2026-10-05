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
