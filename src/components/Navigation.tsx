'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Package,
  Users,
  LayoutDashboard,
  LogOut,
  Settings,
  History,
  MapPin,
  Menu,
  X,
  MoreHorizontal,
  ClipboardList,
  ClipboardCheck,
  ReceiptText,
  ChevronDown,
  Boxes,
  ShoppingCart,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';

type IconType = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
type NavLinkItem = { name: string; href: string; icon: IconType; hint?: string };
type NavGroup = { name: string; icon: IconType; items: NavLinkItem[] };
type NavEntry = NavLinkItem | NavGroup;

/** Menu em cascata: links soltos e grupos que abrem para baixo. */
const NAV: NavEntry[] = [
  { name: 'Início', href: '/', icon: LayoutDashboard },
  {
    name: 'Estoque',
    icon: Boxes,
    items: [
      { name: 'Almoxarifado', href: '/inventory', icon: Package, hint: 'Itens, saldos, retiradas e etiquetas' },
      { name: 'Inventário (contagem)', href: '/inventario', icon: ClipboardCheck, hint: 'Contar e ajustar o estoque' },
      { name: 'Histórico', href: '/history', icon: History, hint: 'Todas as movimentações e recibos' },
    ],
  },
  {
    name: 'Compras',
    icon: ShoppingCart,
    items: [
      { name: 'Ordens de compra', href: '/ordens-compra', icon: ClipboardList, hint: 'Pedidos e recebimento' },
      { name: 'Gestão de aluguéis', href: '/rentals', icon: ReceiptText, hint: 'Equipamentos alugados' },
    ],
  },
  {
    name: 'Pessoas e locais',
    icon: Users,
    items: [
      { name: 'Colaboradores', href: '/staff', icon: Users, hint: 'Equipe, carteira e ficha de EPI' },
      { name: 'Sedes e canteiros', href: '/sites', icon: MapPin, hint: 'Locais e o que está em cada um' },
    ],
  },
  { name: 'Configurações', href: '/settings', icon: Settings },
];

function isGroup(e: NavEntry): e is NavGroup {
  return 'items' in e;
}

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };
}

/** Barra superior com o menu em cascata (computador) e o botão ☰ (celular/tablet). */
export function Header({
  mobileNavOpen,
  onMenuButtonClick,
}: {
  mobileNavOpen: boolean;
  onMenuButtonClick: () => void;
}) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Fecha o grupo aberto ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenGroup(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  return (
    <header className="h-16 fixed top-0 left-0 right-0 z-[60] flex items-center gap-3 px-4 sm:px-6 lg:px-8 border-b border-slate-200/80 backdrop-blur-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(248,250,252,0.82)_100%)]">
      <button
        type="button"
        onClick={onMenuButtonClick}
        className="lg:hidden p-2.5 rounded-xl border border-slate-200/90 text-slate-600 hover:text-primary hover:bg-white/80 transition-all shadow-sm shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-expanded={mobileNavOpen}
        aria-controls="app-menu-panel"
        title={mobileNavOpen ? 'Fechar menu' : 'Abrir menu'}
      >
        {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0" onClick={() => setOpenGroup(null)}>
        <span className="text-xl sm:text-2xl font-bold tracking-tighter text-primary">
          LOGG<span className="text-secondary">B</span>
        </span>
        <span className="bg-secondary/15 text-secondary text-[9px] sm:text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border border-secondary/25 hidden min-[380px]:inline xl:inline">
          Almoxarifado
        </span>
      </Link>

      <nav ref={navRef} className="hidden lg:flex items-center gap-1 ml-4 flex-1 min-w-0" aria-label="Menu principal">
        {NAV.map((entry) => {
          if (!isGroup(entry)) {
            const active = isActivePath(pathname, entry.href);
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={() => setOpenGroup(null)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${
                  active ? 'bg-primary text-white' : 'text-slate-600 hover:text-primary hover:bg-slate-100'
                }`}
              >
                <Icon size={17} />
                {entry.name}
              </Link>
            );
          }
          const groupActive = entry.items.some((i) => isActivePath(pathname, i.href));
          const open = openGroup === entry.name;
          const Icon = entry.icon;
          return (
            <div key={entry.name} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : entry.name)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${
                  groupActive
                    ? 'bg-primary text-white'
                    : open
                      ? 'bg-slate-100 text-primary'
                      : 'text-slate-600 hover:text-primary hover:bg-slate-100'
                }`}
              >
                <Icon size={17} />
                {entry.name}
                <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open ? (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 animate-in fade-in slide-in-from-top-1 duration-150"
                >
                  {entry.items.map((item) => {
                    const active = isActivePath(pathname, item.href);
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        onClick={() => setOpenGroup(null)}
                        className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                          active ? 'bg-secondary/15' : 'hover:bg-slate-50'
                        }`}
                      >
                        <ItemIcon size={18} className={`mt-0.5 shrink-0 ${active ? 'text-secondary' : 'text-slate-400'}`} />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-primary">{item.name}</span>
                          {item.hint ? <span className="block text-[11px] text-slate-500">{item.hint}</span> : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => void signOut()}
        className="hidden lg:inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 ml-auto shrink-0"
      >
        <LogOut size={17} />
        Sair
      </button>
    </header>
  );
}

/** Painel que desce do topo no celular/tablet, com os grupos em cascata. */
export function MobileMenuPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  if (!open) return null;

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-3 py-3 min-h-[48px] font-bold text-sm transition-colors ${
      active ? 'bg-secondary/15 text-primary' : 'text-slate-700 hover:bg-slate-50'
    }`;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 top-16 z-40 bg-primary/35 backdrop-blur-[2px] lg:hidden"
        aria-label="Fechar menu"
        onClick={onClose}
      />
      <div
        id="app-menu-panel"
        className="fixed top-16 left-0 right-0 z-50 lg:hidden max-h-[calc(100dvh-4rem)] overflow-y-auto bg-white border-b border-slate-200 shadow-xl animate-in fade-in slide-in-from-top-2 duration-150"
      >
        <nav className="p-3 grid gap-1 sm:grid-cols-2 sm:gap-x-4" aria-label="Menu principal">
          {NAV.map((entry) => {
            if (!isGroup(entry)) {
              const Icon = entry.icon;
              return (
                <Link key={entry.href} href={entry.href} onClick={onClose} className={linkClass(isActivePath(pathname, entry.href))}>
                  <Icon size={19} className="text-slate-400" />
                  {entry.name}
                </Link>
              );
            }
            return (
              <div key={entry.name} className="sm:row-span-1">
                <div className="px-3 pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {entry.name}
                </div>
                {entry.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose} className={`${linkClass(isActivePath(pathname, item.href))} pl-5`}>
                      <Icon size={19} className="text-slate-400" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onClose();
              void signOut();
            }}
            className="flex items-center gap-3 rounded-xl px-3 py-3 min-h-[48px] font-bold text-sm text-red-600 hover:bg-red-50 mt-1"
          >
            <LogOut size={19} />
            Sair
          </button>
        </nav>
      </div>
    </>
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
      aria-label="Atalhos"
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
