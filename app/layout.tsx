import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wystawiacz Allegro SaaS",
  description: "Panel abonamentowy do przygotowywania i wystawiania ofert części samochodowych na Allegro.",
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
    <html lang="pl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
