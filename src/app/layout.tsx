import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LoggB | Almoxarifado Inteligente",
  description: "Sistema de Gestão de Inventário e Movimentação LoggB",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased font-sans">
      <body className={`${inter.className} min-h-screen bg-background`}>
        <LayoutWrapper>{children}</LayoutWrapper>
      </body>
    </html>
  );
}
