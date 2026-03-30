'use client';

import Link from 'next/link';
import { Package, Users, ArrowRightLeft, LayoutDashboard, LogOut, Settings, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const menuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard size={20} />, href: '/' },
    { name: 'Almoxarifado', icon: <Package size={20} />, href: '/inventory' },
    { name: 'Colaboradores', icon: <Users size={20} />, href: '/staff' },
    { name: 'Movimentação', icon: <ArrowRightLeft size={20} />, href: '/movement' },
    { name: 'Histórico', icon: <History size={20} />, href: '/history' },
    { name: 'Configurações', icon: <Settings size={20} />, href: '/settings' },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="w-64 bg-primary text-white h-screen flex flex-col fixed left-0 top-0 pt-16">
      <nav className="flex-1 px-4 space-y-2 py-6">
        {menuItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-secondary text-white shadow-lg shadow-secondary/20' 
                  : 'hover:bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors mt-8"
        >
          <LogOut size={20} />
          <span className="font-medium">Sair</span>
        </button>
      </nav>
      <div className="p-4 border-t border-slate-800">
        <p className="text-xs text-slate-400">© 2026 LOGG-B System</p>
      </div>
    </aside>
  );
}

export function Header() {
  return (
    <header className="h-16 bg-white border-b border-border fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-8">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold tracking-tighter text-primary">
          LOGG<span className="text-secondary">B</span>
        </span>
        <span className="bg-secondary/10 text-secondary text-[10px] uppercase font-bold px-2 py-0.5 rounded ml-2">Almoxarifado</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-primary font-bold">
          YS
        </div>
      </div>
    </header>
  );
}
