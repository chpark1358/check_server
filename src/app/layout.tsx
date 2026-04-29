import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Check Server",
  description: "Zendesk mail sending workflow for browser deployment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
