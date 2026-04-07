'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { FileUp, Loader2, Plus, X } from 'lucide-react';
import type { EmployeeLite } from '@/lib/purchaseOrders';
import { clampNumber } from '@/lib/purchaseOrders';
import { ensureKanbanColumnsSeeded, type KanbanColumnRow } from '@/lib/kanbanColumns';
import { formatProductLabelDisplay, normalizeProductLabelForSave } from '@/lib/productDisplayText';

type ImportItem = {
  product_name: string;
  quantity_requested: number;
  unit: string;
  product_url: string;
  vendor: string;
  product_price: string;
  notes: string;
};

function normalizeUnit(u: string): string {
  const v = (u || '').trim();
  return v || 'un';
}

export function downloadOrdersTemplate(): void {
  const headers = [
    'product_name',
    'quantity',
    'unit',
    'product_url',
    'vendor',
    'price',
    'notes',
  ];
  const example = [
    ['Luva nitrílica', 10, 'par', 'https://...', 'Loja X', 'R$ 39,90', 'tamanho M'],
    ['Óleo hidráulico', 20, 'L', 'https://...', 'Fornecedor Y', 'R$ 18,00', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'itens');
  XLSX.writeFile(wb, 'modelo_pedido.xlsx');
}

export function PurchaseOrderImportModal({
  isOpen,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [columns, setColumns] = useState<KanbanColumnRow[]>([]);
  const [requesterId, setRequesterId] = useState('');
  const [kanbanColumnId, setKanbanColumnId] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [items, setItems] = useState<ImportItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setEmployees([]);
        setColumns([]);
        return;
      }
      const [empRes, colSeed] = await Promise.all([
        supabase
          .from('employees')
          .select('id, full_name, status')
          .eq('user_id', user.id)
          .order('full_name', { ascending: true }),
        ensureKanbanColumnsSeeded(supabase, user.id),
      ]);
      if (empRes.error) {
        console.error('Error fetching employees:', empRes.error);
        setEmployees([]);
      } else {
        const list: EmployeeLite[] = (empRes.data || []).map((r: unknown) => {
          const row = r as Record<string, unknown>;
          return {
            id: String(row.id),
            full_name: String(row.full_name ?? ''),
            status: row.status ? String(row.status) : undefined,
          };
        });
        setEmployees(list);
      }
      setColumns(colSeed.columns);
      const first = colSeed.columns[0]?.id ?? '';
      setKanbanColumnId((cur) => cur || first);
    };
    run();
  }, [isOpen]);

  const canSubmit = useMemo(
    () => requesterId && items.length > 0 && !!kanbanColumnId,
    [requesterId, items.length, kanbanColumnId]
  );

  if (!isOpen) return null;

  const parseFile = async (file: File) => {
    setError(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    if (!rows.length) throw new Error('Planilha vazia.');

    const header = (rows[0] || []).map((c) => String(c || '').trim());
    const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

    const iName = idx('product_name');
    const iQty = idx('quantity');
    const iUnit = idx('unit');
    const iUrl = idx('product_url');
    const iVendor = idx('vendor');
    const iPrice = idx('price');
    const iNotes = idx('notes');

    if (iName === -1 || iQty === -1) {
      throw new Error('Cabeçalho inválido. Baixe o modelo e preencha no mesmo formato.');
    }

    const parsed: ImportItem[] = rows
      .slice(1)
      .filter((r) => (r[iName] ?? '').toString().trim())
      .map((r) => ({
        product_name: normalizeProductLabelForSave(String(r[iName] ?? '').trim()),
        quantity_requested: clampNumber(Number(r[iQty] ?? 1), 1, 1_000_000),
        unit: normalizeUnit(String(r[iUnit] ?? 'un')),
        product_url: String(r[iUrl] ?? '').trim(),
        vendor: String(r[iVendor] ?? '').trim(),
        product_price: String(r[iPrice] ?? '').trim(),
        notes: String(r[iNotes] ?? '').trim(),
      }));

    if (!parsed.length) throw new Error('Nenhum item encontrado na planilha.');
    setItems(parsed);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await parseFile(file);
    } catch (err: unknown) {
      setItems([]);
      setError(err instanceof Error ? err.message : 'Falha ao ler planilha.');
    } finally {
      e.target.value = '';
    }
  };

  const createOrderFromSpreadsheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    const col = columns.find((c) => c.id === kanbanColumnId) || columns[0];
    if (!col) {
      setError('Nenhuma coluna do quadro. Rode o SQL kanban_and_ca.sql.');
      setIsSubmitting(false);
      return;
    }

    const { data: orderData, error: orderError } = await supabase
      .from('purchase_orders')
      .insert([
        {
          user_id: user.id,
          requester_employee_id: requesterId,
          kanban_column_id: col.id,
          stage: col.title,
          notes: orderNotes.trim() || null,
          title: null,
          updated_at: new Date().toISOString(),
        },
      ])
      .select('id')
      .single();

    if (orderError || !orderData?.id) {
      setError(orderError?.message || 'Erro ao criar pedido.');
      setIsSubmitting(false);
      return;
    }

    const itemsPayload = items.map((it) => ({
      order_id: orderData.id,
      product_name: normalizeProductLabelForSave(it.product_name) || null,
      product_url: it.product_url || null,
      vendor: it.vendor || null,
      product_price: it.product_price || null,
      unit: normalizeUnit(it.unit),
      quantity_requested: clampNumber(Number(it.quantity_requested), 1, 1_000_000),
      quantity_received: 0,
      notes: it.notes || null,
    }));

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
    if (itemsError) {
      await supabase.from('purchase_orders').delete().eq('id', orderData.id);
      setError(itemsError.message);
      setIsSubmitting(false);
      return;
    }

    onClose();
    onSaved();
    setRequesterId('');
    setKanbanColumnId(columns[0]?.id ?? '');
    setOrderNotes('');
    setItems([]);
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-primary">Importar Pedido por Planilha</h2>
            <p className="text-xs text-slate-500 mt-1">Use o modelo e suba uma planilha simples para criar o pedido rápido.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={createOrderFromSpreadsheet} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 text-red-700 rounded-xl text-xs font-bold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Solicitante *</label>
              <select
                required
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                value={requesterId}
                onChange={(e) => setRequesterId(e.target.value)}
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
              <label className="text-xs font-bold uppercase text-slate-500">Coluna do quadro</label>
              <select
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
                value={kanbanColumnId}
                onChange={(e) => setKanbanColumnId(e.target.value)}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-slate-500">Descrição do pedido</label>
              <input
                type="text"
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Ex.: Materiais para Obra X"
              />
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <div className="text-sm font-bold text-primary">Planilha</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadOrdersTemplate}
                className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 text-sm"
              >
                <Plus size={16} />
                Baixar modelo
              </button>
              <label className="px-4 py-2 bg-primary text-white rounded-lg font-bold hover:bg-slate-800 transition-all flex items-center gap-2 text-sm cursor-pointer">
                <FileUp size={16} />
                Enviar planilha
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />
              </label>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
              <div className="text-xs font-black text-primary uppercase">Preview de itens</div>
              <div className="text-xs font-bold text-slate-500">{items.length} itens</div>
            </div>
            <div className="p-4">
              {items.length === 0 ? (
                <div className="text-slate-400 text-sm italic">Nenhuma planilha carregada ainda.</div>
              ) : (
                <div className="space-y-2">
                  {items.slice(0, 12).map((it, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-bold text-primary truncate">
                          {formatProductLabelDisplay(it.product_name)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold truncate">
                          {it.vendor || '—'} {it.product_price ? `• ${it.product_price}` : ''} {it.product_url ? '• link' : ''}
                        </div>
                      </div>
                      <div className="shrink-0 font-black text-primary">
                        {it.quantity_requested} {it.unit}
                      </div>
                    </div>
                  ))}
                  {items.length > 12 && (
                    <div className="text-[11px] text-slate-400 font-bold">+ {items.length - 12} itens…</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 flex gap-3">
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
              {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <FileUp size={18} />}
              Criar pedido
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

