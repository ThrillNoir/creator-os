"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function WorkflowImage({
  alt,
  className,
  priority = false,
  sizes,
  src,
}: {
  alt: string;
  className?: string;
  priority?: boolean;
  sizes: string;
  src: string;
}) {
  const [unavailable, setUnavailable] = useState(false);

  return (
    <div className={cn("workflow-media-frame", unavailable && "workflow-media-unavailable", className)}>
      {!unavailable ? <Image alt={alt} fill onError={() => setUnavailable(true)} priority={priority} sizes={sizes} src={src} unoptimized /> : null}
      {unavailable ? <span className="workflow-media-fallback" role="img" aria-label="Source preview unavailable"><ImageOff aria-hidden="true" />Source preview unavailable</span> : null}
    </div>
  );
}
