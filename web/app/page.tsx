import { JournalApp } from "./components/JournalApp";
import { appOrigin as baseUrl } from "./lib/site-config";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${baseUrl}/#website`,
      url: `${baseUrl}/`,
      name: "Miroven",
      description: "나만 볼 수 있는 암호화 저널",
      inLanguage: ["ko", "en"],
    },
    {
      "@type": "WebApplication",
      "@id": `${baseUrl}/#webapplication`,
      url: `${baseUrl}/`,
      name: "Miroven",
      description: "나만 볼 수 있는 암호화 저널",
      applicationCategory: "LifestyleApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      image: `${baseUrl}/og.png`,
      isPartOf: {
        "@id": `${baseUrl}/#website`,
      },
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <JournalApp />
    </>
  );
}
