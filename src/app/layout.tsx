import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./board.css";

export const metadata: Metadata = {
  title: "Creator Brief Wall",
  description:
    "This week’s briefs, ranked by money. Creators see who is paying to be taken.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="site-frame">{children}</div>
      </body>
    </html>
  );
}
