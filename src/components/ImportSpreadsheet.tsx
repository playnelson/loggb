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

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Iniciando processamento robusto...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        // PASS 1: Deduplicate and Sync Employees
        setProgress(prev => ({ ...prev, message: 'Fase 1/3: Sincronizando Colaboradores...' }));
        const employeeMap = new Map<string, string>(); // Key (Name or CPF) -> ID
        const uniqueEmployees = new Map<string, any>();

        for (const row of rows) {
          const name = getCol(row, ['Funcionario', 'Funcionário', 'Nome', 'Employee', 'Name', 'Atribuído a', 'Colaborador'])?.toString().trim();
          let cpf = getCol(row, ['CPF', 'Identificação', 'Identificacao'])?.toString().replace(/\D/g, '') || null;
          if (cpf && cpf.length > 0 && cpf.length < 11) cpf = cpf.padStart(11, '0');
          const role = getCol(row, ['Cargo', 'Role', 'Função', 'Função', 'Atividade'])?.toString().trim();
          const dept = getCol(row, ['Departamento', 'Dept', 'Setor', 'Setor', 'Área', 'Area'])?.toString().trim();

          if (name) {
            const key = cpf || name.toLowerCase();
            if (!uniqueEmployees.has(key)) {
              uniqueEmployees.set(key, { name, cpf, role, dept });
            }
          }
        }

        let empIndex = 0;
        for (const [key, emp] of uniqueEmployees.entries()) {
          empIndex++;
          setProgress(prev => ({ ...prev, message: `Fase 1/3: Cadastrando colaboradores (${empIndex}/${uniqueEmployees.size})...` }));
          
          let empId = null;
          // Lookup
          if (emp.cpf) {
            const { data } = await supabase.from('employees').select('id').eq('cpf', emp.cpf).limit(1);
            if (data && data.length > 0) empId = data[0].id;
          }
          if (!empId) {
            const { data } = await supabase.from('employees').select('id').ilike('full_name', emp.name).limit(1);
            if (data && data.length > 0) empId = data[0].id;
          }

          if (empId) {
            // Update existing
            await supabase.from('employees').update({
              role: emp.role || undefined,
              department: emp.dept || undefined
            }).eq('id', empId);
            employeeMap.set(key, empId);
          } else {
            // Insert new
            const { data, error } = await supabase.from('employees').insert({
              full_name: emp.name,
              cpf: emp.cpf,
              role: emp.role || null,
              department: emp.dept || null,
              status: 'Ativo',
              user_id: user.id
            }).select('id').single();
            if (data) employeeMap.set(key, data.id);
            else if (error) console.error('Erro ao criar funcionário:', emp.name, error);
          }
        }

        // PASS 2: Deduplicate and Sync Items
        setProgress(prev => ({ ...prev, message: 'Fase 2/3: Sincronizando Almoxarifado...' }));
        const itemMap = new Map<string, string>(); // Code -> ID
        const uniqueItems = new Map<string, any>();

        for (const row of rows) {
          const code = getCol(row, ['Codigo', 'Código', 'Codigo do Item', 'Código do Item', 'Item Code', 'Item'])?.toString().trim();
          if (code) {
            if (!uniqueItems.has(code)) {
              uniqueItems.set(code, {
                code,
                description: getCol(row, ['Descricao', 'Descrição', 'Descricao do Item', 'Descrição do Item', 'Product'])?.toString().trim() || 'Sem descrição',
                unit: getCol(row, ['Unidade', 'Unid.', 'Unit'])?.toString().trim() || 'un',
                category: getCol(row, ['Categoria', 'Category'])?.toString().trim(),
                consumable: getCol(row, ['Consumível?', 'Consumivel?', 'Consumivel', 'Consumable'])?.toString().toLowerCase().includes('sim') || false,
                location: getCol(row, ['Local', 'Localizacao', 'Localização', 'Pátio', 'Storage', 'Almoxarifado'])?.toString().trim(),
                qty: parseNumericValue(getCol(row, ['Qtd. em Estoque', 'Qtd em Estoque', 'Estoque', 'Saldo Estoque'])),
                qtyMin: parseNumericValue(getCol(row, ['Qtd. Mínima', 'Qtd Minima', 'Qtd Min', 'Qtd Mín']))
              });
            }
          }
        }

        let itemIndex = 0;
        for (const [code, itm] of uniqueItems.entries()) {
          itemIndex++;
          setProgress(prev => ({ ...prev, message: `Fase 2/3: Cadastrando itens (${itemIndex}/${uniqueItems.size})...` }));
          
          const itemPayload: any = {
            code: itm.code,
            description: itm.description,
            category: itm.category || (itm.consumable ? 'Consumível' : 'Ferramenta'),
            unit: itm.unit,
            location: itm.location || null,
            consumable: itm.consumable,
            user_id: user.id
          };

          if (mode === 'inventory') {
            itemPayload.quantity_current = itm.qty;
            itemPayload.quantity_min = itm.qtyMin;
          }

          const { data, error } = await supabase.from('items').upsert(itemPayload, { onConflict: 'code' }).select('id').single();
          if (data) itemMap.set(code, data.id);
          else if (error) console.error('Erro ao sincronizar item:', itm.code, error);
        }

        // PASS 3: Record Movements (if mode is movement)
        if (mode === 'movement') {
          setProgress(prev => ({ ...prev, message: 'Fase 3/3: Registrando históricos...' }));
          let successCount = 0;
          let failCount = 0;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const code = getCol(row, ['Codigo', 'Código', 'Codigo do Item', 'Código do Item', 'Item Code', 'Item'])?.toString().trim();
            const name = getCol(row, ['Funcionario', 'Funcionário', 'Nome', 'Employee', 'Name', 'Atribuído a', 'Colaborador'])?.toString().trim();
            let cpf = getCol(row, ['CPF', 'Identificação', 'Identificacao'])?.toString().replace(/\D/g, '') || null;
            if (cpf && cpf.length > 0 && cpf.length < 11) cpf = cpf.padStart(11, '0');

            const itemId = code ? itemMap.get(code) : null;
            const empKey = name ? (cpf || name.toLowerCase()) : null;
            const employeeId = empKey ? employeeMap.get(empKey) : null;

            if (itemId && employeeId) {
              try {
                const qWithdrawn = parseNumericValue(getCol(row, ['Total Retirado', 'Retirado', 'Quantidade Retirada', 'Saida', 'Withdrawal', 'Qtd Retirada']));
                const qReturned = parseNumericValue(getCol(row, ['Total Devolvido', 'Devolvido', 'Quantidade Devolvida', 'Entrada', 'Return', 'Qtd Devolvida']));

                if (qWithdrawn > 0) {
                  await supabase.from('movements').insert([{
                    item_id: itemId, employee_id: employeeId, type: 'OUT', quantity: qWithdrawn, performed_by: user.id
                  }]);
                  // Aggregated Possession logic...
                  // For simplicity in import, we'll use a single upsert here.
                  const { data: itemData } = await supabase.from('items').select('consumable').eq('id', itemId).single();
                  if (itemData && !itemData.consumable) {
                    const { data: currPos } = await supabase.from('possession').select('quantity').eq('employee_id', employeeId).eq('item_id', itemId).single();
                    await supabase.from('possession').upsert({
                      employee_id: employeeId, item_id: itemId, user_id: user.id,
                      quantity: (currPos?.quantity || 0) + qWithdrawn
                    }, { onConflict: 'employee_id,item_id' });
                  }
                  await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: -qWithdrawn });
                }

                if (qReturned > 0) {
                  await supabase.from('movements').insert([{
                    item_id: itemId, employee_id: employeeId, type: 'IN', quantity: qReturned, performed_by: user.id
                  }]);
                  const { data: currPos } = await supabase.from('possession').select('quantity').eq('employee_id', employeeId).eq('item_id', itemId).single();
                  const newQty = Math.max(0, (currPos?.quantity || 0) - qReturned);
                  if (newQty <= 0) await supabase.from('possession').delete().match({ employee_id: employeeId, item_id: itemId });
                  else await supabase.from('possession').update({ quantity: newQty }).match({ employee_id: employeeId, item_id: itemId });
                  await supabase.rpc('update_stock', { p_item_id: itemId, p_quantity: qReturned });
                }
                successCount++;
              } catch (e) {
                console.error('Erro na movimentação da linha', i, e);
                failCount++;
              }
            } else {
              failCount++;
            }

            setProgress(prev => ({ ...prev, current: i + 1, message: `Fase 3/3: Processando linhas (${i+1}/${rows.length})...` }));
          }

          setProgress(prev => ({ 
            ...prev, 
            status: 'completed', 
            message: `Importação concluída! ${successCount} linhas processadas, ${failCount} ignoradas/erros.` 
          }));
        } else {
          setProgress(prev => ({ ...prev, status: 'completed', message: 'Sincronização de estoque e equipe finalizada!' }));
        }

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
