'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Wand2, X } from 'lucide-react';
import type { PurchaseDraftForm, PurchaseStage } from '@/lib/purchaseRequests';
import { PURCHASE_STAGES } from '@/lib/purchaseRequests';

export function PurchaseRequestFormModal({
  isOpen,
  onClose,
  onSaved,
  initialStage = 'Rascunho',
  title = 'Novo Pedido (Rascunho)',
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialStage?: PurchaseStage;
  title?: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [form, setForm] = useState<PurchaseDraftForm>({
    requester: '',
    product_url: '',
    product_name: '',
    vendor: '',
    product_price: '',
    stage: initialStage,
    notes: '',
  });

  if (!isOpen) return null;

  const fetchFromLink = async () => {
    const url = form.product_url.trim();
    if (!url) return;
    setLinkLoading(true);
    try {
      const res = await fetch(`/api/link-metadata?url=${encodeURIComponent(url)}`);
      const json: unknown = await res.json();
      if (!res.ok) {
        const msg =
          typeof json === 'object' && json && 'error' in json
            ? String((json as { error?: unknown }).error ?? 'Não foi possível ler o link.')
            : 'Não foi possível ler o link.';
        alert(msg);
        return;
      }
      const payload = json as { product_name?: string | null; vendor?: string | null; product_price?: string | null };
      setForm((f) => ({
        ...f,
        product_name: f.product_name || (payload.product_name ?? ''),
        vendor: f.vendor || (payload.vendor ?? ''),
        product_price: f.product_price || (payload.product_price ?? ''),
      }));
    } finally {
      setLinkLoading(false);
    }
  };

  const createDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    const payload = {
      user_id: user.id,
      requester: form.requester.trim() || null,
      vendor: form.vendor.trim() || null,
      product_name: form.product_name.trim() || null,
      product_url: form.product_url.trim() || null,
      product_price: form.product_price.trim() || null,
      stage: form.stage,
      notes: form.notes.trim() || null,
    };

    const { error } = await supabase.from('purchase_requests').insert([payload]);
    if (error) {
      alert(`Erro ao salvar pedido: ${error.message}`);
    } else {
      onClose();
      onSaved();
      setForm({
        requester: '',
        product_url: '',
        product_name: '',
        vendor: '',
        product_price: '',
        stage: initialStage,
        notes: '',
      });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-bold text-primary">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={createDraft} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Solicitante</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                placeholder="Ex.: Manutenção / João"
                value={form.requester}
                onChange={(e) => setForm((f) => ({ ...f, requester: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Estágio</label>
              <select
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                value={form.stage}
                onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as PurchaseStage }))}
              >
                {PURCHASE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-slate-500">Link do Produto</label>
            <div className="flex gap-2">
              <input
                type="url"
                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                placeholder="Cole o link do produto aqui"
                value={form.product_url}
                onChange={(e) => setForm((f) => ({ ...f, product_url: e.target.value }))}
              />
              <button
                type="button"
                onClick={fetchFromLink}
                disabled={linkLoading || !form.product_url.trim()}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
                title="Puxar nome/infos do link"
              >
                {linkLoading ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                Puxar
              </button>
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              Alguns sites não permitem leitura automática; nesse caso, preencha manualmente.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Nome do Produto</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold text-primary"
                placeholder="Ex.: Luva nitrílica"
                value={form.product_name}
                onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Fornecedor / Site</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                placeholder="Ex.: Loja X"
                value={form.vendor}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Preço (opcional)</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-mono"
                placeholder="Ex.: R$ 199,90"
                value={form.product_price}
                onChange={(e) => setForm((f) => ({ ...f, product_price: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Observações</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                placeholder="Ex.: urgência, quantidade, modelo..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
              Salvar rascunho
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

