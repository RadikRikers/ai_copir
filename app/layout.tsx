import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Copywriter Agent",
  description: "Agent for learning copywriter style and generating texts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
