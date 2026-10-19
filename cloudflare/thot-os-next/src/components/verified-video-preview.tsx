import { verifiedVideoPreviewUrl } from "@/lib/verified-video-preview";

export function VerifiedVideoPreview({ assetId, basename, className }: { assetId: string; basename: string; className?: string }) {
  return <video className={className} controls preload="none" playsInline
    src={verifiedVideoPreviewUrl(assetId)}
    aria-label={`Preview ${basename}`}>Your browser cannot play this video.</video>;
}
