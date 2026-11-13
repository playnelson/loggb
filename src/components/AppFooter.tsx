import { RefreshCw } from 'lucide-react';

const version = process.env.NEXT_PUBLIC_APP_VERSION || '';
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || '';
const sha = process.env.NEXT_PUBLIC_BUILD_SHA || '';
const message = process.env.NEXT_PUBLIC_BUILD_MESSAGE || '';
const commitUrl = process.env.NEXT_PUBLIC_BUILD_COMMIT_URL || '';

function formatBuildTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Rodapé com a última atualização do sistema (data do deploy, versão e commit). */
export default function AppFooter() {
  const when = formatBuildTime(buildTime);

  return (
    <footer className="mt-10 border-t border-slate-300 pt-3 pb-2 text-[11px] text-slate-500">
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          <RefreshCw size={12} aria-hidden />
          LoggB · Estoque e Suprimentos{version ? ` · v${version}` : ''}
        </span>
        {when ? <span>Última atualização: {when}</span> : null}
        {sha ? (
          <span className="min-w-0 truncate" title={message || undefined}>
            {commitUrl ? (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono hover:text-slate-600 hover:underline"
              >
                {sha}
              </a>
            ) : (
              <span className="font-mono">{sha}</span>
            )}
            {message ? <span> · {message}</span> : null}
          </span>
        ) : null}
      </div>
    </footer>
  );
}
