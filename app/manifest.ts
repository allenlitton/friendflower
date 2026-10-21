import type { MetadataRoute } from "next";

// Web app metadata (name, colours, icons). We no longer prompt people to install it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Friend Flower",
    short_name: "Friend Flower",
    description: "Meet friends of friends wherever you are.",
    start_url: "/nearby",
    display: "standalone",
    background_color: "#0d0c0b",
    theme_color: "#0d0c0b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
