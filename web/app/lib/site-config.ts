// Public build settings shared by metadata and static pages.
const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || "https://miroven-app.mksdr.bid";
const parsedUrl = new URL(/^https?:\/\//i.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`);
if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password
  || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
  throw new Error("NEXT_PUBLIC_APP_URL must be an HTTP(S) origin.");
}
export const appOrigin = parsedUrl.origin;
const websiteBase = new URL(process.env.NEXT_PUBLIC_WEBSITE_URL || "https://miroven.mksdr.bid");
if (!["http:", "https:"].includes(websiteBase.protocol) || websiteBase.username || websiteBase.password
  || websiteBase.search || websiteBase.hash) {
  throw new Error("NEXT_PUBLIC_WEBSITE_URL must be an HTTP(S) website URL.");
}
if (!websiteBase.pathname.endsWith("/")) websiteBase.pathname += "/";
export const websiteLinks = {
  about: new URL("ko/", websiteBase).href,
  terms: new URL("ko/terms/", websiteBase).href,
  privacy: new URL("ko/privacy/", websiteBase).href,
};
