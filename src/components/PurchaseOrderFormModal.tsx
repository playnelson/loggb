'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2, Wand2, X } from 'lucide-react';
import type { EmployeeLite, NewOrderForm, PurchaseStage } from '@/lib/purchaseOrders';
import { PURCHASE_STAGES, clampNumber } from '@/lib/purchaseOrders';

function emptyItem() {
  return {
    product_url: '',
    product_name: '',
    vendor: '',
    product_price: '',
    unit: 'un',
    quantity_requested: 1,
    notes: '',
  };
}

export function PurchaseOrderFormModal({
  isOpen,
  onClose,
  onSaved,
  initialStage = 'Rascunho',
  title = 'Novo Pedido',
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialStage?: PurchaseStage;
  title?: string;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkLoadingIdx, setLinkLoadingIdx] = useState<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);

  const [form, setForm] = useState<NewOrderForm>({
    requester_employee_id: '',
    stage: initialStage,
    notes: '',
    items: [emptyItem()],
  });

  useEffect(() => {
    if (!isOpen) return;
    const run = async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, status')
        .order('full_name', { ascending: true });
      if (error) {
        console.error('Error fetching employees:', error);
        setEmployees([]);
      } else {
        const list: EmployeeLite[] = (data || []).map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id),
            full_name: String(row.full_name ?? ''),
            status: row.status ? String(row.status) : undefined,
          };
        });
        setEmployees(list);
      }
    };
    run();
  }, [isOpen]);

  const canSubmit = useMemo(() => {
    if (!form.requester_employee_id) return false;
    if (!form.items.length) return false;
    return form.items.every((it) => it.quantity_requested > 0);
  }, [form]);

  if (!isOpen) return null;

  const pullFromLink = async (idx: number) => {
    const url = form.items[idx]?.product_url.trim();
    if (!url) return;
    setLinkLoadingIdx(idx);
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
      setForm((f) => {
        const next = { ...f, items: [...f.items] };
        const cur = next.items[idx] || emptyItem();
        next.items[idx] = {
          ...cur,
          product_name: cur.product_name || (payload.product_name ?? ''),
          vendor: cur.vendor || (payload.vendor ?? ''),
          product_price: cur.product_price || (payload.product_price ?? ''),
        };
        return next;
      });
    } finally {
      setLinkLoadingIdx(null);
    }
  };

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    const orderPayload = {
      user_id: user.id,
      requester_employee_id: form.requester_employee_id,
      stage: form.stage,
      notes: form.notes.trim() || null,
    };

    const { data: orderData, error: orderError } = await supabase
      .from('purchase_orders')
      .insert([orderPayload])
      .select('id')
      .single();

    if (orderError || !orderData?.id) {
      alert(`Erro ao criar pedido: ${orderError?.message || 'desconhecido'}`);
      setIsSubmitting(false);
      return;
    }

    const itemsPayload = form.items.map((it) => ({
      order_id: orderData.id,
      product_url: it.product_url.trim() || null,
      product_name: it.product_name.trim() || null,
      vendor: it.vendor.trim() || null,
      product_price: it.product_price.trim() || null,
      unit: it.unit.trim() || 'un',
      quantity_requested: clampNumber(Number(it.quantity_requested), 1, 1_000_000),
      quantity_received: 0,
      notes: it.notes.trim() || null,
    }));

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
    if (itemsError) {
      // best-effort rollback: delete the order (will cascade delete items if any inserted)
      await supabase.from('purchase_orders').delete().eq('id', orderData.id);
      alert(`Erro ao adicionar itens: ${itemsError.message}`);
      setIsSubmitting(false);
      return;
    }

    onClose();
    onSaved();
    setForm({
      requester_employee_id: '',
      stage: initialStage,
      notes: '',
      items: [emptyItem()],
    });
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-bold text-primary">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={createOrder} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Solicitante (Funcionário) *</label>
              <select
                required
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                value={form.requester_employee_id}
                onChange={(e) => setForm((f) => ({ ...f, requester_employee_id: e.target.value }))}
              >
                <option value="">Selecione…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
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
            <label className="text-xs font-bold uppercase text-slate-500">Observações do pedido</label>
            <input
              type="text"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
              placeholder="Ex.: urgência, centro de custo, etc."
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs font-black text-primary uppercase tracking-tight">Itens do pedido</div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }))}
              className="flex items-center gap-2 text-primary bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-50"
            >
              <Plus size={14} />
              Adicionar item
            </button>
          </div>

          <div className="space-y-3">
            {form.items.map((it, idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black text-slate-400 uppercase">Item #{idx + 1}</div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) || [emptyItem()] }))
                    }
                    disabled={form.items.length === 1}
                    className="p-2 hover:bg-slate-50 rounded-lg text-slate-300 hover:text-red-500 disabled:opacity-40"
                    title="Remover item"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Link do Produto</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                        placeholder="Cole o link do produto aqui"
                        value={it.product_url}
                        onChange={(e) =>
                          setForm((f) => {
                            const next = { ...f, items: [...f.items] };
                            next.items[idx] = { ...next.items[idx], product_url: e.target.value };
                            return next;
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => void pullFromLink(idx)}
                        disabled={linkLoadingIdx === idx || !it.product_url.trim()}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
                        title="Puxar nome/infos do link"
                      >
                        {linkLoadingIdx === idx ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                        Puxar
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Quantidade *</label>
                    <input
                      required
                      type="number"
                      min={1}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold"
                      value={it.quantity_requested}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = {
                            ...next.items[idx],
                            quantity_requested: clampNumber(Number(e.target.value), 1, 1_000_000),
                          };
                          return next;
                        })
                      }
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Nome do Produto</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-bold text-primary"
                      placeholder="Ex.: Luva nitrílica"
                      value={it.product_name}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = { ...next.items[idx], product_name: e.target.value };
                          return next;
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Unidade</label>
                    <select
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                      value={it.unit}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = { ...next.items[idx], unit: e.target.value };
                          return next;
                        })
                      }
                    >
                      <option value="un">Unidade (un)</option>
                      <option value="par">Par</option>
                      <option value="kg">Quilos (kg)</option>
                      <option value="g">Gramas (g)</option>
                      <option value="L">Litros (L)</option>
                      <option value="mL">Mililitros (mL)</option>
                      <option value="m">Metros (m)</option>
                      <option value="cm">Centímetros (cm)</option>
                      <option value="cx">Caixa (cx)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Fornecedor / Site</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                      placeholder="Ex.: Loja X"
                      value={it.vendor}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = { ...next.items[idx], vendor: e.target.value };
                          return next;
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Preço (opcional)</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-mono"
                      placeholder="Ex.: R$ 199,90"
                      value={it.product_price}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = { ...next.items[idx], product_price: e.target.value };
                          return next;
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-slate-500">Observações do item</label>
                    <input
                      type="text"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                      placeholder="Modelo, cor, tamanho..."
                      value={it.notes}
                      onChange={(e) =>
                        setForm((f) => {
                          const next = { ...f, items: [...f.items] };
                          next.items[idx] = { ...next.items[idx], notes: e.target.value };
                          return next;
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
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
              disabled={isSubmitting || !canSubmit}
              className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              Criar pedido
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

