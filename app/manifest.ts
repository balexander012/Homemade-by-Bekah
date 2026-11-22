import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Homemade by Bekah", short_name: "Bekah Baking",
    start_url: "/", display: "standalone", background_color: "#FAF6EC",
    theme_color: "#5E6B3C", icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
