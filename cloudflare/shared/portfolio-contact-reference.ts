export type PortfolioContactReferences = {
  schemaVersion: 1;
  creatorSlug: string;
  publishedProfileVersionId: string;
  portfolioVersionId: string;
  names: Record<string, string>;
};

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const NAME = /^[^\u0000-\u001f\u007f<>]{1,200}$/;

export function portfolioContactReferenceKey(slug: string, versionId: string) {
  return `adult-portfolio-contact:${slug}:${versionId}`;
}

export function validPortfolioContactName(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && NAME.test(value);
}

export function portfolioContactName(value: unknown, slug: string, profileVersionId: string, portfolioVersionId: string, cardId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reference = value as Partial<PortfolioContactReferences>;
  if (Object.keys(reference).some((key) => !["schemaVersion", "creatorSlug", "publishedProfileVersionId", "portfolioVersionId", "names"].includes(key)) ||
    reference.schemaVersion !== 1 || reference.creatorSlug !== slug || reference.publishedProfileVersionId !== profileVersionId ||
    reference.portfolioVersionId !== portfolioVersionId || !ID.test(slug) || !ID.test(profileVersionId) || !ID.test(portfolioVersionId) ||
    !reference.names || typeof reference.names !== "object" || Array.isArray(reference.names) ||
    Object.keys(reference.names).some((id) => !ID.test(id) || !validPortfolioContactName(reference.names?.[id]))) return null;
  return Object.hasOwn(reference.names, cardId) ? reference.names[cardId] : null;
}
