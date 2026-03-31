'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Plus, Search, Loader2, Link as LinkIcon, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { PurchaseRequestRow, PurchaseStage } from '@/lib/purchaseRequests';
import { PURCHASE_STAGES, isPurchaseStage } from '@/lib/purchaseRequests';
import { PurchaseRequestFormModal } from '@/components/PurchaseRequestFormModal';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'Todos' | PurchaseStage>('Todos');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('purchase_requests')
      .select('id, requester, vendor, product_name, product_url, product_price, stage, notes, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase requests:', error);
      setRequests([]);
    } else {
      const list: PurchaseRequestRow[] = (data || []).map((r: unknown) => {
        const row = r as Record<string, unknown>;
        const stageRaw = String(row.stage ?? '');
        return {
          id: String(row.id),
          requester: (row.requester as string) ?? null,
          vendor: (row.vendor as string) ?? null,
          product_name: (row.product_name as string) ?? null,
          product_url: (row.product_url as string) ?? null,
          product_price: (row.product_price as string) ?? null,
          stage: isPurchaseStage(stageRaw) ? stageRaw : 'Rascunho',
          notes: (row.notes as string) ?? null,
          created_at: String(row.created_at),
        };
      });
      setRequests(list);
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchRequests();
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return requests.filter((r) => {
      const matchesStage = stageFilter === 'Todos' || r.stage === stageFilter;
      if (!s) return matchesStage;
      const blob = [
        r.requester,
        r.vendor,
        r.product_name,
        r.product_url,
        r.product_price,
        r.stage,
        r.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesStage && blob.includes(s);
    });
  }, [requests, search, stageFilter]);

  const byStage = useMemo(() => {
    const map = new Map<PurchaseStage, PurchaseRequestRow[]>();
    PURCHASE_STAGES.forEach((s) => map.set(s, []));
    filtered.forEach((r) => {
      const bucket = map.get(r.stage) || [];
      bucket.push(r);
      map.set(r.stage, bucket);
    });
    return map;
  }, [filtered]);

  const updateStage = async (id: string, next: PurchaseStage) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, stage: next } : r)));
    const { error } = await supabase.from('purchase_requests').update({ stage: next }).eq('id', id);
    if (error) {
      alert(`Erro ao atualizar estágio: ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetchRequests();
    }
  };

  const deleteRequest = async (id: string) => {
    if (!confirm('Excluir este pedido? (Não apaga itens do almoxarifado)')) return;
    const { error } = await supabase.from('purchase_requests').delete().eq('id', id);
    if (error) alert(`Erro ao excluir: ${error.message}`);
    else setRequests((prev) => prev.filter((r) => r.id !== id));
  };

  const nextStageOf = (stage: PurchaseStage): PurchaseStage | null => {
    const idx = PURCHASE_STAGES.indexOf(stage);
    return idx >= 0 && idx < PURCHASE_STAGES.length - 1 ? PURCHASE_STAGES[idx + 1] : null;
  };

  const prevStageOf = (stage: PurchaseStage): PurchaseStage | null => {
    const idx = PURCHASE_STAGES.indexOf(stage);
    return idx > 0 ? PURCHASE_STAGES[idx - 1] : null;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quadro de Pedidos</h1>
          <p className="text-slate-500 text-sm">Kanban por estágio com rascunhos e atualização rápida.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
          >
            <Plus size={16} />
            Novo Pedido
          </button>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por solicitante, produto, link, fornecedor..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-secondary/50 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase">Estágio</span>
          <select
            className="bg-transparent border-none text-sm focus:ring-0 outline-none font-medium text-slate-600"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as any)}
          >
            <option value="Todos">Todos</option>
            {PURCHASE_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Link
          href="/orders"
          className="flex items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm"
          title="Ver em lista"
        >
          Ver lista
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            {loading ? 'Carregando…' : `${filtered.length} pedidos`}
          </div>
          <div className="text-[10px] text-slate-400 font-bold">
            Dica: use o dropdown do card para mudar de coluna.
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1100px] grid grid-cols-6 gap-4 p-4">
            {PURCHASE_STAGES.map((stage) => {
              const items = byStage.get(stage) || [];
              return (
                <div key={stage} className="bg-slate-50/60 border border-slate-100 rounded-2xl p-3 flex flex-col min-h-[420px]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] font-black text-primary uppercase tracking-tight">{stage}</div>
                    <div className="text-[10px] font-bold text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                      {items.length}
                    </div>
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {Array(3)
                        .fill(0)
                        .map((_, i) => (
                          <div key={i} className="h-24 bg-white/60 rounded-xl border border-slate-100 animate-pulse" />
                        ))}
                    </div>
                  ) : items.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-slate-300 text-xs font-bold italic">
                      Vazio
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {items.map((r) => {
                        const prev = prevStageOf(r.stage);
                        const next = nextStageOf(r.stage);
                        const title = r.product_name || 'Sem nome';
                        const subtitle = [r.requester, r.vendor].filter(Boolean).join(' • ');
                        return (
                          <div
                            key={r.id}
                            className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-bold text-primary text-sm truncate">{title}</div>
                                <div className="text-[11px] text-slate-500 font-medium truncate">
                                  {subtitle || '—'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void deleteRequest(r.id)}
                                className="p-2 hover:bg-slate-50 rounded-lg text-slate-300 hover:text-red-500 shrink-0"
                                title="Excluir pedido"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>

                            <div className="mt-2 flex items-center justify-between gap-2">
                              <div className="text-[11px] font-mono text-slate-500">
                                {r.product_price || '—'}
                              </div>
                              <div className="flex items-center gap-2">
                                {r.product_url && (
                                  <a
                                    href={r.product_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[10px] text-secondary font-bold inline-flex items-center gap-1 hover:underline"
                                    title="Abrir link do produto"
                                  >
                                    <LinkIcon size={12} />
                                    Link
                                  </a>
                                )}
                                <Link
                                  href={`/orders?q=${encodeURIComponent(title)}`}
                                  className="text-[10px] text-slate-400 font-bold hover:text-secondary hover:underline"
                                  title="Abrir na lista de pedidos"
                                >
                                  Abrir
                                </Link>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <select
                                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none"
                                value={r.stage}
                                onChange={(e) => void updateStage(r.id, e.target.value as PurchaseStage)}
                              >
                                {PURCHASE_STAGES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!prev}
                                onClick={() => prev && void updateStage(r.id, prev)}
                                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-primary disabled:opacity-40"
                                title="Voltar estágio"
                              >
                                <ArrowLeft size={16} />
                              </button>
                              <button
                                type="button"
                                disabled={!next}
                                onClick={() => next && void updateStage(r.id, next)}
                                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-primary disabled:opacity-40"
                                title="Avançar estágio"
                              >
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PurchaseRequestFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={() => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          fetchRequests();
        }}
      />
    </div>
  );
}
