'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { FileUp, Loader2, CheckCircle2, AlertCircle, X, Info } from 'lucide-react';

interface ImportProgress {
  total: number;
  current: number;
  status: 'idle' | 'parsing' | 'uploading' | 'completed' | 'error';
  message: string;
}

export default function ImportSpreadsheet({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0,
    current: 0,
    status: 'idle',
    message: ''
  });

  const getCol = (row: any, keys: string[]) => {
    // Busca insensitiva a maiúsculas/minúsculas e variações
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

        setProgress({ total: rows.length, current: 0, status: 'uploading', message: 'Iniciando importação...' });
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Usuário não autenticado.');

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          
          // Helper to get columns with different names
          const colCode = getCol(row, ['Codigo', 'Código', 'Codigo do Item', 'Código do Item', 'Item Code', 'ID Item']);
          const colDesc = getCol(row, ['Descricao', 'Descrição', 'Descricao do Item', 'Descrição do Item', 'Nome do Item']);
          const colCat = getCol(row, ['Categoria', 'Category', 'Grupo']);
          const colUnit = getCol(row, ['Unidade', 'Unit', 'UN']);
          const colLoc = getCol(row, ['Local', 'Localizacao', 'Localização', 'Pátio', 'Prateleira', 'Departamento']);
          const colQty = getCol(row, ['Qtd Atual', 'Quantidade Atual', 'Saldo', 'Estoque', 'Saldo Atual', 'Saldo Atual (em Posse)', 'Quantidade']);
          const colMin = getCol(row, ['Qtd Minima', 'Qtd Mínima', 'Qtd Min', 'Qtd Mín', 'Estoque Mínimo', 'Estoque Minimo']);
          const colEmployee = getCol(row, ['Funcionario', 'Funcionário', 'Nome', 'Colaborador']);
          const colCPF = getCol(row, ['CPF', 'Documento']);
          const colRole = getCol(row, ['Cargo', 'Função', 'Funcao']);
          const colWithdrawn = getCol(row, ['Total Retirado', 'Retirado', 'Saida', 'Quantidade Retirada', 'Qtd Retirada']);
          const colReturned = getCol(row, ['Total Devolvido', 'Devolvido', 'Entrada', 'Quantidade Devolvida', 'Qtd Devolvida']);

          // 1. Upsert Item (Shared across both modes)
          let itemId = null;
          if (colCode) {
            const { data: itemData, error: itemError } = await supabase
              .from('items')
              .upsert({
                code: colCode.toString(),
                description: colDesc || '',
                category: colCat || 'Consumível',
                unit: colUnit || 'un',
                location: colLoc || null,
                quantity_current: colQty !== null ? Number(colQty) : undefined,
                quantity_min: colMin !== null ? Number(colMin) : undefined,
                user_id: user.id
              }, { onConflict: 'code' })
              .select('id')
              .single();

            if (itemError) {
              console.error('Erro ao processar item:', itemError);
            } else {
              itemId = itemData.id;
            }
          }

          // 2. Logic for "Movement Log" Format
          if (colEmployee && colCode && itemId) {
             let employeeId = null;
             const { data: empData, error: empError } = await supabase
               .from('employees')
               .upsert({
                 full_name: colEmployee,
                 cpf: colCPF?.toString() || null,
                 role: colRole || null,
                 status: row['Status'] || 'Ativo',
                 user_id: user.id
               }, { onConflict: 'cpf' })
               .select('id')
               .single();
             
             if (empError) {
               console.error('Erro ao processar funcionário:', empError);
             } else {
               employeeId = empData.id;
             }

             if (employeeId) {
                const withdrawn = Number(colWithdrawn) || 0;
                const returned = Number(colReturned) || 0;

                if (withdrawn > 0) {
                  await supabase.from('movements').insert([{
                    item_id: itemId,
                    employee_id: employeeId,
                    type: 'Saida',
                    quantity: withdrawn,
                    performed_by: user.id
                  }]);
                }

                if (returned > 0) {
                  await supabase.from('movements').insert([{
                    item_id: itemId,
                    employee_id: employeeId,
                    type: 'Entrada',
                    quantity: returned,
                    performed_by: user.id
                  }]);
                }
             }
          }

          setProgress(prev => ({ ...prev, current: i + 1, message: `Processando: ${i + 1} de ${rows.length}` }));
        }

        setProgress(prev => ({ ...prev, status: 'completed', message: 'Importação concluída com sucesso!' }));
        setTimeout(() => {
          onComplete();
        }, 2000);

      } catch (error: any) {
        console.error('Erro na importação:', error);
        setProgress({ ...progress, status: 'error', message: error.message || 'Erro desconhecido.' });
      }
    };

    reader.readAsBinaryString(file);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md animate-in zoom-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-primary flex items-center gap-2">
          <FileUp className="text-secondary" />
          Módulo de Importação
        </h2>
        <button onClick={onComplete} className="text-slate-400 hover:text-primary">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-6">
        {progress.status === 'idle' && (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-secondary transition-colors group cursor-pointer relative">
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileUpload}
            />
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-4 group-hover:bg-secondary/10 transition-colors">
                <FileUp className="text-slate-400 group-hover:text-secondary" />
              </div>
              <p className="text-sm font-bold text-primary">Subir Planilha Inteligente</p>
              <p className="text-xs text-slate-400 mt-1">Logs de Movimentação ou Lista de Inventário</p>
            </div>
          </div>
        )}

        {progress.status !== 'idle' && (
          <div className="space-y-4">
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
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-2 overflow-hidden">
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
        
        <div className="p-4 bg-slate-50 rounded-xl border border-border">
          <div className="flex items-center gap-2 text-primary font-bold text-xs mb-3">
            <Info size={14} className="text-secondary" />
            FORMATOS SUPORTADOS
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opção A: Log de Movimentação</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Mapeia quem retirou o quê. Requer colunas `Funcionario`, `CPF` e `Total Retirado/Devolvido`.</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Opção B: Lista de Inventário</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Atualiza o estoque atual. Requer colunas `Código/Codigo` e `Qtd Atual`.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
