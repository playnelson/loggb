import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoggB - Estoque e Suprimentos",
    short_name: "LoggB",
    description: "LoggB: estoque, compras e cadastros da obra",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eceff1",
    theme_color: "#263238",
    icons: [
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
