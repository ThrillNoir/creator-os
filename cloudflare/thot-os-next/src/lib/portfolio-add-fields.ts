const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const LABEL_ID = /^[0-9a-f-]{36}$/i;

export function portfolioAddFields(form: FormData, assetId: string) {
  if (form.get("confirmAdd") !== "yes") throw new Error("Choose Add to private Portfolio to save this draft selection.");
  const choice = String(form.get("categoryChoice") ?? "").trim();
  const newCategoryName = String(form.get("newCategoryName") ?? "").trim().normalize("NFKC").replace(/\s+/g, " ");
  if (choice !== "__new__" && !LABEL_ID.test(choice)) throw new Error("Choose a category or create one.");
  if (choice === "__new__" && (!newCategoryName || newCategoryName.length > 50 || /[\u0000-\u001f\u007f<>]/.test(newCategoryName))) {
    throw new Error("Enter a new category name of at most 50 characters without angle brackets.");
  }
  const fullLengthAssetId = String(form.get("fullLengthAssetId") ?? "").trim() || null;
  if (fullLengthAssetId && (!ASSET_ID.test(fullLengthAssetId) || fullLengthAssetId === assetId)) {
    throw new Error("Choose a separate private full-length video or leave it empty.");
  }
  return { categoryId: choice === "__new__" ? null : choice, newCategoryName: choice === "__new__" ? newCategoryName : null, fullLengthAssetId };
}
