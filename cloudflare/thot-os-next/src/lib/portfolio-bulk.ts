const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function portfolioBulkAssetIds(values: FormDataEntryValue[]) {
  if (!values.length || values.length > 50 || values.some((value) => typeof value !== "string" || !ASSET_ID.test(value))) {
    throw new Error("Select between 1 and 50 portfolio items.");
  }
  const ids = values as string[];
  if (new Set(ids).size !== ids.length) throw new Error("Select each portfolio item once.");
  return ids;
}
