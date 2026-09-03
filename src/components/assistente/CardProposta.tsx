import { useState } from "react";
import { Check, Pencil, TriangleAlert, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { AssistantProposal } from "@/lib/whatsapp-api";
import { acaoDaProposta, bloqueios, podeConfirmar } from "@/lib/assistant-actions";
import { cn } from "@/lib/utils";

/**
 * A ação que o assistente preparou, esperando um clique.
 *
 * Anatomia copiada de src/components/chat/SchedulingProposalBar.tsx — faixa
 * clara, cabeçalho com ícone, X para dispensar, aviso em `bg-warning-soft`
 * quando falta pré-requisito, e o botão desabilitado ficando VISÍVEL em vez de
 * sumir (sumir deixaria o médico sem entender por que o assistente falou em
 * remarcar e nada apareceu).
 *
 * Como o SchedulingProposalBar, não chama API nenhuma: recebe callbacks. Quem
 * executa é a página, e quem revalida é o servidor.
 */
export function CardProposta({
  proposta, ocupado, onConfirmar, onRecusar,
}: {
  proposta: AssistantProposal;
  ocupado?: boolean;
  onConfirmar: (edicao?: Record<string, unknown>) => void;
  onRecusar: () => void;
}) {
  const acao = acaoDaProposta(proposta.tipo);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  if (!acao) return null;
  const Icone = acao.icone;
  const impedimentos = bloqueios(proposta);
  const liberado = podeConfirmar(proposta) && !ocupado;
  const decidida = proposta.status !== "pendente";

  // Só os campos editáveis que existem de fato neste payload, e só os de texto:
  // um card não é um formulário completo, é uma revisão rápida antes do clique.
  const camposEditaveis = acao.editaveis.filter(campo => {
    const valor = proposta.payload[campo];
    return typeof valor === "string" || typeof valor === "number";
  });

  const valorDe = (campo: string) => rascunho[campo] ?? String(proposta.payload[campo] ?? "");

  const confirmar = () => {
    const edicao: Record<string, unknown> = {};
    for (const campo of Object.keys(rascunho)) {
      if (rascunho[campo] !== String(proposta.payload[campo] ?? "")) edicao[campo] = rascunho[campo];
    }
    onConfirmar(Object.keys(edicao).length ? edicao : undefined);
  };

  return (
    <div
      className={cn(
        "mt-2 rounded-xl border px-4 py-3",
        decidida ? "border-border bg-secondary/50" : "border-info/30 bg-info-soft/60",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icone className={cn("h-4 w-4 shrink-0", decidida ? "text-muted-foreground" : "text-info")} />
          <div className="min-w-0">
            <div className={cn("truncate text-sm font-semibold", decidida ? "text-muted-foreground" : "text-info")}>
              {proposta.titulo || acao.rotulo}
            </div>
            {proposta.resumo && (
              <div className="truncate text-[11px] text-muted-foreground">{proposta.resumo}</div>
            )}
          </div>
        </div>
        {!decidida && (
          <Button variant="ghost" size="iconSm" onClick={onRecusar} disabled={ocupado} title="Descartar">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {impedimentos.length > 0 && !decidida && (
        <div className="mb-2 space-y-1">
          {impedimentos.map(aviso => (
            <div key={aviso} className="flex items-start gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{aviso}</span>
            </div>
          ))}
        </div>
      )}

      {proposta.preview.linhas.length > 0 && (
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {proposta.preview.linhas.map(linha => (
            <div key={linha.rotulo} className="contents">
              <dt className="text-muted-foreground">{linha.rotulo}</dt>
              <dd className="truncate font-medium">{linha.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {!editando && proposta.preview.texto && (
        <div className="mb-2 whitespace-pre-wrap rounded-lg bg-card px-3 py-2 text-xs">
          {proposta.preview.texto}
        </div>
      )}

      {editando && (
        <div className="mb-2 space-y-2">
          {camposEditaveis.map(campo => (
            <label key={campo} className="block">
              <span className="text-[11px] text-muted-foreground">{campo.replace(/_/g, " ")}</span>
              {campo === "texto" || campo === "mensagem" || campo === "descricao" ? (
                <Textarea
                  value={valorDe(campo)}
                  onChange={e => setRascunho(r => ({ ...r, [campo]: e.target.value }))}
                  className="mt-0.5 max-h-40 min-h-[64px] resize-none bg-card text-xs"
                />
              ) : (
                <Input
                  value={valorDe(campo)}
                  onChange={e => setRascunho(r => ({ ...r, [campo]: e.target.value }))}
                  className="mt-0.5 h-8 bg-card text-xs"
                />
              )}
            </label>
          ))}
        </div>
      )}

      {decidida ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {proposta.status === "confirmada" && <Check className="h-3 w-3 text-success" />}
          {proposta.status === "falhou" && <TriangleAlert className="h-3 w-3 text-destructive" />}
          <span>
            {proposta.status === "confirmada" && (proposta.resultado?.detalhe || "Feito.")}
            {proposta.status === "recusada" && "Descartado."}
            {proposta.status === "falhou" && (proposta.erro || "Não deu para executar.")}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={confirmar} disabled={!liberado} className="gap-1.5">
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {acao.rotuloConfirmar}
          </Button>
          {camposEditaveis.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditando(v => !v)}
              disabled={ocupado}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              {editando ? "Pronto" : "Ajustar"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
