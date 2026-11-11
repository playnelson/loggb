'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Header, MobileMenuPanel, MobileBottomNav } from '@/components/Navigation';
import AppFooter from '@/components/AppFooter';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname?.startsWith('/login');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Com o painel aberto no celular, a página de trás não rola.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Header mobileNavOpen={mobileNavOpen} onMenuButtonClick={() => setMobileNavOpen((open) => !open)} />
      <MobileMenuPanel open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <MobileBottomNav onOpenFullMenu={() => setMobileNavOpen(true)} />
      <div className="pt-16 h-screen min-h-0">
        <main className="h-full w-full min-w-0 overflow-y-auto bg-transparent p-4 pb-28 sm:p-6 md:p-8 md:pb-8">
          <div className="mx-auto w-full max-w-[1800px]">
            {children}
            <AppFooter />
          </div>
        </main>
      </div>
    </>
  );
}
