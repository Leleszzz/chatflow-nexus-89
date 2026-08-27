import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ResponsiveColumn<T> = {
  /** Identificador da coluna. Só serve de key no React. */
  key: string;
  /** Cabeçalho no desktop; vira o rótulo do par rótulo/valor no card mobile. */
  header: string;
  cell: (row: T) => ReactNode;
  /** A coluna que identifica a linha: vira o título do card, sem rótulo. */
  primary?: boolean;
  /** Colunas de ruído que não valem espaço num celular. */
  hideOnMobile?: boolean;
  className?: string;
};

/**
 * Tabela que vira lista de cards abaixo de `md`.
 *
 * Sete colunas num telefone de 360px dão ~50px por coluna — ilegível mesmo com
 * scroll horizontal, porque o usuário perde a coluna de nome ao arrastar. No
 * card cada linha vira um bloco com o nome em destaque e o resto como pares
 * rótulo/valor, que é o que dá para ler de fato.
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "Nenhum registro encontrado.",
  className,
}: {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  const primary = columns.find(column => column.primary);
  const secundarias = columns.filter(column => !column.primary && !column.hideOnMobile);

  return (
    <>
      <div className={cn("hidden overflow-x-auto md:block", className)}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              {columns.map(column => (
                <th key={column.key} className={cn("px-4 py-3 font-semibold", column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={rowKey(row)} className="border-b border-border/40 last:border-0">
                {columns.map(column => (
                  <td key={column.key} className={cn("px-4 py-3", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 p-3 md:hidden">
        {rows.map(row => (
          <div key={rowKey(row)} className="rounded-xl border border-border/60 bg-card p-3">
            {primary && <div className="mb-2 text-sm font-semibold">{primary.cell(row)}</div>}
            <dl className="space-y-1.5">
              {secundarias.map(column => (
                <div key={column.key} className="flex items-start justify-between gap-3 text-sm">
                  <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{column.header}</dt>
                  <dd className="min-w-0 flex-1 text-right">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
