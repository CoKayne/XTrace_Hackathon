import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://second-look-vc-demo.duankayne.chatgpt.site"),
  title: "VSee — VC Decision Intelligence",
  description: "Turn live market shifts into evidence-backed reasons to revisit past investment decisions.",
  openGraph: {
    title: "VSee — VC Decision Intelligence",
    description: "The market changed. Your old decisions should, too.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "VSee connects an old investment decision to a new market signal." }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "VSee — VC Decision Intelligence",
    description: "The market changed. Your old decisions should, too.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
