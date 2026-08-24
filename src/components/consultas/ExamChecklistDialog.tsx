import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SendWhatsAppDialog } from "./SendWhatsAppDialog";
import { textoExames } from "@/lib/consultation-actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itens: string[];
  nomePaciente: string;
  onEnviar: (texto: string) => Promise<void>;
}

/**
 * Checklist dos exames que a IA ouviu na consulta.
 *
 * Tudo vem marcado: o caso comum é o médico concordar com a lista e enviar. O
 * campo de acrescentar existe porque o áudio engole exame com nome comprido, e
 * regravar a consulta por causa disso não seria razoável.
 */
export function ExamChecklistDialog({ open, onOpenChange, itens, nomePaciente, onEnviar }: Props) {
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const [novo, setNovo] = useState("");

  useEffect(() => {
    if (!open) return;
    setMarcados(Object.fromEntries(itens.map(i => [i, true])));
    setExtras([]);
    setNovo("");
  }, [open, itens]);

  const todos = useMemo(() => [...itens, ...extras], [itens, extras]);
  const selecionados = useMemo(() => todos.filter(i => marcados[i]), [todos, marcados]);

  const acrescentar = () => {
    const limpo = novo.trim();
    if (!limpo) return;
    if (todos.some(i => i.toLowerCase() === limpo.toLowerCase())) {
      setNovo("");
      return;
    }
    setExtras(prev => [...prev, limpo]);
    setMarcados(prev => ({ ...prev, [limpo]: true }));
    setNovo("");
  };

  return (
    <SendWhatsAppDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Enviar lista de exames"
      destinatario={nomePaciente}
      textoInicial={selecionados.length ? textoExames({ nome: nomePaciente, itens: selecionados }) : ""}
      onEnviar={onEnviar}
    >
      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">
          Exames solicitados ({selecionados.length} de {todos.length})
        </div>
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {todos.map(item => (
            <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={Boolean(marcados[item])}
                onCheckedChange={valor => setMarcados(prev => ({ ...prev, [item]: valor === true }))}
              />
              <span className={marcados[item] ? "" : "text-muted-foreground line-through"}>{item}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={novo}
            onChange={e => setNovo(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); acrescentar(); } }}
            placeholder="Acrescentar exame…"
            className="h-8 text-sm"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={acrescentar}>
            <Plus className="h-3.5 w-3.5" /> Incluir
          </Button>
        </div>
      </div>
    </SendWhatsAppDialog>
  );
}
