'use client';

import { ChangeEvent, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Settings as SettingsIcon, 
  Trash2, 
  AlertTriangle, 
  ShieldAlert, 
  Loader2, 
  ArrowLeft,
  AlertCircle,
  Download,
  Upload,
  FileArchive
} from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmStage, setConfirmStage] = useState(1);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupFileName, setBackupFileName] = useState<string | null>(null);
  const [backupPayload, setBackupPayload] = useState<unknown | null>(null);
  const [replaceExistingData, setReplaceExistingData] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetAccountData = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado.');

      // 1. Deletar Movimentações (dependem de itens e funcionários)
      const { error: moveError } = await supabase
        .from('movements')
        .delete()
        .eq('performed_by', user.id);
      
      if (moveError) console.error('Erro ao deletar movimentos:', moveError);

      // 2. Deletar Funcionários
      const { error: rentalsError } = await supabase
        .from('equipment_rentals')
        .delete()
        .eq('user_id', user.id);
      if (rentalsError) console.error('Erro ao deletar aluguéis:', rentalsError);

      const { error: suppliersError } = await supabase
        .from('rental_suppliers')
        .delete()
        .eq('user_id', user.id);
      if (suppliersError) console.error('Erro ao deletar locadoras:', suppliersError);

      // 3. Deletar Funcionários
      const { error: empError } = await supabase
        .from('employees')
        .delete()
        .eq('user_id', user.id);
      
      if (empError) console.error('Erro ao deletar funcionários:', empError);

      // 4. Deletar Itens
      const { error: itemError } = await supabase
        .from('items')
        .delete()
        .eq('user_id', user.id);
      
      if (itemError) console.error('Erro ao deletar itens:', itemError);

      // Sucesso
      setTimeout(() => {
        setIsDeleting(false);
        setIsModalOpen(false);
        router.push('/');
        router.refresh();
      }, 2000);

    } catch (err: any) {
      setError(err.message);
      setIsDeleting(false);
    }
  };

  const claimOrphanTenantData = async () => {
    setClaimMessage(null);
    if (
      !confirm(
        'Isso associa à SUA conta todos os registros que ainda não têm responsável (user_id vazio): materiais e colaboradores.\n\n' +
          'Use somente se você é o dono desses dados ou se há um único uso do sistema. Se outra pessoa usa o mesmo banco com outra conta, ela pode deixar de ver esses registros até corrigir manualmente no Supabase.\n\n' +
          'Continuar?'
      )
    ) {
      return;
    }
    setClaimLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado.');
      const uid = user.id;
      const parts: string[] = [];

      const rItems = await supabase.from('items').update({ user_id: uid }).is('user_id', null).select('id');
      if (rItems.error) parts.push(`Itens: ${rItems.error.message}`);
      else parts.push(`Itens atualizados: ${rItems.data?.length ?? 0} (máx. retorno do servidor).`);

      const rEmp = await supabase.from('employees').update({ user_id: uid }).is('user_id', null).select('id');
      if (rEmp.error) parts.push(`Colaboradores: ${rEmp.error.message}`);
      else parts.push(`Colaboradores: ${rEmp.data?.length ?? 0}.`);

      const rSites = await supabase.from('work_sites').update({ user_id: uid }).is('user_id', null).select('id');
      if (!rSites.error) {
        parts.push(`Sedes/canteiros: ${rSites.data?.length ?? 0}.`);
      } else {
        const em = String(rSites.error.message || '').toLowerCase();
        if (!em.includes('does not exist') && rSites.error.code !== '42P01') {
          parts.push(`Sedes/canteiros: ${rSites.error.message}`);
        }
      }

      const rRentals = await supabase.from('equipment_rentals').update({ user_id: uid }).is('user_id', null).select('id');
      if (!rRentals.error) {
        parts.push(`Aluguéis: ${rRentals.data?.length ?? 0}.`);
      } else {
        const em = String(rRentals.error.message || '').toLowerCase();
        if (!em.includes('does not exist') && rRentals.error.code !== '42P01') {
          parts.push(`Aluguéis: ${rRentals.error.message}`);
        }
      }

      const rSuppliers = await supabase.from('rental_suppliers').update({ user_id: uid }).is('user_id', null).select('id');
      if (!rSuppliers.error) {
        parts.push(`Locadoras: ${rSuppliers.data?.length ?? 0}.`);
      } else {
        const em = String(rSuppliers.error.message || '').toLowerCase();
        if (!em.includes('does not exist') && rSuppliers.error.code !== '42P01') {
          parts.push(`Locadoras: ${rSuppliers.error.message}`);
        }
      }

      setClaimMessage(parts.join(' '));
    } catch (e: unknown) {
      setClaimMessage(e instanceof Error ? e.message : 'Falha ao vincular dados.');
    } finally {
      setClaimLoading(false);
    }
  };

  const downloadBackup = async () => {
    setBackupError(null);
    setBackupMessage(null);
    setIsExportingBackup(true);
    try {
      const res = await fetch('/api/account-backup', { method: 'GET', cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(String(payload?.error || 'Falha ao gerar backup.'));
      }

      const backupText = JSON.stringify(payload, null, 2);
      const blob = new Blob([backupText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dt = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loggb-backup-${dt}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupMessage('Backup gerado e baixado com sucesso.');
    } catch (e: unknown) {
      setBackupError(e instanceof Error ? e.message : 'Não foi possível baixar o backup.');
    } finally {
      setIsExportingBackup(false);
    }
  };

  const onPickBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    setBackupError(null);
    setBackupMessage(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { version?: unknown; data?: unknown };
      if (parsed?.version !== 1 || !parsed?.data || typeof parsed.data !== 'object') {
        throw new Error('Arquivo inválido. Use um backup exportado pelo LoggB.');
      }
      setBackupPayload(parsed);
      setBackupFileName(file.name);
      setBackupMessage('Arquivo carregado. Revise a opção de restauração e confirme.');
    } catch (e: unknown) {
      setBackupPayload(null);
      setBackupFileName(null);
      setBackupError(e instanceof Error ? e.message : 'Falha ao ler arquivo de backup.');
    } finally {
      event.target.value = '';
    }
  };

  const restoreBackup = async () => {
    if (!backupPayload) {
      setBackupError('Selecione um arquivo de backup antes de restaurar.');
      return;
    }

    const userConfirmed = confirm(
      replaceExistingData
        ? 'Isso vai substituir todos os seus dados atuais pelos dados do backup. Deseja continuar?'
        : 'Isso vai mesclar os dados do backup com os seus dados atuais. Deseja continuar?'
    );
    if (!userConfirmed) return;

    setBackupError(null);
    setBackupMessage(null);
    setIsImportingBackup(true);
    try {
      const res = await fetch('/api/account-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backup: backupPayload,
          replaceExisting: replaceExistingData,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(String(payload?.error || 'Falha ao restaurar backup.'));
      }

      const importedCount = Object.values(payload?.importedCounts ?? {}).reduce((acc, n) => {
        const value = typeof n === 'number' ? n : 0;
        return acc + value;
      }, 0);
      const warningCount = Array.isArray(payload?.warnings) ? payload.warnings.length : 0;

      setBackupMessage(
        warningCount > 0
          ? `Restauração concluída. ${importedCount} registros processados com ${warningCount} aviso(s).`
          : `Restauração concluída. ${importedCount} registros processados.`
      );
      router.refresh();
    } catch (e: unknown) {
      setBackupError(e instanceof Error ? e.message : 'Não foi possível restaurar o backup.');
    } finally {
      setIsImportingBackup(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/" className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-primary">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <SettingsIcon className="text-secondary" />
            Configurações
          </h1>
          <p className="text-slate-500 mt-1">Gerencie suas preferências e dados da conta.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Info lateral */}
        <div className="space-y-4">
          <div className="p-6 bg-white rounded-2xl border border-border shadow-sm">
            <h3 className="font-bold text-primary mb-2">Sua Conta</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              As alterações feitas aqui afetam apenas os seus dados sincronizados com o Supabase.
            </p>
          </div>
        </div>

        {/* Conteúdo Principal */}
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-6 border-b border-border bg-slate-50">
              <h2 className="font-bold text-primary">Preferências Gerais</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between opacity-50 cursor-not-allowed">
                <div>
                  <p className="font-bold text-sm text-primary">Modo Escuro</p>
                  <p className="text-xs text-slate-500">Em breve...</p>
                </div>
                <div className="w-10 h-6 bg-slate-200 rounded-full"></div>
              </div>
              <div className="flex items-center justify-between opacity-50 cursor-not-allowed border-t border-slate-50 pt-4">
                <div>
                  <p className="font-bold text-sm text-primary">Notificações por E-mail</p>
                  <p className="text-xs text-slate-500">Avisos de estoque baixo.</p>
                </div>
                <div className="w-10 h-6 bg-slate-200 rounded-full"></div>
              </div>
            </div>
          </section>

          <section className="bg-amber-50/40 rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-amber-100 bg-amber-50 flex items-center gap-2 text-amber-900 font-bold">
              <AlertCircle size={18} />
              Dados antigos sem conta
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-amber-900/90 leading-relaxed">
                Se o almoxarifado aparece vazio mas os materiais existem no Supabase, eles podem estar sem{' '}
                <span className="font-mono">user_id</span>. Use o botão abaixo <strong>somente</strong> para trazer
                esses registros para a conta em que você está logado agora.
              </p>
              <button
                type="button"
                onClick={() => void claimOrphanTenantData()}
                disabled={claimLoading}
                className="px-4 py-2 bg-amber-700 text-white rounded-lg font-bold text-sm hover:bg-amber-800 disabled:opacity-50"
              >
                {claimLoading ? 'Processando…' : 'Vincular órfãos à minha conta'}
              </button>
              {claimMessage && (
                <p className="text-xs font-bold text-amber-950 bg-white/80 border border-amber-100 rounded-lg p-3">
                  {claimMessage}
                </p>
              )}
            </div>
          </section>

          <section className="bg-blue-50/40 rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-blue-100 bg-blue-50 flex items-center gap-2 text-blue-900 font-bold">
              <FileArchive size={18} />
              Backup e recuperação de dados
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-blue-900/90 leading-relaxed">
                Baixe um arquivo completo dos seus dados para manter backup e restaurar em outra conta. Na restauração,
                você pode substituir os dados atuais ou mesclar com os já existentes.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void downloadBackup()}
                  disabled={isExportingBackup || isImportingBackup}
                  className="px-4 py-3 bg-blue-700 text-white rounded-lg font-bold text-sm hover:bg-blue-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {isExportingBackup ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                  {isExportingBackup ? 'Gerando backup…' : 'Baixar backup completo'}
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExportingBackup || isImportingBackup}
                  className="px-4 py-3 bg-white text-blue-900 border border-blue-200 rounded-lg font-bold text-sm hover:bg-blue-50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  <Upload size={16} />
                  Selecionar arquivo de backup
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => void onPickBackupFile(e)}
              />

              {backupFileName && (
                <p className="text-xs text-blue-950 bg-white border border-blue-100 rounded-lg p-3">
                  Arquivo selecionado: <span className="font-bold">{backupFileName}</span>
                </p>
              )}

              <label className="flex items-start gap-2 text-xs text-blue-900 bg-white border border-blue-100 rounded-lg p-3">
                <input
                  type="checkbox"
                  checked={replaceExistingData}
                  onChange={(e) => setReplaceExistingData(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Substituir meus dados atuais durante a restauração (recomendado para migração para outra conta).
                </span>
              </label>

              <button
                type="button"
                onClick={() => void restoreBackup()}
                disabled={!backupPayload || isImportingBackup || isExportingBackup}
                className="px-4 py-3 bg-emerald-700 text-white rounded-lg font-bold text-sm hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {isImportingBackup ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                {isImportingBackup ? 'Restaurando backup…' : 'Restaurar backup selecionado'}
              </button>

              {backupMessage && (
                <p className="text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                  {backupMessage}
                </p>
              )}
              {backupError && (
                <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
                  {backupError}
                </p>
              )}
            </div>
          </section>

          {/* Danger Zone */}
          <section className="bg-red-50/30 rounded-2xl border border-red-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-red-100 bg-red-50 flex items-center gap-2 text-red-600 font-bold">
              <ShieldAlert size={18} />
              Zona de Perigo
            </div>
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-bold text-red-900">Zerar Todos os Dados</p>
                  <p className="text-xs text-red-700">
                    Isso apagará permanentemente todos os materiais, funcionários e históricos vinculados à sua conta.
                  </p>
                </div>
                <button 
                  onClick={() => {
                    setIsModalOpen(true);
                    setConfirmStage(1);
                  }}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 whitespace-nowrap"
                >
                  Zerar Conta
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-primary/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            {isDeleting ? (
              <div className="p-12 text-center space-y-4">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                  <Loader2 className="animate-spin text-red-500" size={40} />
                </div>
                <h3 className="text-xl font-bold text-primary">Limpando seus dados...</h3>
                <p className="text-slate-500 text-sm">Por favor, aguarde enquanto processamos o reset.</p>
              </div>
            ) : (
              <>
                <div className="p-8 text-center space-y-4">
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600 border-4 border-white shadow-xl">
                    {confirmStage === 1 ? <AlertTriangle size={32} /> : <Trash2 size={32} />}
                  </div>
                  
                  {confirmStage === 1 ? (
                    <>
                      <h3 className="text-2xl font-black text-primary uppercase tracking-tight">Você tem certeza?</h3>
                      <p className="text-slate-500 text-sm">
                        Esta ação apagará **TODOS** os seus registros no sistema LoggB. Não existe opção de desfazer!
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-2xl font-black text-red-600 uppercase tracking-tight italic">Último Aviso!</h3>
                      <p className="text-slate-500 text-sm font-medium">
                        Confirme clicando no botão abaixo que você entende que perderá todos os materiais e históricos de movimentação.
                      </p>
                    </>
                  )}
                </div>

                {error && (
                  <div className="mx-8 p-3 bg-red-100 text-red-600 rounded-xl text-xs font-bold flex items-center gap-2">
                    <AlertCircle size={14} /> {error}
                  </div>
                )}

                <div className="p-6 bg-slate-50 flex flex-col gap-3">
                  {confirmStage === 1 ? (
                    <>
                      <button 
                        onClick={() => setConfirmStage(2)}
                        className="w-full p-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                      >
                        Sim, estou ciente e quero continuar
                      </button>
                      <button 
                        onClick={() => setIsModalOpen(false)}
                        className="w-full p-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-bold hover:bg-slate-100 transition-all"
                      >
                        Mudei de ideia, cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={resetAccountData}
                        className="w-full p-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all animate-pulse shadow-xl shadow-red-300"
                      >
                        APAGAR TUDO AGORA
                      </button>
                      <button 
                        onClick={() => setIsModalOpen(false)}
                        className="w-full p-4 text-slate-400 font-bold hover:text-primary transition-colors"
                      >
                        Voltar para segurança
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
