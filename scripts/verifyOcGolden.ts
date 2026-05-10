import { promises as fs } from 'node:fs';
import path from 'node:path';

interface GoldenRule {
  minItems?: number;
  requireVendor?: boolean;
  vendorIncludes?: string;
  requireDeliveryDate?: boolean;
  maxMissingQtyRatio?: number;
  maxMissingUnitRatio?: number;
  disallowLowConfidence?: boolean;
}

interface ScanReport {
  file: string;
  vendor: string | null;
  deliveryDeadline: string | null;
  items: number;
  missingQty: number;
  missingUnit: number;
  confidence?: 'high' | 'medium' | 'low';
}

interface ScanJson {
  reports: ScanReport[];
}

interface GoldenJson {
  defaults?: GoldenRule;
  files: Record<string, GoldenRule>;
}

function mergeRules(defaults: GoldenRule | undefined, specific: GoldenRule | undefined): GoldenRule {
  return {
    minItems: specific?.minItems ?? defaults?.minItems,
    requireVendor: specific?.requireVendor ?? defaults?.requireVendor,
    vendorIncludes: specific?.vendorIncludes ?? defaults?.vendorIncludes,
    requireDeliveryDate: specific?.requireDeliveryDate ?? defaults?.requireDeliveryDate,
    maxMissingQtyRatio: specific?.maxMissingQtyRatio ?? defaults?.maxMissingQtyRatio,
    maxMissingUnitRatio: specific?.maxMissingUnitRatio ?? defaults?.maxMissingUnitRatio,
    disallowLowConfidence: specific?.disallowLowConfidence ?? defaults?.disallowLowConfidence,
  };
}

async function run() {
  const scanPath = path.resolve('reports/oc-model-scan.json');
  const goldenPath = path.resolve('scripts/ocGoldenExpectations.json');
  const scan = JSON.parse(await fs.readFile(scanPath, 'utf-8')) as ScanJson;
  const golden = JSON.parse(await fs.readFile(goldenPath, 'utf-8')) as GoldenJson;

  const failures: string[] = [];

  for (const r of scan.reports) {
    const rule = mergeRules(golden.defaults, golden.files[r.file]);

    if (rule.minItems != null && r.items < rule.minItems) {
      failures.push(`${r.file}: items=${r.items} abaixo do mínimo esperado (${rule.minItems})`);
    }
    if (rule.requireVendor && !(r.vendor && r.vendor.trim())) {
      failures.push(`${r.file}: fornecedor ausente`);
    }
    if (rule.vendorIncludes) {
      const v = (r.vendor || '').toUpperCase();
      if (!v.includes(rule.vendorIncludes.toUpperCase())) {
        failures.push(
          `${r.file}: fornecedor "${r.vendor || 'N/D'}" não contém "${rule.vendorIncludes}"`
        );
      }
    }
    if (rule.requireDeliveryDate && !r.deliveryDeadline) {
      failures.push(`${r.file}: data de entrega ausente`);
    }

    if (rule.maxMissingQtyRatio != null) {
      const ratio = r.items > 0 ? r.missingQty / r.items : 1;
      if (ratio > rule.maxMissingQtyRatio) {
        failures.push(
          `${r.file}: missingQtyRatio=${ratio.toFixed(2)} acima do limite (${rule.maxMissingQtyRatio})`
        );
      }
    }

    if (rule.maxMissingUnitRatio != null) {
      const ratio = r.items > 0 ? r.missingUnit / r.items : 1;
      if (ratio > rule.maxMissingUnitRatio) {
        failures.push(
          `${r.file}: missingUnitRatio=${ratio.toFixed(2)} acima do limite (${rule.maxMissingUnitRatio})`
        );
      }
    }

    if (rule.disallowLowConfidence && r.confidence === 'low') {
      failures.push(`${r.file}: confiança baixa no parsing`);
    }
  }

  for (const file of Object.keys(golden.files)) {
    const exists = scan.reports.some((x) => x.file === file);
    if (!exists) {
      failures.push(`Arquivo esperado não encontrado no scan: ${file}`);
    }
  }

  if (failures.length) {
    console.error('Falha na validação golden de OCs:');
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  console.log('Validação golden de OCs concluída com sucesso.');
}

void run().catch((e) => {
  console.error('Erro ao validar golden de OCs:', e);
  process.exit(1);
});
