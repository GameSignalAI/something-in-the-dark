import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Something in the Dark — An AI Horror Game",
  description: "An AI creates the nightmare. A human must find the way out. Created by @Texchnostack.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
