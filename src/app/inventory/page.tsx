'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Plus, AlertCircle, X, FileUp, Users, History, Edit, Trash2, Loader2, ArrowUpRight, ArrowDownLeft, Tags, ShoppingCart, User, Minus, Tag, Download } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';
import QuickMovementModal from '@/components/QuickMovementModal';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { recordMovement, updatePossessionQuantity, updateStock } from '@/lib/movements';

function possessionEmployeeName(
  employees: { full_name: string } | { full_name: string }[] | null | undefined
): string | undefined {
  if (!employees) return undefined;
  return Array.isArray(employees) ? employees[0]?.full_name : employees.full_name;
}

interface PossessionDetail {
  id: string;
  quantity: number;
  employees?: { full_name: string } | { full_name: string }[] | null;
}

interface Product {
  id: string;
  code?: string | null;
  description: string;
  category: string;
  location: string;
  consumable: boolean;
  unique_item?: boolean;
  /** TAG / identificador fixo no cadastro do item */
  tag?: string | null;
  quantity_current: number;
  quantity_min: number;
  unit: string;
  updated_at?: string;
  possession?: PossessionDetail[];
}

interface ItemCategory {
  id: string;
  name: string;
  locked: boolean;
}

interface EmployeeLite {
  id: string;
  full_name: string;
}

interface CartLine {
  lineId: string;
  itemId: string;
  description: string;
  quantity: number;
  unit: string;
  consumable: boolean;
  unique_item: boolean;
  tag?: string;
}

const FALLBACK_CATEGORIES = ['Ferramenta', 'EPI', 'Tubulação', 'Consumível'] as const;

