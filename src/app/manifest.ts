import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "THOT OS",
    short_name: "THOT OS",
    description: "Private creator content operations and mobile posting handoff.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6fa",
    theme_color: "#171522",
  };
}
