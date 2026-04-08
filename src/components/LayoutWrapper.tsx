'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar, Header } from '@/components/Navigation';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname?.startsWith('/login');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('loggb.sidebar.collapsed');
      setSidebarCollapsed(v === '1');
    } catch {
      setSidebarCollapsed(false);
    }
  }, []);

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

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Header collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
      <div className="flex pt-16 h-screen">
        <Sidebar collapsed={sidebarCollapsed} />
        <main
          className={`flex-1 p-8 overflow-y-auto transition-all duration-200 ${
            sidebarCollapsed ? 'ml-20 w-[calc(100vw-80px)]' : 'ml-64 w-[calc(100vw-256px)]'
          }`}
        >
          {children}
        </main>
      </div>
    </>
  );
}
