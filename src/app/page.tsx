'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { Package, Users, ArrowUpRight, AlertTriangle, Loader2 } from 'lucide-react';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState([
    { name: 'Itens em Estoque', value: '0', icon: <Package className="text-secondary" />, change: 'Atualizado', changeType: 'neutral' },
    { name: 'Colaboradores Ativos', value: '0', icon: <Users className="text-secondary" />, change: '0%', changeType: 'neutral' },
    { name: 'Itens em Posse', value: '0', icon: <ArrowUpRight className="text-secondary" />, change: 'Ativos', changeType: 'increase' },
    { name: 'Alertas de Estoque', value: '0', icon: <AlertTriangle className="text-red-500" />, change: 'Crítico', changeType: 'decrease' },
  ]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      
      // 1. Itens em Estoque (Total quantity)
      const { data: items } = await supabase.from('items').select('quantity_current, quantity_min');
      const totalStock = items?.reduce((acc, item) => acc + (item.quantity_current || 0), 0) || 0;
      const alertsCount = items?.filter(item => (item.quantity_current || 0) <= (item.quantity_min || 0)).length || 0;

      // 2. Colaboradores Ativos
      const { count: activeEmployees } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Ativo');

      // 3. Itens em Posse
      const { count: itemsInPossession } = await supabase
        .from('possession')
        .select('*', { count: 'exact', head: true })
        .gt('quantity', 0);

      setStats([
        { name: 'Itens em Estoque', value: totalStock.toLocaleString(), icon: <Package className="text-secondary" />, change: 'Total', changeType: 'neutral' },
        { name: 'Colaboradores Ativos', value: (activeEmployees || 0).toString(), icon: <Users className="text-secondary" />, change: 'Em campo', changeType: 'neutral' },
        { name: 'Itens em Posse', value: (itemsInPossession || 0).toString(), icon: <ArrowUpRight className="text-secondary" />, change: 'Em uso', changeType: 'increase' },
        { name: 'Alertas de Estoque', value: alertsCount.toString().padStart(2, '0'), icon: <AlertTriangle className="text-red-500" />, change: alertsCount > 0 ? 'Atenção' : 'OK', changeType: alertsCount > 0 ? 'decrease' : 'neutral' },
      ]);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetchStats();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-primary">Bem-vindo ao LoggB</h1>
          <p className="text-slate-500 mt-1">Visão geral em tempo real do seu almoxarifado.</p>
        </div>
        {loading && <Loader2 className="animate-spin text-secondary" size={24} />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-slate-50 rounded-lg">{stat.icon}</div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider ${
                stat.changeType === 'increase' ? 'bg-green-100 text-green-700' : 
                stat.changeType === 'decrease' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
              }`}>
                {stat.change}
              </span>
            </div>
            <div className="mt-4">
              <h3 className="text-slate-500 text-sm font-medium">{stat.name}</h3>
              <p className="text-2xl font-bold text-primary mt-1">
                {loading ? '...' : stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-border shadow-sm">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            Ações Rápidas
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Link 
              href="/inventory?new=true"
              className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-xl hover:border-secondary transition-all group"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:bg-secondary transition-colors mb-3">
                <Package className="text-primary group-hover:text-white" />
              </div>
              <span className="font-bold text-sm text-primary">Novo Item</span>
            </Link>
            <Link 
              href="/movement"
              className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-xl hover:border-secondary transition-all group"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:bg-secondary transition-colors mb-3">
                <ArrowUpRight className="text-primary group-hover:text-white" />
              </div>
              <span className="font-bold text-sm text-primary">Saída de Material</span>
            </Link>
            <Link 
              href="/staff"
              className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-xl hover:border-secondary transition-all group"
            >
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:bg-secondary transition-colors mb-3">
                <Users className="text-primary group-hover:text-white" />
              </div>
              <span className="font-bold text-sm text-primary">Equipe</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
