import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about", "/privacy", "/terms", "/contact"],
        disallow: [
          "/api/",
          "/admin",
          "/profile",
          "/room/",
          "/dashboard",
          "/login",
          "/signup",
          "/guest",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
