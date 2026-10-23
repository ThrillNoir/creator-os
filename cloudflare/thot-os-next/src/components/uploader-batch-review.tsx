"use client";

import { useEffect, useRef } from "react";
import { saveAssetAttributesAction } from "@/app/actions";
import { AttributeFields } from "@/components/attribute-fields";
import { LibraryBatchForm, LibraryBatchSubmit } from "@/components/library-batch-form";

export function UploaderBatchReview({ items }: { items: { assetId: string; name: string }[] }) {
  const unique = [...new Map(items.map((item) => [item.assetId, item])).values()];
  if (!unique.length) return null;
  return <CompletedUploadsReview items={unique} />;
}

function CompletedUploadsReview({ items }: { items: { assetId: string; name: string }[] }) {
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (panel.current) panel.current.open = true; }, []);
  return <details ref={panel} className="uploader-batch-review">
    <summary>Next: name and tag {items.length} saved {items.length === 1 ? "file" : "files"}</summary>
    <p>Choose the saved files you want to update together. You can also do this later from Batch edit in the Library. Files still uploading are excluded.</p>
    <LibraryBatchForm action={saveAssetAttributesAction} initialSelectedCount={items.length} selectionVersion={items.map((item) => item.assetId).join("|")}>
      <input type="hidden" name="returnTo" value="/library" />
      <div className="uploader-batch-items">{items.map((item) => <label key={item.assetId}><input type="checkbox" name="assetId" value={item.assetId} defaultChecked /> {item.name}</label>)}</div>
      <p>Applying classification replaces the selected files&apos; current tags. Renaming below changes only their Library names.</p>
      <AttributeFields />
      <LibraryBatchSubmit />
      <div className="batch-rename"><h3>Batch rename</h3><p>For example, FILENAME_1.mp4 and FILENAME_2.jpg. Each original stays unchanged.</p><label>Base name<input type="text" name="namePrefix" maxLength={110} placeholder="FILENAME" /></label><label>Start at<input type="number" name="startAt" min="1" max="999999" defaultValue="1" /></label><button className="secondary-action" type="submit" name="intent" value="rename_batch">Rename selected uploads</button></div>
    </LibraryBatchForm>
  </details>;
}
