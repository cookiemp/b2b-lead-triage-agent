import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inbound Lead Triage — B2B Enrichment & Approval Workbench",
  description:
    "Autonomous B2B inbound lead enrichment, structured Gemini triage, deterministic confidence gating, and human-in-the-loop review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen antialiased selection:bg-[#171614] selection:text-[#fafaf8]">
        {children}
      </body>
    </html>
  );
}
