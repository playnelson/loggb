'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay, normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { Plus, AlertCircle, X, FileUp, Users, History, Edit, Trash2, Loader2, ArrowUpRight, ArrowDownLeft, Tags, ShoppingCart, User, Minus, Tag, Download, MapPin, FilterX } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';
import QuickMovementModal from '@/components/QuickMovementModal';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { recordMovement, updatePossessionQuantity, updateSitePossessionQuantity, updateStock } from '@/lib/movements';
import { fetchTenantItems, isLikelyMissingColumn } from '@/lib/tenantItems';
import { downloadInventoryImportTemplate } from '@/lib/inventoryImportTemplate';
import { downloadInventoryWorkbookFromTemplate } from '@/lib/inventoryExportTemplate';
import { CatalogProductAutocomplete } from '@/components/CatalogProductAutocomplete';
import { formatEmployeeName, normalizeSearchText } from '@/lib/employeeName';

function possessionEmployeeName(
  employees: { full_name: string } | { full_name: string }[] | null | undefined
): string | undefined {
  if (!employees) return undefined;
  const fullName = Array.isArray(employees) ? employees[0]?.full_name : employees.full_name;
  return formatEmployeeName(fullName);
}

function movementCounterpartyLabel(move: {
  employees?: { full_name: string } | null;
  work_sites?: { name: string; kind: string } | { name: string; kind: string }[] | null;
}): string {
  const emp = move.employees && !Array.isArray(move.employees) ? move.employees.full_name : undefined;
  if (emp) return formatEmployeeName(emp);
  const ws = move.work_sites;
  const site = Array.isArray(ws) ? ws[0] : ws;
  if (site?.name) {
    const k = site.kind === 'sede' ? 'Sede' : 'Canteiro';
    return `${k}: ${site.name}`;
  }
  return 'Almoxarifado / ajuste';
}

interface PossessionDetail {
  id: string;
  quantity: number;
  employee_id?: string;
  employees?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
}

