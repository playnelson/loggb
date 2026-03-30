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
        const sheetName = workbook.SheetNames[0]; 
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet) as any[];

        if (rows.length === 0) {
          throw new Error('Planilha vazia ou formato inválido.');
        }

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Iniciando processamento...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          
          try {
            // Mapeamento de Colunas (mais robusto)
            const colCode = getCol(row, ['Codigo', 'Código', 'Codigo do Item', 'Código do Item', 'Item Code', 'Item']);
            const colDesc = getCol(row, ['Descricao', 'Descrição', 'Descricao do Item', 'Descrição do Item', 'Product']);
            const colQtyStock = getCol(row, ['Qtd. em Estoque', 'Qtd em Estoque', 'Estoque', 'Saldo Estoque', 'Current Stock']);
            const colQtyTotal = getCol(row, ['Qtd. Total', 'Qtd Total', 'Total', 'Saldo Total', 'Total Qty']);
            const colQtyMin = getCol(row, ['Qtd. Mínima', 'Qtd Minima', 'Qtd Min', 'Qtd Mín', 'Min Stock']);
            const colUnit = getCol(row, ['Unidade', 'Unid.', 'Unit']);
            const colCat = getCol(row, ['Categoria', 'Category']);
            const colConsumable = getCol(row, ['Consumível?', 'Consumivel?', 'Consumivel', 'Consumable']);
            
            const colLoc = getCol(row, ['Local', 'Localizacao', 'Localização', 'Pátio', 'Storage']);
            const colEmployee = getCol(row, ['Funcionario', 'Funcionário', 'Nome', 'Employee', 'Name']);
            const colCPF = getCol(row, ['CPF']);
            const colRole = getCol(row, ['Cargo', 'Role', 'Função', 'Função']);
            const colDept = getCol(row, ['Departamento', 'Dept', 'Setor', 'Setor']);
            const colWithdrawn = getCol(row, ['Total Retirado', 'Retirado', 'Quantidade Retirada', 'Saida', 'Withdrawal']);
            const colReturned = getCol(row, ['Total Devolvido', 'Devolvido', 'Quantidade Devolvida', 'Entrada', 'Return']);

            // 1. Process Item 
            let itemId = null;
            if (colCode) {
              const codeStr = colCode.toString().trim();
              if (codeStr) {
                const itemPayload: any = {
                  code: codeStr,
                  description: colDesc?.toString().trim() || 'Sem descrição',
                  category: colCat?.toString().trim() || (colConsumable?.toString().toLowerCase().includes('sim') ? 'Consumível' : 'Ferramenta'),
                  unit: colUnit?.toString().trim() || 'un',
                  location: colLoc?.toString().trim() || (mode === 'movement' ? colDept?.toString().trim() : null),
                  consumable: colConsumable?.toString().toLowerCase().includes('sim') || false,
                  user_id: user.id
                };

                if (mode === 'inventory') {
                  const qVal = colQtyStock !== null ? colQtyStock : colQtyTotal;
                  if (qVal !== null) {
                    itemPayload.quantity_current = parseNumericValue(qVal);
                  }
                  if (colQtyMin !== null) {
                    itemPayload.quantity_min = parseNumericValue(colQtyMin);
                  }
                }

                const { data: itemData, error: itemErr } = await supabase
                  .from('items')
                  .upsert(itemPayload, { onConflict: 'code' })
                  .select('id')
                  .limit(1);

                if (itemErr) {
                  console.warn(`Erro no item da linha ${i+1}:`, itemErr);
                } else if (itemData && itemData.length > 0) {
                  itemId = itemData[0].id;
                }
              }
            }

            // 2. Process Employee & Movement
            if (mode === 'movement' && colEmployee) {
              const employeeName = colEmployee.toString().trim();
              if (employeeName) {
                let employeeId = null;
                
                // Limpeza CPF: Tratar como string, remover não-números e preencher com zeros (11 dígitos)
                let cleanedCPF = colCPF?.toString().replace(/\D/g, '') || null;
                if (cleanedCPF && cleanedCPF.length > 0 && cleanedCPF.length < 11) {
                  cleanedCPF = cleanedCPF.padStart(11, '0');
                }

                // Busca robusta de funcionário
                let empSearchData = null;
                if (cleanedCPF) {
                  const { data } = await supabase.from('employees').select('id').eq('cpf', cleanedCPF).limit(1);
                  if (data && data.length > 0) empSearchData = data[0];
                }

                if (!empSearchData) {
                  const { data } = await supabase.from('employees').select('id').ilike('full_name', employeeName).limit(1);
                  if (data && data.length > 0) empSearchData = data[0];
                }

                if (!empSearchData) {
                  // Inserir novo funcionário
                  const { data: newData, error: newError } = await supabase
                    .from('employees')
                    .insert({
                      full_name: employeeName,
                      cpf: cleanedCPF,
                      role: colRole?.toString().trim() || null,
                      department: colDept?.toString().trim() || null,
                      status: 'Ativo',
                      user_id: user.id
                    })
                    .select('id')
                    .limit(1);
                  
                  if (!newError && newData && newData.length > 0) {
                    employeeId = newData[0].id;
                  } else if (newError) {
                    console.warn(`Erro ao criar funcionário na linha ${i+1}:`, newError);
                  }
                } else {
                  employeeId = empSearchData.id;
                  // Atualizar informações se necessário (ex: cargo ou departamento que pode ter mudado)
                  if (colRole || colDept) {
                    await supabase.from('employees').update({
                      role: colRole?.toString().trim() || undefined,
                      department: colDept?.toString().trim() || undefined
                    }).eq('id', employeeId);
                  }
                }

                // Registrar Movimentações se houver Item e quantidades
                if (employeeId && itemId) {
                  const qWithdrawn = parseNumericValue(colWithdrawn);
                  const qReturned = parseNumericValue(colReturned);

                  if (qWithdrawn > 0) {
                    await supabase.from('movements').insert([{
                      item_id: itemId,
                      employee_id: employeeId,
                      type: 'OUT',
                      quantity: qWithdrawn,
                      performed_by: user.id
                    }]);

                    // Update Possession - ONLY for non-consumables
                    const { data: item } = await supabase.from('items').select('consumable').eq('id', itemId).limit(1);
                    if (item && item.length > 0 && !item[0].consumable) {
                      const { data: currentPos } = await supabase.from('possession').select('quantity').eq('employee_id', employeeId).eq('item_id', itemId).limit(1);
                      const currentQty = (currentPos && currentPos.length > 0) ? currentPos[0].quantity : 0;
                      await supabase.from('possession').upsert({
                        employee_id: employeeId,
                        item_id: itemId,
                        quantity: currentQty + qWithdrawn,
                        user_id: user.id
                      }, { onConflict: 'employee_id,item_id' });
                    }

                    // Update stock
                    await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: -qWithdrawn });
                  }

                  if (qReturned > 0) {
                    await supabase.from('movements').insert([{
                      item_id: itemId,
                      employee_id: employeeId,
                      type: 'IN',
                      quantity: qReturned,
                      performed_by: user.id
                    }]);

                    // Update Possession
                    const { data: item } = await supabase.from('items').select('consumable').eq('id', itemId).limit(1);
                    if (item && item.length > 0 && !item[0].consumable) {
                      const { data: currentPos } = await supabase.from('possession').select('quantity').eq('employee_id', employeeId).eq('item_id', itemId).limit(1);
                      const currentQty = (currentPos && currentPos.length > 0) ? currentPos[0].quantity : 0;
                      const newQty = Math.max(0, currentQty - qReturned);
                      
                      if (newQty <= 0) {
                        await supabase.from('possession').delete().match({ employee_id: employeeId, item_id: itemId });
                      } else {
                        await supabase.from('possession').upsert({
                          employee_id: employeeId,
                          item_id: itemId,
                          quantity: newQty,
                          user_id: user.id
                        }, { onConflict: 'employee_id,item_id' });
                      }
                    }

                    // Update stock
                    await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: qReturned });
                  }
                }
              }
            }

            successCount++;
          } catch (rowError) {
            console.error(`Erro processando linha ${i + 1}:`, rowError);
            errorCount++;
          }

          setProgress(prev => ({ 
            ...prev, 
            current: i + 1, 
            message: `Processando: ${i + 1} de ${rows.length}${errorCount > 0 ? ` (${errorCount} erros)` : ''}` 
          }));
        }

        setProgress(prev => ({ 
          ...prev, 
          status: 'completed', 
          message: `Importação finalizada! Sucessos: ${successCount}. Falhas: ${errorCount}.` 
        }));
        setTimeout(onComplete, 3000);

      } catch (error: any) {
        console.error('Erro geral na importação:', error);
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
