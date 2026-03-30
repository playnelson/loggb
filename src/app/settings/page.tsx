'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { 
  Settings as SettingsIcon, 
  Trash2, 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  Loader2, 
  ArrowLeft,
  AlertCircle
} from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmStage, setConfirmStage] = useState(1);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { error: empError } = await supabase
        .from('employees')
        .delete()
        .eq('user_id', user.id);
      
      if (empError) console.error('Erro ao deletar funcionários:', empError);

      // 3. Deletar Itens
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
