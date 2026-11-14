'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import AlmoxarifadoTabs, { itemInAlmox, useAlmoxSelection, useAlmoxarifados } from '@/components/AlmoxarifadoTabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatProductLabelDisplay, normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { Plus, AlertCircle, X, FileUp, Users, History, Edit, Trash2, Loader2, ArrowUpRight, ArrowDownLeft, Tags, ShoppingCart, User, Minus, Tag, Download, MapPin, FilterX, Printer, QrCode, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import ImportSpreadsheet from '@/components/ImportSpreadsheet';
import QuickMovementModal from '@/components/QuickMovementModal';
import { itemCodeFromDescription } from '@/lib/itemCode';
import {
  registerMovement,
  formatQty,
  parseQty,
  movementReasonOf,
  MOVEMENT_REASON_LABEL,
  MOVEMENT_DOCUMENT_MAX,
  MOVEMENT_NOTE_MAX,
  newBatchId,
  receiptNumber,
} from '@/lib/movements';
import { openPrintable, buildReceiptHtml, loadCompanyInfo, buildQrLabelsHtml } from '@/lib/printDocs';
import { fetchAllTenantItems, isLikelyMissingColumn } from '@/lib/tenantItems';
import { downloadInventoryImportTemplate } from '@/lib/inventoryImportTemplate';
import { downloadInventoryWorkbookFromTemplate } from '@/lib/inventoryExportTemplate';
import { SuggestInput } from '@/components/SuggestInput';
import { PhotoField, PhotoThumb } from '@/components/PhotoThumb';
import { TagPlate } from '@/components/TagPlate';
import { compareSizes, sizeLabel, sizeRange, splitSize, type ItemSize } from '@/lib/itemSizes';
import { ITEM_PHOTOS_BUCKET, signedPhotoUrls, uploadPhoto } from '@/lib/photos';
import { formatEmployeeName, normalizeSearchText } from '@/lib/employeeName';
import { useWorkspace } from '@/lib/workspace';
import { useCanApproveDeletion } from '@/lib/deletion';
import DeletionDialog from '@/components/DeletionDialog';

function possessionEmployeeName(
  employees: { full_name: string } | { full_name: string }[] | null | undefined
): string | undefined {
  if (!employees) return undefined;
  const fullName = Array.isArray(employees) ? employees[0]?.full_name : employees.full_name;
  return formatEmployeeName(fullName);
}

function possessionTotalForProduct(product: Product): number {
  if (product.consumable) return 0;
  return product.possession?.reduce((acc, curr) => acc + curr.quantity, 0) || 0;
}

function sitePossessionTotal(product: Product): number {
  return (
    product.site_possession?.reduce((acc, curr) => acc + Number(curr.quantity || 0), 0) || 0
  );
}

function sitePossessionLabel(
  workSites: SitePossessionDetail['work_sites']
): string | undefined {
  if (!workSites) return undefined;
  const ws = Array.isArray(workSites) ? workSites[0] : workSites;
  if (!ws?.name) return undefined;
  const kind = ws.kind === 'sede' ? 'Sede' : 'Canteiro';
  return `${kind}: ${ws.name}`;
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

interface SitePossessionDetail {
  quantity: number;
  site_id?: string;
  work_sites?: { id: string; name: string; kind: string } | { id: string; name: string; kind: string }[] | null;
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
  /** Foto do item (pasta privada item-photos). */
  photo_path?: string | null;
  calibration_due_date?: string | null;
  expiration_date?: string | null;
  /** Nº do Certificado de Aprovação (EPI). */
  ca_number?: string | null;
  quantity_current: number;
  quantity_min: number;
  unit: string;
  updated_at?: string;
  /** Preenchido quando o item foi arquivado (sai da lista, mantém o histórico). */
  archived_at?: string | null;
  possession?: PossessionDetail[];
  site_possession?: SitePossessionDetail[];
}

type ListEntry =
  | { kind: 'item'; p: Product; nested: boolean }
  | { kind: 'group'; key: string; items: Product[]; open: boolean; sizes: ItemSize[] | null; title: string };

/** Texto da plaquinha do item: a TAG cadastrada ou, em botas e fardamentos, o tamanho. */
function plateText(p: { tag?: string | null; description: string }): string {
  const tag = p.tag?.trim();
  if (tag) return tag;
  const s = splitSize(p.description);
  return s ? sizeLabel(s) : '';
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

interface ItemMovement {
  id: string;
  type: 'IN' | 'OUT' | string;
  reason?: string | null;
  tag?: string | null;
  note?: string | null;
  document?: string | null;
  employee_id?: string | null;
  work_site_id?: string | null;
  quantity: number;
  created_at: string;
  employees?: { full_name: string } | null;
  work_sites?: { name: string; kind: string } | { name: string; kind: string }[] | null;
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
  /** EPI: o CA é informado na entrega (mesmo item pode ter CAs diferentes). */
  epi?: boolean;
  ca?: string;
}

const isEpiCategory = (c: string | null | undefined) => String(c ?? '').trim().toUpperCase().startsWith('EPI');

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
  ca_number: '',
});

function InventoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Item aberto pelo QR da etiqueta (?item=<id>): a lista mostra só ele. */
  const focusItemId = searchParams.get('item');
  const { can, canManageCategory, managesAnyArea, currentWorkspace } = useWorkspace();
  /** caminho da foto -> link temporário */
  const [itemPhotos, setItemPhotos] = useState<Record<string, string>>({});
  const [itemPhotoFile, setItemPhotoFile] = useState<File | null>(null);
  const [dropItemPhoto, setDropItemPhoto] = useState(false);
  /** Almoxarifados (por categoria) que a pessoa enxerga e o escolhido nas abas. */
  const almox = useAlmoxarifados();
  const [almoxSel, setAlmoxSel] = useAlmoxSelection(almox.list);
  const almoxArea = almox.list.find((a) => a.id === almoxSel) ?? null;
  const approver = useCanApproveDeletion();
  const canCategories = can('cadastros');
  /** Excluir: quem aprova exclui na hora; os outros pedem (página Aprovações). */
  const [deleting, setDeleting] = useState<{ product: Product; note: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExportingInventory, setIsExportingInventory] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Quantos itens filtrados estão renderizados (a lista cresce ao rolar). Reinicia quando o filtro muda. */
  const [visibleState, setVisibleState] = useState<{ key: string; count: number }>({ key: '', count: ITEMS_PAGE_SIZE });
  const [filterArchived, setFilterArchived] = useState<'active' | 'archived'>('active');
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
  /** Nomes já cadastrados (sugestão no cadastro; evita o mesmo item com dois nomes). */
  const existingItemNames = useMemo(
    () => [...new Set(products.filter((p) => p.id !== editingItem?.id).map((p) => p.description).filter(Boolean))],
    [products, editingItem]
  );
  const [historyItem, setHistoryItem] = useState<Product | null>(null);
  const [itemMovements, setItemMovements] = useState<ItemMovement[]>([]);
  const [activePopover, setActivePopover] = useState<string | null>(null);
  /** Grupos de itens com tag (mesma descrição) abertos na lista. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
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
  const [cartDocument, setCartDocument] = useState('');
  const [cartNote, setCartNote] = useState('');
  /** Retirada recém-gravada: mostra a confirmação com o botão de recibo. */
  const [lastReceipt, setLastReceipt] = useState<{ batchId: string; lines: number; destination: string } | null>(null);
  const hasBootstrappedRef = useRef(false);
  const productsReqIdRef = useRef(0);
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

    // Categorias padrão só na primeira vez (lista vazia). Depois disso, a categoria que o
    // usuário apagou não volta sozinha — só a EPI (travada) é garantida.
    const existingLower = new Set(list.map((c) => c.name.trim().toLowerCase()));
    const missingDefaults = FALLBACK_CATEGORIES.filter(
      (n) => !existingLower.has(n.toLowerCase()) && (list.length === 0 || n === 'EPI')
    );
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

  /**
   * Carrega TODOS os itens da conta (inclusive arquivados) em páginas de 500.
   * Busca e filtros rodam sobre a lista inteira — antes só valiam para os itens já carregados na rolagem.
   * A tela renderiza aos poucos (visibleCount) para continuar leve.
   */
  const fetchProducts = useCallback(async () => {
    const reqId = ++productsReqIdRef.current;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (reqId === productsReqIdRef.current) setProducts([]);
        return;
      }
      const all = (await fetchAllTenantItems(supabase, user.id, { includeArchived: true })) as Product[];
      if (reqId !== productsReqIdRef.current) return; // resposta antiga: ignora
      // Quantidades são numeric no banco: garante número no front (somas e comparações).
      setProducts(
        all.map((p) => ({
          ...p,
          quantity_current: Number(p.quantity_current ?? 0),
          quantity_min: Number(p.quantity_min ?? 0),
          possession: p.possession?.map((pos) => ({ ...pos, quantity: Number(pos.quantity ?? 0) })),
          site_possession: p.site_possession?.map((sp) => ({ ...sp, quantity: Number(sp.quantity ?? 0) })),
        }))
      );
      setLoadError(null);
      const photoPaths = all.map((p) => p.photo_path).filter((x): x is string => !!x);
      void signedPhotoUrls(supabase, ITEM_PHOTOS_BUCKET, photoPaths).then((urls) => {
        if (reqId === productsReqIdRef.current) setItemPhotos(urls);
      });
    } catch (error) {
      console.error('Error fetching products:', error);
      if (reqId === productsReqIdRef.current) {
        const msg = (error as { message?: unknown } | null)?.message;
        setLoadError(typeof msg === 'string' && msg ? msg : 'Falha ao carregar o inventário.');
      }
    } finally {
      if (reqId === productsReqIdRef.current) setLoading(false);
    }
  }, []);

  const fetchEmployees = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setEmployees([]);
      return;
    }
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
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) {
      console.warn('work_sites:', error);
      setWorkSites([]);
      return;
    }
    setWorkSites((data || []) as Array<{ id: string; name: string; kind: string }>);
  }, []);

  // Cada vez que o cadastro abre ou fecha, começa sem foto nova escolhida.
  useEffect(() => {
    setItemPhotoFile(null);
    setDropItemPhoto(false);
  }, [isModalOpen, editingItem?.id]);

  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    queueMicrotask(() => {
      void fetchProducts();
      void fetchCategories();
      void fetchEmployees();
      void fetchWorkSites();
    });
  }, [fetchCategories, fetchEmployees, fetchProducts, fetchWorkSites]);

  const syncCartWithProducts = useCallback((lines: CartLine[], currentProducts: Product[]) => {
    if (lines.length === 0 || currentProducts.length === 0) return lines;

    const productsById = new Map(currentProducts.map((p) => [p.id, p]));
    let changed = false;
    const next = lines.map((line) => {
      const current = productsById.get(line.itemId);
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
    return changed ? next : lines;
  }, []);

  useEffect(() => {
    // Mantém o carrinho sincronizado com os dados mais atuais dos itens editados.
    queueMicrotask(() => {
      setCart((prev) => syncCartWithProducts(prev, products));
    });
  }, [products, syncCartWithProducts]);

  const categoryNames = categories?.map((c) => c.name) ?? [...FALLBACK_CATEGORIES];
  const categoryOptions = Array.from(
    new Set([...(categoryNames || []), ...products.map((p) => p.category).filter(Boolean)])
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const openCategoryManager = () => {
    setIsCategoriesOpen(true);
    setNewCategoryName('');
    setEditingCategory(null);
    setEditingCategoryName('');
    void fetchCategories();
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
      .eq('category', prevName);

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
    setItemMovements([]);
    const { data } = await supabase
      .from('movements')
      .select('*, employees(full_name), work_sites(name, kind)')
      .eq('item_id', item.id)
      .order('created_at', { ascending: false })
      .limit(100);
    setItemMovements((data || []) as ItemMovement[]);
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustItem) return;
    const qty = parseQty(adjustQty || 0);
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

    // Ajuste: histórico + saldo numa única transação.
    const res = await registerMovement(supabase, {
      item_id: adjustItem.id,
      quantity: abs,
      type,
      reason: 'ajuste',
      stock_delta: qty,
    });
    if (!res.ok) {
      alert(`Erro ao registrar ajuste: ${res.message}`);
      setIsSubmitting(false);
      return;
    }

    setAdjustItem(null);
    setAdjustQty(0);
    void fetchProducts();
    setIsSubmitting(false);
  };

  /**
   * Remover item:
   * - sem movimentações nem aluguéis → apaga de vez (cadastro feito por engano);
   * - com histórico → ARQUIVA (sai da lista, não movimenta, mas o histórico fica guardado).
   * Bloqueia se ainda houver material com colaboradores ou em canteiros/sedes.
   */
  const handleDelete = async (p: Product) => {
    const name = formatProductLabelDisplay(p.description);
    const withEmployees = (p.possession || []).reduce((s, pos) => s + Number(pos.quantity || 0), 0);
    const atSites = sitePossessionTotal(p);
    if (withEmployees > 0 || atSites > 0) {
      const parts = [
        withEmployees > 0 ? `${formatQty(withEmployees)} ${p.unit} com colaboradores` : '',
        atSites > 0 ? `${formatQty(atSites)} ${p.unit} em canteiros/sedes` : '',
      ].filter(Boolean);
      alert(`Não é possível remover "${name}": ainda há ${parts.join(' e ')}. Registre a devolução antes.`);
      return;
    }

    const [movRes, rentRes] = await Promise.all([
      supabase.from('movements').select('id', { count: 'exact', head: true }).eq('item_id', p.id),
      supabase.from('equipment_rentals').select('id', { count: 'exact', head: true }).eq('item_id', p.id),
    ]);
    if (movRes.error) {
      alert(`Erro ao verificar o histórico do item: ${movRes.error.message}`);
      return;
    }
    const movCount = movRes.count ?? 0;
    const rentCount = rentRes.error ? 0 : rentRes.count ?? 0;
    const stockWarn =
      Number(p.quantity_current) > 0
        ? ` Ainda há ${formatQty(p.quantity_current)} ${p.unit} em estoque; se o material não existe mais, faça um ajuste antes.`
        : '';
    const note =
      movCount === 0 && rentCount === 0
        ? `O item não tem nenhuma movimentação, então será apagado de vez.${stockWarn}`
        : `O item tem ${movCount} movimentação(ões) no histórico, então será ARQUIVADO em vez de apagado: sai da lista e não pode mais ser movimentado, mas o histórico continua guardado (filtro "Arquivados").${stockWarn}`;
    setDeleting({ product: p, note });
  };

  const handleRestore = async (p: Product) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Usuário não autenticado.');
      return;
    }
    const { error } = await supabase
      .from('items')
      .update({ archived_at: null })
      .eq('id', p.id);
    if (error) alert('Erro ao reativar: ' + error.message);
    else void fetchProducts();
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

    // Virar consumível apaga as carteiras/saldos em locais deste item — confirmar antes.
    if (!editingItem.consumable && formData.consumable) {
      const withEmployees = (editingItem.possession || []).reduce((s, pos) => s + Number(pos.quantity || 0), 0);
      const atSites = sitePossessionTotal(editingItem);
      if (
        (withEmployees > 0 || atSites > 0) &&
        !confirm(
          `Ao marcar como consumível, os saldos em posse (${formatQty(withEmployees)} com colaboradores` +
            `${atSites > 0 ? `, ${formatQty(atSites)} em locais` : ''}) deixam de ser controlados e serão zerados. Continuar?`
        )
      ) {
        setIsSubmitting(false);
        return;
      }
    }

    const descNorm = normalizeProductLabelForSave(formData.description);
    // O saldo (quantity_current) NÃO é enviado aqui: ele só muda por movimentação/ajuste,
    // para o histórico sempre bater e para não sobrescrever uma baixa feita enquanto o formulário estava aberto.
    const basePatch = {
      description: descNorm,
      category: formData.category,
      location: formData.location,
      consumable: formData.consumable,
      unique_item: formData.unique_item,
      is_rented: formData.is_rented,
      calibration_due_date: formData.calibration_due_date || null,
      expiration_date: formData.expiration_date || null,
      quantity_min: parseQty(formData.quantity_min),
      unit: formData.unit,
      ca_number: formData.ca_number.trim() || null,
      code: itemCodeFromDescription(descNorm, formData.unique_item ? formData.tag : null),
    };
    const tagVal = formData.tag.trim() || null;

    let patch: Record<string, unknown> = { ...basePatch, tag: tagVal };
    let error = (await supabase.from('items').update(patch).eq('id', editingItem.id)).error;

    if (
      error?.message &&
      (
        isLikelyMissingColumn(error.message, 'tag') ||
        isLikelyMissingColumn(error.message, 'is_rented') ||
        isLikelyMissingColumn(error.message, 'calibration_due_date') ||
        isLikelyMissingColumn(error.message, 'expiration_date')
      )
    ) {
      const legacy = { ...patch } as Record<string, unknown>;
      delete legacy.tag;
      delete legacy.is_rented;
      delete legacy.calibration_due_date;
      delete legacy.expiration_date;
      patch = legacy;
      error = (await supabase.from('items').update(patch).eq('id', editingItem.id)).error;
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
      const photoErr = await saveItemPhoto(editingItem.id, editingItem.photo_path ?? null);
      if (photoErr) alert(`Item atualizado, mas a foto não foi salva: ${photoErr}`);
      setEditingItem(null);
      fetchProducts();
    }
    setIsSubmitting(false);
  };

  const pickItemPhoto = useCallback((f: File) => {
    setItemPhotoFile(f);
    setDropItemPhoto(false);
  }, []);

  /** Envia a foto nova (ou remove a antiga) depois de salvar o item. Devolve a mensagem de erro, se houver. */
  const saveItemPhoto = async (itemId: string, oldPath: string | null): Promise<string | null> => {
    if (!itemPhotoFile && !dropItemPhoto) return null;
    let newPath: string | null = null;
    if (itemPhotoFile) {
      if (!currentWorkspace?.id) return 'obra não identificada.';
      const up = await uploadPhoto(supabase, ITEM_PHOTOS_BUCKET, currentWorkspace.id, 'itens', itemId, itemPhotoFile);
      if ('error' in up) return up.error;
      newPath = up.path;
    }
    const { error } = await supabase.from('items').update({ photo_path: newPath }).eq('id', itemId);
    if (error) {
      if (newPath) await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([newPath]);
      return error.message;
    }
    if (oldPath) await supabase.storage.from(ITEM_PHOTOS_BUCKET).remove([oldPath]);
    setItemPhotoFile(null);
    setDropItemPhoto(false);
    return null;
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
    const code = itemCodeFromDescription(descNew, formData.unique_item ? formData.tag : null);
    const initialQty = parseQty(formData.quantity_current);
    if (initialQty < 0) {
      alert('O saldo inicial não pode ser negativo.');
      setIsSubmitting(false);
      return;
    }

    // O item nasce com saldo 0; o saldo inicial entra como movimentação ("Saldo inicial"),
    // para o histórico explicar o saldo desde o primeiro dia.
    const row: Record<string, unknown> = {
      description: descNew,
      category: formData.category,
      location: formData.location,
      consumable: formData.consumable,
      unique_item: formData.unique_item,
      is_rented: formData.is_rented,
      calibration_due_date: formData.calibration_due_date || null,
      expiration_date: formData.expiration_date || null,
      quantity_current: 0,
      quantity_min: parseQty(formData.quantity_min),
      unit: formData.unit,
      tag: formData.tag.trim() || null,
      ca_number: formData.ca_number.trim() || null,
      code,
      user_id: user.id,
    };

    const { data: created, error } = await supabase.from('items').insert([row]).select('id').single();

    if (error) {
      // Mesma descrição de um item já cadastrado (código único por conta).
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('items')
          .select('id, archived_at')
          .eq('code', code)
          .maybeSingle();
        if (existing?.archived_at) {
          if (confirm('Já existe um item ARQUIVADO com esta descrição. Deseja reativá-lo em vez de criar outro?')) {
            const { error: restoreErr } = await supabase
              .from('items')
              .update({ archived_at: null })
              .eq('id', existing.id);
            if (restoreErr) alert('Erro ao reativar: ' + restoreErr.message);
            else {
              setIsModalOpen(false);
              setFormData(emptyItemForm());
              void fetchProducts();
            }
          }
        } else {
          alert('Já existe um item com esta descrição. Procure-o na lista ou use outra descrição.');
        }
      } else {
        console.error('Error adding item:', error);
        alert(`Erro ao cadastrar item: ${error.message}`);
      }
      setIsSubmitting(false);
      return;
    }

    if (initialQty > 0 && created?.id) {
      const res = await registerMovement(supabase, {
        item_id: String(created.id),
        type: 'IN',
        reason: 'saldo_inicial',
        quantity: initialQty,
        stock_delta: initialQty,
      });
      if (!res.ok) {
        alert(
          `O item foi cadastrado, mas o saldo inicial não foi registrado: ${res.message}\n` +
            'Use "Ajustar estoque" no item para lançar o saldo.'
        );
      }
    }

    if (created?.id) {
      const photoErr = await saveItemPhoto(String(created.id), null);
      if (photoErr) alert(`Item cadastrado, mas a foto não foi salva: ${photoErr}`);
    }

    setIsModalOpen(false);
    setFormData(emptyItemForm());
    void fetchProducts();
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
    setFilterArchived('active');
  };

  const activeProductsCount = useMemo(() => products.filter((p) => !p.archived_at).length, [products]);
  const archivedProductsCount = products.length - activeProductsCount;

  /** Itens ativos em cada aba de almoxarifado. */
  const almoxCounts = useMemo(() => {
    const active = products.filter((p) => !p.archived_at);
    const out: Record<string, number> = { todos: active.length };
    for (const a of almox.list) out[a.id] = active.filter((p) => itemInAlmox(p.category, a.id, almox.list)).length;
    out.outros = active.filter((p) => itemInAlmox(p.category, 'outros', almox.list)).length;
    return out;
  }, [products, almox.list]);

  const filteredProducts = useMemo(() => {
    const q = normalizeSearchText(filterDescription);
    if (focusItemId) return products.filter((p) => p.id === focusItemId);
    return products.filter((p) => {
      if (!itemInAlmox(p.category, almoxSel, almox.list)) return false;
      if (filterArchived === 'active' ? p.archived_at : !p.archived_at) return false;
      if (
        q &&
        !normalizeSearchText(p.description).includes(q) &&
        !normalizeSearchText(p.tag || '').includes(q) &&
        !normalizeSearchText(p.location || '').includes(q)
      ) {
        return false;
      }
      if (filterConsumable === 'sim' && !p.consumable) return false;
      if (filterConsumable === 'nao' && p.consumable) return false;

      const posTotal = possessionTotalForProduct(p);
      const physTotal = p.quantity_current + posTotal + sitePossessionTotal(p);
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
    filterArchived,
    filterDescription,
    filterConsumable,
    filterEstoque,
    filterPosse,
    filterTotal,
    filterMinimo,
    filterCategory,
    filterCart,
    cart,
    focusItemId,
    almoxSel,
    almox.list,
  ]);

  // Renderização progressiva: mostra 30 itens filtrados e acrescenta mais 30 ao chegar no fim da lista.
  const filterKey = [
    almoxSel,
    focusItemId || '',
    filterArchived,
    filterDescription,
    filterConsumable,
    filterEstoque,
    filterPosse,
    filterTotal,
    filterMinimo,
    filterCategory,
    filterCart,
  ].join('|');
  const visibleCount = visibleState.key === filterKey ? visibleState.count : ITEMS_PAGE_SIZE;
  /*
    Itens com tag (únicos) que têm a mesma descrição viram um grupo:
    uma linha com o total ("12 unidades") e, ao abrir, uma linha por tag.
  */
  const listEntries = useMemo(() => {
    const keyOf = (p: Product): string | null => {
      if (p.unique_item) return `u:${normalizeSearchText(p.description)}`;
      const s = splitSize(p.description);
      return s ? `s:${normalizeSearchText(s.base)}` : null;
    };
    const groups = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const k = keyOf(p);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(p);
      else groups.set(k, [p]);
    }
    const q = normalizeSearchText(filterDescription);
    const out: ListEntry[] = [];
    const done = new Set<string>();
    for (const p of filteredProducts) {
      const k = keyOf(p);
      const g = k ? groups.get(k) : undefined;
      if (!g || g.length < 2) {
        out.push({ kind: 'item', p, nested: false });
        continue;
      }
      if (!k || done.has(k)) continue;
      done.add(k);
      // Abre sozinho quando a busca é por uma tag (e não pela descrição).
      const byTag =
        !!q && !normalizeSearchText(p.description).includes(q) && g.some((x) => normalizeSearchText(x.tag || '').includes(q));
      const open = openGroups.has(k) || byTag || !!focusItemId;
      const sized = k.startsWith('s:');
      const items = sized
        ? [...g].sort((a, b) => compareSizes(splitSize(a.description), splitSize(b.description)))
        : g;
      const sizes = sized ? items.map((x) => splitSize(x.description)).filter((x): x is ItemSize => !!x) : null;
      const title = sized ? (sizes?.[0]?.base ?? p.description) : p.description;
      out.push({ kind: 'group', key: k, items, open, sizes, title });
      if (open) for (const x of items) out.push({ kind: 'item', p: x, nested: true });
    }
    return out;
  }, [filteredProducts, filterDescription, openGroups, focusItemId]);
  const visibleEntries = listEntries.slice(0, visibleCount);
  const hasMoreToShow = listEntries.length > visibleCount;

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groupSummary = (items: Product[]) => {
    let estoque = 0;
    let posse = 0;
    let locais = 0;
    for (const x of items) {
      estoque += Number(x.quantity_current) || 0;
      posse += possessionTotalForProduct(x);
      locais += sitePossessionTotal(x);
    }
    return { estoque, posse, locais, total: estoque + posse + locais };
  };

  /** Primeira foto do grupo (para a linha do grupo). */
  const groupPhoto = (items: Product[]) => {
    const withPhoto = items.find((x) => x.photo_path && itemPhotos[x.photo_path]);
    return withPhoto?.photo_path ? itemPhotos[withPhoto.photo_path] : undefined;
  };

  const groupChips = (items: Product[]) => {
    const g = groupSummary(items);
    return (
      <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-tight">
        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">{formatQty(g.estoque)} no estoque</span>
        {g.posse > 0 ? <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-800">{formatQty(g.posse)} com colaboradores</span> : null}
        {g.locais > 0 ? <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800">{formatQty(g.locais)} em locais</span> : null}
      </div>
    );
  };

  useEffect(() => {
    const anchor = loadMoreAnchorRef.current;
    if (!anchor || !hasMoreToShow) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleState((prev) => ({
          key: filterKey,
          count: (prev.key === filterKey ? prev.count : ITEMS_PAGE_SIZE) + ITEMS_PAGE_SIZE,
        }));
      },
      { root: null, rootMargin: '0px 0px 280px 0px', threshold: 0.05 }
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [filterKey, hasMoreToShow, visibleCount]);

  const selectFilterClass =
    'w-full min-w-0 max-w-full text-[11px] font-bold text-primary bg-white border border-slate-200 rounded-md px-1.5 py-1.5 outline-none focus:ring-2 focus:ring-secondary/40';

  const handlePrintQrLabels = () => {
    const list = filteredProducts.filter((p) => !p.archived_at);
    if (list.length === 0) {
      alert('Nenhum item ativo na lista filtrada.');
      return;
    }
    if (list.length > 300 && !window.confirm(`Gerar ${list.length} etiquetas? Use os filtros para imprimir menos.`)) return;
    const origin = window.location.origin;
    void openPrintable('Etiquetas QR', () =>
      buildQrLabelsHtml(
        list.map((p) => ({ id: p.id, description: formatProductLabelDisplay(p.description), tag: p.tag, location: p.location })),
        origin
      )
    );
  };

  const handleDownloadInventory = async () => {
    if (isExportingInventory) return;
    setIsExportingInventory(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        alert('Faça login para exportar o inventário.');
        return;
      }

      const allItems = (await fetchAllTenantItems(supabase, user.id)) as Product[];
      if (allItems.length === 0) {
        alert('Não há itens para exportar.');
        return;
      }

      await downloadInventoryWorkbookFromTemplate(allItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao gerar planilha de inventário.';
      alert(message);
    } finally {
      setIsExportingInventory(false);
    }
  };

  const cartPickedItem = products.find((p) => p.id === cartPickItemId) || null;
  const cartTotalUnits = cart.reduce((acc, line) => acc + line.quantity, 0);

  const appendProductToCart = useCallback((product: Product, quantity: number, tag: string): boolean => {
    const isUnique = Boolean(product.unique_item);
    const qty = isUnique ? 1 : parseQty(quantity);
    const t = (tag.trim() || product.tag?.trim() || '');

    if (isUnique && !t) {
      return false;
    }
    if (!(qty > 0)) {
      alert('Informe uma quantidade maior que zero.');
      return false;
    }

    const inCartQty = cart
      .filter((l) => l.itemId === product.id)
      .reduce((s, l) => s + l.quantity, 0);
    if (parseQty(qty + inCartQty) > product.quantity_current) {
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
          epi: isEpiCategory(product.category),
          ca: product.ca_number ?? '',
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
            epi: isEpiCategory(product.category),
            ca: product.ca_number ?? '',
          },
        ];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: parseQty(next[idx].quantity + qty) };
      return next;
    });
    return true;
  }, [cart]);

  const addItemToCartFromRow = useCallback(
    (product: Product) => {
      if (product.archived_at) return;
      if (product.quantity_current <= 0) {
        alert('Sem saldo disponível no almoxarifado para retirada.');
        return;
      }
      if (product.unique_item) {
        const linkedTag = product.tag?.trim() || '';
        if (linkedTag) {
          appendProductToCart(product, 1, linkedTag);
          return;
        }
        setCartPickItemId(product.id);
        setCartPickQty(1);
        setCartPickTag('');
        void fetchWorkSites();
        setIsCartOpen(true);
        return;
      }
      // Saldo fracionado menor que 1 (ex.: 0,5 kg): adiciona o que houver.
      appendProductToCart(product, Math.min(1, product.quantity_current), '');
    },
    [appendProductToCart, fetchWorkSites]
  );

  const addLineToCart = () => {
    if (!cartPickedItem) return;
    const tag = cartPickTag.trim() || cartPickedItem.tag?.trim() || '';
    if (cartPickedItem.unique_item && !tag) {
      alert('Informe a TAG para item único.');
      return;
    }
    const qty = cartPickedItem.unique_item ? 1 : parseQty(cartPickQty);
    const ok = appendProductToCart(cartPickedItem, qty, tag);
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
      const nextQty = parseQty(line.quantity + delta);
      if (nextQty <= 0) return prev.filter((l) => l.lineId !== lineId);
      const others = prev
        .filter((l) => l.itemId === line.itemId && l.lineId !== lineId)
        .reduce((s, l) => s + l.quantity, 0);
      if (parseQty(nextQty + others) > item.quantity_current) {
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

    if (cartDocument.trim().length > MOVEMENT_DOCUMENT_MAX || cartNote.trim().length > MOVEMENT_NOTE_MAX) {
      alert(`Documento até ${MOVEMENT_DOCUMENT_MAX} caracteres e observação até ${MOVEMENT_NOTE_MAX}.`);
      setIsSubmitting(false);
      return;
    }

    // Todas as linhas desta retirada compartilham o mesmo lote = um recibo.
    const batchId = newBatchId();
    const toSite = cartDestination === 'site';
    const destination = toSite
      ? (() => {
          const s = workSites.find((w) => w.id === cartWorkSiteId);
          return s ? `${s.kind === 'sede' ? 'Sede' : 'Canteiro'}: ${s.name}` : 'local';
        })()
      : formatEmployeeName(employees.find((e) => e.id === cartEmployeeId)?.full_name || 'colaborador');

    for (let i = 0; i < cart.length; i++) {
      const line = cart[i];
      const currentItem = products.find((p) => p.id === line.itemId);
      const isConsumableNow = currentItem ? Boolean(currentItem.consumable) : line.consumable;
      // Cada linha é gravada numa única transação (histórico + carteira/local + estoque).
      // Envio para canteiro/sede baixa o almoxarifado e soma no saldo do local.
      const res = await registerMovement(supabase, {
        item_id: line.itemId,
        employee_id: cartDestination === 'employee' ? cartEmployeeId : null,
        work_site_id: toSite ? cartWorkSiteId : null,
        quantity: line.quantity,
        type: 'OUT',
        tag: line.tag || null,
        ca_number: line.epi ? line.ca?.trim() || null : null,
        stock_delta: -line.quantity,
        possession_delta: !toSite && !isConsumableNow ? line.quantity : 0,
        site_delta: toSite ? line.quantity : 0,
        document: cartDocument,
        note: cartNote,
        batch_id: batchId,
      });
      if (!res.ok) {
        const done =
          i > 0
            ? ` As ${i} linha(s) anteriores já foram gravadas e saíram do carrinho (recibo ${receiptNumber(batchId)} no Histórico).`
            : '';
        alert(`Erro na linha ${i + 1} (${line.description}): ${res.message}${done}`);
        setCart((prev) => prev.slice(i));
        setIsSubmitting(false);
        await fetchProducts();
        return;
      }
    }

    setLastReceipt({ batchId, lines: cart.length, destination });
    setCart([]);
    setCartPickItemId('');
    setCartPickQty(1);
    setCartPickTag('');
    setCartDocument('');
    setCartNote('');
    setIsSubmitting(false);
    await fetchProducts();
  };

  const closeCart = () => {
    setIsCartOpen(false);
    setLastReceipt(null);
  };

  const printReceipt = (batchId: string) => {
    void openPrintable(`Recibo ${receiptNumber(batchId)}`, () =>
      buildReceiptHtml(supabase, { batchId }, loadCompanyInfo())
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 erp-titlebar px-4 py-3 sm:px-5">
        <div>
          <h1 className="text-xl sm:text-[22px] font-bold tracking-tight text-primary">Almoxarifado</h1>
          <p className="text-slate-500 text-sm">Gestão de materiais, EPIs e ferramentas por descrição e categoria.</p>
        </div>
        <div className="flex flex-col gap-2 w-full md:flex-row md:flex-nowrap md:w-auto md:gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchWorkSites();
              setIsCartOpen(true);
            }}
            className="relative flex w-full md:w-auto items-center justify-center gap-2 bg-secondary text-white px-3 py-3 md:px-4 md:py-2 rounded-lg hover:opacity-95 transition-all font-medium text-sm min-h-[48px] md:min-h-[36px]"
            title="Monte a retirada e depois escolha o colaborador"
          >
            <ShoppingCart size={18} />
            Carrinho
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-amber-400 text-amber-950 text-[11px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                {cart.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleDownloadInventory()}
            disabled={loading || isExportingInventory}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm disabled:opacity-50 min-h-[48px] md:min-h-[36px]"
            title="Baixa em XLSX com todos os itens da sua conta, incluindo TAG"
          >
            {isExportingInventory ? (
              <Loader2 size={18} className="text-secondary shrink-0 animate-spin" />
            ) : (
              <Download size={18} className="text-secondary shrink-0" />
            )}
            <span className="truncate">
              <span className="md:hidden">{isExportingInventory ? 'Gerando…' : 'CSV'}</span>
              <span className="hidden md:inline">{isExportingInventory ? 'Gerando planilha…' : 'Baixar inventário'}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={handlePrintQrLabels}
            disabled={loading || filteredProducts.length === 0}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm disabled:opacity-50 min-h-[48px] md:min-h-[36px]"
            title="Imprime etiquetas com QR code dos itens da lista filtrada; ao ler, o item abre no LoggB"
          >
            <QrCode size={18} className="text-secondary shrink-0" />
            <span className="truncate">Etiquetas QR</span>
          </button>
          {canCategories ? (
          <button
            type="button"
            onClick={openCategoryManager}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-50 transition-all font-medium text-sm min-h-[48px] md:min-h-[36px]"
            title="Criar, editar e excluir categorias"
          >
            <Tags size={18} className="text-secondary shrink-0" />
            Categorias
          </button>
          ) : null}
          <button
            type="button"
            onClick={() => downloadInventoryImportTemplate()}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-white text-primary border border-teal-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-teal-50 transition-all font-medium text-sm min-h-[48px] md:min-h-[36px]"
            title="Planilha .xlsx formatada com instruções e colunas reconhecidas pelo importador"
          >
            <Download size={18} className="text-teal-600 shrink-0" />
            <span className="truncate">
              <span className="md:hidden">Modelo</span>
              <span className="hidden md:inline">Modelo importação</span>
            </span>
          </button>
          {managesAnyArea ? (
          <>
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-slate-100 text-primary border border-slate-200 px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-slate-200 transition-all font-medium text-sm min-h-[48px] md:min-h-[36px]"
          >
            <FileUp size={18} className="text-secondary shrink-0" />
            Importar
          </button>
          <button 
            onClick={() => {
              setEditingItem(null);
              const blank = emptyItemForm();
              // Almoxarifado escolhido nas abas: o item novo já nasce numa categoria dele.
              const ofAlmox = almoxArea ? categoryOptions.find((c) => itemInAlmox(c, almoxArea.id, almox.list) && canManageCategory(c)) : undefined;
              if (ofAlmox) blank.category = ofAlmox;
              else if (!canManageCategory(blank.category)) {
                const mine = categoryOptions.find((c) => canManageCategory(c));
                if (mine) blank.category = mine;
              }
              setFormData(blank);
              setIsModalOpen(true);
            }}
            className="flex w-full md:w-auto items-center justify-center gap-2 bg-primary text-white px-3 py-3 md:px-4 md:py-2 rounded-lg hover:bg-bar-2 transition-all font-medium text-sm min-h-[48px] md:min-h-[36px]"
          >
            <Plus size={18} />
            Novo Material
          </button>
          </>
          ) : null}
        </div>
      </div>

      <div className="-mt-3 px-1">
        <AlmoxarifadoTabs
          list={almox.list}
          seesAll={almox.seesAll}
          value={almoxSel}
          onChange={setAlmoxSel}
          counts={almoxCounts}
        />
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

      {focusItemId ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 rounded-xl border border-secondary/30 bg-secondary/5 text-sm">
          <span className="font-bold text-primary flex items-center gap-2">
            <QrCode size={18} className="text-secondary shrink-0" />
            {loading
              ? 'Abrindo item da etiqueta…'
              : filteredProducts.length
                ? 'Mostrando o item da etiqueta QR.'
                : 'O item desta etiqueta não foi encontrado nesta conta.'}
          </span>
          <button
            type="button"
            onClick={() => router.replace('/inventory')}
            className="self-start sm:self-auto px-3 py-2 rounded-lg bg-white border border-slate-200 font-bold text-secondary"
          >
            Ver todos os itens
          </button>
        </div>
      ) : null}

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        {loadError ? (
          <div className="px-4 py-3 border-b border-rose-200 bg-rose-50 text-rose-800 text-xs font-bold">
            Não foi possível carregar o inventário: {loadError}
          </div>
        ) : null}
        <div className="hidden md:flex px-4 py-2 border-b border-slate-100 flex-wrap items-center justify-between gap-2 bg-slate-50/80">
          <p className="text-[11px] font-bold text-slate-500">
            Filtros na primeira linha do cabeçalho da tabela abaixo.
            {!loading ? (
              <span className="text-slate-400 font-medium">
                {' '}
                · {filteredProducts.length} de{' '}
                {filterArchived === 'active' ? activeProductsCount : archivedProductsCount}{' '}
                {filterArchived === 'active' ? 'itens ativos' : 'itens arquivados'}
              </span>
            ) : null}
          </p>
          <select
            className="text-[11px] font-bold text-primary bg-white border border-slate-200 rounded-md px-2 py-1.5 outline-none focus:ring-2 focus:ring-secondary/40"
            value={filterArchived}
            onChange={(e) => setFilterArchived(e.target.value as 'active' | 'archived')}
            title="Itens arquivados saem da lista mas mantêm o histórico"
          >
            <option value="active">Itens ativos</option>
            <option value="archived">Arquivados ({archivedProductsCount})</option>
          </select>
        </div>

        {/* Filtros compactos — celular (mesmos estados da tabela) */}
        <div className="md:hidden p-4 border-b border-slate-100 bg-slate-50/80 space-y-3">
          <p className="text-xs font-bold text-slate-600 leading-snug">
            Busque o material e refine com os filtros. Toque nos botões do card para saída, entrada ou carrinho.
          </p>
          {!loading ? (
            <p className="text-[11px] font-bold text-slate-400">
              {filteredProducts.length} de{' '}
              {filterArchived === 'active' ? activeProductsCount : archivedProductsCount}{' '}
              {filterArchived === 'active' ? 'itens ativos' : 'itens arquivados'}
            </p>
          ) : null}
          <select
            className={`${selectFilterClass} min-h-[44px]`}
            value={filterArchived}
            onChange={(e) => setFilterArchived(e.target.value as 'active' | 'archived')}
          >
            <option value="active">Itens ativos</option>
            <option value="archived">Arquivados ({archivedProductsCount})</option>
          </select>
          <input
            type="text"
            value={filterDescription}
            onChange={(e) => setFilterDescription(e.target.value)}
            placeholder="Buscar por descrição, TAG ou local…"
            className="w-full text-sm font-bold text-primary bg-white border border-slate-200 rounded-xl px-3 py-3 outline-none focus:ring-2 focus:ring-secondary/40 min-h-[48px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Consumível</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterConsumable}
              onChange={(e) => setFilterConsumable(e.target.value as 'all' | 'sim' | 'nao')}
            >
              <option value="all">Todos</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
            <label className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Estoque</label>
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
            <label className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Em posse</label>
            <select
              className={`${selectFilterClass} col-span-2 min-h-[44px]`}
              value={filterPosse}
              onChange={(e) => setFilterPosse(e.target.value as 'all' | 'zero' | 'positive')}
            >
              <option value="all">Todos</option>
              <option value="zero">Zero</option>
              <option value="positive">Com posse</option>
            </select>
            <label className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Categoria</label>
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
            <label className="col-span-2 text-[10px] font-bold uppercase text-slate-400">Carrinho</label>
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
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-tight text-slate-600 border border-slate-200 rounded-xl bg-white hover:bg-slate-50"
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
                <th className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center" title="Almoxarifado + com colaboradores + em canteiros/sedes">Total</th>
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
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight text-slate-600 hover:text-primary border border-slate-200 rounded-md px-2 py-1.5 bg-white hover:bg-slate-50"
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
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin inline mr-2" size={20} />
                    Carregando inventário...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">Nenhum item encontrado.</td>
                </tr>
              ) : (
                visibleEntries.map((entry) => {
                  if (entry.kind === 'group') {
                    // Linha do grupo com as mesmas colunas dos itens, para os números ficarem alinhados.
                    const first = entry.items[0];
                    const g = groupSummary(entry.items);
                    const photo = groupPhoto(entry.items);
                    return (
                      <tr
                        key={`g-${entry.key}`}
                        className="bg-slate-50/70 hover:bg-slate-100 cursor-pointer border-l-4 border-l-primary"
                        onClick={() => toggleGroup(entry.key)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            {entry.open ? <ChevronDown size={18} className="shrink-0 text-primary" /> : <ChevronRight size={18} className="shrink-0 text-primary" />}
                            {photo ? <PhotoThumb url={photo} size={44} /> : null}
                            <div className="min-w-0">
                              <div className="font-bold text-primary text-base">{formatProductLabelDisplay(entry.title)}</div>
                              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary text-white text-[10px] font-bold">
                                <Layers size={11} />
                                {entry.sizes
                                  ? `${entry.items.length} tamanhos · ${sizeRange(entry.sizes)}`
                                  : `${entry.items.length} unidades com tag`}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-center border-x border-slate-50">
                          <span
                            className={`px-2 py-1 rounded-md font-bold text-[10px] uppercase tracking-tighter ${
                              first.consumable ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'
                            }`}
                          >
                            {first.consumable ? 'Sim' : 'Não'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center bg-slate-50/30">
                          <span className="font-bold text-sm text-primary">{formatQty(g.estoque)}</span>
                          {g.locais > 0 ? (
                            <div className="text-[9px] font-bold uppercase text-amber-700">{formatQty(g.locais)} em locais</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-bold text-sm text-primary">{formatQty(g.posse)}</span>
                          <div className="text-[9px] font-bold uppercase text-slate-400">com colaboradores</div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-bold text-sm text-primary">{formatQty(g.total)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-slate-400 font-bold text-xs">—</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter w-fit ${
                              first.category === 'Ferramenta'
                                ? 'bg-blue-50 text-blue-600'
                                : first.category === 'EPI'
                                  ? 'bg-purple-50 text-purple-600'
                                  : 'bg-orange-50 text-orange-600'
                            }`}
                          >
                            {first.category}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 whitespace-nowrap">
                            {entry.open ? 'Fechar' : entry.sizes ? 'Ver tamanhos' : 'Ver as tags'}
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  const p = entry.p;
                  const isLowStock = p.quantity_min > 0 && p.quantity_current <= p.quantity_min;
                  const totalInPossession = possessionTotalForProduct(p);
                  const totalAtSites = sitePossessionTotal(p);
                  const totalQuantity = p.quantity_current + totalInPossession + totalAtSites;
                  const popoverPosseKey = `posse-${p.id}`;
                  const popoverSitesKey = `sites-${p.id}`;
                  
                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-50 transition-colors group ${entry.nested ? 'bg-slate-50/40' : ''}`}
                    >
                      <td className={`px-4 py-2.5 ${entry.nested ? 'pl-10 border-l-4 border-l-slate-200' : ''}`}>
                        <div className="flex items-start gap-3">
                        {p.photo_path && itemPhotos[p.photo_path] ? <PhotoThumb url={itemPhotos[p.photo_path]} size={44} /> : null}
                        <div className="min-w-0">
                        <div className="font-bold text-primary text-base">{formatProductLabelDisplay(p.description)}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">{p.location || 'Sem local definido'} • {p.unit}</div>
                        {plateText(p) ? (
                          <div className="mt-1">
                            <TagPlate>{plateText(p)}</TagPlate>
                          </div>
                        ) : null}
                        {p.is_rented ? (
                          <div className="mt-1 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                            Equipamento alugado
                          </div>
                        ) : null}
                        </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-center border-x border-slate-50">
                        <span className={`px-2 py-1 rounded-md font-bold text-[10px] uppercase tracking-tighter ${p.consumable ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}`}>
                          {p.consumable ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 bg-slate-50/30">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`font-bold text-sm ${isLowStock ? 'text-red-500' : 'text-primary'}`}>
                            {formatQty(p.quantity_current)}
                          </span>
                          {totalAtSites > 0 ? (
                            <div className="relative inline-block">
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePopover(activePopover === popoverSitesKey ? null : popoverSitesKey)
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-tight text-amber-800 hover:bg-amber-100 transition-colors"
                                title="Material enviado a canteiros ou sedes — saldo do almoxarifado mantido"
                              >
                                <MapPin size={10} />
                                {formatQty(totalAtSites)}em locais
                              </button>
                              {activePopover === popoverSitesKey && (
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-white border border-border rounded-xl shadow-xl z-30 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                  <h4 className="text-[10px] font-bold uppercase text-amber-700 mb-2 border-b border-amber-100 pb-1">
                                    Em canteiros / sedes
                                  </h4>
                                  <div className="space-y-2">
                                    {p.site_possession
                                      ?.filter((sp) => Number(sp.quantity) > 0)
                                      .map((sp) => (
                                        <div
                                          key={`${sp.site_id}-${sp.quantity}`}
                                          className="flex justify-between text-[10px]"
                                        >
                                          <span className="text-slate-600 truncate mr-2">
                                            {sitePossessionLabel(sp.work_sites) || 'Local'}
                                          </span>
                                          <span className="font-bold text-primary">{formatQty(sp.quantity)}</span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {totalInPossession > 0 && (p.possession ?? []).filter((pos) => Number(pos.quantity) > 0).length <= 2 ? (
                          // Até 2 pessoas: mostra o nome direto (itens únicos sempre caem aqui).
                          <div className="flex flex-col items-center gap-1">
                            {(p.possession ?? [])
                              .filter((pos) => Number(pos.quantity) > 0)
                              .map((pos) => (
                                <span
                                  key={pos.id}
                                  className="inline-flex items-center gap-1 max-w-[190px] bg-slate-100 px-2.5 py-1 rounded-full text-[11px] font-bold text-primary"
                                  title={possessionEmployeeName(pos.employees)}
                                >
                                  <Users size={11} className="text-secondary shrink-0" />
                                  <span className="truncate">{possessionEmployeeName(pos.employees)}</span>
                                  {Number(pos.quantity) !== 1 ? <span className="text-slate-500 shrink-0">×{formatQty(pos.quantity)}</span> : null}
                                </span>
                              ))}
                          </div>
                        ) : totalInPossession > 0 ? (
                          <div className="relative inline-block">
                            <button 
                              onClick={() => setActivePopover(activePopover === popoverPosseKey ? null : popoverPosseKey)}
                              className="flex items-center gap-1 mx-auto bg-slate-100 px-3 py-1 rounded-full text-primary font-bold hover:bg-slate-200 transition-colors text-xs"
                            >
                              <Users size={12} className="text-secondary" />
                              {formatQty(totalInPossession)}
                            </button>
                            
                            {activePopover === popoverPosseKey && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-white border border-border rounded-xl shadow-xl z-30 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                <h4 className="text-[10px] font-bold uppercase text-slate-400 mb-2 border-b pb-1">Em posse de:</h4>
                                <div className="space-y-2">
                                  {p.possession?.map(pos => (
                                    <div key={pos.id} className="flex justify-between text-[10px]">
                                      <span className="text-slate-600 truncate mr-2">{possessionEmployeeName(pos.employees)}</span>
                                      <span className="font-bold text-primary">{formatQty(pos.quantity)}</span>
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
                      <td className="px-4 py-2.5 text-center font-bold text-primary text-sm bg-slate-50/30 transition-colors group-hover:bg-slate-100/50">{formatQty(totalQuantity)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-slate-400 font-bold text-xs">{formatQty(p.quantity_min)}</span>
                          {isLowStock && <AlertCircle size={10} className="text-red-400 mt-1 animate-pulse" />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tighter w-fit ${
                            p.category === 'Ferramenta' ? 'bg-blue-50 text-blue-600' :
                            p.category === 'EPI' ? 'bg-purple-50 text-purple-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {p.category}
                          </span>

                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center border-x border-slate-50/80">
                        <button
                          type="button"
                          disabled={p.quantity_current <= 0 || Boolean(p.archived_at) || !canManageCategory(p.category)}
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
                      <td className="px-4 py-2.5 text-right">
                        {!canManageCategory(p.category) ? (
                          <div className="flex justify-end items-center gap-1">
                            <span
                              className="text-[10px] font-bold uppercase text-slate-400 mr-1"
                              title="Este item é de um almoxarifado que você não gerencia. Peça ao ADM para incluir você nele."
                            >
                              Só consulta
                            </span>
                            <button
                              onClick={() => openHistory(p)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-secondary"
                              title="Histórico"
                            >
                              <History size={16} />
                            </button>
                          </div>
                        ) : p.archived_at ? (
                          <div className="flex justify-end items-center gap-1">
                            <span className="text-[10px] font-bold uppercase text-slate-400 mr-1">Arquivado</span>
                            <button
                              onClick={() => openHistory(p)}
                              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-secondary"
                              title="Histórico"
                            >
                              <History size={16} />
                            </button>
                            <button
                              onClick={() => void handleRestore(p)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-primary hover:bg-slate-50"
                              title="Volta para a lista de itens ativos"
                            >
                              Reativar
                            </button>
                          </div>
                        ) : (
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
                                ca_number: p.ca_number ?? '',
                              });
                            }}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-500"
                            title="Editar"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => void handleDelete(p)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-500"
                            title={approver ? 'Excluir ou arquivar (itens com histórico são arquivados)' : 'Pedir exclusão (o ADM ou o gestor aprova)'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        )}
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
            visibleEntries.map((entry) => {
              if (entry.kind === 'group') {
                return (
                  <button
                    key={`g-${entry.key}`}
                    type="button"
                    onClick={() => toggleGroup(entry.key)}
                    className="w-full text-left rounded-2xl border border-slate-300 bg-slate-50 p-4 shadow-sm space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      {entry.open ? <ChevronDown size={18} className="mt-0.5 shrink-0" /> : <ChevronRight size={18} className="mt-0.5 shrink-0" />}
                      <span className="font-bold text-primary text-base leading-snug">{formatProductLabelDisplay(entry.title)}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary text-white text-[11px] font-bold">
                      <Layers size={12} />
                      {entry.sizes ? `${entry.items.length} tamanhos · ${sizeRange(entry.sizes)}` : `${entry.items.length} unidades com tag`}
                    </span>
                    {groupChips(entry.items)}
                  </button>
                );
              }
              const p = entry.p;
              const isLowStock = p.quantity_min > 0 && p.quantity_current <= p.quantity_min;
              const totalInPossession = possessionTotalForProduct(p);
              const totalAtSites = sitePossessionTotal(p);
              const totalQuantity = p.quantity_current + totalInPossession + totalAtSites;
              return (
                <div
                  key={p.id}
                  className={`rounded-2xl border border-border bg-white p-4 shadow-sm space-y-3 ${entry.nested ? 'ml-4 border-l-4 border-l-slate-300' : ''}`}
                >
                  <div className="min-w-0 flex items-start gap-3">
                    {p.photo_path && itemPhotos[p.photo_path] ? <PhotoThumb url={itemPhotos[p.photo_path]} size={56} /> : null}
                    <div className="min-w-0">
                    <h3 className="font-bold text-primary text-base leading-snug">
                      {formatProductLabelDisplay(p.description)}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-bold mt-1 uppercase tracking-tight">
                      {p.location || 'Sem local'} · {p.unit}
                    </p>
                    {plateText(p) ? (
                      <div className="mt-1.5">
                        <TagPlate>{plateText(p)}</TagPlate>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
                          p.consumable ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {p.consumable ? 'Consumível' : 'Não consumível'}
                      </span>
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${
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
                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold uppercase bg-amber-50 text-amber-700">
                          Alugado
                        </span>
                      ) : null}
                    </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-bold uppercase text-slate-400">Estoque</div>
                      <div
                        className={`text-lg font-bold ${isLowStock ? 'text-red-500' : 'text-primary'}`}
                      >
                        {formatQty(p.quantity_current)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-bold uppercase text-slate-400">Posse</div>
                      <div className="text-lg font-bold text-primary">{formatQty(totalInPossession)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
                      <div className="text-[9px] font-bold uppercase text-slate-400">Total</div>
                      <div className="text-lg font-bold text-primary">{formatQty(totalQuantity)}</div>
                    </div>
                  </div>
                  {isLowStock ? (
                    <p className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} />
                      Abaixo ou no mínimo ({formatQty(p.quantity_min)})
                    </p>
                  ) : null}

                  {totalAtSites > 0 ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                      <p className="text-[10px] font-bold uppercase text-amber-800 mb-2 flex items-center gap-1">
                        <MapPin size={12} />
                        {formatQty(totalAtSites)}em canteiros / sedes
                      </p>
                      <p className="text-[10px] text-amber-900/80 mb-2">
                        O saldo do almoxarifado permanece; este aviso indica onde o material foi enviado.
                      </p>
                      <div className="space-y-1.5">
                        {p.site_possession
                          ?.filter((sp) => Number(sp.quantity) > 0)
                          .map((sp) => (
                            <div key={`${sp.site_id}-${sp.quantity}`} className="flex justify-between text-xs font-bold">
                              <span className="text-amber-950 truncate pr-2">
                                {sitePossessionLabel(sp.work_sites) || 'Local'}
                              </span>
                              <span className="text-amber-900 shrink-0">{formatQty(sp.quantity)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  {totalInPossession > 0 ? (
                    <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                      <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Em posse de</p>
                      <div className="space-y-1.5">
                        {p.possession?.map((pos) => (
                          <div key={pos.id} className="flex justify-between text-xs font-bold">
                            <span className="text-slate-600 truncate pr-2">
                              {possessionEmployeeName(pos.employees) || '—'}
                            </span>
                            <span className="text-primary shrink-0">{formatQty(pos.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!canManageCategory(p.category) ? (
                  <div className="grid grid-cols-1 gap-2">
                    <p className="text-[11px] text-slate-500 text-center">
                      Só consulta: este item é de um almoxarifado que você não gerencia.
                    </p>
                    <button
                      type="button"
                      onClick={() => openHistory(p)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-slate-700 border border-slate-200 font-bold text-sm"
                    >
                      <History size={18} />
                      Histórico
                    </button>
                  </div>
                  ) : p.archived_at ? (
                  <div className="grid grid-cols-2 gap-2">
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
                      onClick={() => void handleRestore(p)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-white text-primary border border-slate-300 font-bold text-sm"
                    >
                      Reativar
                    </button>
                  </div>
                  ) : (
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
                          ca_number: p.ca_number ?? '',
                        });
                      }}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-blue-700 border border-slate-200 font-bold text-sm"
                    >
                      <Edit size={18} />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(p)}
                      className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-slate-50 text-red-600 border border-slate-200 font-bold text-sm"
                    >
                      <Trash2 size={18} />
                      {approver ? 'Excluir' : 'Pedir exclusão'}
                    </button>
                  </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {!loading ? (
          <div className="px-4 pb-5 border-t border-slate-100 bg-slate-50/40">
            {hasMoreToShow ? (
              <div
                ref={loadMoreAnchorRef}
                className="py-4 text-center text-xs font-bold text-slate-500"
              >
                Mostrando {visibleEntries.length} de {listEntries.length} linhas. Role at&eacute; o final para ver mais.
              </div>
            ) : filteredProducts.length > 0 ? (
              <div className="py-4 text-center text-xs font-bold text-slate-400">
                Todos os {filteredProducts.length} itens estão na lista.
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
                  itemMovements.map((move) => {
                    const reason = movementReasonOf(move);
                    return (
                    <div key={move.id} className="flex gap-4 items-start p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className={`mt-1 p-2 rounded-lg ${move.type === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {move.type === 'IN' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start gap-2">
                          <p className="font-bold text-primary">{movementCounterpartyLabel(move)}</p>
                          <span className="text-[10px] bg-white px-2 py-1 rounded-md border text-slate-400 font-mono shrink-0">
                            {new Date(move.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          <span className="font-bold">{MOVEMENT_REASON_LABEL[reason]}</span>
                          {' · '}
                          <span className={`font-bold ${move.type === 'IN' ? 'text-green-700' : 'text-red-700'}`}>
                            {move.type === 'IN' ? '+' : '−'}{formatQty(move.quantity)}
                          </span>{' '}
                          {historyItem.unit}
                          {move.tag && reason !== 'descarte' ? (
                            <TagPlate size="xs" className="ml-2">{move.tag}</TagPlate>
                          ) : null}
                        </p>
                        {move.document || move.note ? (
                          <p className="text-[11px] text-slate-500 mt-1">
                            {move.document ? <span className="font-bold">Doc. {move.document}</span> : null}
                            {move.document && move.note ? ' · ' : null}
                            {move.note}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    );
                  })
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
                <SuggestInput
                  label="Descrição do Produto"
                  options={existingItemNames}
                  placeholder="Digite o nome do item…"
                  exactWarning="Já existe um item cadastrado com esse nome."
                  value={formData.description}
                  onChange={(v) => setFormData({ ...formData, description: v })}
                  required
                />
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-400">Foto do item</label>
                  <PhotoField
                    currentUrl={
                      editingItem?.photo_path && !dropItemPhoto ? itemPhotos[editingItem.photo_path] : undefined
                    }
                    file={itemPhotoFile}
                    searchQuery={formData.description}
                    onPick={pickItemPhoto}
                    onRemove={() => {
                      setItemPhotoFile(null);
                      setDropItemPhoto(true);
                    }}
                  />
                </div>
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
                      className={`text-sm font-bold cursor-pointer ${formData.consumable ? 'text-slate-300' : 'text-secondary'}`}
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
                      className="text-sm font-bold cursor-pointer text-amber-700"
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
                    {categoryOptions
                      .filter((c) => c === formData.category || (canManageCategory(c) && (!almoxArea || editingItem || itemInAlmox(c, almoxArea.id, almox.list))))
                      .map((c) => (
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

              {(formData.category.trim().toUpperCase() === 'EPI' || formData.ca_number.trim() !== '') && (
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-slate-400">Nº do CA (Certificado de Aprovação)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="Ex.: 12345"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none text-sm font-mono"
                    value={formData.ca_number}
                    onChange={(e) => setFormData({ ...formData, ca_number: e.target.value })}
                  />
                  <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
                    Sai no recibo e na ficha de EPI. Cada entrega guarda o CA do momento, então trocar aqui não altera
                    entregas antigas.
                  </p>
                </div>
              )}

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
                  <label className="text-xs font-bold uppercase text-secondary">
                    {editingItem ? 'Qtd. em Estoque' : 'Saldo inicial'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
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
                      className="mt-2 w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50"
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
                    step="any"
                    min="0"
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
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-bar-2 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
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
                onClick={closeCart}
                className="p-2 hover:bg-slate-200 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {lastReceipt ? (
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600">
                  <ShoppingCart size={28} />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-primary">Retirada registrada</h4>
                  <p className="text-sm text-slate-500 mt-1">
                    {lastReceipt.lines} item(ns) para <span className="font-bold">{lastReceipt.destination}</span> · recibo nº{' '}
                    <span className="font-mono font-bold">{receiptNumber(lastReceipt.batchId)}</span>
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => printReceipt(lastReceipt.batchId)}
                    className="px-5 py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2"
                  >
                    <Printer size={18} />
                    Imprimir recibo
                  </button>
                  <button
                    type="button"
                    onClick={() => setLastReceipt(null)}
                    className="px-5 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Nova retirada
                  </button>
                  <button
                    type="button"
                    onClick={closeCart}
                    className="px-5 py-3 border border-slate-200 rounded-xl font-bold text-slate-500 hover:bg-slate-50"
                  >
                    Fechar
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">
                  O recibo também pode ser impresso depois, pelo Histórico. Dados da empresa no recibo: Colaboradores → Fichas.
                </p>
              </div>
            ) : (
            <>
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
                  {workSites.length > 0 || cartDestination === 'site' ? (
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
                  ) : null}
                </div>
                {cartDestination === 'site' && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
                    Envio para canteiro ou sede <span className="font-bold">baixa</span> o saldo do almoxarifado e passa a
                    constar no local. Quando voltar, registre a devolução para o item retornar ao estoque.
                  </p>
                )}
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
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400 mb-1 block">
                      Documento <span className="normal-case font-medium">(requisição, OS, NF — opcional)</span>
                    </label>
                    <input
                      type="text"
                      maxLength={MOVEMENT_DOCUMENT_MAX}
                      placeholder="Ex.: REQ 0458"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                      value={cartDocument}
                      onChange={(e) => setCartDocument(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-400 mb-1 block">
                      Observação <span className="normal-case font-medium">(opcional, sai no recibo)</span>
                    </label>
                    <input
                      type="text"
                      maxLength={MOVEMENT_NOTE_MAX}
                      placeholder="Ex.: troca por desgaste, frente de serviço 3…"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-medium"
                      value={cartNote}
                      onChange={(e) => setCartNote(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <select
                    className="md:col-span-6 p-3 bg-white border border-slate-200 rounded-lg outline-none font-medium"
                    value={cartPickItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCartPickItemId(id);
                      const picked = products.find((p) => p.id === id);
                      setCartPickTag(
                        picked?.unique_item && picked.tag?.trim() ? picked.tag.trim() : ''
                      );
                      setCartPickQty(1);
                    }}
                  >
                    <option value="">Item para adicionar...</option>
                    {products.filter((p) => !p.archived_at).map((p) => (
                      <option key={p.id} value={p.id} disabled={p.quantity_current <= 0}>
                        {formatProductLabelDisplay(p.description)} - saldo {formatQty(p.quantity_current)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    disabled={Boolean(cartPickedItem?.unique_item)}
                    className="md:col-span-2 p-3 bg-white border border-slate-200 rounded-lg outline-none font-bold disabled:opacity-60"
                    value={cartPickedItem?.unique_item ? 1 : cartPickQty === 0 ? '' : cartPickQty}
                    onChange={(e) => setCartPickQty(Number(e.target.value))}
                  />
                  {cartPickedItem?.unique_item && !cartPickedItem.tag?.trim() && (
                    <input
                      type="text"
                      placeholder="TAG obrigatoria"
                      className="md:col-span-3 p-3 bg-white border-2 border-secondary/50 rounded-lg outline-none font-bold"
                      value={cartPickTag}
                      onChange={(e) => setCartPickTag(e.target.value)}
                    />
                  )}
                  {cartPickedItem?.unique_item && cartPickedItem.tag?.trim() && (
                    <div className="md:col-span-3 p-3 bg-white border border-slate-200 rounded-lg flex items-center">
                      <TagPlate size="md">{cartPickedItem.tag.trim()}</TagPlate>
                    </div>
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
                          {line.tag && <TagPlate size="xs">{line.tag}</TagPlate>}
                        </div>
                        {line.epi ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={40}
                            value={line.ca ?? ''}
                            onChange={(e) =>
                              setCart((prev) => prev.map((x) => (x.lineId === line.lineId ? { ...x, ca: e.target.value } : x)))
                            }
                            placeholder="Nº do CA (opcional)"
                            title="CA do EPI entregue. Se não souber agora, dá para corrigir depois no Histórico."
                            className="mt-1 w-40 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md outline-none focus:border-secondary"
                          />
                        ) : null}
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
                        <span className="font-bold min-w-8 text-center">{formatQty(line.quantity)}</span>
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
                Itens: {cart.length} linhas / {formatQty(cartTotalUnits)} unidades
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
            </>
            )}
          </div>
        </div>
      )}

      {deleting ? (
        <DeletionDialog
          entity="item"
          id={deleting.product.id}
          label={formatProductLabelDisplay(deleting.product.description)}
          note={deleting.note}
          onClose={() => setDeleting(null)}
          onDone={(outcome) => {
            const id = deleting.product.id;
            setDeleting(null);
            if (outcome.kind === 'done') setCart((prev) => prev.filter((l) => l.itemId !== id));
            void fetchProducts();
          }}
        />
      ) : null}

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
                  step="any"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold text-lg"
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
                  className="flex-1 p-3 bg-primary text-white rounded-xl font-bold hover:bg-bar-2 disabled:opacity-50"
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
