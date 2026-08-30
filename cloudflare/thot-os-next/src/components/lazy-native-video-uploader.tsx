"use client";

import dynamic from "next/dynamic";

// Hashing and multipart upload code are needed only after an editor opens the
// native Library. Keep that browser-only work out of the server render path.
const NativeVideoUploader = dynamic(
  () => import("@/components/native-video-uploader").then((module) => module.NativeVideoUploader),
  {
    ssr: false,
    loading: () => <section className="upload-card native-video-upload" aria-busy="true"><p>Preparing private video upload…</p></section>,
  },
);

export function LazyNativeVideoUploader() {
  return <NativeVideoUploader />;
}
