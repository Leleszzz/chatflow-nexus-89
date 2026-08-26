import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QuickReply, whatsappApi } from "@/lib/whatsapp-api";
import { renderTemplate } from "@/lib/message-template";

/** Contexto das `{{variaveis}}` — mesmo shape que shared/message-template.js espera. */
export type QuickReplyContext = {
  nome?: string;
  nomeWhatsapp?: string;
  telefone?: string;
  listaNome?: string;
  listaCpf?: string;
  listaTelefone?: string;
  atendente?: string;
};

interface Props {
  contexto: QuickReplyContext;
  disabled?: boolean;
  /** Recebe o corpo já renderizado, com as variáveis substituídas. */
  onEscolher: (texto: string) => void;
}

/**
 * Seletor de mensagens rápidas.
 *
 * Nasceu como JSX solto dentro da tela de Conversas; virou componente quando a
 * fila da secretaria passou a precisar do mesmo seletor. Ele entrega o texto
 * pronto e não envia nada — quem chamou decide se joga no rascunho do chat ou
 * no preview da tarefa.
 */
export function QuickReplyPicker({ contexto, disabled, onEscolher }: Props) {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelado = false;
    whatsappApi.listQuickReplies()
      .then(list => { if (!cancelado) setQuickReplies(list); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, []);

  const escolher = (qr: QuickReply) => {
    onEscolher(renderTemplate(qr.corpo, contexto));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Mensagens rápidas" disabled={disabled}>
          <MessageSquareText className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-1">
        {quickReplies.length === 0 ? (
          <div className="p-3 text-center text-xs text-muted-foreground">
            Nenhuma mensagem criada.<br />
            Crie em Configurações &gt; Mensagens rápidas.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {quickReplies.map(qr => (
              <button
                key={qr.id}
                onClick={() => escolher(qr)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-secondary"
              >
                <span className="text-sm font-medium">{qr.titulo}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {renderTemplate(qr.corpo, contexto)}
                </span>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
