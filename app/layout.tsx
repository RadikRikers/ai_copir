import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Копир",
  applicationName: "AI Копир",
  description: "Закрытый агент отдела для сохранения стиля копирайтеров и генерации рабочих текстов.",
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
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
