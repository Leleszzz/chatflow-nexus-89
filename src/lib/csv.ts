// Geração de CSV pensada para abrir direto no Excel em pt-BR:
// - BOM UTF-8, senão os acentos viram caracteres quebrados;
// - `;` como separador, que é o padrão do Excel em locales que usam vírgula
//   decimal (com `,` as colunas embaralham quando o valor tem decimal);
// - CRLF como quebra de linha.
const BOM = "﻿";
const SEPARATOR = ";";
const EOL = "\r\n";

export const csvEscape = (value: string | number) => `"${String(value).split('"').join('""')}"`;

/** Número no formato pt-BR (vírgula decimal), para o Excel reconhecer como número. */
export const csvNumber = (value: number, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals).replace(".", ",") : "";

export const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
  const csv = BOM + rows.map(row => row.map(csvEscape).join(SEPARATOR)).join(EOL);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
