type FanslyDelivery = { status: string; receipt: string; stale_claim: number };

export function fanslyDeliveryWarning(send: FanslyDelivery): string | null {
  let uncertain = send.status === "claimed" && Boolean(send.stale_claim);
  if (send.status === "failed") {
    try {
      const receipt = JSON.parse(send.receipt);
      uncertain = receipt?.outcome === "uncertain" || receipt?.reconciliationRequired === true;
    } catch { /* Older receipts may not contain valid JSON. Keep their recorded error. */ }
  }
  return uncertain ? "Delivery uncertain—verify the Fansly conversation before retry. THOT OS will not resend this automatically." : null;
}
