'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar, Header, MobileBottomNav } from '@/components/Navigation';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname?.startsWith('/login');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('loggb.sidebar.collapsed');
      setSidebarCollapsed(v === '1');
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('loggb.sidebar.collapsed', next ? '1' : '0');
      } catch {
        // ignore localStorage errors
      }
      return next;
    });
  };

  const handleMenuButtonClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileNavOpen((open) => !open);
    } else {
      toggleSidebar();
    }
  };

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-primary/35 backdrop-blur-[2px] md:hidden"
          aria-label="Fechar menu de navegação"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <Header
        collapsed={sidebarCollapsed}
        mobileNavOpen={mobileNavOpen}
        onMenuButtonClick={handleMenuButtonClick}
      />
      <div className="flex pt-16 h-screen min-h-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onCloseRequest={() => setMobileNavOpen(false)}
        />
        <MobileBottomNav onOpenFullMenu={() => setMobileNavOpen(true)} />
        <main
          className={`flex-1 w-full min-w-0 overflow-y-auto transition-[margin,width] duration-200 bg-transparent ml-0 p-4 pb-28 sm:p-6 md:p-8 md:pb-8 ${
            sidebarCollapsed ? 'md:ml-20 md:w-[calc(100vw-80px)]' : 'md:ml-64 md:w-[calc(100vw-256px)]'
          }`}
        >
          <div className="mx-auto w-full max-w-[1800px]">{children}</div>
        </main>
      </div>
    </>
  );
}
