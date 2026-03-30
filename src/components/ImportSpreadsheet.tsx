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

  const getCol = (row: any, keys: string[]) => {
    const rowKeys = Object.keys(row);
    for (const key of keys) {
      const foundKey = rowKeys.find(rk => 
        rk.toLowerCase().trim() === key.toLowerCase().trim() ||
        rk.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() === 
        key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
      );
      if (foundKey !== undefined) return row[foundKey];
    }
    return null;
  };

  const parseNumericValue = (val: any) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    
    const str = val.toString().trim();
    // Tenta detectar padrão brasileiro: pontos como milhar e vírgula como decimal
    // Ou simplesmente remove pontos de milhar e troca vírgula por ponto
    let cleaned = str;
    
    // Se tem vírgula e ponto: 1.234,56
    if (str.includes(',') && str.includes('.')) {
      cleaned = str.replace(/\./g, '').replace(',', '.');
    } 
    // Se tem apenas vírgula: 1234,56
    else if (str.includes(',')) {
      cleaned = str.replace(',', '.');
    }
    
    // Remove qualquer outro caractere não numérico (exceto sinal negativo no início)
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
        const sheetName = workbook.SheetNames[0]; // Pegar primeira aba se houver várias
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet) as any[];

        if (rows.length === 0) {
          throw new Error('Planilha vazia ou formato inválido.');
        }

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Processando dados...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          
          const colCode = getCol(row, ['Codigo', 'Código', 'Codigo do Item', 'Código do Item', 'Item Code']);
          const colDesc = getCol(row, ['Descricao', 'Descrição', 'Descricao do Item', 'Descrição do Item']);
          const colQtyStock = getCol(row, ['Qtd. em Estoque', 'Qtd em Estoque', 'Estoque', 'Saldo Estoque']);
          const colQtyTotal = getCol(row, ['Qtd. Total', 'Qtd Total', 'Total', 'Saldo Total']);
          const colQtyMin = getCol(row, ['Qtd. Mínima', 'Qtd Minima', 'Qtd Min', 'Qtd Mín']);
          const colUnit = getCol(row, ['Unidade', 'Unio.']);
          const colCat = getCol(row, ['Categoria', 'Category']);
          const colConsumable = getCol(row, ['Consumível?', 'Consumivel?', 'Consumivel']);
          
          const colLoc = getCol(row, ['Local', 'Localizacao', 'Localização', 'Pátio']);
          const colEmployee = getCol(row, ['Funcionario', 'Funcionário', 'Nome']);
          const colCPF = getCol(row, ['CPF']);
          const colRole = getCol(row, ['Cargo']);
          const colWithdrawn = getCol(row, ['Total Retirado', 'Retirado', 'Quantidade Retirada', 'Saida']);
          const colReturned = getCol(row, ['Total Devolvido', 'Devolvido', 'Quantidade Devolvida', 'Entrada']);

          // 1. Process Item (ALWAYS in Inventory mode, Optional in Movement mode)
          let itemId = null;
          if (colCode) {
            const itemPayload: any = {
              code: colCode.toString().trim(),
              description: colDesc || '',
              category: colCat || (colConsumable?.toString().toLowerCase().includes('sim') ? 'Consumível' : 'Ferramenta'),
              unit: colUnit || 'un',
              location: colLoc || null,
              user_id: user.id
            };

            // No modo inventário, atualiza os saldos totais
            if (mode === 'inventory') {
              // Prioriza 'Qtd. em Estoque', senão usa 'Qtd. Total'
              const qVal = colQtyStock !== null ? colQtyStock : colQtyTotal;
              if (qVal !== null) {
                itemPayload.quantity_current = parseNumericValue(qVal);
              }
              if (colQtyMin !== null) {
                itemPayload.quantity_min = parseNumericValue(colQtyMin);
              }
            }

            const { data: itemData } = await supabase
              .from('items')
              .upsert(itemPayload, { onConflict: 'code' })
              .select('id')
              .single();

            itemId = itemData?.id;
          }

          // 2. Movement Logic: Employees and Movements
          if (mode === 'movement' && colEmployee && itemId) {
            // Deduplicação de Funcionário (Nome ou CPF)
            let employeeId = null;
            const cleanedCPF = colCPF?.toString().replace(/\D/g, '') || null;
            
            // Busca por CPF primeiro
            let { data: empData } = cleanedCPF 
              ? await supabase.from('employees').select('id').eq('cpf', cleanedCPF).single()
              : { data: null };

            // Se não achou por CPF, busca por Nome (Trimmado e case insensitive no DB)
            if (!empData) {
              const { data: nameData } = await supabase
                .from('employees')
                .select('id')
                .ilike('full_name', colEmployee.toString().trim())
                .limit(1)
                .single();
              empData = nameData;
            }

            if (!empData) {
               // Criar novo se não existir
               const { data: newData, error: newError } = await supabase
                 .from('employees')
                 .insert({
                   full_name: colEmployee.toString().trim(),
                   cpf: cleanedCPF,
                   role: colRole || null,
                   status: 'Ativo',
                   user_id: user.id
                 })
                 .select('id')
                 .single();
               
               if (!newError) employeeId = newData.id;
            } else {
              employeeId = empData.id;
            }

            if (employeeId) {
              const qWithdrawn = parseNumericValue(colWithdrawn);
              const qReturned = parseNumericValue(colReturned);

              if (qWithdrawn > 0) {
                await supabase.from('movements').insert([{
                  item_id: itemId,
                  employee_id: employeeId,
                  type: 'Saida',
                  quantity: qWithdrawn,
                  performed_by: user.id
                }]);
              }

              if (qReturned > 0) {
                await supabase.from('movements').insert([{
                  item_id: itemId,
                  employee_id: employeeId,
                  type: 'Entrada',
                  quantity: qReturned,
                  performed_by: user.id
                }]);
              }
            }
          }

          setProgress(prev => ({ ...prev, current: i + 1, message: `Finalizando: ${i + 1} de ${rows.length}` }));
        }

        setProgress(prev => ({ ...prev, status: 'completed', message: 'Importação finalizada!' }));
        setTimeout(onComplete, 1500);

      } catch (error: any) {
        console.error('Erro na importação:', error);
        setProgress({ ...progress, status: 'error', message: error.message || 'Erro inesperado.' });
      }
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-lg animate-in zoom-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          {mode === 'inventory' ? <Package className="text-secondary" /> : <Users className="text-secondary" />}
          Importar {mode === 'inventory' ? 'Produtos/Inventário' : 'Movimentação/Log'}
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
              <p className="text-sm font-bold text-primary">Carregar arquivo da planilha</p>
              <p className="text-xs text-slate-400 mt-1">.XLSX, .XLS ou .CSV</p>
            </div>
          </div>
        )}

        {progress.status !== 'idle' && (
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-3">
              {progress.status === 'parsing' || progress.status === 'uploading' ? (
                <Loader2 className="animate-spin text-secondary" size={24} />
              ) : progress.status === 'completed' ? (
                <CheckCircle2 className="text-green-500" size={24} />
              ) : (
                <AlertCircle className="text-red-500" size={24} />
              )}
              <div className="flex-1">
                <p className="text-sm font-bold text-primary">{progress.message}</p>
                {progress.status === 'uploading' && (
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
            <p className="font-bold uppercase tracking-widest text-[10px]">Atenção no Formato</p>
            {mode === 'inventory' ? (
              <p>O modo **Inventário** atualizará os códigos, descrições e o **saldo total** de cada item no sistema. Use para fazer balanços.</p>
            ) : (
              <p>O modo **Movimentação** registrará as retiradas e devoluções nos históricos e **não** sobrescreverá o saldo total dos materiais diretamente.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
