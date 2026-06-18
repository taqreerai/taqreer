import { MetadataRoute } from "next";

// PWA / install metadata. Minimal: brand name, dark brand background, and the
// existing colored icon mark. start_url is the Arabic root (the product default).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "taqreer.ai",
    short_name: "taqreer.ai",
    description: "تصميم عروض تقديمية وتقارير بالذكاء الاصطناعي، بالعربية والإنجليزية.",
    start_url: "/ar",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    icons: [
      { src: "/icon-colored.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
