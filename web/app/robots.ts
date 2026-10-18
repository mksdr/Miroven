import type { MetadataRoute } from "next";
import { appOrigin } from "./lib/site-config";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${appOrigin}/sitemap.xml` };
}
