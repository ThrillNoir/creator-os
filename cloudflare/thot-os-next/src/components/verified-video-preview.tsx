import { verifiedVideoPreviewUrl } from "@/lib/verified-video-preview";

export function VerifiedVideoPreview({ assetId, basename, className, poster }: { assetId: string; basename: string; className?: string; poster?: string | null }) {
  return <video className={className} controls preload="none" playsInline poster={poster ?? undefined}
    src={verifiedVideoPreviewUrl(assetId)}
    aria-label={`Preview ${basename}`}>Your browser cannot play this video.</video>;
}
