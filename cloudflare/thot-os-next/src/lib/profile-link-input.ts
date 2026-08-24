export type ParsedProfileLink = {
  label: string;
  destinationUrl: string;
  destinationHost: string;
  stableId: string;
  sortOrder: number;
};

export function approvedHttpsDestination(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Every public link needs a complete HTTPS destination."); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("Every public link must be a credential-free HTTPS destination.");
  return { destinationUrl: url.toString(), destinationHost: url.hostname.toLowerCase() };
}

/**
 * Blank authoring rows are optional; only a partly completed row is invalid.
 * This pure parser is shared with the server action so tests exercise the same
 * save-time rule without needing to publish or contact an external service.
 */
export function parseProfileLinkRows({ labels, destinations, stableIds, maximum, adult = false }: {
  labels: string[];
  destinations: string[];
  stableIds: string[];
  maximum: number;
  adult?: boolean;
}): ParsedProfileLink[] {
  if (labels.length !== destinations.length || labels.length !== stableIds.length || labels.length > maximum) throw new Error(`A ${adult ? "adult" : "public"} profile can contain up to ${maximum} links.`);
  return labels.flatMap((rawLabel, index): ParsedProfileLink[] => {
    const label = rawLabel.replace(/\s+/g, " ").trim();
    const destination = destinations[index].trim();
    if (!label && !destination) return [];
    if (!label || !destination) throw new Error(adult ? "Every adult link needs a label of up to 80 characters and an HTTPS destination." : "Complete both a link label and HTTPS destination, or clear the row to omit it.");
    if (label.length > 80) throw new Error(adult ? "Every adult link needs a label of up to 80 characters and an HTTPS destination." : "Every public link label must be 80 characters or fewer.");
    return [{ label, ...approvedHttpsDestination(destination), stableId: stableIds[index].trim(), sortOrder: index }];
  });
}
