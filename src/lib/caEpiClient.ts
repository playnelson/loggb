/** Extrai nome padronizado do equipamento a partir do JSON da API Base CAEPI / similar. */
export function equipmentLabelFromCaApiPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const tryStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const nome = tryStr(o.NomeEquipamento) || tryStr(o.nome_equipamento);
  const desc = tryStr(o.DescricaoEquipamento) || tryStr(o.descricao_equipamento) || tryStr(o.Descricao);
  const equip = nome || desc;
  const marca = tryStr(o.MarcaCA) || tryStr(o.marca);
  const ref = tryStr(o.Referencia) || tryStr(o.referencia);
  const parts = [equip, marca && ref ? `${marca} ${ref}`.trim() : marca || ref].filter(Boolean);
  return parts.join(' — ') || equip || desc;
}

export async function fetchCaEpiByNumber(caDigits: string): Promise<{
  ok: boolean;
  label?: string;
  raw?: unknown;
  error?: string;
  hint?: string;
  officialUrl?: string;
}> {
  const res = await fetch(`/api/ca-epi?ca=${encodeURIComponent(caDigits)}`);
  const json: unknown = await res.json();
  const obj = json as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof obj.error === 'string' ? obj.error : 'Falha na consulta.',
      hint: typeof obj.hint === 'string' ? obj.hint : undefined,
      officialUrl: typeof obj.officialUrl === 'string' ? obj.officialUrl : undefined,
    };
  }
  const data = obj.data;
  const label = equipmentLabelFromCaApiPayload(data);
  return { ok: true, label: label || undefined, raw: data };
}
