import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Копир отдела",
    short_name: "AI Копир",
    description: "Агент отдела для сохранения стиля копирайтеров и генерации рабочих текстов.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f8",
    theme_color: "#202426",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
