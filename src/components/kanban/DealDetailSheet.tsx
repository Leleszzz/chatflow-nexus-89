import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Deal, Temperature } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useCRM } from "@/store/crm-store";
import { TagBadge } from "@/components/shared/Badges";
import { CustomFieldsPanel } from "@/components/shared/CustomFieldsPanel";
import { CalendarClock, CheckCircle2, Clock3, FolderOpen, MessageCircle, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

const appointmentDateTime = (date: string, time: string) => new Date(`${date}T${time}`).getTime();

const formatAppointmentDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
};

export function DealDetailSheet({ deal, open, onOpenChange, onFinish }: {
  deal: Deal | null; open: boolean; onOpenChange: (v: boolean) => void; onFinish: () => void;
}) {
  const { updateDeal, removeDeal, tags, addTag, removeTag: removeGlobalTag, teamUsers, isAdmin, appointments, getProntuariosByDeal } = useCRM();
  const [newTag, setNewTag] = useState("");
  const navigate = useNavigate();

  const leadAppointments = useMemo(() => {
    if (!deal) return [];

    const now = Date.now();
    const related = appointments.filter(appointment => appointment.dealId === deal.id);
    const next = related
      .filter(appointment => appointmentDateTime(appointment.date, appointment.startTime) >= now)
      .sort((a, b) => appointmentDateTime(a.date, a.startTime) - appointmentDateTime(b.date, b.startTime));
    const history = related
      .filter(appointment => appointmentDateTime(appointment.date, appointment.startTime) < now)
      .sort((a, b) => appointmentDateTime(b.date, b.startTime) - appointmentDateTime(a.date, a.startTime));

    return [...next, ...history];
  }, [appointments, deal]);

  if (!deal) return null;

  const nextAppointmentId = leadAppointments.find(appointment => appointmentDateTime(appointment.date, appointment.startTime) >= Date.now())?.id;

  const createAndAttachTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    addTag(tag);
    updateDeal(deal.id, { tags: Array.from(new Set([...deal.tags, tag])) });
    setNewTag("");
    toast.success("Tag vinculada ao lead");
  };

  const toggleTag = (tag: string) => {
    const alreadyLinked = deal.tags.includes(tag);
    updateDeal(deal.id, {
      tags: alreadyLinked ? deal.tags.filter(item => item !== tag) : [...deal.tags, tag],
    });
  };

  const removeTag = (tag: string) => updateDeal(deal.id, { tags: deal.tags.filter(item => item !== tag) });
  const deleteGlobalTag = (tag: string) => {
    removeGlobalTag(tag);
    updateDeal(deal.id, { tags: deal.tags.filter(item => item !== tag) });
    toast.success("Tag excluída");
  };

  const handleDeleteDeal = () => {
    if (!window.confirm(`Excluir o card de ${deal.customer}? Esta acao tambem remove agendamentos vinculados.`)) return;
    removeDeal(deal.id);
    toast.success("Card excluido");
    onOpenChange(false);
  };

  const renderAppointmentCard = (appointment: typeof leadAppointments[number], compact = false) => {
    const seller = teamUsers.find(user => user.id === appointment.sellerId);
    const isNext = appointment.id === nextAppointmentId;

    return (
      <div
        key={appointment.id}
        className={`rounded-lg border ${compact ? "p-2" : "p-3"} text-xs ${
          isNext ? "border-primary/35 bg-primary-soft/70" : "border-border/70 bg-secondary/50"
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-semibold">{appointment.title}</div>
          {isNext && <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Próximo</span>}
        </div>
        <div className="space-y-1 text-muted-foreground">
          <div className="truncate"><span className="font-medium text-foreground">Cliente:</span> {deal.customer}</div>
          <div className="flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" />
            {formatAppointmentDate(appointment.date)} às {appointment.startTime}
          </div>
          <div className="truncate"><span className="font-medium text-foreground">Vendedor:</span> {seller?.name || "Sem vendedor"}</div>
        </div>
        {!compact && appointment.description && <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">{appointment.description}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-visible p-0">
        {leadAppointments.length > 0 && (
          <aside className="absolute right-[calc(100%+0.75rem)] top-0 hidden max-h-[90vh] w-72 overflow-y-auto rounded-xl border border-border/70 bg-card p-3 shadow-xl lg:block">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">Agendamentos</div>
                <div className="text-[11px] text-muted-foreground">Próximo primeiro</div>
              </div>
            </div>
            <div className="space-y-2">
              {leadAppointments.map(appointment => renderAppointmentCard(appointment))}
            </div>
          </aside>
        )}

        <div className="max-h-[90vh] overflow-y-auto p-6">
          {leadAppointments.length > 0 && (
            <div className="mb-4 rounded-xl border border-border/70 bg-card p-3 shadow-sm lg:hidden">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-primary" />
                Agendamentos
              </div>
              <div className="space-y-2">
                {leadAppointments.map(appointment => renderAppointmentCard(appointment, true))}
              </div>
            </div>
          )}

          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0 flex-1">
                <DialogTitle className="font-display flex items-center gap-2">
                  <UserRound className="w-5 h-5 text-primary" /> Detalhes do lead
                </DialogTitle>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  title="Abrir prontuário do cliente"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/prontuarios?dealId=${deal.id}`);
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                  Prontuário
                  {getProntuariosByDeal(deal.id).length > 0 && (
                    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      {getProntuariosByDeal(deal.id).length}
                    </span>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-success/30 text-success hover:text-success"
                  title="Abrir conversa no WhatsApp"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/conversas?deal=${deal.id}`);
                  }}
                >
                  <MessageCircle className="w-4 h-4" />
                  Abrir conversa
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="customer">Nome do lead</Label>
                <Input
                  id="customer"
                  value={deal.customer}
                  onChange={event => updateDeal(deal.id, { customer: event.target.value })}
                  onBlur={() => toast.success("Nome do lead atualizado")}
                />
              </div>
              <div>
                <Label htmlFor="phone">WhatsApp</Label>
                <Input id="phone" value={deal.phone} onChange={event => updateDeal(deal.id, { phone: event.target.value })} />
              </div>
            </div>

            <div>
              <Label htmlFor="interest">Interesse do Cliente</Label>
              <Input
                id="interest"
                value={deal.interest || ""}
                onChange={event => updateDeal(deal.id, { interest: event.target.value })}
                onBlur={() => toast.success("Interesse do cliente atualizado")}
                placeholder="Ex: Botox"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Temperatura</Label>
                <Select value={deal.temperature} onValueChange={(v) => { updateDeal(deal.id, { temperature: v as Temperature }); toast.success("Temperatura atualizada"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quente">Quente</SelectItem>
                    <SelectItem value="morno">Morno</SelectItem>
                    <SelectItem value="frio">Frio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Responsável</Label>
                <Select value={deal.sellerId} onValueChange={(v) => { updateDeal(deal.id, { sellerId: v }); toast.success("Responsável alterado"); }} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {teamUsers.filter(user => user.active && user.role !== "Administrador").map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Tags vinculadas</Label>
              <div className="flex flex-wrap gap-1.5 my-2 min-h-[24px]">
                {deal.tags.map(tag => <TagBadge key={tag} label={tag} onRemove={() => removeTag(tag)} />)}
                {deal.tags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma tag vinculada</span>}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Criar nova tag..." value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => event.key === "Enter" && createAndAttachTag()} />
                <Button size="icon" variant="outline" onClick={createAndAttachTag}><Plus className="w-4 h-4" /></Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <span key={tag} className={`inline-flex items-center rounded-full border transition-colors overflow-hidden ${
                    deal.tags.includes(tag)
                      ? "bg-primary-soft text-primary border-primary/30"
                      : "bg-secondary text-muted-foreground border-border"
                  }`}>
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="text-[11px] px-2 py-1 hover:text-foreground"
                    >
                      {tag}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteGlobalTag(tag)}
                      className="h-full px-1.5 py-1 border-l border-current/15 hover:bg-destructive/10 hover:text-destructive"
                      title={`Excluir tag ${tag}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <CustomFieldsPanel deal={deal} />

            <div>
              <Label htmlFor="notes">Observação interna</Label>
              <Textarea id="notes" defaultValue={deal.notes} onBlur={event => updateDeal(deal.id, { notes: event.target.value })} rows={3} />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="destructive" className="gap-2" onClick={handleDeleteDeal}>
                <Trash2 className="w-4 h-4" /> Excluir card
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                <Button className="bg-gradient-primary text-primary-foreground gap-2" onClick={onFinish}>
                  <CheckCircle2 className="w-4 h-4" /> Concluir atendimento
                </Button>
              </div>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
