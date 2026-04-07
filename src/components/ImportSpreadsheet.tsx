'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { itemCodeFromDescription } from '@/lib/itemCode';
import { normalizeProductLabelForSave } from '@/lib/productDisplayText';
import { recordMovement, updatePossessionQuantity, updateStock } from '@/lib/movements';
import { FileUp, Loader2, CheckCircle2, AlertCircle, X, Info, Users, Package, Download } from 'lucide-react';
import { downloadInventoryImportTemplate } from '@/lib/inventoryImportTemplate';

type ImportMode = 'inventory' | 'movement';

interface ImportProgress {
  total: number;
  current: number;
  status: 'idle' | 'parsing' | 'uploading' | 'completed' | 'error';
  message: string;
}

export default function ImportSpreadsheet({ 
  mode = 'inventory', 
  onComplete 
}: { 
  mode?: ImportMode; 
  onComplete: () => void 
}) {
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0,
    current: 0,
    status: 'idle',
    message: ''
  });

  const parseNumericValue = (val: any) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    
    const str = val.toString().trim();
    if (!str) return 0;
    
    // Handle Brazilian format: "1.234,56" or "1234,56"
    let cleaned = str;
    if (str.includes(',') && str.includes('.')) {
      // "1.234,56" -> "1234.56"
      cleaned = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
      // "1234,56" -> "1234.56"
      cleaned = str.replace(',', '.');
    }
    
    // Remove any remaining non-numeric characters e.g. "R$ 100,00"
    const finalCleaned = cleaned.replace(/[^\d.]/g, '');
    const num = parseFloat(finalCleaned);
    return isNaN(num) ? 0 : num;
  };

  const parseBooleanValue = (val: any) => {
    if (val === null || val === undefined) return false;
    if (typeof val === 'boolean') return val;
    const str = val.toString().trim().toUpperCase();
    return ['SIM', 'S', 'YES', 'Y', '1', 'TRUE', 'VERDADEIRO'].includes(str);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProgress({ ...progress, status: 'parsing', message: 'Lendo planilha...' });

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0]; 
        const sheet = workbook.Sheets[sheetName];
        
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        if (rawData.length === 0) {
          throw new Error('Planilha vazia.');
        }

        // Robust Header Detection
        const nameKeywords = ['NOME', 'FUNCIONARIO', 'FUNCIONÁRIO', 'COLABORADOR', 'FULL NAME'];
        const cpfKeywords = ['CPF', 'DOC', 'IDENTIDADE', 'REGISTRY'];
        const roleKeywords = ['CARGO', 'FUNÇÃO', 'ROLE', 'POSITION'];
        const deptKeywords = ['DEPARTAMENTO', 'DEP', 'DEPT', 'SETOR', 'AREA'];
        const statusKeywords = ['STATUS', 'SITUAÇÃO', 'ESTADO'];
        
        // Não usar termos ambíguos (ex: "MAT") para evitar colisão com cabeçalhos como "Material".
        // Código no banco continua existindo, mas aqui priorizamos identificar corretamente a coluna de descrição.
        const codeKeywords = ['CODIGO', 'CÓDIGO', 'CODE', 'REF', 'SKU'];
        // Planilha de funcionários pode vir com "Descrição do Item"
        const descKeywords = [
          'DESCRICAO',
          'DESCRIÇÃO',
          'DESCRICAO DO ITEM',
          'DESCRIÇÃO DO ITEM',
          'ITEM',
          'MATERIAL',
          'PRODUTO'
        ];
        const unitKeywords = ['UNIDADE', 'UN', 'UNIT'];
        
        // Ex: "Saldo Atual (em Posse)"
        const possessionKeywords = ['SALDO ATUAL', 'EM POSSE', 'POSSE', 'SALDO'];
        const stockKeywords = ['ESTOQUE', 'QUANTIDADE', 'QTY', 'STOCK', 'TOTAL'];
        const commonQtyKeywords = ['QTD', 'QUANT'];

        const categoryKeywords = ['CATEGORIA', 'CATEGORY', 'GRUPO', 'TIPO'];
        const originKeywords = ['ORIGEM', 'LOCAL', 'LOCATION', 'DEPÓSITO', 'ALMOXARIFADO'];
        const consumableKeywords = ['CONSUMÍVEL', 'CONSUMIVEL', 'CONSUMABLE'];
        // A planilha pode vir como "Qtd. Mínimo" OU "Qtd. Mínima"
        const minKeywords = ['MÍNIMO', 'MINIMO', 'MÍNIMA', 'MINIMA', 'MIN', 'LIMIT', 'ALERTA'];

        const allKeywords = [
          ...nameKeywords, ...cpfKeywords, ...roleKeywords, ...deptKeywords,
          ...codeKeywords, ...descKeywords, ...possessionKeywords, ...stockKeywords,
          ...categoryKeywords, ...consumableKeywords
        ];

        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rawData.length, 20); i++) {
          const row = rawData[i];
          if (!row || !Array.isArray(row)) continue;
          const rowStr = row.join(' ').toUpperCase();
          const matchCount = allKeywords.filter(k => rowStr.includes(k)).length;
          if (matchCount >= 2) {
            headerRowIndex = i;
            break;
          }
        }

        const headers = rawData[headerRowIndex].map(h => h?.toString().toUpperCase().trim() || '');
        const rows = rawData.slice(headerRowIndex + 1);

        console.log(`Found header at row ${headerRowIndex}:`, headers);

        const findBestIdx = (keywords: string[]) => {
          return headers.findIndex(h => keywords.some(k => h.includes(k)));
        };

        const mapping = {
          nameIdx: findBestIdx(nameKeywords),
          cpfIdx: findBestIdx(cpfKeywords),
          roleIdx: findBestIdx(roleKeywords),
          deptIdx: findBestIdx(deptKeywords),
          statusIdx: findBestIdx(statusKeywords),
          
          codeIdx: findBestIdx(codeKeywords),
          descIdx: findBestIdx(descKeywords),
          unitIdx: findBestIdx(unitKeywords),
          
          possessionIdx: findBestIdx(possessionKeywords),
          stockIdx: findBestIdx(stockKeywords),
          commonQtyIdx: findBestIdx(commonQtyKeywords),
          
          categoryIdx: findBestIdx(categoryKeywords),
          locationIdx: findBestIdx(originKeywords),
          consumableIdx: findBestIdx(consumableKeywords),
          minIdx: findBestIdx(minKeywords)
        };

        // Determine which quantity column to use based on mode
        let qtyIdx = -1;
        if (mode === 'movement') {
          qtyIdx = mapping.possessionIdx !== -1 ? mapping.possessionIdx : 
                   (mapping.stockIdx !== -1 ? mapping.stockIdx : mapping.commonQtyIdx);
        } else {
          qtyIdx = mapping.stockIdx !== -1 ? mapping.stockIdx : 
                   (mapping.commonQtyIdx !== -1 ? mapping.commonQtyIdx : mapping.possessionIdx);
        }

        console.log('Detected mapping:', { ...mapping, finalQtyIdx: qtyIdx });

        if (rows.length === 0) throw new Error('Dados não encontrados.');

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Processando...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        // 1. Process Employees
        const employeeMap = new Map<string, string>(); 
        const uniquePeople = new Map<string, any>();

        if (mapping.nameIdx !== -1) {
          rows.forEach(row => {
            const nameLine = row[mapping.nameIdx]?.toString().trim();
            if (!nameLine || nameLine.length < 2) return;

            let cpf = mapping.cpfIdx !== -1 ? row[mapping.cpfIdx]?.toString().trim() : null;
            const originalCpf = cpf;
            const cleanedCpf = cpf ? cpf.replace(/\D/g, '') : '';
            
            // If CPF is masked (contains * or X), don't treat it as a hard identifier for matching if it differs from DB
            const isMaskedCpf = originalCpf && (originalCpf.includes('*') || originalCpf.toUpperCase().includes('X'));
            
            const role = mapping.roleIdx !== -1 ? row[mapping.roleIdx]?.toString().trim() : null;
            const dept = mapping.deptIdx !== -1 ? row[mapping.deptIdx]?.toString().trim() : null;
            const status = mapping.statusIdx !== -1 ? row[mapping.statusIdx]?.toString().trim() : 'Ativo';

            const key = (!isMaskedCpf && cleanedCpf.length === 11) ? cleanedCpf : nameLine.toLowerCase();
            
            if (!uniquePeople.has(key)) {
              uniquePeople.set(key, { 
                name: nameLine, 
                cpf: (cleanedCpf.length === 11 && !isMaskedCpf) ? cleanedCpf : null,
                role,
                dept,
                status
              });
            }
          });
        }

        let pCount = 0;
        for (const [key, person] of uniquePeople.entries()) {
          pCount++;
          setProgress(prev => ({ ...prev, message: `Sincronizando Colaboradores: ${pCount}/${uniquePeople.size}` }));
          
          let empId = null;
          // Strategy: Match by CPF (if valid) OR Name
          if (person.cpf) {
            const { data } = await supabase
              .from('employees')
              .select('id')
              .eq('cpf', person.cpf)
              .eq('user_id', user.id)
              .maybeSingle();
            if (data) empId = data.id;
          }
          
          if (!empId) {
            const { data } = await supabase
              .from('employees')
              .select('id')
              .ilike('full_name', person.name)
              .eq('user_id', user.id)
              .maybeSingle();
            if (data) empId = data.id;
          }

          const empData = {
            full_name: person.name,
            cpf: person.cpf || null,
            role: person.role,
            department: person.dept,
            status: person.status || 'Ativo',
            user_id: user.id
          };

          if (empId) {
            await supabase.from('employees').update(empData).eq('id', empId).eq('user_id', user.id);
            employeeMap.set(key, empId);
          } else {
            const { data } = await supabase.from('employees').insert(empData).select('id').single();
            if (data) employeeMap.set(key, data.id);
          }
        }

        // 2. Process Items
        const itemMap = new Map<string, string>();
        const uniqueItems = new Map<string, any>();

        if (mapping.codeIdx !== -1 || mapping.descIdx !== -1) {
          rows.forEach(row => {
            const code = mapping.codeIdx !== -1 ? row[mapping.codeIdx]?.toString().trim() : '';
            const desc = mapping.descIdx !== -1 ? row[mapping.descIdx]?.toString().trim() : '';
            
            if (code || desc) {
              const description = normalizeProductLabelForSave((desc || code || 'Sem descricao').trim()) || 'SEM DESCRICAO';
              const itemKey = description.toLowerCase();
              if (!uniqueItems.has(itemKey)) {
                const qty = qtyIdx !== -1 ? parseNumericValue(row[qtyIdx]) : 0;
                const min = mapping.minIdx !== -1 ? parseNumericValue(row[mapping.minIdx]) : 1;
                const category = mapping.categoryIdx !== -1 ? row[mapping.categoryIdx]?.toString().trim() : 'Material';
                const location = mapping.locationIdx !== -1 ? row[mapping.locationIdx]?.toString().trim() : 'Almoxarifado';
                const unit = mapping.unitIdx !== -1 ? row[mapping.unitIdx]?.toString().trim() : 'un';
                const consumable = mapping.consumableIdx !== -1 ? parseBooleanValue(row[mapping.consumableIdx]) : false;
                const sheetCode = code ? code.trim() : '';

                uniqueItems.set(itemKey, {
                  sheetCode: sheetCode || null,
                  description,
                  qty,
                  min,
                  category,
                  location,
                  unit,
                  consumable
                });
              }
            }
          });
        }

        let iCount = 0;
        for (const [key, itm] of uniqueItems.entries()) {
          iCount++;
          setProgress(prev => ({ ...prev, message: `Sincronizando Itens: ${iCount}/${uniqueItems.size}` }));
          
          let existingId = null;
          if (itm.description) {
            const { data: byDesc } = await supabase
              .from('items')
              .select('id')
              .ilike('description', itm.description)
              .eq('user_id', user.id)
              .maybeSingle();
            if (byDesc) existingId = byDesc.id;
          }
          if (!existingId && itm.sheetCode && !itm.sheetCode.startsWith('REF-')) {
            const { data: byCode } = await supabase
              .from('items')
              .select('id')
              .eq('code', itm.sheetCode)
              .eq('user_id', user.id)
              .maybeSingle();
            if (byCode) existingId = byCode.id;
          }

          const itemData = {
            code: itemCodeFromDescription(itm.description),
            description: itm.description,
            category: itm.category,
            location: itm.location,
            unit: itm.unit,
            consumable: itm.consumable,
            quantity_min: itm.min,
            user_id: user.id,
            ...(mode === 'inventory' ? { quantity_current: itm.qty } : {})
          };

          if (existingId) {
            await supabase.from('items').update(itemData).eq('id', existingId).eq('user_id', user.id);
            itemMap.set(key, existingId);
          } else {
            const { data: newItem } = await supabase.from('items').insert(itemData).select('id').single();
            if (newItem) itemMap.set(key, newItem.id);
          }
        }

        // 3. Process Movements / Possession Sync
        if (mode === 'movement') {
          let ok = 0;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const nameValue = row[mapping.nameIdx]?.toString().trim();
            if (!nameValue) continue;

            let cpf = mapping.cpfIdx !== -1 ? row[mapping.cpfIdx]?.toString().trim() : null;
            const cleanedCpf = cpf ? cpf.replace(/\D/g, '') : '';
            const isMaskedCpf = cpf && (cpf.includes('*') || cpf.toUpperCase().includes('X'));
            
            const empKey = (!isMaskedCpf && cleanedCpf.length === 11) ? cleanedCpf : nameValue.toLowerCase();
            const empId = employeeMap.get(empKey);
            
            const code = row[mapping.codeIdx]?.toString().trim();
            const desc = row[mapping.descIdx]?.toString().trim();
            const description = normalizeProductLabelForSave((desc || code || '').trim());
            const itemKey = description.toLowerCase();
            const itemId = itemKey ? itemMap.get(itemKey) : null;
            
            const targetQty = qtyIdx !== -1 ? parseNumericValue(row[qtyIdx]) : 0;

            if (empId && itemId) {
              // Get current possession
              const { data: currentPos } = await supabase
                .from('possession')
                .select('quantity')
                .eq('employee_id', empId)
                .eq('item_id', itemId)
                .maybeSingle();
              
              const currentQty = currentPos?.quantity || 0;
              const diff = targetQty - currentQty;

              if (diff !== 0) {
                // Record adjustment movement
                const moveType = diff > 0 ? 'OUT' : 'IN'; // Positive diff means more items OUT to employee
                const moveQty = Math.abs(diff);

                const mvRes = await recordMovement(supabase, {
                  employee_id: empId,
                  item_id: itemId,
                  quantity: moveQty,
                  type: moveType,
                  performed_by: user.id,
                });
                if (!mvRes.ok) throw new Error(mvRes.message);

                // Update possession record
                const posRes = await updatePossessionQuantity(supabase, empId, itemId, targetQty, user.id);
                if (!posRes.ok) throw new Error(posRes.message);

                // Update Stock (if OUT, decrease stock. if IN, increase stock)
                const stockRes = await updateStock(supabase, itemId, -diff);
                if (!stockRes.ok) throw new Error(stockRes.message);
              }
              ok++;
            }
            setProgress(prev => ({ ...prev, current: i + 1 }));
          }
          setProgress(prev => ({ ...prev, status: 'completed', message: `Sincronização concluída: ${ok} registros.` }));
        } else {
          setProgress(prev => ({ ...prev, status: 'completed', message: 'Inventário atualizado!' }));
        }
        setTimeout(onComplete, 2000);
      } catch (err: any) {
        console.error(err);
        setProgress(prev => ({ ...prev, status: 'error', message: err.message || 'Erro no processamento.' }));
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg animate-in zoom-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          {mode === 'inventory' ? <Package className="text-secondary" /> : <Users className="text-secondary" />}
          Importar {mode === 'inventory' ? 'Inventário' : 'Movimentação'}
        </h2>
        <button onClick={onComplete} className="text-slate-400 hover:text-primary">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-6">
        {progress.status === 'idle' && mode === 'inventory' && (
          <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/90 to-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-teal-900 font-medium leading-relaxed">
              <p className="font-black uppercase tracking-wide text-[10px] text-teal-800 mb-1">Modelo oficial</p>
              <p>Baixe a planilha formatada (duas abas: Materiais + Instruções) e preencha conforme o guia.</p>
            </div>
            <button
              type="button"
              onClick={() => downloadInventoryImportTemplate()}
              className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 text-white rounded-lg font-bold text-sm hover:bg-teal-800 shadow-md shadow-teal-900/10"
            >
              <Download size={18} />
              Baixar modelo .xlsx
            </button>
          </div>
        )}
        {progress.status === 'idle' && (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center hover:border-secondary transition-colors group cursor-pointer relative bg-slate-50/50">
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileUpload}
            />
            <div className="flex flex-col items-center">
              <FileUp className="w-10 h-10 text-slate-300 group-hover:text-secondary mb-4 transition-transform group-hover:-translate-y-1" />
              <p className="text-sm font-bold text-primary">Carregar planilha</p>
              <p className="text-xs text-slate-400 mt-1">.XLSX, .XLS ou .CSV</p>
            </div>
          </div>
        )}

        {progress.status !== 'idle' && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              {['parsing', 'uploading'].includes(progress.status) ? (
                <Loader2 className="animate-spin text-secondary" size={24} />
              ) : progress.status === 'completed' ? (
                <CheckCircle2 className="text-green-500" size={24} />
              ) : (
                <AlertCircle className="text-red-500" size={24} />
              )}
              <div className="flex-1">
                <p className="text-sm font-bold text-primary">{progress.message}</p>
                {progress.total > 0 && (
                  <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div 
                      className="bg-secondary h-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
          <Info className="text-amber-600 shrink-0" size={20} />
          <div className="text-xs text-amber-800 space-y-2">
            <p className="font-bold uppercase tracking-widest text-[10px]">Aviso</p>
            <p>O sistema tentará detectar as colunas automaticamente. Certifique-se de que a planilha possui colunas de Nome e Item.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
