import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lead Triage | B2B Inbound Operations",
  description:
    "Autonomous B2B inbound lead enrichment, structured Gemini triage, deterministic confidence gating, and human-in-the-loop review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-[#ffffff] text-[#111113] antialiased selection:bg-[#111113] selection:text-[#ffffff]">
        {children}
      </body>
    </html>
  );
}
