import type { Cell } from "write-excel-file/browser";

// Exportação em .xlsx pensada para abrir direto no Excel em pt-BR.
//
// Substituiu o CSV, que precisava de BOM + separador ";" + vírgula decimal só
// para contornar o parser do Excel. Aqui a célula é tipada: número é número
// (somável, alinhado à direita), data é data e o acento não depende de BOM —
// a formatação de exibição fica com o locale do próprio Excel.
export type CellValue = string | number | Date | boolean | null | undefined;

/**
 * Infere o tipo de célula do Excel a partir do valor JS. Puro de propósito:
 * é o que os testes cobrem, sem precisar carregar a biblioteca nem tocar no DOM.
 */
export const toCell = (value: CellValue): Cell => {
  // Número não-finito (NaN/Infinity) quebraria o arquivo — vira célula vazia,
  // que era o mesmo comportamento do antigo csvNumber.
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value, type: Number, format: "#,##0.00" } : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { value, type: Date, format: "dd/mm/yyyy hh:mm" };
  }
  if (typeof value === "boolean") return { value, type: Boolean };
  if (value === null || value === undefined) return null;
  return { value: String(value), type: String };
};

/** Largura da coluna: acompanha o cabeçalho, com piso e teto legíveis. */
const columnWidth = (header: string) => ({ width: Math.min(40, Math.max(14, header.length + 4)) });

export const downloadXlsx = async (
  filename: string,
  header: string[],
  rows: CellValue[][],
): Promise<void> => {
  // Import dinâmico: exportar é ação rara, então a biblioteca fica fora do
  // bundle inicial e só é baixada quando alguém clica em exportar.
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const data: Cell[][] = [
    header.map(title => ({ value: title, type: String, fontWeight: "bold" as const })),
    ...rows.map(row => row.map(toCell)),
  ];
  // No build de browser da v4 o download sai por `.toFile(nome)` — passar
  // `fileName` nas opções não baixa nada.
  await writeXlsxFile(data, { columns: header.map(columnWidth) }).toFile(filename);
};
