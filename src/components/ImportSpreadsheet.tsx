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
    let cleaned = str;
    
    if (str.includes(',') && str.includes('.')) {
      cleaned = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
      cleaned = str.replace(',', '.');
    }
    
    const finalCleaned = cleaned.replace(/(?!^-)[^\d.]/g, '');
    const num = parseFloat(finalCleaned);
    return isNaN(num) ? 0 : num;
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

        // HEADERS ARE ALWAYS THE FIRST ROW
        const headerRowIndex = 0;
        const headers = rawData[headerRowIndex].map(h => h?.toString().toUpperCase().trim() || '');
        const rows = rawData.slice(1);

        console.log('Detected Headers:', headers);

        const mapping = {
          nameIdx: headers.findIndex(h => h.includes('FUNCIONARIO') || h.includes('NOME')),
          cpfIdx: headers.findIndex(h => h === 'CPF'),
          codeIdx: headers.findIndex(h => h.includes('CODIGO') || h.includes('REFERENCIA')),
          descIdx: headers.findIndex(h => h.includes('DESCRICAO') || h.includes('ITEM')),
          qtyIdx: headers.findIndex(h => h.includes('SALDO') || h.includes('QUANTIDADE') || h.includes('TOTAL RETIRADO') || h.includes('EM POSSE'))
        };

        console.log('Initial mapping:', mapping);

        // Fallbacks if specific headers not found
        if (mapping.nameIdx === -1) mapping.nameIdx = 0;
        if (mapping.codeIdx === -1) mapping.codeIdx = 5;
        if (mapping.descIdx === -1) mapping.descIdx = 6;
        if (mapping.qtyIdx === -1) mapping.qtyIdx = 11;

        console.log('Final mapping indices:', mapping);

        if (rows.length === 0) throw new Error('Não foram encontrados dados na planilha.');

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Processando...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        const employeeMap = new Map<string, string>(); 
        const uniquePeople = new Map<string, any>();

        rows.forEach(row => {
          const name = row[mapping.nameIdx]?.toString().trim();
          let cpf = mapping.cpfIdx !== -1 ? row[mapping.cpfIdx]?.toString().replace(/\D/g, '') : null;
          if (cpf && cpf.length > 0 && cpf.length < 11) cpf = cpf.padStart(11, '0');
          
          if (name && name.length > 2) {
            const key = cpf || name.toLowerCase();
            if (!uniquePeople.has(key)) uniquePeople.set(key, { name, cpf });
          } else {
            console.log('Skipping person in row because name too short or empty:', row);
          }
        });

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

        rows.forEach(row => {
          const code = row[mapping.codeIdx]?.toString().trim();
          const desc = row[mapping.descIdx]?.toString().trim();
          if (code || desc) {
            const itemKey = code || desc;
            if (!uniqueItems.has(itemKey)) {
              const qty = parseNumericValue(row[mapping.qtyIdx]);
              uniqueItems.set(itemKey, {
                code: code || `REF-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
                description: desc || 'Sem descrição',
                qty
              });
            }
          } else {
            console.log('Skipping item in row because both code and description are empty:', row);
          }
        });

        let iCount = 0;
        for (const [key, itm] of uniqueItems.entries()) {
          iCount++;
          setProgress(prev => ({ ...prev, message: `Itens: ${iCount}/${uniqueItems.size}` }));
          const { data } = await supabase.from('items').upsert({
            code: itm.code,
            description: itm.description,
            user_id: user.id,
            ...(mode === 'inventory' ? { quantity_current: itm.qty } : {})
          }, { onConflict: 'code' }).select('id').single();
          if (data) itemMap.set(key, data.id);
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
