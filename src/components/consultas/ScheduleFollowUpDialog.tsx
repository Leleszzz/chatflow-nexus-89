import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCRM } from "@/store/crm-store";
import { Appointment, AppointmentType, Deal } from "@/lib/mock-data";
import { whatsappApi, WAConversation } from "@/lib/whatsapp-api";
import {
  AgendarRetornoPayload, calcularLembretes, formatarDataBR, LEMBRETES,
  QuandoLembrete, textoConfirmacao, textoLembrete,
} from "@/lib/consultation-actions";
import { computeFreeTimeButtons, conflitosNoHorario, minutesFromTime, timeFromMinutes } from "@/lib/agenda";
import { isAtendente } from "@/lib/roles";
import { mensagemDeErro } from "@/lib/erros";

const TIPOS: { valor: AppointmentType; rotulo: string }[] = [
  { valor: "retorno", rotulo: "Retorno" },
  { valor: "reuniao", rotulo: "Reunião" },
  { valor: "follow-up", rotulo: "Follow-up" },
  { valor: "ligacao", rotulo: "Ligação" },
  { valor: "outro", rotulo: "Outro" },
];

const DURACAO_PADRAO_MIN = 60;

/** Hoje + `dias`, no formato AAAA-MM-DD local. */
function emDias(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: AgendarRetornoPayload;
  deal: Deal | null | undefined;
  conversa: WAConversation | null;
  onConcluir: () => Promise<void>;
}

/**
 * Agenda o retorno sem tirar o médico da tela de Consultas.
 *
 * Data e hora chegam preenchidas pela IA quando foram ditas em voz alta; quando
 * não foram, o padrão é daqui a uma semana às 09:00 — palpite explícito que o
 * médico corrige, e não uma data que a IA inventou.
 */
