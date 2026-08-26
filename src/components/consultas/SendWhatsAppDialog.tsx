import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  destinatario: string;
  textoInicial: string;
  /** Conteúdo extra acima do preview — o checklist de exames entra por aqui. */
  children?: React.ReactNode;
  onEnviar: (texto: string) => Promise<void>;
}

/**
 * Preview editável antes de qualquer mensagem sair para o paciente.
 *
 * A IA erra nome de exame e data, e o destinatário é um paciente — mandar sem
 * uma última leitura humana não vale a economia de um clique.
 */
export function SendWhatsAppDialog({
  open, onOpenChange, titulo, destinatario, textoInicial, children, onEnviar,
}: Props) {
  const [texto, setTexto] = useState(textoInicial);
  const [enviando, setEnviando] = useState(false);

  /**
   * O preview segue `textoInicial` sempre que ele MUDA de valor.
   *
   * Um texto novo só chega aqui por uma ação deliberada de quem chamou —
   * desmarcar um exame do checklist, escolher uma mensagem rápida — e essas
   * ações precisam ganhar do que já estava escrito, senão o clique não faz
   * nada e parece defeito. O que a comparação evita é o oposto: um re-render
   * qualquer com o MESMO texto apagando a edição em andamento.
   */
  const ultimoInicial = useRef(textoInicial);
  useEffect(() => {
    if (ultimoInicial.current === textoInicial) return;
    ultimoInicial.current = textoInicial;
    setTexto(textoInicial);
  }, [textoInicial]);

  useEffect(() => {
    if (!open) return;
    ultimoInicial.current = textoInicial;
    setTexto(textoInicial);
    // `textoInicial` de propósito fora das dependências: reabrir o diálogo
    // recomeça do texto sugerido, mas mudanças durante o uso passam pelo efeito
    // acima, que compara antes de sobrescrever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await onEnviar(texto.trim());
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={aberto => { if (!enviando) onOpenChange(aberto); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Revise antes de enviar para {destinatario || "o cliente"}.
          </DialogDescription>
        </DialogHeader>

        {children}

        <Textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          rows={9}
          className="text-sm"
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button className="gap-2" onClick={enviar} disabled={enviando || !texto.trim()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar no WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
