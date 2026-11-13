import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";
import PwaServiceWorker from "@/components/PwaServiceWorker";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LoggB | Estoque e Suprimentos",
  description: "LoggB: estoque, compras e cadastros da obra",
  manifest: "/manifest.webmanifest",
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
  themeColor: "#263238",
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
