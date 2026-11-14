'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Eye, Loader2, Package, PackageX, RefreshCw, Search, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllTenantItems } from '@/lib/tenantItems';
import { downloadInventoryWorkbookFromTemplate, type InventoryExportItem } from '@/lib/inventoryExportTemplate';
import { formatDateTimeBR, useWorkspace, workspaceKindLabel } from '@/lib/workspace';
import { OrgLogo } from '@/components/OrganizationSetup';
import AlmoxarifadoTabs, { itemInAlmox, useAlmoxSelection, useAlmoxarifados } from '@/components/AlmoxarifadoTabs';

import { TagPlate } from '@/components/TagPlate';
type StockItem = {
  id: string;
  code: string | null;
  description: string;
  category: string;
  location: string;
  unit: string;
  consumable: boolean;
  unique_item?: boolean;
  tag?: string | null;
  quantity_current: number;
  quantity_min: number;
  possession?: { quantity: number; employees?: { full_name: string } | { full_name: string }[] | null }[];
  site_possession?: { quantity: number }[];
};

const PAGE = 200;

function num(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function sumQty(list: { quantity: number }[] | undefined): number {
  return (list ?? []).reduce((acc, r) => acc + Number(r.quantity || 0), 0);
}

/** Nomes de quem está com o item agora (posse > 0). */
function holdersOf(i: StockItem): string {
  const names = (i.possession ?? [])
    .filter((p) => Number(p.quantity) > 0)
    .map((p) => (Array.isArray(p.employees) ? p.employees[0]?.full_name : p.employees?.full_name) ?? '')
    .filter(Boolean);
  return [...new Set(names)].join(', ');
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Estoque do workspace atual só para consulta (gestor convidado, ou qualquer pessoa que queira só ver). */
export default function GestorPage() {
  const { currentWorkspace, currentOrganization, readOnly } = useWorkspace();
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const almox = useAlmoxarifados();
  const [almoxSel, setAlmoxSel] = useAlmoxSelection(almox.list);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Faça login para ver o estoque.');
      const all = (await fetchAllTenantItems(supabase, user.id)) as unknown as StockItem[];
      setItems(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar o estoque.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [items]
  );

  const stats = useMemo(() => {
    let low = 0;
    let zero = 0;
    let withPeople = 0;
    for (const i of items) {
      const q = Number(i.quantity_current || 0);
      if (q <= 0) zero++;
      else if (Number(i.quantity_min || 0) > 0 && q < Number(i.quantity_min)) low++;
      if (sumQty(i.possession) > 0) withPeople++;
    }
    return { total: items.length, low, zero, withPeople };
  }, [items]);

  const almoxCounts = useMemo(() => {
    const out: Record<string, number> = { todos: items.length };
    for (const a of almox.list) out[a.id] = items.filter((i) => itemInAlmox(i.category, a.id, almox.list)).length;
    out.outros = items.filter((i) => itemInAlmox(i.category, 'outros', almox.list)).length;
    return out;
  }, [items, almox.list]);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return items.filter((i) => {
      if (!itemInAlmox(i.category, almoxSel, almox.list)) return false;
      if (category && i.category !== category) return false;
      if (onlyLow) {
        const qty = Number(i.quantity_current || 0);
        if (!(qty <= 0 || (Number(i.quantity_min || 0) > 0 && qty < Number(i.quantity_min)))) return false;
      }
      if (!q) return true;
      return normalize(`${i.description} ${i.code ?? ''} ${i.location ?? ''} ${i.tag ?? ''} ${holdersOf(i)}`).includes(q);
    });
  }, [items, search, category, onlyLow, almoxSel, almox.list]);

  const download = async () => {
    if (exporting || items.length === 0) return;
    setExporting(true);
    try {
      await downloadInventoryWorkbookFromTemplate(items as unknown as InventoryExportItem[]);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao gerar a planilha.');
    } finally {
      setExporting(false);
    }
  };

  const statusOf = (i: StockItem) => {
    const q = Number(i.quantity_current || 0);
    if (q <= 0) return { label: 'Sem saldo', cls: 'bg-red-100 text-red-700' };
    if (Number(i.quantity_min || 0) > 0 && q < Number(i.quantity_min)) return { label: 'Abaixo do mínimo', cls: 'bg-amber-100 text-amber-800' };
    return { label: 'OK', cls: 'bg-green-100 text-green-700' };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 erp-titlebar px-4 py-3 sm:px-5">
        <div className="flex items-center gap-4 min-w-0">
          <OrgLogo src={currentOrganization?.logo_data} name={currentOrganization?.name ?? ''} size={56} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">
              {currentOrganization?.name}
            </p>
            <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary truncate">{currentWorkspace?.name ?? 'Estoque'}</h1>
            <p className="text-xs text-slate-500">
              {currentWorkspace ? workspaceKindLabel(currentWorkspace.kind) : ''}
              {currentWorkspace?.city ? ` · ${currentWorkspace.city}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
            <Eye size={14} />
            Somente leitura
            {readOnly && currentOrganization?.access_expires_at
              ? ` · até ${formatDateTimeBR(currentOrganization.access_expires_at)}`
              : ''}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold text-primary border border-slate-200 bg-white rounded-lg hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={exporting || loading || items.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-secondary rounded-lg hover:opacity-95 disabled:opacity-60"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Baixar planilha (Excel)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Itens ativos', value: stats.total, icon: Package, cls: 'text-primary' },
          { label: 'Abaixo do mínimo', value: stats.low, icon: AlertTriangle, cls: 'text-amber-600' },
          { label: 'Sem saldo', value: stats.zero, icon: PackageX, cls: 'text-red-600' },
          { label: 'Com colaboradores', value: stats.withPeople, icon: Users, cls: 'text-secondary' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400">
              <c.icon size={15} className={c.cls} />
              {c.label}
            </div>
            <div className={`text-2xl font-bold mt-1 ${c.cls}`}>{loading ? '—' : num(c.value)}</div>
          </div>
        ))}
      </div>

      <div className="px-1">
        <AlmoxarifadoTabs
          list={almox.list}
          seesAll={almox.seesAll}
          value={almoxSel}
          onChange={(v) => {
            setAlmoxSel(v);
            setLimit(PAGE);
          }}
          counts={almoxCounts}
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-col md:flex-row gap-3">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Buscar por descrição, código, local, TAG ou colaborador"
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-secondary text-sm"
          />
        </label>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(PAGE);
          }}
          className="md:w-56 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-medium"
          aria-label="Categoria"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 px-2 whitespace-nowrap">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          Só faltando
        </label>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm font-bold">{error}</div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-12 text-center text-slate-400 text-sm">Nenhum item encontrado.</p>
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="md:hidden divide-y divide-slate-100">
              {filtered.slice(0, limit).map((i) => {
                const st = statusOf(i);
                return (
                  <li key={i.id} className="p-4 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-bold text-primary text-sm">
                        {i.description}
                        {i.tag ? (
                          <span className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] font-normal text-slate-500">
                            <TagPlate size="xs">{i.tag}</TagPlate>
                            {holdersOf(i) ? `com ${holdersOf(i)}` : ''}
                          </span>
                        ) : null}
                      </span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {[i.code, i.category, i.location].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-sm">
                      <span className="font-bold text-primary">{num(i.quantity_current)}</span>{' '}
                      <span className="text-slate-500">{i.unit}</span>
                      {Number(i.quantity_min) > 0 ? <span className="text-xs text-slate-400"> · mín. {num(i.quantity_min)}</span> : null}
                      {sumQty(i.possession) > 0 ? <span className="text-xs text-slate-500"> · {num(sumQty(i.possession))} com colaboradores</span> : null}
                      {sumQty(i.site_possession) > 0 ? <span className="text-xs text-slate-500"> · {num(sumQty(i.site_possession))} em locais</span> : null}
                    </p>
                  </li>
                );
              })}
            </ul>

            {/* Computador: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Código', 'Descrição', 'Categoria', 'Local', 'Saldo', 'Com colaboradores', 'Em locais', 'Mínimo', 'Situação'].map((h) => (
                      <th key={h} className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.slice(0, limit).map((i) => {
                    const st = statusOf(i);
                    return (
                      <tr key={i.id} className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{i.code || '—'}</td>
                        <td className="px-3 py-2.5 font-bold text-primary">
                          {i.description}
                          {i.tag ? (
                            <span className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] font-normal text-slate-500">
                              <TagPlate size="xs">{i.tag}</TagPlate>
                              {holdersOf(i) ? <span className="font-semibold text-secondary">com {holdersOf(i)}</span> : null}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{i.category}</td>
                        <td className="px-3 py-2.5 text-slate-600">{i.location || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="font-bold text-primary">{num(i.quantity_current)}</span>{' '}
                          <span className="text-xs text-slate-500">{i.unit}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{sumQty(i.possession) > 0 ? num(sumQty(i.possession)) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600">{sumQty(i.site_possession) > 0 ? num(sumQty(i.site_possession)) : '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600">{Number(i.quantity_min) > 0 ? num(i.quantity_min) : '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>
                Mostrando {num(Math.min(limit, filtered.length))} de {num(filtered.length)} itens
              </span>
              {filtered.length > limit ? (
                <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="font-bold text-primary hover:underline">
                  Mostrar mais
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
