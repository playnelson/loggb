'use client';

import Link from 'next/link';
import {
  Package,
  Users,
  LayoutDashboard,
  LogOut,
  Settings,
  History,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  MoreHorizontal,
  ClipboardList,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseRequest,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseRequest?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const menuItems = [
    { name: 'Início', icon: <LayoutDashboard size={20} />, href: '/' },
    { name: 'Almoxarifado', icon: <Package size={20} />, href: '/inventory' },
    { name: 'Ordens de compra', icon: <ClipboardList size={20} />, href: '/ordens-compra' },
    { name: 'Colaboradores', icon: <Users size={20} />, href: '/staff' },
    { name: 'Sedes e canteiros', icon: <MapPin size={20} />, href: '/sites' },
    { name: 'Histórico', icon: <History size={20} />, href: '/history' },
    { name: 'Configurações', icon: <Settings size={20} />, href: '/settings' },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside
      id="app-sidebar"
      className={`h-screen flex flex-col fixed left-0 top-0 pt-16 z-50 transition-transform duration-200 ease-out md:transition-[width] md:duration-200 border-r border-white/30 shadow-xl backdrop-blur-xl w-64 max-w-[85vw] md:z-auto ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } md:translate-x-0 ${collapsed ? 'md:w-20' : 'md:w-64'} bg-[linear-gradient(200deg,rgba(15,23,42,0.96)_0%,rgba(15,23,42,0.88)_58%,rgba(15,23,42,0.78)_100%)] text-white`}
    >
      <nav className="flex-1 px-4 space-y-2 py-6 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.name : undefined}
              onClick={() => onCloseRequest?.()}
              className={`flex items-center px-4 py-3.5 rounded-xl transition-all min-h-[48px] ${
                isActive 
                  ? 'bg-secondary text-white shadow-md shadow-secondary/25' 
                  : 'hover:bg-white/10 text-slate-300 hover:text-white border border-transparent hover:border-white/10'
              } ${collapsed ? 'md:justify-center gap-3 md:gap-0' : 'gap-3'}`}
            >
              {item.icon}
              <span className={`font-medium ${collapsed ? 'md:sr-only' : ''}`}>{item.name}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => {
            void handleSignOut();
            onCloseRequest?.();
          }}
          title={collapsed ? 'Sair' : undefined}
          className={`w-full flex items-center px-4 py-3.5 rounded-xl hover:bg-red-500/10 text-red-300 hover:text-red-200 border border-transparent hover:border-red-400/20 transition-all mt-8 min-h-[48px] ${
            collapsed ? 'md:justify-center gap-3 md:gap-0' : 'gap-3'
          }`}
        >
          <LogOut size={20} />
          <span className={`font-medium ${collapsed ? 'md:sr-only' : ''}`}>Sair</span>
        </button>
      </nav>
      <div className={`p-4 border-t border-white/10 shrink-0 ${collapsed ? 'md:text-center' : ''}`}>
        <p className="text-xs text-slate-300/80">
          {collapsed ? (
            <>
              <span className="md:hidden">© 2026 LOGG-B System</span>
              <span className="hidden md:inline">LOGG-B</span>
            </>
          ) : (
            '© 2026 LOGG-B System'
          )}
        </p>
      </div>
    </aside>
  );
}

export function Header({
  collapsed,
  mobileNavOpen,
  onMenuButtonClick,
}: {
  collapsed: boolean;
  mobileNavOpen: boolean;
  onMenuButtonClick: () => void;
}) {
  return (
    <header className="h-16 fixed top-0 left-0 right-0 z-[60] flex items-center justify-between px-4 sm:px-6 md:px-8 border-b border-white/45 backdrop-blur-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.86)_0%,rgba(248,250,252,0.7)_100%)]">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        <button
          type="button"
          onClick={onMenuButtonClick}
          className="mr-1 sm:mr-2 p-2.5 rounded-xl border border-slate-200/90 text-slate-500 hover:text-primary hover:bg-white/80 transition-all shadow-sm shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          title={
            mobileNavOpen
              ? 'Fechar menu'
              : collapsed
                ? 'Expandir menu lateral'
                : 'Recolher menu lateral'
          }
        >
          <span className="md:hidden">{mobileNavOpen ? <X size={20} /> : <Menu size={20} />}</span>
          <span className="hidden md:inline">
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </span>
        </button>
        <span className="text-xl sm:text-2xl font-bold tracking-tighter text-primary truncate">
          LOGG<span className="text-secondary">B</span>
        </span>
        <span className="bg-secondary/15 text-secondary text-[9px] sm:text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ml-1 sm:ml-2 border border-secondary/25 shrink-0 hidden min-[380px]:inline">
          Almoxarifado
        </span>
      </div>
    </header>
  );
}

const bottomNavItems = [
  { name: 'Início', icon: LayoutDashboard, href: '/' },
  { name: 'Almox.', icon: Package, href: '/inventory' },
  { name: 'Equipe', icon: Users, href: '/staff' },
] as const;

export function MobileBottomNav({ onOpenFullMenu }: { onOpenFullMenu: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden border-t border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(248,250,252,0.98)_100%)] backdrop-blur-xl pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.12)]"
      aria-label="Navegação principal"
    >
      <div className="flex items-stretch justify-around gap-1 px-1 pt-1">
        {bottomNavItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-bold transition-colors ${
                isActive
                  ? 'text-secondary bg-secondary/10'
                  : 'text-slate-500 hover:text-primary hover:bg-slate-100/80'
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.25 : 2} />
              <span className="truncate max-w-full">{item.name}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenFullMenu}
          className="flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-bold text-slate-500 hover:text-primary hover:bg-slate-100/80 transition-colors"
        >
          <MoreHorizontal size={22} />
          <span>Mais</span>
        </button>
      </div>
    </nav>
  );
}
