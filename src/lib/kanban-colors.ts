// Paleta pré-definida para a cor de fundo do card de título das colunas do Kanban.
// `value` é o token salvo em `stage.color` (mantém compatibilidade com as etapas
// já semeadas, ex.: "bg-primary"). `header` são as classes aplicadas no card de
// título; `dot` é a bolinha usada nas etapas fechado/perdido; `swatch` é a
// amostra exibida no seletor de cor.
//
// As classes precisam aparecer como strings literais aqui para o JIT do Tailwind
// gerar o CSS — nunca montar o nome da classe dinamicamente.
export type KanbanColor = {
  value: string;
  label: string;
  header: string;
  dot: string;
  swatch: string;
  /** Agrupa as cores no seletor. "tema" segue os tokens do design system. */
  group: "tema" | "paleta";
};

export const KANBAN_COLORS: KanbanColor[] = [
  // Tokens do design system — acompanham o tema claro/escuro.
  { value: "bg-primary", label: "Primária", header: "bg-primary text-primary-foreground", dot: "bg-primary", swatch: "bg-primary", group: "tema" },
  { value: "bg-info", label: "Informação", header: "bg-info text-info-foreground", dot: "bg-info", swatch: "bg-info", group: "tema" },
  { value: "bg-success", label: "Sucesso", header: "bg-success text-success-foreground", dot: "bg-success", swatch: "bg-success", group: "tema" },
  { value: "bg-warning", label: "Atenção", header: "bg-warning text-warning-foreground", dot: "bg-warning", swatch: "bg-warning", group: "tema" },
  { value: "bg-destructive", label: "Crítico", header: "bg-destructive text-destructive-foreground", dot: "bg-destructive", swatch: "bg-destructive", group: "tema" },
  { value: "bg-card", label: "Neutro", header: "bg-card text-foreground", dot: "bg-muted-foreground", swatch: "bg-secondary border border-border", group: "tema" },

  // Cores fixas — mesmo tom no claro e no escuro.
  { value: "bg-red-600", label: "Vermelho", header: "bg-red-600 text-white", dot: "bg-red-600", swatch: "bg-red-600", group: "paleta" },
  { value: "bg-orange-500", label: "Laranja", header: "bg-orange-500 text-white", dot: "bg-orange-500", swatch: "bg-orange-500", group: "paleta" },
  { value: "bg-amber-500", label: "Âmbar", header: "bg-amber-500 text-white", dot: "bg-amber-500", swatch: "bg-amber-500", group: "paleta" },
  { value: "bg-yellow-500", label: "Amarelo", header: "bg-yellow-500 text-white", dot: "bg-yellow-500", swatch: "bg-yellow-500", group: "paleta" },
  { value: "bg-lime-600", label: "Lima", header: "bg-lime-600 text-white", dot: "bg-lime-600", swatch: "bg-lime-600", group: "paleta" },
  { value: "bg-green-600", label: "Verde", header: "bg-green-600 text-white", dot: "bg-green-600", swatch: "bg-green-600", group: "paleta" },
  { value: "bg-emerald-600", label: "Esmeralda", header: "bg-emerald-600 text-white", dot: "bg-emerald-600", swatch: "bg-emerald-600", group: "paleta" },
  { value: "bg-teal-600", label: "Turquesa", header: "bg-teal-600 text-white", dot: "bg-teal-600", swatch: "bg-teal-600", group: "paleta" },
  { value: "bg-cyan-600", label: "Ciano", header: "bg-cyan-600 text-white", dot: "bg-cyan-600", swatch: "bg-cyan-600", group: "paleta" },
  { value: "bg-sky-500", label: "Céu", header: "bg-sky-500 text-white", dot: "bg-sky-500", swatch: "bg-sky-500", group: "paleta" },
  { value: "bg-blue-600", label: "Azul", header: "bg-blue-600 text-white", dot: "bg-blue-600", swatch: "bg-blue-600", group: "paleta" },
  { value: "bg-indigo-600", label: "Índigo", header: "bg-indigo-600 text-white", dot: "bg-indigo-600", swatch: "bg-indigo-600", group: "paleta" },
  { value: "bg-violet-600", label: "Violeta", header: "bg-violet-600 text-white", dot: "bg-violet-600", swatch: "bg-violet-600", group: "paleta" },
  { value: "bg-purple-600", label: "Roxo", header: "bg-purple-600 text-white", dot: "bg-purple-600", swatch: "bg-purple-600", group: "paleta" },
  { value: "bg-fuchsia-600", label: "Fúcsia", header: "bg-fuchsia-600 text-white", dot: "bg-fuchsia-600", swatch: "bg-fuchsia-600", group: "paleta" },
  { value: "bg-pink-600", label: "Rosa", header: "bg-pink-600 text-white", dot: "bg-pink-600", swatch: "bg-pink-600", group: "paleta" },
  { value: "bg-rose-600", label: "Rubro", header: "bg-rose-600 text-white", dot: "bg-rose-600", swatch: "bg-rose-600", group: "paleta" },
  { value: "bg-stone-500", label: "Pedra", header: "bg-stone-500 text-white", dot: "bg-stone-500", swatch: "bg-stone-500", group: "paleta" },
  { value: "bg-slate-600", label: "Ardósia", header: "bg-slate-600 text-white", dot: "bg-slate-600", swatch: "bg-slate-600", group: "paleta" },
  { value: "bg-zinc-700", label: "Grafite", header: "bg-zinc-700 text-white", dot: "bg-zinc-700", swatch: "bg-zinc-700", group: "paleta" },
];

const DEFAULT_COLOR = KANBAN_COLORS[0];

export function kanbanColor(value?: string): KanbanColor {
  return KANBAN_COLORS.find(c => c.value === value) || DEFAULT_COLOR;
}

export function headerClassFor(value?: string): string {
  return kanbanColor(value).header;
}
