import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto-Injection-Check",
  description: "AIチャット向けの自動セキュリティスキャンツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