function escapeCsvCell(value: string): string {
  const s = String(value ?? '');
  if (/[;\n\r"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const emptyItemForm = () => ({
  description: '',
  category: 'Ferramenta',
  location: '',
  consumable: false,
  unique_item: false,
  quantity_current: 0,
  quantity_min: 0,
  unit: 'un',
  tag: '',
});

function InventoryContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<ItemCategory[] | null>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<ItemCategory | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  
  // Modals for actions
  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [historyItem, setHistoryItem] = useState<Product | null>(null);
  const [itemMovements, setItemMovements] = useState<any[]>([]);
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [adjustItem, setAdjustItem] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(0);

  // Quick Movement State
  const [isQuickMovementOpen, setIsQuickMovementOpen] = useState(false);
  const [quickMovementItem, setQuickMovementItem] = useState<Product | null>(null);
  const [quickMovementMode, setQuickMovementMode] = useState<'IN' | 'OUT'>('OUT');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartEmployeeId, setCartEmployeeId] = useState('');
  const [cartPickItemId, setCartPickItemId] = useState('');
  const [cartPickQty, setCartPickQty] = useState(1);
  const [cartPickTag, setCartPickTag] = useState('');

  // Form states for NEW/EDIT
  const [formData, setFormData] = useState(emptyItemForm);

  const fetchCategories = async () => {
    setCategoryError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCategories(null);
      return;
    }

    // If the table doesn't exist (or RLS blocks), we fall back to the hardcoded list.
    const { data, error } = await supabase
      .from('item_categories')
      .select('id, name, locked')
      .order('locked', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching categories:', error);
      setCategories(null);
      setCategoryError('Categorias não configuradas no banco (usando padrão).');
      return;
    }

    const list = (data || []).map((c: { id: unknown; name: unknown; locked: unknown }) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      locked: Boolean(c.locked),
    })) as ItemCategory[];

    // Ensure defaults (client-side seed per user)
    const existingLower = new Set(list.map((c) => c.name.trim().toLowerCase()));
    const missingDefaults = FALLBACK_CATEGORIES.filter((n) => !existingLower.has(n.toLowerCase()));
    if (missingDefaults.length) {
      await supabase.from('item_categories').insert(
        missingDefaults.map((name) => ({
          name,
          locked: name === 'EPI',
          user_id: user.id,
        }))
      );
      const { data: data2 } = await supabase
        .from('item_categories')
        .select('id, name, locked')
        .order('locked', { ascending: false })
        .order('name', { ascending: true });
      const list2 = (data2 || []).map((c: { id: unknown; name: unknown; locked: unknown }) => ({
        id: String(c.id),
        name: String(c.name ?? ''),
        locked: Boolean(c.locked),
      })) as ItemCategory[];
      setCategories(list2);
      return;
    }

    setCategories(list);
  };

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select(
        'id, code, description, category, location, consumable, unique_item, tag, quantity_current, quantity_min, unit, updated_at, possession (id, quantity, employees (full_name))'
      )
      .order('description', { ascending: true });

    if (error) {
      console.error('Error fetching products:', error);
      setProducts([]);
    } else {
      setProducts(data || []);
    }
    setLoading(false);
  };

  const fetchEmployees = async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('Error fetching employees:', error);
      setEmployees([]);
      return;
    }
    const actives = (data || [])
      .filter((e: { id: string; full_name: string; status?: string }) => !e.status || e.status === 'Ativo')
      .map((e: { id: string; full_name: string }) => ({ id: e.id, full_name: e.full_name }));
    setEmployees(actives);
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchProducts();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchCategories();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchEmployees();
  }, []);

  const categoryNames = categories?.map((c) => c.name) ?? [...FALLBACK_CATEGORIES];
  const categoryOptions = Array.from(
    new Set([...(categoryNames || []), ...products.map((p) => p.category).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const openCategoryManager = () => {
    setIsCategoriesOpen(true);
    setNewCategoryName('');
    setEditingCategory(null);
    setEditingCategoryName('');
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchCategories();
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (name.length < 2) return;
    setIsSubmitting(true);
    setCategoryError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      alert('Usuário não autenticado.');
      return;
    }
    const { error } = await supabase.from('item_categories').insert([{ name, locked: name === 'EPI', user_id: user.id }]);
    if (error) setCategoryError(error.message);
    setNewCategoryName('');
    await fetchCategories();
    setIsSubmitting(false);
  };

  const startEditCategory = (cat: ItemCategory) => {
    if (cat.locked) return;
    setEditingCategory(cat);
    setEditingCategoryName(cat.name);
  };

  const saveEditCategory = async () => {
    if (!editingCategory) return;
    if (editingCategory.locked) return;
    const nextName = editingCategoryName.trim();
    if (nextName.length < 2) return;
    if (nextName.toLowerCase() === 'epi') {
      alert('A categoria EPI é travada e não pode ser renomeada.');
      return;
    }
    setIsSubmitting(true);
    setCategoryError(null);
    const prevName = editingCategory.name;
    const { error } = await supabase
      .from('item_categories')
      .update({ name: nextName })
      .eq('id', editingCategory.id);
    if (error) {
      setCategoryError(error.message);
      setIsSubmitting(false);
      return;
    }

    // Update existing items to keep consistency (does NOT delete items).
    await supabase.from('items').update({ category: nextName }).eq('category', prevName);

    setEditingCategory(null);
    setEditingCategoryName('');
    await fetchCategories();
    await fetchProducts();
    setIsSubmitting(false);
  };

  const deleteCategory = async (cat: ItemCategory) => {
    if (cat.locked || cat.name.toLowerCase() === 'epi') {
      alert('Esta categoria é travada e não pode ser excluída.');
      return;
    }
    if (!confirm(`Excluir a categoria "${cat.name}"? (Os itens NÃO serão apagados.)`)) return;
    setIsSubmitting(true);
    setCategoryError(null);
    const { error } = await supabase.from('item_categories').delete().eq('id', cat.id);
    if (error) setCategoryError(error.message);
    await fetchCategories();
    setIsSubmitting(false);
  };

  const openHistory = async (item: Product) => {
    setHistoryItem(item);
    const { data } = await supabase
      .from('movements')
      .select('*, employees(full_name)')
      .eq('item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setItemMovements(data || []);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const qty = Number(adjustQty || 0);
    if (!Number.isFinite(qty) || qty === 0) return;
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    const type = qty > 0 ? 'IN' : 'OUT';
    const abs = Math.abs(qty);

    const { error: moveError } = await supabase.from('movements').insert([{
      item_id: adjustItem.id,
      employee_id: null,
      quantity: abs,
      type,
      performed_by: user.id
    }]);
    if (moveError) {
      alert(`Erro ao registrar ajuste: ${moveError.message}`);
      setIsSubmitting(false);
      return;
    }

    const stockRes = await updateStock(supabase, adjustItem.id, qty);
    if (!stockRes.ok) {
      alert(`Erro ao atualizar estoque: ${stockRes.message}`);
      setIsSubmitting(false);
      return;
    }

    setAdjustItem(null);
    setAdjustQty(0);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchProducts();
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Tem certeza que deseja excluir "${name}"? Esta ação é irreversível.`)) {
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) alert('Erro ao excluir: ' + error.message);
      else fetchProducts();
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setIsSubmitting(true);

    const { error } = await supabase
      .from('items')
      .update({
        description: formData.description,
        category: formData.category,
        location: formData.location,
        consumable: formData.consumable,
        unique_item: formData.unique_item,
        quantity_current: formData.quantity_current,
        quantity_min: formData.quantity_min,
        unit: formData.unit,
        tag: formData.tag.trim() || null,
        code: itemCodeFromDescription(formData.description),
      })
      .eq('id', editingItem.id);

    if (error) {
      alert('Erro ao atualizar: ' + error.message);
    } else {
      setEditingItem(null);
      fetchProducts();
    }
    setIsSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const finalData = {
      description: formData.description,
      category: formData.category,
      location: formData.location,
      consumable: formData.consumable,
      unique_item: formData.unique_item,
      quantity_current: formData.quantity_current,
      quantity_min: formData.quantity_min,
      unit: formData.unit,
      tag: formData.tag.trim() || null,
      code: itemCodeFromDescription(formData.description),
    };

    const { error } = await supabase
      .from('items')
      .insert([finalData]);

    if (error) {
      console.error('Error adding item:', error);
      alert(`Erro ao cadastrar item: ${error.message}`);
    } else {
      setIsModalOpen(false);
      setFormData(emptyItemForm());
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      fetchProducts();
    }
    setIsSubmitting(false);
  };

  const filteredProducts = products.filter(p =>
    p.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDownloadInventory = () => {
    if (products.length === 0) {
      alert('Não há itens para exportar.');
      return;
    }
    const header = [
      'Descrição',
      'Código',
      'Categoria',
      'Local',
      'Unidade',
      'Consumível',
      'Item único',
      'TAG (cadastro)',
      'Estoque almox.',
      'Em posse (detalhe)',
      'Em posse (soma)',
      'Mínimo',
      'Total físico',
    ];
    const lines = [header.map(escapeCsvCell).join(';')];
    for (const p of products) {
      const posTotal = p.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
      const posDetail =
        (p.possession || [])
          .filter((pos) => pos.quantity > 0)
          .map((pos) => {
            const name = possessionEmployeeName(pos.employees) || '—';
            return `${name}: ${pos.quantity}`;
          })
          .join(' | ') || '—';
      const row = [
        p.description,
        p.code ?? '',
        p.category,
        p.location ?? '',
        p.unit,
        p.consumable ? 'Sim' : 'Não',
        p.unique_item ? 'Sim' : 'Não',
        p.tag ?? '',
        String(p.quantity_current),
        posDetail,
        String(posTotal),
        String(p.quantity_min),
        String(p.quantity_current + posTotal),
      ];
      lines.push(row.map(escapeCsvCell).join(';'));
    }
    const bom = '\uFEFF';
    const csv = bom + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `inventario_almoxarifado_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cartPickedItem = products.find((p) => p.id === cartPickItemId) || null;
  const cartTotalUnits = cart.reduce((acc, line) => acc + line.quantity, 0);

  const addLineToCart = () => {
    if (!cartPickedItem) return;
    const isUnique = Boolean(cartPickedItem.unique_item);
    const qty = isUnique ? 1 : Math.max(1, Math.floor(Number(cartPickQty || 1)));
    if (isUnique && !cartPickTag.trim()) {
      alert('Informe a TAG para item único.');
      return;
    }

    const inCartQty = cart
      .filter((l) => l.itemId === cartPickedItem.id)
      .reduce((s, l) => s + l.quantity, 0);
    if (qty + inCartQty > cartPickedItem.quantity_current) {
      alert('Quantidade no carrinho maior que o saldo atual do estoque.');
      return;
    }

    if (isUnique) {
      const normalizedTag = cartPickTag.trim().toLowerCase();
      const duplicatedTag = cart.some(
        (l) => l.itemId === cartPickedItem.id && (l.tag || '').trim().toLowerCase() === normalizedTag
      );
      if (duplicatedTag) {
        alert('Essa TAG já está no carrinho.');
        return;
      }
      setCart((prev) => [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          itemId: cartPickedItem.id,
          description: cartPickedItem.description,
          quantity: 1,
          unit: cartPickedItem.unit,
          consumable: cartPickedItem.consumable,
          unique_item: true,
          tag: cartPickTag.trim(),
        },
      ]);
      setCartPickTag('');
      return;
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === cartPickedItem.id && !l.unique_item);
      if (idx === -1) {
        return [
          ...prev,
          {
            lineId: crypto.randomUUID(),
            itemId: cartPickedItem.id,
            description: cartPickedItem.description,
            quantity: qty,
            unit: cartPickedItem.unit,
            consumable: cartPickedItem.consumable,
            unique_item: false,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
      return next;
    });
    setCartPickQty(1);
  };

  const updateCartLineQty = (lineId: string, delta: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.lineId === lineId);
      if (idx < 0) return prev;
      const line = prev[idx];
      if (line.unique_item) return prev;
      const item = products.find((p) => p.id === line.itemId);
      if (!item) return prev;
      const nextQty = line.quantity + delta;
      if (nextQty <= 0) return prev.filter((l) => l.lineId !== lineId);
      const others = prev
        .filter((l) => l.itemId === line.itemId && l.lineId !== lineId)
        .reduce((s, l) => s + l.quantity, 0);
      if (nextQty + others > item.quantity_current) {
        alert('Saldo insuficiente para aumentar esse item.');
        return prev;
      }
      const next = [...prev];
      next[idx] = { ...line, quantity: nextQty };
      return next;
    });
  };

  const processCartCheckout = async () => {
    if (!cartEmployeeId) {
      alert('Selecione o colaborador.');
      return;
    }
    if (cart.length === 0) {
      alert('Carrinho vazio.');
      return;
    }
    setIsSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const mvRes = await recordMovement(supabase, {
        item_id: line.itemId,
        employee_id: cartEmployeeId,
        quantity: line.quantity,
        type: 'OUT',
        performed_by: user.id,
        tag: line.tag || null,
      });
      if (!mvRes.ok) {
        alert(`Erro na linha ${i + 1}: ${mvRes.message}`);
        setIsSubmitting(false);
        return;
      }

      if (!line.consumable) {
        const { data: currentPos } = await supabase
          .from('possession')
          .select('quantity')
          .eq('employee_id', cartEmployeeId)
          .eq('item_id', line.itemId)
          .maybeSingle();
        const currentQty = Number(currentPos?.quantity ?? 0);
        const posRes = await updatePossessionQuantity(
          supabase,
          cartEmployeeId,
          line.itemId,
          currentQty + line.quantity,
          user.id
        );
        if (!posRes.ok) {
          alert(`Erro ao atualizar carteira (${line.description}): ${posRes.message}`);
          setIsSubmitting(false);
          return;
        }
      }

      const stockRes = await updateStock(supabase, line.itemId, -line.quantity);
      if (!stockRes.ok) {
        alert(`Erro ao atualizar estoque (${line.description}): ${stockRes.message}`);
        setIsSubmitting(false);
        return;
      }
    }

    setCart([]);
    setCartPickItemId('');
    setCartPickQty(1);
    setCartPickTag('');
    setIsCartOpen(false);
    setIsSubmitting(false);
    await fetchProducts();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Almoxarifado LoggB</h1>
          <p className="text-slate-500 text-sm">Gestão de materiais, EPIs e ferramentas por descrição e categoria.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="flex items-center gap-2 bg-secondary text-white px-4 py-2 rounded-lg hover:opacity-95 transition-all font-medium"
            title="Retirada em lote por colaborador"
          >
            <ShoppingCart size={18} />
            Carrinho
          </button>
          <button
            type="button"
            onClick={handleDownloadInventory}
            disabled={loading || products.length === 0}
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium disabled:opacity-50"
            title="CSV: todos os itens, saldo no almoxarifado e materiais sob cautela (em posse), por colaborador"
          >
            <Download size={18} className="text-secondary" />
            Baixar inventário
          </button>
          <button
            type="button"
            onClick={openCategoryManager}
            className="flex items-center gap-2 bg-white text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all font-medium"
            title="Criar, editar e excluir categorias"
          >
            <Tags size={18} className="text-secondary" />
            Categorias
          </button>
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 bg-slate-100 text-primary border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-200 transition-all font-medium"
          >
            <FileUp size={18} className="text-secondary" />
            Importar
          </button>
          <button 
            onClick={() => {
              setEditingItem(null);
              setFormData(emptyItemForm());
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-all font-medium"
          >
            <Plus size={18} />
            Novo Material
          </button>
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <ImportSpreadsheet 
            mode="inventory"
            onComplete={() => {
              setIsImportModalOpen(false);
              fetchProducts();
            }} 
          />
        </div>
      )}

      {/* Modal Gerenciar Categorias */}
      {isCategoriesOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">Categorias de Itens</h3>
                <p className="text-xs text-slate-500 mt-1">Excluir aqui não apaga itens. “EPI” é travada.</p>
              </div>
              <button onClick={() => setIsCategoriesOpen(false)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {categoryError && (
                <div className="p-3 bg-amber-50 border border-amber-100 text-amber-700 rounded-xl text-xs font-bold">
                  {categoryError}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                  placeholder="Nova categoria (ex.: Elétrica)"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void createCategory()}
                  disabled={isSubmitting || newCategoryName.trim().length < 2}
                  className="px-4 py-2 bg-primary text-white rounded-lg font-bold disabled:opacity-50"
                >
                  Criar
                </button>
              </div>

              <div className="space-y-2">
                {(categories ?? categoryOptions.map((n, idx) => ({ id: String(idx), name: n, locked: n === 'EPI' } as ItemCategory))).map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl">
                    <div className="min-w-0">
                      <div className="font-bold text-primary text-sm truncate">{cat.name}</div>
                      {cat.locked && <div className="text-[10px] text-slate-400 font-bold uppercase">Travada</div>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditCategory(cat)}
                        disabled={cat.locked}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-500 disabled:opacity-40"
                        title="Renomear"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCategory(cat)}
                        disabled={cat.locked}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500 disabled:opacity-40"
                        title="Excluir (não apaga itens)"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {editingCategory && (
              <div className="p-6 border-t bg-slate-50">
                <div className="text-xs font-bold uppercase text-slate-400 mb-2">Renomear categoria</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 p-3 bg-white border border-slate-200 rounded-lg outline-none text-sm"
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void saveEditCategory()}
                    disabled={isSubmitting || editingCategoryName.trim().length < 2}
                    className="px-4 py-2 bg-primary text-white rounded-lg font-bold disabled:opacity-50"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditingCategory(null); setEditingCategoryName(''); }}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-bold text-slate-500"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-xl border border-border shadow-sm flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por descrição..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Descrição do Material</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Consumível?</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Estoque</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Em Posse</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Total</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Mínimo</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Categoria</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2" size={20} />
                    Carregando inventário...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">Nenhum item encontrado.</td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isLowStock = p.quantity_current <= p.quantity_min;
                  const totalInPossession = p.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
                  const totalQuantity = p.quantity_current + totalInPossession;
                  
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-bold text-primary text-base">{p.description}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">{p.location || 'Sem local definido'} • {p.unit}</div>
                        {p.tag ? (
                          <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-1">
                            <Tag size={10} className="shrink-0 text-slate-400" />
                            {p.tag}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-xs text-center border-x border-slate-50">
                        <span className={`px-2 py-1 rounded-md font-bold text-[10px] uppercase tracking-tighter ${p.consumable ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}`}>
                          {p.consumable ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="px-6 py-4 bg-slate-50/30">
                        <div className="flex flex-col items-center">
                          <span className={`font-black text-sm ${isLowStock ? 'text-red-500' : 'text-primary'}`}>
                            {p.quantity_current}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {totalInPossession > 0 ? (
                          <div className="relative inline-block">
                            <button 
                              onClick={() => setActivePopover(activePopover === p.id ? null : p.id)}
                              className="flex items-center gap-1 mx-auto bg-slate-100 px-3 py-1 rounded-full text-primary font-bold hover:bg-slate-200 transition-colors text-xs"
                            >
                              <Users size={12} className="text-secondary" />
                              {totalInPossession}
                            </button>
                            
                            {activePopover === p.id && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-white border border-border rounded-xl shadow-xl z-30 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                <h4 className="text-[10px] font-bold uppercase text-slate-400 mb-2 border-b pb-1">Em posse de:</h4>
                                <div className="space-y-2">
                                  {p.possession?.map(pos => (
                                    <div key={pos.id} className="flex justify-between text-[10px]">
                                      <span className="text-slate-600 truncate mr-2">{possessionEmployeeName(pos.employees)}</span>
                                      <span className="font-bold text-primary">{pos.quantity}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px] font-bold">0</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center font-black text-primary text-sm bg-slate-50/30 transition-colors group-hover:bg-slate-100/50">{totalQuantity}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-slate-400 font-bold text-xs">{p.quantity_min}</span>
                          {isLowStock && <AlertCircle size={10} className="text-red-400 mt-1 animate-pulse" />}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter w-fit ${
                            p.category === 'Ferramenta' ? 'bg-blue-50 text-blue-600' :
                            p.category === 'EPI' ? 'bg-purple-50 text-purple-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {p.category}
                          </span>

                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <button 
                            onClick={() => {
                              setQuickMovementItem(p);
                              setQuickMovementMode('OUT');
                              setIsQuickMovementOpen(true);
                            }}
                            className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 font-bold text-xs flex items-center gap-1"
                            title="Saída Rápida"
                          >
                            <ArrowUpRight size={16} />
                            EXT
                          </button>
                          <button 
                            onClick={() => {
                              setQuickMovementItem(p);
                              setQuickMovementMode('IN');
                              setIsQuickMovementOpen(true);
                            }}
                            className="p-2 hover:bg-green-50 rounded-lg text-green-400 hover:text-green-600 font-bold text-xs flex items-center gap-1"
                            title="Entrada Rápida"
                          >
                            <ArrowDownLeft size={16} />
                            ENT
                          </button>
                          <button 
                            onClick={() => openHistory(p)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-secondary group/btn relative"
                            title="Histórico"
                          >
                            <History size={16} />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingItem(p);
                              setFormData({
                                description: p.description,
                                category: p.category,
                                location: p.location,
                                consumable: p.consumable || false,
                                unique_item: Boolean(p.unique_item),
                                quantity_current: p.quantity_current,
                                quantity_min: p.quantity_min,
                                unit: p.unit,
                                tag: p.tag ?? '',
                              });
                            }}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-500"
                            title="Editar"
                          >
                            <Edit size={16} />
                          </button>
                          <button 
                            onClick={() => handleDelete(p.id, p.description)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500"
                            title="Excluir"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Histórico do Item */}
      {historyItem && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">{historyItem.description}</h3>
                <p className="text-xs text-slate-500 font-mono mt-1 uppercase">Log de movimentações detalhado</p>
              </div>
              <button onClick={() => setHistoryItem(null)} className="p-2 hover:bg-slate-200 rounded-full">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {itemMovements.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 italic">Nenhuma movimentação registrada.</p>
                ) : (
                  itemMovements.map((move) => (
                    <div key={move.id} className="flex gap-4 items-start p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className={`mt-1 p-2 rounded-lg ${move.type === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {move.type === 'IN' ? <Plus size={16} /> : <Trash2 size={16} />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="font-bold text-primary">{move.employees?.full_name}</p>
                          <span className="text-[10px] bg-white px-2 py-1 rounded-md border text-slate-400 font-mono">
                            {new Date(move.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          {move.type === 'IN' ? 'Devolveu' : 'Retirou'} <span className="font-bold">{move.quantity}</span> {historyItem.unit}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cadastro/Edição */}
      {(isModalOpen || editingItem) && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50">
              <h2 className="text-xl font-bold text-primary">
                {editingItem ? 'Editar Material' : 'Novo Material'}
              </h2>
              <button 
                onClick={() => { setIsModalOpen(false); setEditingItem(null); }}
                className="p-1 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={editingItem ? handleEditSubmit : handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Unidade</label>
                  <select 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={formData.unit}
                    onChange={(e) => setFormData({...formData, unit: e.target.value})}
                  >
                    <option value="un">Unidade (un)</option>
                    <option value="par">Par</option>
                    <option value="m">Metros (m)</option>
                    <option value="kg">Quilos (kg)</option>
                    <option value="cx">Caixa (cx)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Descrição do Produto</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Nome detalhado do item..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>
                <div className="space-y-3 pt-6">
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="consumable-toggle"
                      className="w-5 h-5 accent-secondary rounded border-slate-300 cursor-pointer"
                      checked={formData.consumable}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          consumable: e.target.checked,
                          unique_item: e.target.checked ? false : formData.unique_item,
                        })
                      }
                    />
                    <label htmlFor="consumable-toggle" className="text-sm font-bold text-primary cursor-pointer">
                      Consumível?
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="unique-item-toggle"
                      className="w-5 h-5 accent-secondary rounded border-slate-300 cursor-pointer"
                      checked={Boolean(formData.unique_item)}
                      disabled={formData.consumable}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          unique_item: e.target.checked,
                          consumable: e.target.checked ? false : formData.consumable,
                        })
                      }
                    />
                    <label
                      htmlFor="unique-item-toggle"
                      className={`text-sm font-black cursor-pointer ${formData.consumable ? 'text-slate-300' : 'text-secondary'}`}
                      title="Quando marcado, a movimentação exige TAG e força quantidade 1."
                    >
                      Item único (exige TAG)
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Categoria</label>
                  <select 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  >
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Local de Armazenamento</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Prateleira A1"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-xs"
                    value={formData.location}
                    onChange={(e) => setFormData({...formData, location: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <Tag size={14} className="text-secondary" />
                  TAG (cadastro do item)
                </label>
                <input
                  type="text"
                  placeholder="Opcional: patrimônio, lote, código interno…"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-mono"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                />
                <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
                  Identificador fixo deste material no cadastro. Na retirada de item único, a TAG da movimentação continua
                  sendo informada no carrinho ou na saída rápida.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-secondary">Qtd. em Estoque</label>
                  <input 
                    type="number" 
                    disabled={!!editingItem}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold disabled:opacity-60"
                    value={formData.quantity_current === 0 ? '' : formData.quantity_current}
                    onChange={(e) => setFormData({...formData, quantity_current: Number(e.target.value)})}
                    onFocus={(e) => e.target.select()}
                  />
                  {editingItem && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!editingItem) return;
                        setAdjustItem(editingItem);
                        setAdjustQty(0);
                      }}
                      className="mt-2 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-black text-slate-600 hover:bg-slate-50"
                      title="Ajustar saldo com histórico"
                    >
                      Ajustar estoque (com histórico)
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-red-500">Alerta Mínimo</label>
                  <input 
                    type="number" 
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold"
                    value={formData.quantity_min === 0 ? '' : formData.quantity_min}
                    onChange={(e) => setFormData({...formData, quantity_min: Number(e.target.value)})}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => { setIsModalOpen(false); setEditingItem(null); }}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : (editingItem ? 'Salvar Edição' : 'Cadastrar Item')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCartOpen && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">Carrinho de retirada</h3>
                <p className="text-xs text-slate-500 mt-1">Retire varios itens de uma vez para o mesmo colaborador.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCartOpen(false)}
                className="p-2 hover:bg-slate-200 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2 mb-1">
                    <User size={14} className="text-secondary" />
                    Colaborador
                  </label>
                  <select
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                    value={cartEmployeeId}
                    onChange={(e) => setCartEmployeeId(e.target.value)}
                  >
                    <option value="">Selecione o colaborador...</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <select
                    className="md:col-span-6 p-3 bg-white border border-slate-200 rounded-lg outline-none font-medium"
                    value={cartPickItemId}
                    onChange={(e) => {
                      setCartPickItemId(e.target.value);
                      setCartPickTag('');
                      setCartPickQty(1);
                    }}
                  >
                    <option value="">Item para adicionar...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.quantity_current <= 0}>
                        {p.description} - saldo {p.quantity_current}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    disabled={Boolean(cartPickedItem?.unique_item)}
                    className="md:col-span-2 p-3 bg-white border border-slate-200 rounded-lg outline-none font-bold disabled:opacity-60"
                    value={cartPickedItem?.unique_item ? 1 : cartPickQty === 0 ? '' : cartPickQty}
                    onChange={(e) => setCartPickQty(Number(e.target.value))}
                  />
                  {cartPickedItem?.unique_item && (
                    <input
                      type="text"
                      placeholder="TAG obrigatoria"
                      className="md:col-span-3 p-3 bg-white border-2 border-secondary/50 rounded-lg outline-none font-black"
                      value={cartPickTag}
                      onChange={(e) => setCartPickTag(e.target.value)}
                    />
                  )}
                  <button
                    type="button"
                    onClick={addLineToCart}
                    className="md:col-span-1 p-3 bg-secondary text-white rounded-lg font-bold hover:opacity-95 flex items-center justify-center"
                    title="Adicionar ao carrinho"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {cart.length === 0 ? (
                  <div className="text-sm text-slate-400 italic p-6 text-center border border-dashed rounded-xl">
                    Carrinho vazio.
                  </div>
                ) : (
                  cart.map((line) => (
                    <div key={line.lineId} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-bold text-primary text-sm truncate">{line.description}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-2">
                          {line.unit}
                          {line.tag && (
                            <span className="inline-flex items-center gap-1 text-secondary">
                              <Tag size={10} />
                              {line.tag}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!line.unique_item && (
                          <button
                            type="button"
                            onClick={() => updateCartLineQty(line.lineId, -1)}
                            className="p-2 hover:bg-slate-100 rounded"
                          >
                            <Minus size={14} />
                          </button>
                        )}
                        <span className="font-black min-w-8 text-center">{line.quantity}</span>
                        {!line.unique_item && (
                          <button
                            type="button"
                            onClick={() => updateCartLineQty(line.lineId, 1)}
                            className="p-2 hover:bg-slate-100 rounded"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setCart((prev) => prev.filter((x) => x.lineId !== line.lineId))}
                          className="p-2 text-red-500 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
              <div className="text-sm font-bold text-slate-600">
                Itens: {cart.length} linhas / {cartTotalUnits} unidades
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-500 hover:bg-white"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || cart.length === 0 || !cartEmployeeId}
                  onClick={() => void processCartCheckout()}
                  className="px-4 py-2 bg-primary text-white rounded-lg font-bold disabled:opacity-50"
                >
                  {isSubmitting ? 'Processando...' : 'Confirmar retirada'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QuickMovementModal 
        isOpen={isQuickMovementOpen}
        item={quickMovementItem}
        initialMode={quickMovementMode}
        onClose={() => setIsQuickMovementOpen(false)}
        onComplete={() => {
          setIsQuickMovementOpen(false);
          fetchProducts();
        }}
      />

      {/* Modal Ajuste de Estoque */}
      {adjustItem && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">Ajustar estoque</h3>
                <p className="text-xs text-slate-500 mt-1">{adjustItem.description}</p>
              </div>
              <button
                type="button"
                onClick={() => { setAdjustItem(null); setAdjustQty(0); }}
                className="p-2 hover:bg-slate-200 rounded-full"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAdjustStock} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-slate-400">
                  Quantidade do ajuste (use positivo ou negativo)
                </label>
                <input
                  type="number"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-black text-lg"
                  value={adjustQty === 0 ? '' : adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="Ex.: 5 ou -2"
                />
                <div className="text-[11px] text-slate-500 font-bold">
                  Isso cria uma movimentação no histórico e atualiza o saldo.
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setAdjustItem(null); setAdjustQty(0); }}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || adjustQty === 0}
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmitting ? 'Salvando...' : 'Confirmar ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Carregando almoxarifado...</div>}>
      <InventoryContent />
    </Suspense>
  );
}
