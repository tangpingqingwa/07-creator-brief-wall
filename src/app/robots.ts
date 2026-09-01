import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/checkout/", "/r/"],
    },
    sitemap: "https://creatorbrief.lol/sitemap.xml",
    host: "https://creatorbrief.lol",
  };
}
