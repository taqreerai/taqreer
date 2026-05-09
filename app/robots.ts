import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/preview/",
    },
    sitemap: "https://taqreer.ai/sitemap.xml",
  };
}
