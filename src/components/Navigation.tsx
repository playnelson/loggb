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
  ChevronRight,
  Boxes,
  ShoppingCart,
  Layers,
  Eye,
  Building2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import { useWorkspace } from '@/lib/workspace';

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
      { name: 'Visão de consulta', href: '/gestor', icon: Eye, hint: 'Estoque só para consulta, como quem tem o cargo Consulta vê' },
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
    name: 'Cadastros',
    icon: Users,
    items: [
      { name: 'Colaboradores', href: '/staff', icon: Users, hint: 'Equipe, carteira e ficha de EPI' },
      { name: 'Sedes e canteiros', href: '/sites', icon: MapPin, hint: 'Locais e o que está em cada um' },
    ],
  },
  { name: 'Workspaces', href: '/workspaces', icon: Layers },
  { name: 'Configurações', href: '/settings', icon: Settings },
];

/** Menu do gestor convidado: só consulta. */
const NAV_READ_ONLY: NavEntry[] = [
  { name: 'Estoque', href: '/gestor', icon: Package },
  { name: 'Colaboradores', href: '/gestor/colaboradores', icon: Users },
  { name: 'Histórico', href: '/history', icon: History },
  { name: 'Workspaces', href: '/workspaces', icon: Layers },
];

/** Só para ADM: pessoas, cargos, áreas do estoque e convites. */
const NAV_ORG: NavLinkItem = { name: 'Organização', href: '/organizacao', icon: Building2 };

function useNavEntries(): NavEntry[] {
  const { readOnly, isAdm } = useWorkspace();
  if (readOnly) return NAV_READ_ONLY;
  if (!isAdm) return NAV;
  const i = NAV.findIndex((e) => !isGroup(e) && e.href === '/workspaces');
  return [...NAV.slice(0, i), NAV_ORG, ...NAV.slice(i)];
}

function isGroup(e: NavEntry): e is NavGroup {
  return 'items' in e;
}

function isActivePath(pathname: string | null, href: string) {
  if (!pathname) return false;
  // '/' e '/gestor' têm subpáginas próprias no menu: só contam quando é a própria tela.
  if (href === '/' || href === '/gestor') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };
}

