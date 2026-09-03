import { Loader2, Check, TriangleAlert } from "lucide-react";
import type { AssistantPasso } from "@/lib/whatsapp-api";
import { rotuloDoPasso } from "@/lib/assistant-actions";
import { cn } from "@/lib/utils";

/**
 * O que o assistente está consultando agora.
 *
 * Existe porque a resposta não vem em streaming: um turno que aciona quatro
 * ferramentas leva dezenas de segundos, e tela parada nesse tempo parece
 * travamento. Mostrar o passo também deixa a resposta auditável — o médico vê
 * "leu 20 mensagens do Julio" e entende de onde saiu o que está lendo.
 *
 * Burro de propósito: quem decide o texto de cada passo é o backend (o `resumo`
 * de cada ferramenta) com o fallback de src/lib/assistant-actions.ts.
 */
export function PassosDaIA({ passos, ativo }: { passos: AssistantPasso[]; ativo: boolean }) {
  if (!ativo && passos.length === 0) return null;
  const ultimo = passos[passos.length - 1];
  const anteriores = passos.slice(0, -1);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-card px-4 py-2 text-sm shadow-sm sm:max-w-[70%]">
        <div className="flex items-center gap-2 text-muted-foreground">
          {ativo
            ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            : <Check className="h-3.5 w-3.5 shrink-0 text-success" />}
          <span className="text-[13px]">
            {ultimo ? rotuloDoPasso(ultimo) : "pensando…"}
          </span>
        </div>

        {anteriores.length > 0 && (
          // <details> nativo no lugar de um accordion: o projeto não tem o
          // componente, e trazer @radix-ui/react-accordion por causa disto seria
          // uma dependência para uma seta.
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-muted-foreground/80 hover:text-muted-foreground">
              {anteriores.length} passo(s) antes
            </summary>
            <ul className="mt-1 space-y-0.5 border-l border-border pl-2">
              {anteriores.map((passo, i) => (
                <li
                  key={`${passo.tool}-${i}`}
                  className={cn(
                    "flex items-start gap-1.5 text-[11px]",
                    passo.ok ? "text-muted-foreground" : "text-warning",
                  )}
                >
                  {!passo.ok && <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
                  <span>{rotuloDoPasso(passo)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
