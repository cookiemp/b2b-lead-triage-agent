import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "B2B Lead Triage & Enrichment Agent",
  description:
    "Autonomous B2B inbound lead enrichment, structured triage, and human-in-the-loop approval workbench.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
