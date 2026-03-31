'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Search, Link as LinkIcon, Loader2, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import type { PurchaseRequestRow, PurchaseStage } from '@/lib/purchaseRequests';
import { PURCHASE_STAGES, isPurchaseStage } from '@/lib/purchaseRequests';
import { PurchaseRequestFormModal } from '@/components/PurchaseRequestFormModal';

export default function OrdersPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
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

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

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

  const updateStage = async (id: string, stage: PurchaseStage) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, stage } : r)));
    const { error } = await supabase.from('purchase_requests').update({ stage }).eq('id', id);
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Pedidos</h1>
          <p className="text-slate-500 text-sm">Rascunhos, estágios de compra e links de produto com preenchimento automático.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm"
        >
          <Plus size={16} />
          Novo Pedido
        </button>
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
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Produto</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Solicitante</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fornecedor</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preço</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Estágio</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2 text-secondary" size={20} />
                    Carregando pedidos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">Nenhum pedido encontrado.</td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-primary text-sm">
                        {r.product_name || <span className="text-slate-300 italic font-medium">Sem nome</span>}
                      </div>
                      {r.product_url && (
                        <a
                          href={r.product_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-secondary font-bold inline-flex items-center gap-1 mt-1 hover:underline"
                        >
                          <LinkIcon size={12} />
                          Abrir link
                        </a>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">{r.requester || '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">{r.vendor || '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-mono">{r.product_price || '—'}</td>
                    <td className="px-6 py-4">
                      <select
                        className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none"
                        value={r.stage}
                        onChange={(e) => updateStage(r.id, e.target.value as PurchaseStage)}
                      >
                        {PURCHASE_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => deleteRequest(r.id)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500"
                        title="Excluir pedido"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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

