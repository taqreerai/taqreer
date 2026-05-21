import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/preview/", "/project/"],
    },
    sitemap: "https://taqreer.ai/sitemap.xml",
  };
}
