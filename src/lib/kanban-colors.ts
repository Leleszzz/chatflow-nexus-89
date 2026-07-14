// Paleta pré-definida para a cor de fundo do card de título das colunas do Kanban.
// `value` é o token salvo em `stage.color` (mantém compatibilidade com as etapas
// já semeadas, ex.: "bg-primary"). `header` são as classes aplicadas no card de
// título; `dot` é a bolinha usada nas etapas fechado/perdido; `swatch` é a
// amostra exibida no seletor de cor.
export type KanbanColor = {
  value: string;
  label: string;
  header: string;
  dot: string;
  swatch: string;
};

export const KANBAN_COLORS: KanbanColor[] = [
  { value: "bg-primary", label: "Primária", header: "bg-primary text-primary-foreground", dot: "bg-primary", swatch: "bg-primary" },
  { value: "bg-info", label: "Informação", header: "bg-info text-info-foreground", dot: "bg-info", swatch: "bg-info" },
  { value: "bg-success", label: "Sucesso", header: "bg-success text-success-foreground", dot: "bg-success", swatch: "bg-success" },
  { value: "bg-warning", label: "Atenção", header: "bg-warning text-warning-foreground", dot: "bg-warning", swatch: "bg-warning" },
  { value: "bg-destructive", label: "Crítico", header: "bg-destructive text-destructive-foreground", dot: "bg-destructive", swatch: "bg-destructive" },
  { value: "bg-card", label: "Neutro", header: "bg-card text-foreground", dot: "bg-muted-foreground", swatch: "bg-secondary border border-border" },
];

const DEFAULT_COLOR = KANBAN_COLORS[0];

export function kanbanColor(value?: string): KanbanColor {
  return KANBAN_COLORS.find(c => c.value === value) || DEFAULT_COLOR;
}

export function headerClassFor(value?: string): string {
  return kanbanColor(value).header;
}

export function dotClassFor(value?: string): string {
  return kanbanColor(value).dot;
}