/** Barra superior: faixa grafite (marca, workspace, sair) e, no computador, a faixa do menu logo abaixo. */
export function Header({
  mobileNavOpen,
  onMenuButtonClick,
}: {
  mobileNavOpen: boolean;
  onMenuButtonClick: () => void;
}) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const nav = useNavEntries();
  const { readOnly } = useWorkspace();
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

  const menuItemClass = (active: boolean, open = false) =>
    `inline-flex items-center gap-2 h-10 px-3 xl:px-4 text-[13px] font-semibold whitespace-nowrap border-b-[3px] transition-colors ${
      active
        ? 'border-accent text-white bg-white/10'
        : open
          ? 'border-transparent text-white bg-white/10'
          : 'border-transparent text-slate-300 hover:text-white hover:bg-white/5'
    }`;

  return (
    <header className="fixed top-0 left-0 right-0 z-[60] shadow-md">
      <div className="h-14 lg:h-12 bg-bar text-white flex items-center gap-3 px-3 sm:px-5 lg:px-6">
        <button
          type="button"
          onClick={onMenuButtonClick}
          className="lg:hidden rounded-lg text-slate-200 hover:text-white hover:bg-white/10 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-expanded={mobileNavOpen}
          aria-controls="app-menu-panel"
          title={mobileNavOpen ? 'Fechar menu' : 'Abrir menu'}
        >
          {mobileNavOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0" onClick={() => setOpenGroup(null)}>
          <span className="text-xl font-extrabold tracking-tight text-white">
            LOGG<span className="text-accent">B</span>
          </span>
          <span className="hidden md:inline text-[11px] font-medium text-slate-400 border-l border-white/15 pl-2">
            Estoque e Suprimentos
          </span>
        </Link>

        <div className="hidden sm:block w-px h-6 bg-white/15 shrink-0" aria-hidden />
        <WorkspaceSwitcher />
        {readOnly ? (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-200 bg-amber-400/15 border border-amber-300/30 px-2 py-1 rounded shrink-0"
            title="Acesso de gestor: só visualização"
          >
            <Eye size={12} />
            Somente leitura
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void signOut()}
          title="Sair"
          className="hidden lg:inline-flex items-center gap-2 px-3 py-1.5 rounded text-[13px] font-semibold text-slate-300 hover:text-white hover:bg-white/10 ml-auto shrink-0"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>

      <nav
        ref={navRef}
        className="hidden lg:flex items-stretch h-10 bg-bar-2 px-3 xl:px-4 border-t border-black/20"
        aria-label="Menu principal"
      >
        {nav.map((entry) => {
          if (!isGroup(entry)) {
            const active = isActivePath(pathname, entry.href);
            const Icon = entry.icon;
            return (
              <Link
                key={entry.href}
                href={entry.href}
                onClick={() => setOpenGroup(null)}
                title={entry.name}
                className={menuItemClass(active)}
              >
                <Icon size={16} />
                {entry.name}
              </Link>
            );
          }
          const groupActive = entry.items.some((i) => isActivePath(pathname, i.href));
          const open = openGroup === entry.name;
          const Icon = entry.icon;
          return (
            <div key={entry.name} className="relative flex">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : entry.name)}
                className={menuItemClass(groupActive, open)}
              >
                <Icon size={16} />
                {entry.name}
                <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open ? (
                <div
                  role="menu"
                  className="absolute left-0 top-full w-72 border border-slate-300 border-t-0 bg-white shadow-xl py-1"
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
                        className={`flex items-start gap-3 px-3 py-2 border-l-[3px] transition-colors ${
                          active ? 'border-secondary bg-secondary/10' : 'border-transparent hover:bg-slate-100'
                        }`}
                      >
                        <ItemIcon size={17} className={`mt-0.5 shrink-0 ${active ? 'text-secondary' : 'text-slate-500'}`} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-primary">{item.name}</span>
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
    </header>
  );
}

/** Caminho da tela atual (ex.: Estoque › Almoxarifado), mostrado no topo de cada tela. */
export function PageTrail() {
  const pathname = usePathname();
  const nav = useNavEntries();
  let trail: string[] = [];
  for (const entry of nav) {
    if (isGroup(entry)) {
      const item = entry.items.find((i) => isActivePath(pathname, i.href));
      if (item) {
        trail = [entry.name, item.name];
        break;
      }
    } else if (isActivePath(pathname, entry.href)) {
      trail = [entry.name];
      break;
    }
  }
  if (trail.length === 0) return null;
  if (pathname?.startsWith('/ordens-compra/')) trail = [...trail, 'Detalhe do pedido'];
  return (
    <nav aria-label="Você está em" className="mb-4 flex items-center gap-1.5 text-[12px] text-slate-500">
      <Link href="/" className="inline-flex items-center hover:text-secondary" title="Início">
        <LayoutDashboard size={13} />
      </Link>
      {trail.map((part, i) => (
        <span key={`${part}-${i}`} className="inline-flex items-center gap-1.5">
          <ChevronRight size={12} className="text-slate-400" />
          <span className={i === trail.length - 1 ? 'font-semibold text-primary' : undefined}>{part}</span>
        </span>
      ))}
    </nav>
  );
}

/** Painel que desce do topo no celular/tablet, com os grupos em cascata. */
export function MobileMenuPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const signOut = useSignOut();
  const nav = useNavEntries();
  if (!open) return null;

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 border-l-[3px] px-3 py-3 min-h-[48px] font-semibold text-sm transition-colors ${
      active ? 'border-secondary bg-secondary/10 text-primary' : 'border-transparent text-slate-700 hover:bg-slate-100'
    }`;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 top-14 z-40 bg-primary/40 lg:hidden"
        aria-label="Fechar menu"
        onClick={onClose}
      />
      <div
        id="app-menu-panel"
        className="fixed top-14 left-0 right-0 z-50 lg:hidden max-h-[calc(100dvh-3.5rem)] overflow-y-auto bg-white border-b border-slate-300 shadow-xl"
      >
        <nav className="p-3 grid gap-1 sm:grid-cols-2 sm:gap-x-4" aria-label="Menu principal">
          {nav.map((entry) => {
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
                <div className="px-3 pt-3 pb-1 mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-slate-200">
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
            className="flex items-center gap-3 border-l-[3px] border-transparent px-3 py-3 min-h-[48px] font-semibold text-sm text-red-600 hover:bg-red-50 mt-1"
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

const bottomNavItemsReadOnly = [
  { name: 'Estoque', icon: Package, href: '/gestor' },
  { name: 'Equipe', icon: Users, href: '/gestor/colaboradores' },
  { name: 'Histórico', icon: History, href: '/history' },
] as const;

export function MobileBottomNav({ onOpenFullMenu }: { onOpenFullMenu: () => void }) {
  const pathname = usePathname();
  const { readOnly } = useWorkspace();
  const items = readOnly ? bottomNavItemsReadOnly : bottomNavItems;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 md:hidden border-t border-slate-300 bg-white pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(38,50,56,0.08)]"
      aria-label="Atalhos"
    >
      <div className="flex items-stretch justify-around gap-1 px-1">
        {items.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border-t-[3px] px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                isActive
                  ? 'border-secondary text-secondary'
                  : 'border-transparent text-slate-500 hover:text-primary hover:bg-slate-100'
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
          className="flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border-t-[3px] border-transparent px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-primary hover:bg-slate-100 transition-colors"
        >
          <MoreHorizontal size={22} />
          <span>Mais</span>
        </button>
      </div>
    </nav>
  );
}
