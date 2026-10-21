"use client";

import { saveAssetAttributesAction } from "@/app/actions";
import { AttributeFields } from "@/components/attribute-fields";
import { LibraryBatchForm, LibraryBatchSubmit } from "@/components/library-batch-form";

export function UploaderBatchReview({ items }: { items: { assetId: string; name: string }[] }) {
  const unique = [...new Map(items.map((item) => [item.assetId, item])).values()];
  if (!unique.length) return null;
  return <details className="uploader-batch-review">
    <summary>Batch edit {unique.length} completed upload{unique.length === 1 ? "" : "s"}</summary>
    <p>Choose saved files to classify or give numbered Library names. Uploads still in progress are excluded.</p>
    <LibraryBatchForm action={saveAssetAttributesAction}>
      <input type="hidden" name="returnTo" value="/library" />
      <div className="uploader-batch-items">{unique.map((item) => <label key={item.assetId}><input type="checkbox" name="assetId" value={item.assetId} defaultChecked /> {item.name}</label>)}</div>
      <AttributeFields />
      <LibraryBatchSubmit />
      <div className="batch-rename"><h3>Batch rename</h3><p>For example, FILENAME_1.mp4 and FILENAME_2.jpg. Each original stays unchanged.</p><label>Base name<input type="text" name="namePrefix" maxLength={110} placeholder="FILENAME" /></label><label>Start at<input type="number" name="startAt" min="1" max="999999" defaultValue="1" /></label><button className="secondary-action" type="submit" name="intent" value="rename_batch">Rename selected uploads</button></div>
    </LibraryBatchForm>
  </details>;
}
