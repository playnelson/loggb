'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { FileUp, Loader2, CheckCircle2, AlertCircle, X, Info, Users, Package } from 'lucide-react';

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

        // Robust Header Detection: Find the first row that contains at least one keyword
        const nameKeywords = ['NOME', 'FUNCIONARIO', 'COLABORADOR', 'USER', 'PESSOA', 'FULL_NAME', 'WORKER', 'CONTRIBUTOR'];
        const cpfKeywords = ['CPF', 'ID', 'IDENTIDADE', 'DOC', 'REGISTRY'];
        const codeKeywords = ['CODIGO', 'CODE', 'REF', 'ID_ITEM', 'MAT', 'ITEM_CODE', 'REFERENCIA', 'SKU'];
        const descKeywords = ['DESCRICAO', 'ITEM', 'DESC', 'MATERIAL', 'PRODUCT', 'DESCRIÇÃO', 'ARTICLE', 'OBJETO'];
        const qtyKeywords = ['QUANTIDADE', 'QTY', 'STOCK', 'ESTOQUE', 'TOTAL', 'SALDO', 'RETIRADO', 'DEVOLVIDO', 'POSSE', 'SALDO ATUAL', 'BALANCE', 'QTD'];
        const categoryKeywords = ['CATEGORIA', 'CATEGORY', 'GRUPO', 'TIPO'];
        const originKeywords = ['ORIGEM', 'LOCAL', 'LOCATION', 'DEPÓSITO', 'ALMOXARIFADO'];
        const consumableKeywords = ['CONSUMÍVEL', 'CONSUMIVEL', 'CONSUMABLE'];
        const minKeywords = ['MÍNIMO', 'MINIMO', 'MIN', 'LIMIT', 'ALERTA', 'MINIMO_ESTOQUE'];

        const allKeywords = [
          ...nameKeywords, ...cpfKeywords, ...codeKeywords, ...descKeywords, 
          ...qtyKeywords, ...categoryKeywords, ...originKeywords, 
          ...consumableKeywords, ...minKeywords
        ];

        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rawData.length, 15); i++) { // Check more rows for safety
          const row = rawData[i];
          if (!row || !Array.isArray(row)) continue;
          
          const rowStr = row.join(' ').toUpperCase();
          const matchCount = allKeywords.filter(k => rowStr.includes(k)).length;
          if (matchCount >= 2) { // At least 2 keyword matches to be more confident
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
          codeIdx: findBestIdx(codeKeywords),
          descIdx: findBestIdx(descKeywords),
          qtyIdx: findBestIdx(qtyKeywords),
          categoryIdx: findBestIdx(categoryKeywords),
          locationIdx: findBestIdx(originKeywords),
          consumableIdx: findBestIdx(consumableKeywords),
          minIdx: findBestIdx(minKeywords)
        };

        console.log('Detected mapping:', mapping);

        if (rows.length === 0) throw new Error('Dados não encontrados.');

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Processando...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        const employeeMap = new Map<string, string>(); 
        const uniquePeople = new Map<string, any>();

        if (mapping.nameIdx !== -1) {
          rows.forEach(row => {
            const nameValue = row[mapping.nameIdx];
            if (!nameValue) return;
            const name = nameValue.toString().trim();
            let cpf = mapping.cpfIdx !== -1 ? row[mapping.cpfIdx]?.toString().replace(/\D/g, '') : null;
            if (cpf && cpf.length > 0 && cpf.length < 11) cpf = cpf.padStart(11, '0');
            
            if (name && name.length > 2) {
              const key = cpf || name.toLowerCase();
              if (!uniquePeople.has(key)) uniquePeople.set(key, { name, cpf });
            }
          });
        }

        let pCount = 0;
        for (const [key, person] of uniquePeople.entries()) {
          pCount++;
          setProgress(prev => ({ ...prev, message: `Colaboradores: ${pCount}/${uniquePeople.size}` }));
          
          let empId = null;
          if (person.cpf) {
            const { data } = await supabase.from('employees').select('id').eq('cpf', person.cpf).limit(1);
            if (data?.[0]) empId = data[0].id;
          }
          if (!empId) {
            const { data } = await supabase.from('employees').select('id').ilike('full_name', person.name).limit(1);
            if (data?.[0]) empId = data[0].id;
          }

          if (empId) {
            employeeMap.set(key, empId);
          } else {
            const { data } = await supabase.from('employees').insert({
              full_name: person.name,
              cpf: person.cpf || null,
              status: 'Ativo',
              user_id: user.id
            }).select('id').single();
            if (data) employeeMap.set(key, data.id);
          }
        }

        const itemMap = new Map<string, string>();
        const uniqueItems = new Map<string, any>();

        if (mapping.codeIdx !== -1 || mapping.descIdx !== -1) {
          rows.forEach(row => {
            const code = mapping.codeIdx !== -1 ? row[mapping.codeIdx]?.toString().trim() : '';
            const desc = mapping.descIdx !== -1 ? row[mapping.descIdx]?.toString().trim() : '';
            
            if (code || desc) {
              const itemKey = code || desc;
              if (!uniqueItems.has(itemKey)) {
                const qty = mapping.qtyIdx !== -1 ? parseNumericValue(row[mapping.qtyIdx]) : 0;
                const min = mapping.minIdx !== -1 ? parseNumericValue(row[mapping.minIdx]) : 1;
                const category = mapping.categoryIdx !== -1 ? row[mapping.categoryIdx]?.toString().trim() : null;
                const location = mapping.locationIdx !== -1 ? row[mapping.locationIdx]?.toString().trim() : 'Almoxarifado';
                const consumable = mapping.consumableIdx !== -1 ? parseBooleanValue(row[mapping.consumableIdx]) : false;
                
                // Deterministic code if missing: PRE-description-slug
                const generatedCode = `REF-${desc.toUpperCase().replace(/[^A-Z0-9]/g, '-').slice(0, 10)}-${Math.random().toString(36).substr(2, 3).toUpperCase()}`;

                uniqueItems.set(itemKey, {
                  code: code || generatedCode,
                  description: desc || 'Sem descrição',
                  qty,
                  min,
                  category,
                  location,
                  consumable
                });
              }
            }
          });
        }

        let iCount = 0;
        for (const [key, itm] of uniqueItems.entries()) {
          iCount++;
          setProgress(prev => ({ ...prev, message: `Itens: ${iCount}/${uniqueItems.size}` }));
          
          // Check for existing item by code OR description to prevent duplicates
          let existingId = null;
          
          // 1. Try by code
          if (itm.code && !itm.code.startsWith('REF-')) {
            const { data: byCode } = await supabase.from('items').select('id').eq('code', itm.code).maybeSingle();
            if (byCode) existingId = byCode.id;
          }
          
          // 2. Try by description (if not found by code)
          if (!existingId && itm.description) {
            const { data: byDesc } = await supabase.from('items').select('id').ilike('description', itm.description).maybeSingle();
            if (byDesc) existingId = byDesc.id;
          }

          const itemData = {
            code: itm.code,
            description: itm.description,
            category: itm.category,
            location: itm.location,
            consumable: itm.consumable,
            quantity_min: itm.min,
            user_id: user.id,
            ...(mode === 'inventory' ? { quantity_current: itm.qty } : {})
          };

          if (existingId) {
            await supabase.from('items').update(itemData).eq('id', existingId);
            itemMap.set(key, existingId);
          } else {
            const { data: newItem } = await supabase.from('items').insert(itemData).select('id').single();
            if (newItem) itemMap.set(key, newItem.id);
          }
        }

        if (mode === 'movement') {
          let ok = 0;
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const name = row[mapping.nameIdx]?.toString().trim();
            let cpf = mapping.cpfIdx !== -1 ? row[mapping.cpfIdx]?.toString().replace(/\D/g, '') : null;
            const code = row[mapping.codeIdx]?.toString().trim();
            const desc = row[mapping.descIdx]?.toString().trim();
            const qty = parseNumericValue(row[mapping.qtyIdx]);

            const empId = name ? employeeMap.get(cpf || name.toLowerCase()) : null;
            const itemId = (code || desc) ? itemMap.get(code || desc) : null;

            if (empId && itemId && qty > 0) {
              await supabase.from('movements').insert({
                employee_id: empId, item_id: itemId, quantity: qty, type: 'OUT', performed_by: user.id
              });
              
              const { data: item } = await supabase.from('items').select('consumable').eq('id', itemId).single();
              if (item && !item.consumable) {
                const { data: pos } = await supabase.from('possession').select('quantity').eq('employee_id', empId).eq('item_id', itemId).single();
                await supabase.from('possession').upsert({
                  employee_id: empId, item_id: itemId, user_id: user.id,
                  quantity: (pos?.quantity || 0) + qty
                }, { onConflict: 'employee_id,item_id' });
              }
              await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: -qty });
              ok++;
            } else {
              console.log('Skipping movement because:', {
                hasEmp: !!empId,
                hasItem: !!itemId,
                qty
              }, 'Row:', row);
            }
            setProgress(prev => ({ ...prev, current: i + 1 }));
          }
          setProgress(prev => ({ ...prev, status: 'completed', message: `${ok} registros salvos.` }));
        } else {
          setProgress(prev => ({ ...prev, status: 'completed', message: 'Concluído!' }));
        }
        setTimeout(onComplete, 2000);
      } catch (err: any) {
        console.error(err);
        setProgress(prev => ({ ...prev, status: 'error', message: err.message || 'Erro.' }));
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
