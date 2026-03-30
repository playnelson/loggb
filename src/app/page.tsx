'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Package, Users, ArrowUpRight, AlertTriangle, Loader2, Clock, History, ChevronRight, TrendingDown } from 'lucide-react';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState([
    { name: 'Itens em Estoque', value: '0', icon: <Package size={20} className="text-secondary" />, change: 'Total', changeType: 'neutral' },
    { name: 'Colaboradores Ativos', value: '0', icon: <Users size={20} className="text-secondary" />, change: 'Em campo', changeType: 'neutral' },
    { name: 'Itens em Posse', value: '0', icon: <ArrowUpRight size={20} className="text-secondary" />, change: 'Em uso', changeType: 'increase' },
    { name: 'Alertas de Estoque', value: '0', icon: <AlertTriangle size={20} className="text-red-500" />, change: 'Atenção', changeType: 'decrease' },
  ]);
  const [criticalItems, setCriticalItems] = useState<any[]>([]);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // 1. Stats
      const { data: items } = await supabase.from('items').select('quantity_current, quantity_min, description, unit');
      const totalStock = items?.reduce((acc, item) => acc + (item.quantity_current || 0), 0) || 0;
      const alertsCount = items?.filter(item => (item.quantity_current || 0) <= (item.quantity_min || 0)).length || 0;
      
      setCriticalItems(items?.filter(item => (item.quantity_current || 0) <= (item.quantity_min || 0)).slice(0, 5) || []);

      const { count: activeEmployees } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Ativo');

      const { count: itemsInPossession } = await supabase
        .from('possession')
        .select('*', { count: 'exact', head: true })
        .gt('quantity', 0);

      setStats([
        { name: 'Itens em Estoque', value: totalStock.toLocaleString(), icon: <Package size={20} className="text-secondary" />, change: 'Total', changeType: 'neutral' },
        { name: 'Colaboradores Ativos', value: (activeEmployees || 0).toString(), icon: <Users size={20} className="text-secondary" />, change: 'Ativo', changeType: 'neutral' },
        { name: 'Itens em Posse', value: (itemsInPossession || 0).toString(), icon: <ArrowUpRight size={20} className="text-secondary" />, change: 'Em campo', changeType: 'increase' },
        { name: 'Alertas de Estoque', value: alertsCount.toString(), icon: <AlertTriangle size={20} className="text-red-500" />, change: alertsCount > 0 ? 'Crítico' : 'OK', changeType: alertsCount > 0 ? 'decrease' : 'neutral' },
      ]);

      // 2. Recent Movements
      const { data: movements } = await supabase
        .from('movements')
        .select('*, items(description), employees(full_name)')
        .order('created_at', { ascending: false })
        .limit(5);
      
      setRecentMovements(movements || []);

    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchDashboardData();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-primary tracking-tight">Painel de Controle</h1>
          <p className="text-slate-500 mt-1 font-medium">LoggB Almoxarifado Inteligente — Visão Geral.</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-border">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sistema Online</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-2xl border border-border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
            <div className="flex items-center justify-between">
              <div className="p-3 bg-slate-50 rounded-xl group-hover:bg-secondary/10 group-hover:scale-110 transition-all">
                {stat.icon}
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                stat.changeType === 'increase' ? 'bg-green-100 text-green-700' : 
                stat.changeType === 'decrease' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
              }`}>
                {stat.change}
              </span>
            </div>
            <div className="mt-6">
              <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest">{stat.name}</h3>
              <p className="text-3xl font-bold text-primary mt-1">
                {loading ? <span className="text-slate-200">...</span> : stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-border shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <History size={18} className="text-secondary" />
                Atividade Recente
              </h2>
              <Link href="/movement" className="text-xs font-bold text-secondary flex items-center gap-1 hover:underline">
                Ver Tudo <ChevronRight size={14} />
              </Link>
            </div>
            
            <div className="space-y-4">
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <div key={i} className="h-16 bg-slate-50 rounded-xl animate-pulse"></div>
                ))
              ) : recentMovements.length === 0 ? (
                <div className="text-center py-12 text-slate-400 italic">Nenhuma atividade registrada hoje.</div>
              ) : (
                recentMovements.map((move) => (
                  <div key={move.id} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-transparent hover:border-slate-100 hover:bg-white transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${move.type === 'IN' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        <TrendingDown size={18} className={move.type === 'IN' ? 'rotate-180' : ''} />
                      </div>
                      <div>
                        <p className="font-bold text-primary text-sm leading-tight">{move.items?.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-slate-500 font-medium">{move.employees?.full_name}</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-sm ${move.type === 'IN' ? 'text-green-600' : 'text-red-600'}`}>
                        {move.type === 'IN' ? '+' : '-'}{move.quantity}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 font-mono">
                        {new Date(move.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white p-6 rounded-2xl border border-border shadow-sm">
            <h2 className="text-lg font-bold text-primary mb-6 flex items-center gap-2">
              Ações Rápidas
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              {[
                { href: '/inventory?new=true', label: 'Novo Item', icon: <Package />, delay: 'delay-0' },
                { href: '/movement', label: 'Saída/Baixa', icon: <ArrowUpRight />, delay: 'delay-100' },
                { href: '/staff', label: 'Equipe', icon: <Users />, delay: 'delay-200' },
              ].map((action, i) => (
                <Link 
                  key={i}
                  href={action.href}
                  className={`flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-2xl hover:border-secondary hover:bg-white hover:shadow-xl transition-all duration-300 group ${action.delay}`}
                >
                  <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:bg-secondary group-hover:rotate-6 transition-all mb-4">
                    <div className="text-primary group-hover:text-white transition-colors">
                      {action.icon}
                    </div>
                  </div>
                  <span className="font-bold text-sm text-primary tracking-tight">{action.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Alerts / Critical Side */}
        <div className="space-y-6">
          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-2xl shadow-primary/20 relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-32 h-32 bg-red-500/10 rounded-full blur-3xl group-hover:bg-red-500/20 transition-all"></div>
            <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              Estoque Crítico
            </h2>
            <div className="space-y-4">
              {loading ? (
                 Array(3).fill(0).map((_, i) => (
                  <div key={i} className="h-14 bg-slate-800 rounded-xl animate-pulse"></div>
                ))
              ) : criticalItems.length === 0 ? (
                <div className="text-center py-8 text-slate-500 italic text-sm">Todo o estoque operando normalmente.</div>
              ) : (
                criticalItems.map((item) => (
                  <div key={item.id} className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:bg-slate-800 transition-colors">
                    <div className="flex justify-between items-start mb-2 gap-3">
                      <div>
                        <p className="font-bold text-sm leading-tight text-white">{item.description}</p>

                      </div>
                      <span className="text-[10px] font-black bg-red-500/20 text-red-500 px-2 py-0.5 rounded shrink-0">CRÍTICO</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
                      <span>Atual: <span className="text-red-400">{item.quantity_current}</span></span>
                      <span>Mínimo: {item.quantity_min}</span>
                    </div>
                    <div className="mt-3 w-full bg-slate-700 h-1 rounded-full overflow-hidden">
                      <div 
                        className="bg-red-500 h-full transition-all duration-1000" 
                        style={{ width: `${Math.min(100, (item.quantity_current / item.quantity_min) * 100)}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {criticalItems.length > 0 && (
              <button className="w-full mt-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all border border-white/5">
                Gerar Relatório de Reposição
              </button>
            )}
          </div>

          <div className="bg-gradient-to-br from-secondary to-primary rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-lg font-bold mb-2 tracking-tight">Relatório Rápido</h3>
              <p className="text-white/70 text-sm mb-6 leading-relaxed">
                Acesse o resumo completo de movimentações do mês.
              </p>
              <button className="px-5 py-2.5 bg-white text-primary rounded-xl text-xs font-bold hover:bg-slate-100 transition-all shadow-lg">
                Baixar Resumo (.txt)
              </button>
            </div>
            <ArrowUpRight className="absolute -right-8 -bottom-8 w-40 h-40 opacity-10" />
          </div>
        </div>
      </div>
    </div>
  );
}
