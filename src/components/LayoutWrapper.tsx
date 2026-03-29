'use client';

import { usePathname } from 'next/navigation';
import { Sidebar, Header } from '@/components/Navigation';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname?.startsWith('/login');

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Header />
      <div className="flex pt-16 h-screen">
        <Sidebar />
        <main className="ml-64 flex-1 p-8 overflow-y-auto w-[calc(100vw-256px)]">
          {children}
        </main>
      </div>
    </>
  );
}
