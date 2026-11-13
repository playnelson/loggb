'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Layers, Loader2 } from 'lucide-react';
import { Header, MobileMenuPanel, MobileBottomNav, PageTrail } from '@/components/Navigation';
import AppFooter from '@/components/AppFooter';
import { OrganizationSetupForm } from '@/components/OrganizationSetup';
import JoinWithInvite from '@/components/JoinWithInvite';
import { WorkspaceProvider, isReadOnlyPath, useWorkspace } from '@/lib/workspace';

/**
 * As telas só aparecem quando já se sabe em qual workspace a pessoa está;
 * assim nenhuma tela busca ou grava dados antes disso.
 */
function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, readOnly } = useWorkspace();
  const isInvitePage = Boolean(pathname?.startsWith('/convite'));
  const blockedForReadOnly = status === 'ready' && readOnly && !isReadOnlyPath(pathname);

  // Gestor (somente leitura) só usa as telas de consulta.
  useEffect(() => {
    if (blockedForReadOnly) router.replace('/gestor');
  }, [blockedForReadOnly, router]);

  // A página do convite precisa abrir mesmo para quem ainda não tem organização.
  if (isInvitePage && status !== 'loading') return <>{children}</>;

  if (status === 'loading' || blockedForReadOnly) {
    return (
      <div className="py-24 flex flex-col items-center gap-3 text-slate-400" aria-busy>
        <Loader2 className="animate-spin" size={28} />
        <span className="text-sm font-medium">Carregando workspace…</span>
      </div>
    );
  }

  if (status === 'onboarding') {
    return (
      <div className="max-w-xl mx-auto py-6 sm:py-10 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-t-[3px] border-t-secondary">
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <h1 className="text-xl font-bold text-primary flex items-center gap-2">
              <Layers className="text-secondary" />
              Bem-vindo ao LoggB
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Vai trabalhar na equipe de uma empresa que já usa o LoggB? Use o convite que o ADM enviou.
            </p>
          </div>
          <div className="p-6">
            <JoinWithInvite />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <h2 className="text-base font-bold text-primary">Ou crie a sua própria organização</h2>
            <p className="text-sm text-slate-500 mt-1">
              Só se você é o responsável pela empresa: crie a organização e o primeiro workspace (canteiro, cidade ou sede).
            </p>
          </div>
          <div className="p-6">
            <OrganizationSetupForm onCreated={() => window.location.assign('/')} />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'no_workspace' && !pathname?.startsWith('/workspaces')) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-4">
        <Layers className="mx-auto text-secondary" size={36} />
        <h1 className="text-xl font-bold text-primary">Escolha um workspace</h1>
        <p className="text-sm text-slate-500">
          Você não está em nenhum workspace ativo. Entre em um existente, reative um arquivado ou crie um novo.
        </p>
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-2 bg-secondary text-white px-5 py-2.5 rounded-lg font-bold hover:opacity-95"
        >
          <Layers size={18} />
          Ir para Workspaces
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageTrail />
      {children}
    </>
  );
}

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
    <WorkspaceProvider enabled={!isLoginPage}>
      <Header mobileNavOpen={mobileNavOpen} onMenuButtonClick={() => setMobileNavOpen((open) => !open)} />
      <MobileMenuPanel open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <MobileBottomNav onOpenFullMenu={() => setMobileNavOpen(true)} />
      <div className="pt-14 lg:pt-[88px] h-screen min-h-0">
        <main className="h-full w-full min-w-0 overflow-y-auto bg-transparent p-3 pb-28 sm:p-5 lg:px-6 lg:py-5 md:pb-8">
          <div className="mx-auto w-full max-w-[1800px]">
            <WorkspaceGate>{children}</WorkspaceGate>
            <AppFooter />
          </div>
        </main>
      </div>
    </WorkspaceProvider>
  );
}
