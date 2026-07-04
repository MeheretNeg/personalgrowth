import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anchor — time awareness trainer",
    short_name: "Anchor",
    description:
      "A training gym for time blindness: backward-planned timelines, guess-first calibration, visible time decay.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#101423",
    theme_color: "#101423",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
