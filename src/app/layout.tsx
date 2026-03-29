import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar, Header } from "@/components/Navigation";

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
        <Header />
        <div className="flex pt-16 h-screen">
          <Sidebar />
          <main className="ml-64 flex-1 p-8 overflow-y-auto w-[calc(100vw-256px)]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
