import { Package, Users, ArrowUpRight, AlertTriangle } from 'lucide-react';

export default function Home() {
  const stats = [
    { name: 'Itens em Estoque', value: '1,280', icon: <Package className="text-secondary" />, change: '+5%', changeType: 'increase' },
    { name: 'Colaboradores Ativos', value: '42', icon: <Users className="text-secondary" />, change: '0%', changeType: 'neutral' },
    { name: 'Itens em Posse', value: '156', icon: <ArrowUpRight className="text-secondary" />, change: '+12', changeType: 'increase' },
    { name: 'Alertas de Estoque', value: '08', icon: <AlertTriangle className="text-red-500" />, change: 'Crítico', changeType: 'decrease' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Bem-vindo ao LoggB</h1>
        <p className="text-slate-500 mt-1">Visão geral do sistema de almoxarifado.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-card p-6 rounded-xl border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div className="p-2 bg-slate-50 rounded-lg">{stat.icon}</div>
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                stat.changeType === 'increase' ? 'bg-green-100 text-green-700' : 
                stat.changeType === 'decrease' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
              }`}>
                {stat.change}
              </span>
            </div>
            <div className="mt-4">
              <h3 className="text-slate-500 text-sm font-medium">{stat.name}</h3>
              <p className="text-2xl font-bold text-primary mt-1">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-xl border border-border shadow-sm">
          <h2 className="text-lg font-bold text-primary mb-4">Ações Rápidas</h2>
          <div className="grid grid-cols-2 gap-4">
            <button className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-lg hover:border-secondary transition-all group">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:bg-secondary transition-colors mb-3">
                <Package className="text-primary group-hover:text-white" />
              </div>
              <span className="font-semibold text-primary">Novo Item</span>
            </button>
            <button className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-100 rounded-lg hover:border-secondary transition-all group">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm group-hover:bg-secondary transition-colors mb-3">
                <ArrowUpRight className="text-primary group-hover:text-white" />
              </div>
              <span className="font-semibold text-primary">Nova Saída</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
