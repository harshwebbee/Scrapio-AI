import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Scrapio AI",
  description: "AI-ready website crawling and export console"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
