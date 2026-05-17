'use client';

export const dynamic = 'force-dynamic';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { BarChart3, StickyNote } from 'lucide-react';
import { AlmoxHomeDashboard } from '@/components/AlmoxHomeDashboard';
import { HomeAlertsFeed } from '@/components/HomeAlertsFeed';
import { MuralPostIts } from '@/components/MuralPostIts';

type HomeSection = 'resumo' | 'mural';

export default function Home() {
  const [homeSection, setHomeSection] = useState<HomeSection>('resumo');

  const sectionTabs: { id: HomeSection; label: string; icon: ReactNode }[] = [
    { id: 'resumo', label: 'Resumo', icon: <BarChart3 size={16} /> },
    { id: 'mural', label: 'Mural', icon: <StickyNote size={16} /> },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="space-y-3">
          <div>
            <h1 className="text-2xl font-bold text-primary">Início</h1>
            <p className="text-slate-500 text-sm">
              {homeSection === 'resumo' && 'Indicadores para o almoxarifado: saídas, estoque e categorias.'}
              {homeSection === 'mural' && 'Post-its para lembretes rápidos da equipe.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sectionTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setHomeSection(t.id)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-all ${
                  homeSection === t.id
                    ? 'bg-primary text-white border-primary shadow-md'
                    : 'bg-white text-primary border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {homeSection === 'resumo' && (
        <>
          <HomeAlertsFeed />
          <AlmoxHomeDashboard />
        </>
      )}
      {homeSection === 'mural' && <MuralPostIts />}
    </div>
  );
}
