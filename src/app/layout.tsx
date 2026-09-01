import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./board.css";

const SITE_URL = "https://creatorbrief.lol";
const SITE_NAME = "Creator Brief Wall";
const SITE_DESCRIPTION =
  "Paid briefs from the rolling last 7 days, ranked by money. Creators see who paid to be taken. Brands bid for placement and rank is the bid.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: "%s | Creator Brief Wall" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["creator briefs", "brand deals", "creator opportunities", "paid collaborations"],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand-mark.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [{ url: "/brand-mark.png", width: 512, height: 512, alt: "Creator Brief Wall flyer" }],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/brand-mark.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
  isAccessibleForFree: true,
};

function MakerFooter() {
  return (
    <footer className="maker-footer" data-maker-contact="">
      <p>
        Built by <a href="mailto:tangpingqingwa@gmail.com">tangpingqingwa@gmail.com</a>
      </p>
    </footer>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>
        <div className="site-frame">
          {children}
          <MakerFooter />
        </div>
      </body>
    </html>
  );
}
