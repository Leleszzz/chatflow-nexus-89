import { useEffect, useState } from "react";
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

  // O texto é remontado quando o checklist muda; enquanto o médico não editou à
  // mão, o preview acompanha. Depois de editar, `textoInicial` para de mandar.
  const [editadoAMao, setEditadoAMao] = useState(false);
  useEffect(() => {
    if (!editadoAMao) setTexto(textoInicial);
  }, [textoInicial, editadoAMao]);

  useEffect(() => {
    if (open) setEditadoAMao(false);
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
          onChange={e => { setTexto(e.target.value); setEditadoAMao(true); }}
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
