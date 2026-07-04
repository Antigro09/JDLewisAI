import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "ContractorAI";
  return {
    name,
    short_name: name,
    description: "Private, construction-specialized AI assistant for the team.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#ea580c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
