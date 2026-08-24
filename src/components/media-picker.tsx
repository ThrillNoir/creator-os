"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Check, Film, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isPhotoAsset, mediaUrl, type MediaAsset } from "@/components/media-workflow";

type SelectionAsset = Pick<MediaAsset, "id" | "basename" | "relative_path" | "extension" | "classification_safety" | "is_teaser" | "is_multi" | "repeated_basename">;
type StoredSelection = Record<string, SelectionAsset>;

function selectionStorageKey(creatorId: string) {
  return `thot-os:content-selection:${creatorId}`;
}

export function MediaPicker({ assets, creatorId }: { assets: SelectionAsset[]; creatorId: string }) {
  const [selection, setSelection] = useState<StoredSelection>({});
  const [hasRestoredSelection, setHasRestoredSelection] = useState(false);
  const currentAssetIds = useMemo(() => new Set(assets.map((asset) => asset.id)), [assets]);
  const priorityAssetId = useMemo(() => assets.find((asset) => isPhotoAsset(asset))?.id, [assets]);
  const aboveFoldPhotoIds = useMemo(() => new Set(assets.filter((asset) => isPhotoAsset(asset)).slice(0, 5).map((asset) => asset.id)), [assets]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.sessionStorage.getItem(selectionStorageKey(creatorId));
        if (stored) {
          const parsed = JSON.parse(stored) as StoredSelection;
          if (parsed && typeof parsed === "object") setSelection(parsed);
        }
      } catch {
        // A blocked storage area should never stop a native draft form from working.
      } finally {
        setHasRestoredSelection(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [creatorId]);

  useEffect(() => {
    if (!hasRestoredSelection) return;
    try {
      window.sessionStorage.setItem(selectionStorageKey(creatorId), JSON.stringify(selection));
    } catch {
      // The current-page checkbox values remain submit-ready when session storage is unavailable.
    }
  }, [creatorId, hasRestoredSelection, selection]);

  const selectedAssets = Object.values(selection);
  const selectionCount = selectedAssets.length;

  function setSelected(asset: SelectionAsset, checked: boolean) {
    setSelection((current) => {
      const next = { ...current };
      if (checked) next[asset.id] = asset;
      else delete next[asset.id];
      return next;
    });
  }

  return (
    <div className="media-picker-shell">
      <div className="media-picker-grid">
        {assets.map((asset) => {
          const checked = Boolean(selection[asset.id]);
          const photo = isPhotoAsset(asset);
          return (
            <label className="media-pick-card" key={asset.id}>
              <input
                checked={checked}
                className="peer sr-only"
                name="assetIds"
                onChange={(event) => setSelected(asset, event.target.checked)}
                type="checkbox"
                value={asset.id}
              />
              <span className="media-pick-card-surface">
                <span className="media-pick-image">
                  {photo ? <Image alt="" fill loading={asset.id === priorityAssetId ? undefined : aboveFoldPhotoIds.has(asset.id) ? "eager" : undefined} priority={asset.id === priorityAssetId} sizes="(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 220px" src={mediaUrl(asset.relative_path)} unoptimized /> : <video aria-hidden="true" muted preload="metadata" src={mediaUrl(asset.relative_path)} />}
                  {!photo ? <span className="media-kind-pill"><Film aria-hidden="true" />Video</span> : null}
                  <span className="media-selected-mark"><Check aria-hidden="true" /><span className="sr-only">Selected</span></span>
                </span>
                <span className="media-pick-copy">
                  <strong title={asset.basename}>{asset.basename}</strong>
                  <span>{asset.classification_safety ? asset.classification_safety.toUpperCase() : "Needs review"}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {selectedAssets.filter((asset) => !currentAssetIds.has(asset.id)).map((asset) => <input key={asset.id} name="assetIds" type="hidden" value={asset.id} />)}

      <aside className="media-selection-tray" aria-live="polite">
        <div>
          <Badge className="shadow-none" variant={selectionCount ? "accent" : "outline"}>{selectionCount} selected</Badge>
          <p>{selectionCount ? "Your selection remains available while you refine the Library filters." : "Choose one or more existing assets to create local draft variants."}</p>
        </div>
        {selectionCount ? <div className="media-selection-summary">
          <div>{selectedAssets.slice(0, 3).map((asset) => <span key={asset.id} title={asset.basename}>{asset.basename}</span>)}{selectionCount > 3 ? <span>+{selectionCount - 3} more</span> : null}</div>
          <Button onClick={() => setSelection({})} size="sm" type="button" variant="ghost"><X aria-hidden="true" />Clear selection</Button>
        </div> : null}
      </aside>
    </div>
  );
}
