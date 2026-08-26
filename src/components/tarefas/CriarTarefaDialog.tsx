import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCRM } from "@/store/crm-store";
import { Task, TaskOrigem } from "@/lib/whatsapp-api";
import { isSecretariaRole, isAtendente, roleLabel } from "@/lib/roles";
import { mensagemDeErro } from "@/lib/erros";

/** O que quem abre o diálogo já sabe sobre a tarefa. Tudo é editável antes de criar. */
export type RascunhoTarefa = {
  titulo?: string;
  descricao?: string;
  dealId?: string;
  consultationId?: string;
  itens?: string[];
  mensagemSugerida?: string;
  origem?: TaskOrigem;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rascunho: RascunhoTarefa;
  /** Nome do paciente, só para o texto de apoio. */
  nomePaciente?: string;
  onCriada?: (task: Task) => void;
}

const SEM_RESPONSAVEL = "__fila__";

export function CriarTarefaDialog({ open, onOpenChange, rascunho, nomePaciente, onCriada }: Props) {
  const { teamUsers, createTask } = useCRM();

  // A recepção é quem executa a fila, então ela aparece primeiro e já vem
  // escolhida. O doutor continua na lista: às vezes a tarefa é dele mesmo.
  const responsaveis = useMemo(() => {
    const ativos = teamUsers.filter(u => u.active && isAtendente(u.role));
    return [...ativos].sort((a, b) => Number(isSecretariaRole(b.role)) - Number(isSecretariaRole(a.role)));
  }, [teamUsers]);

  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [prazo, setPrazo] = useState("");
  const [itens, setItens] = useState<string[]>([]);
  const [novoItem, setNovoItem] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitulo(rascunho.titulo || "");
    setDescricao(rascunho.descricao || "");
    setItens(rascunho.itens || []);
    setMensagem(rascunho.mensagemSugerida || "");
    setNovoItem("");
    setPrazo("");
    const primeiraSecretaria = responsaveis.find(u => isSecretariaRole(u.role));
    setAssigneeId(primeiraSecretaria?.id || responsaveis[0]?.id || "");
  }, [open, rascunho, responsaveis]);

  const acrescentar = () => {
    const limpo = novoItem.trim();
    if (!limpo) return;
    if (!itens.some(i => i.toLowerCase() === limpo.toLowerCase())) setItens(prev => [...prev, limpo]);
    setNovoItem("");
  };

  const criar = async () => {
    if (!titulo.trim()) {
      toast.error("Informe um título para a tarefa");
      return;
    }
    setSalvando(true);
    try {
      const criada = await createTask({
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        dealId: rascunho.dealId || "",
        consultationId: rascunho.consultationId || "",
        assigneeId: assigneeId === SEM_RESPONSAVEL ? "" : assigneeId,
        prazo,
        itens: itens.map(texto => ({ texto, feito: false })),
        mensagemSugerida: mensagem.trim(),
        origem: rascunho.origem || "manual",
      });
      onOpenChange(false);
      onCriada?.(criada);
      toast.success("Tarefa criada para a secretaria");
    } catch (err) {
      toast.error(`Falha ao criar a tarefa: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={aberto => { if (!salvando) onOpenChange(aberto); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" /> Criar tarefa para a secretaria
          </DialogTitle>
          <DialogDescription>
            {nomePaciente ? `Paciente: ${nomePaciente}` : "Tarefa avulsa, sem paciente vinculado."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tarefa-titulo">Título</Label>
            <Input
              id="tarefa-titulo"
              autoFocus
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex.: Cobrar exames"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={assigneeId || SEM_RESPONSAVEL} onValueChange={setAssigneeId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_RESPONSAVEL}>Fila geral — quem pegar</SelectItem>
                  {responsaveis.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name} — {roleLabel(u.role)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tarefa-prazo">Prazo (opcional)</Label>
              <Input id="tarefa-prazo" type="date" value={prazo} onChange={e => setPrazo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">
              Checklist {itens.length > 0 && `(${itens.length})`}
            </div>
            {itens.map(item => (
              <div key={item} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => setItens(prev => prev.filter(i => i !== item))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                value={novoItem}
                onChange={e => setNovoItem(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); acrescentar(); } }}
                placeholder="Acrescentar item…"
                className="h-8 text-sm"
              />
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={acrescentar}>
                <Plus className="h-3.5 w-3.5" /> Incluir
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tarefa-mensagem">Mensagem sugerida ao paciente (opcional)</Label>
            <Textarea
              id="tarefa-mensagem"
              value={mensagem}
              onChange={e => setMensagem(e.target.value)}
              rows={4}
              placeholder="A secretaria vê este texto pronto e pode editar antes de enviar."
              className="text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button className="gap-2" onClick={criar} disabled={salvando || !titulo.trim()}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
