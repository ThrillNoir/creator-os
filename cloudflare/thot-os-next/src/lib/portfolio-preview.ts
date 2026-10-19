export function privatePortfolioImageObjectId(previewKey: string | null) {
  return previewKey?.match(/\/assets\/([a-f0-9]{64})\/previews\/[a-f0-9]{64}\.jpg$/)?.[1] ?? null;
}
