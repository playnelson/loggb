import { nameTokens } from '@/components/SuggestInput';

/** Profissões comuns em obra. Aparecem como sugestão no cadastro de colaboradores. */
export const DEFAULT_PROFESSIONS = [
  'SERVENTE',
  'AJUDANTE GERAL',
  'PEDREIRO',
  'CARPINTEIRO',
  'ARMADOR',
  'ELETRICISTA',
  'ENCANADOR',
  'SOLDADOR',
  'SERRALHEIRO',
  'PINTOR',
  'MOTORISTA',
  'OPERADOR DE MÁQUINAS',
  'OPERADOR DE ESCAVADEIRA',
  'OPERADOR DE RETROESCAVADEIRA',
  'OPERADOR DE PÁ CARREGADEIRA',
  'OPERADOR DE MOTONIVELADORA',
  'OPERADOR DE ROLO COMPACTADOR',
  'MECÂNICO',
  'LUBRIFICADOR',
  'BORRACHEIRO',
  'APONTADOR',
  'ENCARREGADO DE OBRAS',
  'MESTRE DE OBRAS',
  'ALMOXARIFE',
  'AUXILIAR DE ALMOXARIFADO',
  'TÉCNICO DE SEGURANÇA DO TRABALHO',
  'TÉCNICO DE EDIFICAÇÕES',
  'TOPÓGRAFO',
  'AUXILIAR DE TOPOGRAFIA',
  'LABORATORISTA',
  'ENGENHEIRO CIVIL',
  'AUXILIAR ADMINISTRATIVO',
  'VIGIA',
  'COZINHEIRO',
];

const key = (s: string) => [...nameTokens(s)].sort().join(' ');

/** Escreve a profissão do jeito padrão: maiúsculas e sem espaços sobrando. */
export const cleanProfession = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

/** Lista de sugestões: as padrão + as que já existem nos colaboradores (sem repetir a mesma escrita). */
export function professionOptions(existing: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...DEFAULT_PROFESSIONS, ...existing]) {
    const name = cleanProfession(String(raw ?? ''));
    const k = key(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** A profissão da lista com as mesmas palavras (ex.: "servente " -> "SERVENTE"), ou null se for nova. */
export function matchProfession(typed: string, options: string[]): string | null {
  const k = key(typed);
  if (!k) return null;
  return options.find((o) => key(o) === k) ?? null;
}
