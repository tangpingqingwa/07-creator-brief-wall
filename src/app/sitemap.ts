import type { MetadataRoute } from "next";

const SITE_URL = "https://creatorbrief.lol";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/rules`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
