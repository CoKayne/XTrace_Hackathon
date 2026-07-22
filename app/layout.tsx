import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Look — VC Deal Intelligence",
  description: "Turn live market shifts into evidence-backed reasons to revisit past investment decisions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