interface Product {
  id: string;
  code?: string | null;
  description: string;
  category: string;
  location: string;
  consumable: boolean;
  unique_item?: boolean;
  is_rented?: boolean;
  /** TAG / identificador fixo no cadastro do item */
  tag?: string | null;
  calibration_due_date?: string | null;
  expiration_date?: string | null;
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
const ITEMS_PAGE_SIZE = 30;

const emptyItemForm = () => ({
  description: '',
  category: 'Ferramenta',
  location: '',
  consumable: false,
  unique_item: false,
  is_rented: false,
  quantity_current: 0,
  quantity_min: 0,
  unit: 'un',
  tag: '',
  calibration_due_date: '',
  expiration_date: '',
});

function InventoryContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMoreProducts, setIsLoadingMoreProducts] = useState(false);
  const [nextProductsOffset, setNextProductsOffset] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [filterDescription, setFilterDescription] = useState('');
  const [filterConsumable, setFilterConsumable] = useState<'all' | 'sim' | 'nao'>('all');
  const [filterEstoque, setFilterEstoque] = useState<'all' | 'zero' | 'positive' | 'below_min'>('all');
  const [filterPosse, setFilterPosse] = useState<'all' | 'zero' | 'positive'>('all');
  const [filterTotal, setFilterTotal] = useState<'all' | 'zero' | 'positive'>('all');
  const [filterMinimo, setFilterMinimo] = useState<'all' | 'defined' | 'below_min'>('all');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCart, setFilterCart] = useState<'all' | 'in' | 'out'>('all');
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
  const [cartDestination, setCartDestination] = useState<'employee' | 'site'>('employee');
  const [cartWorkSiteId, setCartWorkSiteId] = useState('');
  const [workSites, setWorkSites] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [cartPickItemId, setCartPickItemId] = useState('');
  const [cartPickQty, setCartPickQty] = useState(1);
  const [cartPickTag, setCartPickTag] = useState('');
  const isFetchingProductsRef = useRef(false);
  const loadMoreAnchorRef = useRef<HTMLDivElement | null>(null);

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

  const fetchProducts = useCallback(async (options: { reset?: boolean } = {}) => {
    const { reset = true } = options;
    if (isFetchingProductsRef.current) return;
    if (!reset && (!hasMoreProducts || loading || isLoadingMoreProducts)) return;

    isFetchingProductsRef.current = true;
    try {
      if (reset) {
        setLoading(true);
        setHasMoreProducts(true);
        setNextProductsOffset(0);
      } else {
        setIsLoadingMoreProducts(true);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProducts([]);
        setHasMoreProducts(false);
        setNextProductsOffset(0);
        return;
      }

      const offset = reset ? 0 : nextProductsOffset;
      const { data, error } = await fetchTenantItems(supabase, user.id, {
        offset,
        limit: ITEMS_PAGE_SIZE,
      });

      if (error) {
        console.error('Error fetching products:', error);
        if (reset) {
          setProducts([]);
          setHasMoreProducts(false);
          setNextProductsOffset(0);
        }
        return;
      }

      const incoming = (data as Product[]) || [];
      setProducts((prev) => (reset ? incoming : [...prev, ...incoming]));
      setHasMoreProducts(incoming.length === ITEMS_PAGE_SIZE);
      setNextProductsOffset(offset + incoming.length);
    } finally {
      setIsLoadingMoreProducts(false);
      setLoading(false);
      isFetchingProductsRef.current = false;
    }
  }, [hasMoreProducts, isLoadingMoreProducts, loading, nextProductsOffset]);

  const fetchEmployees = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setEmployees([]);
      return;
    }
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, status')
      .eq('user_id', user.id)
      .order('full_name', { ascending: true });
    if (error) {
      console.error('Error fetching employees:', error);
      setEmployees([]);
      return;
    }
    const actives = (data || [])
      .filter((e: { id: string; full_name: string; status?: string }) => !e.status || e.status === 'Ativo')
      .map((e: { id: string; full_name: string }) => ({ id: e.id, full_name: formatEmployeeName(e.full_name) }));
    setEmployees(actives);
  };

  const fetchWorkSites = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setWorkSites([]);
      return;
    }
    const { data, error } = await supabase
      .from('work_sites')
      .select('id, name, kind')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) {
      console.warn('work_sites:', error);
      setWorkSites([]);
      return;
    }
    setWorkSites((data || []) as Array<{ id: string; name: string; kind: string }>);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchProducts();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchCategories();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchEmployees();
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchWorkSites();
  }, [fetchProducts, fetchWorkSites]);

  useEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor || !hasMoreProducts) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void fetchProducts({ reset: false });
      },
      { root: null, rootMargin: '0px 0px 280px 0px', threshold: 0.05 }
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [fetchProducts, hasMoreProducts]);

  useEffect(() => {
    // Mantém o carrinho sincronizado com os dados mais atuais dos itens editados.
    setCart((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        const current = products.find((p) => p.id === line.itemId);
        if (!current) return line;
        if (
          line.description === current.description &&
          line.unit === current.unit &&
          line.consumable === Boolean(current.consumable)
        ) {
          return line;
        }
        changed = true;
        return {
          ...line,
          description: current.description,
          unit: current.unit,
          consumable: Boolean(current.consumable),
        };
      });
      return changed ? next : prev;
    });
  }, [products]);

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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }
    // Update existing items to keep consistency (does NOT delete items).
    await supabase
      .from('items')
      .update({ category: nextName })
      .eq('category', prevName)
      .eq('user_id', user.id);

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
      .select('*, employees(full_name), work_sites(name, kind)')
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
    if (!confirm(`Tem certeza que deseja excluir "${name}"? Esta ação é irreversível.`)) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      return;
    }
    const { error } = await supabase.from('items').delete().eq('id', id).eq('user_id', user.id);
    if (error) alert('Erro ao excluir: ' + error.message);
    else fetchProducts();
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }

    const descNorm = normalizeProductLabelForSave(formData.description);
    const basePatch = {
      description: descNorm,
      category: formData.category,
      location: formData.location,
      consumable: formData.consumable,
      unique_item: formData.unique_item,
      is_rented: formData.is_rented,
      calibration_due_date: formData.calibration_due_date || null,
      expiration_date: formData.expiration_date || null,
      quantity_current: formData.quantity_current,
      quantity_min: formData.quantity_min,
      unit: formData.unit,
      code: itemCodeFromDescription(descNorm),
    };
    const tagVal = formData.tag.trim() || null;

    let patch: Record<string, unknown> = { ...basePatch, tag: tagVal };
    let error = (await supabase.from('items').update(patch).eq('id', editingItem.id).eq('user_id', user.id)).error;

    if (
      error?.message &&
      (
        isLikelyMissingColumn(error.message, 'tag') ||
        isLikelyMissingColumn(error.message, 'is_rented') ||
        isLikelyMissingColumn(error.message, 'calibration_due_date') ||
        isLikelyMissingColumn(error.message, 'expiration_date')
      )
    ) {
      const {
        tag: _t,
        is_rented: _r,
        calibration_due_date: _c,
        expiration_date: _e,
        ...legacy
      } = patch as Record<string, unknown> & {
        tag?: unknown;
        is_rented?: unknown;
        calibration_due_date?: unknown;
        expiration_date?: unknown;
      };
      patch = legacy;
      error = (await supabase.from('items').update(patch).eq('id', editingItem.id).eq('user_id', user.id)).error;
    }

    if (error) {
      alert('Erro ao atualizar: ' + error.message);
    } else {
      // Se virou consumível, removemos saldos de carteira/local para não manter
      // material "não consumível legado" em posse após a alteração de cadastro.
      if (!editingItem.consumable && formData.consumable) {
        const [employeePosDel, sitePosDel] = await Promise.all([
          supabase.from('possession').delete().eq('item_id', editingItem.id),
          supabase.from('site_possession').delete().eq('item_id', editingItem.id),
        ]);
        if (employeePosDel.error || sitePosDel.error) {
          const msg =
            employeePosDel.error?.message ||
            sitePosDel.error?.message ||
            'Falha ao limpar posse antiga.';
          alert(`Item atualizado, mas houve erro ao limpar carteiras antigas: ${msg}`);
        }
      }
      setEditingItem(null);
      fetchProducts();
    }
    setIsSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      setIsSubmitting(false);
      return;
    }

    const descNew = normalizeProductLabelForSave(formData.description);
    const finalData: Record<string, unknown> = {
      description: descNew,
      category: formData.category,
      location: formData.location,
      consumable: formData.consumable,
      unique_item: formData.unique_item,
      is_rented: formData.is_rented,
      calibration_due_date: formData.calibration_due_date || null,
      expiration_date: formData.expiration_date || null,
      quantity_current: formData.quantity_current,
      quantity_min: formData.quantity_min,
      unit: formData.unit,
      tag: formData.tag.trim() || null,
      code: itemCodeFromDescription(descNew),
      user_id: user.id,
    };

    let row: Record<string, unknown> = { ...finalData };
    let { error } = await supabase.from('items').insert([row]);
    if (
      error?.message &&
      (
        isLikelyMissingColumn(error.message, 'tag') ||
        isLikelyMissingColumn(error.message, 'is_rented') ||
        isLikelyMissingColumn(error.message, 'calibration_due_date') ||
        isLikelyMissingColumn(error.message, 'expiration_date')
      )
    ) {
      const {
        tag: _t,
        is_rented: _r,
        calibration_due_date: _c,
        expiration_date: _e,
        ...legacy
      } = row as Record<string, unknown> & {
        tag?: unknown;
        is_rented?: unknown;
        calibration_due_date?: unknown;
        expiration_date?: unknown;
      };
      row = legacy;
      ({ error } = await supabase.from('items').insert([row]));
    }

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

  const resetInventoryFilters = () => {
    setFilterDescription('');
    setFilterConsumable('all');
    setFilterEstoque('all');
    setFilterPosse('all');
    setFilterTotal('all');
    setFilterMinimo('all');
    setFilterCategory('');
    setFilterCart('all');
  };

  const filteredProducts = useMemo(() => {
    const q = normalizeSearchText(filterDescription);
    return products.filter((p) => {
      if (q && !normalizeSearchText(p.description).includes(q)) return false;
      if (filterConsumable === 'sim' && !p.consumable) return false;
      if (filterConsumable === 'nao' && p.consumable) return false;

      const posTotal = p.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
      const physTotal = p.quantity_current + posTotal;
      const belowMin = p.quantity_min > 0 && p.quantity_current < p.quantity_min;

      if (filterEstoque === 'zero' && p.quantity_current !== 0) return false;
      if (filterEstoque === 'positive' && p.quantity_current <= 0) return false;
      if (filterEstoque === 'below_min' && !belowMin) return false;

      if (filterPosse === 'zero' && posTotal !== 0) return false;
      if (filterPosse === 'positive' && posTotal <= 0) return false;

      if (filterTotal === 'zero' && physTotal !== 0) return false;
      if (filterTotal === 'positive' && physTotal <= 0) return false;

      if (filterMinimo === 'defined' && !(p.quantity_min > 0)) return false;
      if (filterMinimo === 'below_min' && !belowMin) return false;

      if (filterCategory && p.category !== filterCategory) return false;

      const inCart = cart.some((l) => l.itemId === p.id);
      if (filterCart === 'in' && !inCart) return false;
      if (filterCart === 'out' && inCart) return false;

      return true;
    });
  }, [
    products,
    filterDescription,
    filterConsumable,
    filterEstoque,
    filterPosse,
    filterTotal,
    filterMinimo,
    filterCategory,
    filterCart,
    cart,
  ]);

  const selectFilterClass =
    'w-full min-w-0 max-w-full text-[11px] font-bold text-primary bg-white border border-slate-200 rounded-md px-1.5 py-1.5 outline-none focus:ring-2 focus:ring-secondary/40';

  const handleDownloadInventory = async () => {
    if (products.length === 0) {
      alert('Não há itens para exportar.');
      return;
    }
    try {
      await downloadInventoryWorkbookFromTemplate(products);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao gerar planilha de inventário.';
      alert(message);
    }
  };

  const cartPickedItem = products.find((p) => p.id === cartPickItemId) || null;
  const cartTotalUnits = cart.reduce((acc, line) => acc + line.quantity, 0);

  const appendProductToCart = useCallback((product: Product, quantity: number, tag: string): boolean => {
    const isUnique = Boolean(product.unique_item);
    const qty = isUnique ? 1 : Math.max(1, Math.floor(Number(quantity || 1)));
    const t = tag.trim();

    if (isUnique && !t) {
      return false;
    }

    const inCartQty = cart
      .filter((l) => l.itemId === product.id)
      .reduce((s, l) => s + l.quantity, 0);
    if (qty + inCartQty > product.quantity_current) {
      alert('Quantidade no carrinho maior que o saldo atual do estoque.');
      return false;
    }

    if (isUnique) {
      const normalizedTag = t.toLowerCase();
      const duplicatedTag = cart.some(
        (l) => l.itemId === product.id && (l.tag || '').trim().toLowerCase() === normalizedTag
      );
      if (duplicatedTag) {
        alert('Essa TAG já está no carrinho.');
        return false;
      }
      setCart((prev) => [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          itemId: product.id,
          description: product.description,
          quantity: 1,
          unit: product.unit,
          consumable: product.consumable,
          unique_item: true,
          tag: t,
        },
      ]);
      return true;
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === product.id && !l.unique_item);
      if (idx === -1) {
        return [
          ...prev,
          {
            lineId: crypto.randomUUID(),
            itemId: product.id,
            description: product.description,
            quantity: qty,
            unit: product.unit,
            consumable: product.consumable,
            unique_item: false,
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
      return next;
    });
    return true;
  }, [cart]);

  const addItemToCartFromRow = useCallback(
    (product: Product) => {
      if (product.quantity_current <= 0) {
        alert('Sem saldo disponível no almoxarifado para retirada.');
        return;
      }
      if (product.unique_item) {
        setCartPickItemId(product.id);
        setCartPickQty(1);
        setCartPickTag('');
        void fetchWorkSites();
        setIsCartOpen(true);
        return;
      }
      appendProductToCart(product, 1, '');
    },
    [appendProductToCart, fetchWorkSites]
  );

  const addLineToCart = () => {
    if (!cartPickedItem) return;
    if (cartPickedItem.unique_item && !cartPickTag.trim()) {
      alert('Informe a TAG para item único.');
      return;
    }
    const qty = cartPickedItem.unique_item ? 1 : Math.max(1, Math.floor(Number(cartPickQty || 1)));
    const ok = appendProductToCart(cartPickedItem, qty, cartPickTag);
    if (!ok) return;
    setCartPickQty(1);
    setCartPickTag('');
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
    if (cartDestination === 'employee' && !cartEmployeeId) {
      alert('Selecione o colaborador.');
      return;
    }
    if (cartDestination === 'site' && !cartWorkSiteId) {
      alert('Selecione o canteiro ou sede de destino.');
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
      const currentItem = products.find((p) => p.id === line.itemId);
      const isConsumableNow = currentItem ? Boolean(currentItem.consumable) : line.consumable;
      const mvRes = await recordMovement(supabase, {
        item_id: line.itemId,
        employee_id: cartDestination === 'employee' ? cartEmployeeId : null,
        work_site_id: cartDestination === 'site' ? cartWorkSiteId : null,
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

      if (!isConsumableNow) {
        if (cartDestination === 'employee') {
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
        } else {
          const { data: currentSp } = await supabase
            .from('site_possession')
            .select('quantity')
            .eq('site_id', cartWorkSiteId)
            .eq('item_id', line.itemId)
            .maybeSingle();
          const cur = Number(currentSp?.quantity ?? 0);
          const spRes = await updateSitePossessionQuantity(
            supabase,
            cartWorkSiteId,
            line.itemId,
            cur + line.quantity,
            user.id
          );
          if (!spRes.ok) {
            alert(`Erro ao atualizar estoque no local (${line.description}): ${spRes.message}`);
            setIsSubmitting(false);
            return;
          }
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
        <div className="flex flex-col gap-2 w-full md:flex-row md:flex-nowrap md:w-auto md:gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchWorkSites();
              setIsCartOpen(true);
            }}
            className="relative flex w-full md:w-auto items-center justify-center gap-2 bg-secondary text-white px-3 py-3 md:px-4 md:py-2 rounded-lg hover:opacity-95 transition-all font-medium text-sm min-h-[48px]"
            title="Monte a retirada e depois escolha o colaborador"
          >
            <ShoppingCart size={18} />
            Carrinho
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-amber-400 text-amber-950 text-[11px] font-black rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                {cart.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadInventory()}
            disabled={loading || products.length === 0}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm disabled:opacity-50 min-h-[48px]"
            title="Baixa em XLSX usando o modelo do inventário com os dados atuais da sua conta"
          >
            <Download size={18} className="text-secondary shrink-0" />
            <span className="truncate">
              <span className="md:hidden">CSV</span>
              <span className="hidden md:inline">Baixar inventário</span>
            </span>
          </button>
          <button
            type="button"
            onClick={openCategoryManager}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm min-h-[48px]"
            title="Criar, editar e excluir categorias"
          >
            <Tags size={18} className="text-secondary shrink-0" />
            Categorias
          </button>
          <button
            type="button"
            onClick={() => downloadInventoryImportTemplate()}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-teal-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-teal-50 transition-all font-medium text-sm min-h-[48px]"
            title="Planilha .xlsx formatada com instruções e colunas reconhecidas pelo importador"
          >
            <Download size={18} className="text-teal-600 shrink-0" />
            <span className="truncate">
              <span className="md:hidden">Modelo</span>
              <span className="hidden md:inline">Modelo importação</span>
            </span>
          </button>
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-slate-100 text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-200 transition-all font-medium text-sm min-h-[48px]"
          >
            <FileUp size={18} className="text-secondary shrink-0" />
            Importar
          </button>
          <button 
            onClick={() => {
              setEditingItem(null);
              setFormData(emptyItemForm());
              setIsModalOpen(true);
            }}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-primary text-white px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-800 transition-all font-medium text-sm min-h-[48px]"
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

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="hidden md:flex px-4 py-2 border-b border-slate-100 flex-wrap items-center justify-between gap-2 bg-slate-50/80">
          <p className="text-[11px] font-bold text-slate-500">
            Filtros na primeira linha do cabeçalho da tabela abaixo.
            {!loading && products.length > 0 ? (
              <span className="text-slate-400 font-medium">
                {' '}
                · Mostrando {filteredProducts.length} de {products.length} itens carregados
              </span>
            ) : null}
          </p>
        </div>

        {/* Filtros compactos — celular (mesmos estados da tabela) */}
        <div className="md:hidden p-4 border-b border-slate-100 bg-slate-50/80 space-y-3">
          <p className="text-xs font-bold text-slate-600 leading-snug">
            Busque o material e refine com os filtros. Toque nos botões do card para saída, entrada ou carrinho.
          </p>
          {!loading && products.length > 0 ? (
            <p className="text-[11px] font-bold text-slate-400">
              Mostrando {filteredProducts.length} de {products.length} itens carregados
            </p>
          ) : null}
          <input
            type="text"
            value={filterDescription}
            onChange={(e) => setFilterDescription(e.target.value)}
            placeholder="Buscar por descrição…"
            className="w-full text-sm font-bold text-primary bg-white border border-slate-200 rounded-xl px-3 py-3 outline-none focus:ring-2 focus:ring-secondary/40 min-h-[48px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[10px] font-black uppercase text-slate-400">Consumível</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterConsumable}
              onChange={(e) => setFilterConsumable(e.target.value as 'all' | 'sim' | 'nao')}
            >
              <option value="all">Todos</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
            <label className="col-span-2 text-[10px] font-black uppercase text-slate-400">Estoque</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterEstoque}
              onChange={(e) =>
                setFilterEstoque(e.target.value as 'all' | 'zero' | 'positive' | 'below_min')
              }
            >
              <option value="all">Todos</option>
              <option value="zero">Zero</option>
              <option value="positive">Com saldo</option>
              <option value="below_min">Abaixo do mín.</option>
            </select>
            <label className="col-span-2 text-[10px] font-black uppercase text-slate-400">Em posse</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterPosse}
              onChange={(e) => setFilterPosse(e.target.value as 'all' | 'zero' | 'positive')}
            >
              <option value="all">Todos</option>
              <option value="zero">Zero</option>
              <option value="positive">Com posse</option>
            </select>
            <label className="col-span-2 text-[10px] font-black uppercase text-slate-400">Categoria</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="col-span-2 text-[10px] font-black uppercase text-slate-400">Carrinho</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterCart}
              onChange={(e) => setFilterCart(e.target.value as 'all' | 'in' | 'out')}
            >
              <option value="all">Todos</option>
              <option value="in">No carrinho</option>
              <option value="out">Fora</option>
            </select>
          </div>
          <button
            type="button"
            onClick={resetInventoryFilters}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 text-sm font-black uppercase tracking-tight text-slate-600 border border-slate-200 rounded-xl bg-white hover:bg-slate-50"
          >
            <FilterX size={16} />
            Limpar filtros
          </button>
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Descrição do Material</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Consumível?</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Estoque</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Em Posse</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Total</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Mínimo</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Categoria</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Carrinho</th>
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Ações</th>
              </tr>
              <tr className="border-b border-border bg-white [&_th]:align-top">
                <th className="px-4 pb-3 pt-0 font-normal">
                  <input
                    type="text"
                    value={filterDescription}
                    onChange={(e) => setFilterDescription(e.target.value)}
                    placeholder="Filtrar…"
                    className="w-full min-w-[140px] text-[11px] font-bold text-primary bg-white border border-slate-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-secondary/40 placeholder:font-medium placeholder:text-slate-400"
                  />
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterConsumable}
                    onChange={(e) => setFilterConsumable(e.target.value as 'all' | 'sim' | 'nao')}
                  >
                    <option value="all">Todos</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterEstoque}
                    onChange={(e) =>
                      setFilterEstoque(e.target.value as 'all' | 'zero' | 'positive' | 'below_min')
                    }
                  >
                    <option value="all">Todos</option>
                    <option value="zero">Zero</option>
                    <option value="positive">Com saldo</option>
                    <option value="below_min">Abaixo do mín.</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterPosse}
                    onChange={(e) => setFilterPosse(e.target.value as 'all' | 'zero' | 'positive')}
                  >
                    <option value="all">Todos</option>
                    <option value="zero">Zero</option>
                    <option value="positive">Com posse</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterTotal}
                    onChange={(e) => setFilterTotal(e.target.value as 'all' | 'zero' | 'positive')}
                  >
                    <option value="all">Todos</option>
                    <option value="zero">Total zero</option>
                    <option value="positive">Total &gt; 0</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterMinimo}
                    onChange={(e) => setFilterMinimo(e.target.value as 'all' | 'defined' | 'below_min')}
                  >
                    <option value="all">Todos</option>
                    <option value="defined">Com mínimo</option>
                    <option value="below_min">Abaixo do mín.</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-right">
                  <select
                    className={`${selectFilterClass}`}
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                  >
                    <option value="">Todas</option>
                    {categoryOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-center">
                  <select
                    className={`${selectFilterClass} text-center`}
                    value={filterCart}
                    onChange={(e) => setFilterCart(e.target.value as 'all' | 'in' | 'out')}
                  >
                    <option value="all">Todos</option>
                    <option value="in">No carrinho</option>
                    <option value="out">Fora</option>
                  </select>
                </th>
                <th className="px-4 pb-3 pt-0 font-normal text-right">
                  <button
                    type="button"
                    onClick={resetInventoryFilters}
                    className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-slate-600 hover:text-primary border border-slate-200 rounded-md px-2 py-1.5 bg-white hover:bg-slate-50"
                    title="Limpar todos os filtros"
                  >
                    <FilterX size={14} />
                    Limpar
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2" size={20} />
                    Carregando inventário...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">Nenhum item encontrado.</td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isLowStock = p.quantity_current <= p.quantity_min;
                  const totalInPossession = p.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
                  const totalQuantity = p.quantity_current + totalInPossession;
                  
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-bold text-primary text-base">{formatProductLabelDisplay(p.description)}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">{p.location || 'Sem local definido'} • {p.unit}</div>
                        {p.tag ? (
                          <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-1">
                            <Tag size={10} className="shrink-0 text-slate-400" />
                            {p.tag}
                          </div>
                        ) : null}
                        {p.is_rented ? (
                          <div className="mt-1 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">
                            Equipamento alugado
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
                      <td className="px-6 py-4 text-center border-x border-slate-50/80">
                        <button
                          type="button"
                          disabled={p.quantity_current <= 0}
                          onClick={() => addItemToCartFromRow(p)}
                          className="inline-flex items-center justify-center p-2.5 rounded-xl bg-teal-50 text-teal-700 border border-teal-200/80 hover:bg-teal-100 hover:border-teal-300 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                          title={
                            p.unique_item
                              ? 'Abre o carrinho para adicionar com TAG (item único)'
                              : 'Adicionar 1 unidade ao carrinho'
                          }
                        >
                          <ShoppingCart size={18} strokeWidth={2.25} />
                        </button>
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
                                is_rented: Boolean(p.is_rented),
                                quantity_current: p.quantity_current,
                                quantity_min: p.quantity_min,
                                unit: p.unit,
                                tag: p.tag ?? '',
                                calibration_due_date: p.calibration_due_date?.slice(0, 10) ?? '',
                                expiration_date: p.expiration_date?.slice(0, 10) ?? '',
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

        {/* Lista em cards — celular (mesmos dados e handlers da tabela) */}
        <div className="md:hidden p-4 space-y-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm">
              <Loader2 className="animate-spin mb-2" size={24} />
              Carregando inventário...
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center text-slate-400 py-12">Nenhum item encontrado.</p>
          ) : (
            filteredProducts.map((p) => {
              const isLowStock = p.quantity_current <= p.quantity_min;
              const totalInPossession = p.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
              const totalQuantity = p.quantity_current + totalInPossession;
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-border bg-white p-4 shadow-sm space-y-3"
                >
                  <div className="min-w-0">
                    <h3 className="font-bold text-primary text-base leading-snug">
                      {formatProductLabelDisplay(p.description)}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-bold mt-1 uppercase tracking-tight">
                      {p.location || 'Sem local'} · {p.unit}
                    </p>
                    {p.tag ? (
                      <p className="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-1">
                        <Tag size={12} className="shrink-0" />
                        {p.tag}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                          p.consumable ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {p.consumable ? 'Consumível' : 'Não consumível'}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                          p.category === 'Ferramenta'
                            ? 'bg-blue-50 text-blue-700'
                            : p.category === 'EPI'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-orange-50 text-orange-700'
                        }`}
                      >
                        {p.category}
                      </span>
                      {p.is_rented ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-amber-50 text-amber-700">
                          Alugado
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-black uppercase text-slate-400">Estoque</div>
                      <div
                        className={`text-lg font-black ${isLowStock ? 'text-red-500' : 'text-primary'}`}
                      >
                        {p.quantity_current}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-black uppercase text-slate-400">Posse</div>
                      <div className="text-lg font-black text-primary">{totalInPossession}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-black uppercase text-slate-400">Total</div>
                      <div className="text-lg font-black text-primary">{totalQuantity}</div>
                    </div>
                  </div>
                  {isLowStock ? (
                    <p className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} />
                      Abaixo ou no mínimo ({p.quantity_min})
                    </p>
                  ) : null}

                  {totalInPossession > 0 ? (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Em posse de</p>
                      <div className="space-y-1.5">
                        {p.possession?.map((pos) => (
                          <div key={pos.id} className="flex justify-between text-xs font-bold">
                            <span className="text-slate-600 truncate pr-2">
                              {possessionEmployeeName(pos.employees) || '—'}
                            </span>
                            <span className="text-primary shrink-0">{pos.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={p.quantity_current <= 0}
                      onClick={() => addItemToCartFromRow(p)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 font-bold text-sm disabled:opacity-35 disabled:pointer-events-none"
                    >
                      <ShoppingCart size={18} />
                      Carrinho
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMovementItem(p);
                        setQuickMovementMode('OUT');
                        setIsQuickMovementOpen(true);
                      }}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-red-50 text-red-700 border border-red-100 font-bold text-sm"
                    >
                      <ArrowUpRight size={18} />
                      Saída
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickMovementItem(p);
                        setQuickMovementMode('IN');
                        setIsQuickMovementOpen(true);
                      }}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-green-50 text-green-700 border border-green-100 font-bold text-sm"
                    >
                      <ArrowDownLeft size={18} />
                      Entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => openHistory(p)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-slate-700 border border-slate-200 font-bold text-sm"
                    >
                      <History size={18} />
                      Histórico
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(p);
                        setFormData({
                          description: p.description,
                          category: p.category,
                          location: p.location,
                          consumable: p.consumable || false,
                          unique_item: Boolean(p.unique_item),
                          is_rented: Boolean(p.is_rented),
                          quantity_current: p.quantity_current,
                          quantity_min: p.quantity_min,
                          unit: p.unit,
                          tag: p.tag ?? '',
                          calibration_due_date: p.calibration_due_date?.slice(0, 10) ?? '',
                          expiration_date: p.expiration_date?.slice(0, 10) ?? '',
                        });
                      }}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-blue-700 border border-slate-200 font-bold text-sm"
                    >
                      <Edit size={18} />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id, p.description)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-red-600 border border-slate-200 font-bold text-sm"
                    >
                      <Trash2 size={18} />
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!loading ? (
          <div className="px-4 pb-5 border-t border-slate-100 bg-slate-50/40">
            {isLoadingMoreProducts ? (
              <div className="py-4 text-center text-xs font-bold text-slate-500">
                <Loader2 className="animate-spin inline mr-2" size={14} />
                Carregando mais 30 itens...
              </div>
            ) : hasMoreProducts ? (
              <div
                ref={loadMoreAnchorRef}
                className="py-4 text-center text-xs font-bold text-slate-500"
              >
                Role at&eacute; o final para carregar mais itens.
              </div>
            ) : products.length > 0 ? (
              <div className="py-4 text-center text-xs font-bold text-slate-400">
                Todos os itens foram carregados.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Modal Histórico do Item */}
      {historyItem && (
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-primary">{formatProductLabelDisplay(historyItem.description)}</h3>
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
                          <p className="font-bold text-primary">{movementCounterpartyLabel(move)}</p>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-border flex items-center justify-between bg-slate-50 shrink-0">
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
            
            <form onSubmit={editingItem ? handleEditSubmit : handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
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
                <CatalogProductAutocomplete
                  label="Descrição do Produto"
                  value={formData.description}
                  onChange={(v) => setFormData({ ...formData, description: v })}
                  required
                />
                <div className="col-span-2 flex flex-wrap items-center gap-x-8 gap-y-3 pt-1">
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

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="rented-item-toggle"
                      className="w-5 h-5 accent-amber-500 rounded border-slate-300 cursor-pointer"
                      checked={Boolean(formData.is_rented)}
                      onChange={(e) => setFormData({ ...formData, is_rented: e.target.checked })}
                    />
                    <label
                      htmlFor="rented-item-toggle"
                      className="text-sm font-black cursor-pointer text-amber-700"
                      title="Marca que este item foi alugado pela empresa."
                    >
                      Item alugado
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Próxima aferição</label>
                  <input
                    type="date"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                    value={formData.calibration_due_date}
                    onChange={(e) => setFormData({ ...formData, calibration_due_date: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Validade</label>
                  <input
                    type="date"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm"
                    value={formData.expiration_date}
                    onChange={(e) => setFormData({ ...formData, expiration_date: e.target.value })}
                  />
                </div>
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
                <p className="text-xs text-slate-500 mt-1">
                  Some itens na grade; depois escolha se a saída é para um colaborador ou para um canteiro/sede e confirme.
                </p>
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
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase text-slate-400">Destino da saída</label>
                <div className="flex p-1 bg-slate-100 rounded-xl max-w-md">
                  <button
                    type="button"
                    onClick={() => setCartDestination('employee')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                      cartDestination === 'employee' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    <User size={16} />
                    Colaborador
                  </button>
                  <button
                    type="button"
                    onClick={() => setCartDestination('site')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold transition-all ${
                      cartDestination === 'site' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    <MapPin size={16} />
                    Canteiro / sede
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cartDestination === 'employee' ? (
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
                  ) : (
                    <div>
                      <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2 mb-1">
                        <MapPin size={14} className="text-secondary" />
                        Local
                      </label>
                      <select
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                        value={cartWorkSiteId}
                        onChange={(e) => setCartWorkSiteId(e.target.value)}
                      >
                        <option value="">Selecione o canteiro ou sede...</option>
                        {workSites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.kind === 'sede' ? 'Sede' : 'Canteiro'}: {s.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Cadastre locais em{' '}
                        <Link href="/sites" className="text-secondary font-bold underline underline-offset-2">
                          Sedes e canteiros
                        </Link>
                        .
                      </div>
                    </div>
                  )}
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
                        {formatProductLabelDisplay(p.description)} - saldo {p.quantity_current}
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
                        <div className="font-bold text-primary text-sm truncate">
                          {formatProductLabelDisplay(line.description)}
                        </div>
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
                  disabled={
                    isSubmitting ||
                    cart.length === 0 ||
                    (cartDestination === 'employee' && !cartEmployeeId) ||
                    (cartDestination === 'site' && !cartWorkSiteId)
                  }
                  onClick={() => void processCartCheckout()}
                  className="px-4 py-2 bg-primary text-white rounded-lg font-bold disabled:opacity-50"
                >
                  {isSubmitting
                    ? 'Processando...'
                    : cartDestination === 'site'
                      ? 'Confirmar envio ao local'
                      : 'Confirmar retirada'}
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
                <p className="text-xs text-slate-500 mt-1">{formatProductLabelDisplay(adjustItem.description)}</p>
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