export function ScheduleFollowUpDialog({ open, onOpenChange, payload, deal, conversa, onConcluir }: Props) {
  const { appointments, addAppointment, currentUser, teamUsers, isAdmin, isSecretaria } = useCRM();

  const responsaveis = useMemo(
    () => teamUsers.filter(u => u.active && isAtendente(u.role)),
    [teamUsers],
  );

  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [tipo, setTipo] = useState<AppointmentType>("retorno");
  const [sellerId, setSellerId] = useState("");
  const [enviarConfirmacao, setEnviarConfirmacao] = useState(true);
  const [lembretes, setLembretes] = useState<QuandoLembrete[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(payload.data || emDias(7));
    setHora(payload.hora || "09:00");
    setTipo("retorno");
    setSellerId(deal?.sellerId || currentUser?.id || responsaveis[0]?.id || "");
    setEnviarConfirmacao(Boolean(conversa));
    setLembretes(conversa ? ["vespera", "duas-horas"] : []);
  }, [open, payload.data, payload.hora, deal?.sellerId, currentUser?.id, responsaveis, conversa]);

  const endTime = useMemo(
    () => (hora ? timeFromMinutes(minutesFromTime(hora) + DURACAO_PADRAO_MIN) : ""),
    [hora],
  );

  const conflitos = useMemo(
    () => (data && hora ? conflitosNoHorario(appointments, { date: data, startTime: hora, endTime, sellerId }) : []),
    [appointments, data, hora, endTime, sellerId],
  );

  const horariosLivres = useMemo(
    () => (data ? computeFreeTimeButtons(data, appointments, sellerId) : []),
    [data, appointments, sellerId],
  );

  const alternarLembrete = (quando: QuandoLembrete, marcado: boolean) =>
    setLembretes(prev => (marcado ? [...new Set([...prev, quando])] : prev.filter(q => q !== quando)));

  const confirmar = async () => {
    if (!deal) return;
    if (!data || !hora) {
      toast.error("Informe a data e o horário do retorno");
      return;
    }
    if (!sellerId) {
      toast.error("Escolha o responsável pelo atendimento");
      return;
    }

    setSalvando(true);
    const nome = deal.customer || "";
    const appointment: Appointment = {
      id: `appt-${Date.now()}`,
      title: `${TIPOS.find(t => t.valor === tipo)?.rotulo || "Retorno"} - ${nome}`,
      dealId: deal.id,
      date: data,
      startTime: hora,
      endTime,
      sellerId,
      description: payload.motivo
        ? `Agendado a partir da consulta gravada. Motivo: ${payload.motivo}`
        : "Agendado a partir da consulta gravada.",
      type: tipo,
      status: "agendado",
      origin: "Consulta",
    };

    // O compromisso entra primeiro: se o WhatsApp falhar depois, a agenda já
    // está certa e o médico só precisa reenviar a mensagem.
    addAppointment(appointment);

    const problemas: string[] = [];

    if (enviarConfirmacao && conversa) {
      try {
        await whatsappApi.sendText(
          conversa.instanceId,
          conversa.chatId,
          textoConfirmacao({ nome, data, hora }),
        );
      } catch (err) {
        problemas.push(`confirmação não enviada (${mensagemDeErro(err)})`);
      }
    }

    if (conversa && lembretes.length) {
      const agendados = calcularLembretes({ data, hora }, lembretes);
      const descartados = lembretes.length - agendados.length;
      if (descartados > 0) {
        problemas.push(`${descartados} lembrete(s) cairiam no passado e foram ignorados`);
      }

      for (const lembrete of agendados) {
        try {
          await whatsappApi.createScheduledMessage({
            instanceId: conversa.instanceId,
            chatId: conversa.chatId,
            conversationId: conversa.id,
            body: textoLembrete({ nome, data, hora, quando: lembrete.quando }),
            scheduledAt: lembrete.scheduledAt,
            cancelIfClientReplies: false,
            cancelIfAgentReplies: false,
            note: "Lembrete de consulta",
          });
        } catch (err) {
          problemas.push(`lembrete não agendado (${mensagemDeErro(err)})`);
        }
      }
    }

    await onConcluir().catch(() => {});
    setSalvando(false);
    onOpenChange(false);

    const quando = `${formatarDataBR(data)} às ${hora}`;
    if (problemas.length) toast.warning(`Retorno agendado para ${quando}, mas: ${problemas.join("; ")}`);
    else toast.success(`Retorno agendado para ${quando}`);
  };

  return (
    <Dialog open={open} onOpenChange={aberto => { if (!salvando) onOpenChange(aberto); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" /> Agendar retorno
          </DialogTitle>
          <DialogDescription>
            {payload.motivo
              ? `Combinado na consulta: ${payload.motivo}`
              : "Confira a data e o horário antes de confirmar."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="retorno-data">Data</Label>
            <Input id="retorno-data" type="date" value={data} onChange={e => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="retorno-hora">Horário</Label>
            <Input id="retorno-hora" type="time" value={hora} onChange={e => setHora(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={v => setTipo(v as AppointmentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS.map(t => <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Responsável</Label>
            {/* A secretária agenda o retorno PARA o doutor, então também escolhe
                o responsável; o doutor só agenda para si mesmo. */}
            <Select value={sellerId} onValueChange={setSellerId} disabled={!isAdmin && !isSecretaria}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {responsaveis.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {conflitos.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              Já existe “{conflitos[0].title}” neste horário
            </div>
            {horariosLivres.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Livres neste dia:</span>
                {horariosLivres.map(h => (
                  <Button
                    key={h}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHora(`${String(h).padStart(2, "0")}:00`)}
                  >
                    {String(h).padStart(2, "0")}:00
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="text-xs font-medium text-muted-foreground">Avisos no WhatsApp</div>
          {!conversa ? (
            <p className="text-xs text-muted-foreground">
              Este cliente ainda não tem conversa no WhatsApp — o compromisso entra na agenda,
              mas nenhuma mensagem é enviada.
            </p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={enviarConfirmacao}
                  onCheckedChange={v => setEnviarConfirmacao(v === true)}
                />
                Enviar confirmação agora
              </label>
              {LEMBRETES.map(l => (
                <label key={l.quando} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={lembretes.includes(l.quando)}
                    onCheckedChange={v => alternarLembrete(l.quando, v === true)}
                  />
                  {l.rotulo}
                </label>
              ))}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="gap-2" onClick={confirmar} disabled={salvando || !data || !hora}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
