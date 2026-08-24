import { useEffect, useState } from "react";
import { Loader2, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { whatsappApi } from "@/lib/whatsapp-api";
import type { Consultation, ConsultationSpeaker, SpeakerRole } from "@/lib/whatsapp-api";

const PAPEIS: { value: SpeakerRole; label: string }[] = [
  { value: "medico", label: "Profissional" },
  { value: "paciente", label: "Paciente" },
  { value: "acompanhante", label: "Acompanhante" },
  { value: "outro", label: "Outro" },
];

// Nome sugerido ao escolher o papel, para o médico não digitar em toda consulta.
const ROTULO_PADRAO: Record<SpeakerRole, string> = {
  medico: "Profissional",
  paciente: "Paciente",
  acompanhante: "Acompanhante",
  outro: "",
};

type Props = {
  consultation: Consultation;
  nomeDoProfissional?: string;
};

export function SpeakerMapper({ consultation, nomeDoProfissional }: Props) {
  const [speakers, setSpeakers] = useState<ConsultationSpeaker[]>(consultation.speakers);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setSpeakers(consultation.speakers), [consultation.id, consultation.speakers]);

  // Um trecho de cada falante, para o médico reconhecer quem é quem sem ter que
  // reler a transcrição inteira.
  const amostraDe = (key: string) => {
    const fala = consultation.segments.find(s => s.speaker === key && s.text.length > 25)
      || consultation.segments.find(s => s.speaker === key);
    if (!fala) return "";
    return fala.text.length > 110 ? `${fala.text.slice(0, 110)}…` : fala.text;
  };

  const atualizar = (key: string, patch: Partial<ConsultationSpeaker>) => {
    setSpeakers(prev => prev.map(s => (s.key === key ? { ...s, ...patch } : s)));
  };

  const trocarPapel = (key: string, role: SpeakerRole) => {
    const atual = speakers.find(s => s.key === key);
    const rotuloGenerico = !atual?.label || /^Pessoa \d+$/.test(atual.label)
      || PAPEIS.some(p => p.label === atual.label) || atual.label === nomeDoProfissional;
    const sugestao = role === "medico" && nomeDoProfissional ? nomeDoProfissional : ROTULO_PADRAO[role];
    // Nome digitado à mão é preservado; só o rótulo genérico é substituído.
    atualizar(key, { role, ...(rotuloGenerico && sugestao ? { label: sugestao } : {}) });
  };

  const salvar = async () => {
    const vazio = speakers.find(s => !s.label.trim());
    if (vazio) {
      toast.error("Dê um nome a cada pessoa da consulta");
      return;
    }
    setSalvando(true);
    try {
      await whatsappApi.patchConsultation(consultation.id, { speakers });
      // O estado chega de volta pelo socket (consultation:update).
      toast.success("Falantes identificados — a transcrição foi atualizada");
    } catch (err) {
      toast.error(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSalvando(false);
    }
  };

  if (!speakers.length) return null;

  const mudou = JSON.stringify(speakers) !== JSON.stringify(consultation.speakers);

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Quem é quem</span>
        <span className="text-xs text-muted-foreground">
          — os agentes de IA leem a transcrição com estes nomes
        </span>
      </div>

      <div className="space-y-3">
        {speakers.map(speaker => (
          <div key={speaker.key} className="grid gap-2 sm:grid-cols-[1fr_170px]">
            <div>
              <Label htmlFor={`falante-${speaker.key}`} className="text-xs">
                Pessoa {speaker.key}
              </Label>
              <Input
                id={`falante-${speaker.key}`}
                value={speaker.label}
                onChange={e => atualizar(speaker.key, { label: e.target.value })}
                placeholder="Nome que aparecerá na transcrição"
              />
              {amostraDe(speaker.key) && (
                <p className="mt-1 line-clamp-2 text-[11px] italic text-muted-foreground">
                  “{amostraDe(speaker.key)}”
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Papel</Label>
              <Select
                value={speaker.role}
                onValueChange={value => trocarPapel(speaker.key, value as SpeakerRole)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAPEIS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>

      <Button
        size="sm"
        className="mt-3 gap-2"
        onClick={salvar}
        disabled={salvando || !mudou}
      >
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Salvar identificação
      </Button>
    </div>
  );
}
