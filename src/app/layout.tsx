import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";
import PwaServiceWorker from "@/components/PwaServiceWorker";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LoggB | Almoxarifado Inteligente",
  description: "Sistema de Gestão de Inventário e Movimentação LoggB",
  manifest: "/manifest.webmanifest",
  themeColor: "#0f172a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LoggB",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased font-sans">
      <body className={`${inter.className} min-h-screen bg-background`}>
        <PwaServiceWorker />
        <LayoutWrapper>{children}</LayoutWrapper>
      </body>
    </html>
  );
}
