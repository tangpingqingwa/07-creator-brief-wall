import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./board.css";

export const metadata: Metadata = {
  title: "Creator Brief Wall",
  description:
    "Paid briefs from the rolling last 7 days, ranked by money. Creators see who is paying to be taken.",
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
      <body>
        <div className="site-frame">
          {children}
          <MakerFooter />
        </div>
      </body>
    </html>
  );
}
