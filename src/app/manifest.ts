import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Creator Brief Wall",
    short_name: "Brief Wall",
    description: "Paid creator briefs on a transparent rolling seven-day wall.",
    start_url: "/",
    display: "standalone",
    background_color: "#c9b79a",
    theme_color: "#8a1f14",
    icons: [{ src: "/brand-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
