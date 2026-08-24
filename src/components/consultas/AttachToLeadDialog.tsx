import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCRM } from "@/store/crm-store";
import { whatsappApi } from "@/lib/whatsapp-api";
import { Deal } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { formatDuration } from "./RecorderPanel";

const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("") || "?";

const somenteDigitos = (v: string) => v.replace(/\D/g, "");

export type AttachResult = { dealId: string; title: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  durationSec: number;
  recordedAt: string;
  enviando: boolean;
  progresso: number;
  onConfirm: (result: AttachResult) => void;
};

export function AttachToLeadDialog({
  open, onOpenChange, durationSec, recordedAt, enviando, progresso, onConfirm,
}: Props) {
  const { deals, canViewDeal, addDeal, stages, currentUser, isAdmin, teamUsers } = useCRM();

  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState<Deal | null>(null);
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTelefone, setNovoTelefone] = useState("");
  const [buscandoLista, setBuscandoLista] = useState(false);
  const [titulo, setTitulo] = useState("");

  const tituloSugerido = useMemo(() => {
    const d = new Date(recordedAt);
    const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `Consulta • ${data} ${hora}`;
  }, [recordedAt]);

  useEffect(() => {
    if (!open) return;
    setBusca("");
    setSelecionado(null);
    setCriando(false);
    setNovoNome("");
    setNovoTelefone("");
    setTitulo(tituloSugerido);
  }, [open, tituloSugerido]);

  const visiveis = useMemo(() => deals.filter(canViewDeal), [deals, canViewDeal]);

  // Mesma busca da página de prontuários: nome, telefone e tags.
  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return visiveis.slice(0, 8);
    const digitos = somenteDigitos(q);
    return visiveis
      .filter(deal => {
        const alvo = [deal.customer, deal.phone, ...(deal.tags || [])].join(" ").toLowerCase();
        if (alvo.includes(q)) return true;
        // Busca por número ignora a máscara: "27999" acha "+55 (27) 99999-0000".
        return digitos.length >= 4 && somenteDigitos(deal.phone).includes(digitos);
      })
      .slice(0, 8);
  }, [visiveis, busca]);

  // O número digitado já tem card? Evita criar cliente duplicado. Compara pelos
  // últimos 8 dígitos, como o phoneKey do backend, para casar número com e sem
  // DDI e com e sem o nono dígito.
  const dealExistentePeloNumero = useMemo(() => {
    const digitos = somenteDigitos(novoTelefone);
    if (digitos.length < 8) return null;
    const ultimos = digitos.slice(-8);
    return visiveis.find(d => somenteDigitos(d.phone).endsWith(ultimos)) || null;
  }, [visiveis, novoTelefone]);

  // Puxa o nome da lista de leads importada, se o número estiver lá.
  const buscarNaLista = async () => {
    const digitos = somenteDigitos(novoTelefone);
    if (digitos.length < 10 || novoNome.trim()) return;
    setBuscandoLista(true);
    try {
      const registro = await whatsappApi.lookupLeadByPhone(digitos);
      if (registro?.nome) {
        setNovoNome(registro.nome);
        toast.success(`Nome encontrado na lista: ${registro.nome}`);
      }
    } catch {
      // A lista é opcional — se não achar, o médico digita o nome.
    } finally {
      setBuscandoLista(false);
    }
  };

  const confirmar = () => {
    const nomeConsulta = titulo.trim() || tituloSugerido;

    if (criando) {
      const digitos = somenteDigitos(novoTelefone);
      if (digitos.length < 10) {
        toast.error("Informe o número de WhatsApp do cliente com DDD");
        return;
      }
      if (dealExistentePeloNumero) {
        toast.error(`Este número já é do cliente ${dealExistentePeloNumero.customer} — selecione-o na busca`);
        return;
      }
      const responsavel = isAdmin
        ? currentUser?.id || teamUsers.find(u => u.active)?.id || ""
        : currentUser?.id || "";
      const deal: Deal = {
        id: `d${Date.now()}`,
        // Sem nome, o próprio número identifica o cliente até alguém renomear.
        customer: novoNome.trim() || novoTelefone.trim(),
        phone: novoTelefone.trim(),
        lastMessage: "Cliente criado a partir de uma consulta gravada.",
        lastInteraction: new Date().toISOString(),
        sellerId: responsavel,
        temperature: "morno",
        tags: ["Consulta"],
        unread: false,
        stage: stages[0]?.id || "novo-lead",
      };
      addDeal(deal);
      onConfirm({ dealId: deal.id, title: nomeConsulta });
      return;
    }

    if (!selecionado) {
      toast.error("Selecione um cliente ou cadastre um novo");
      return;
    }
    onConfirm({ dealId: selecionado.id, title: nomeConsulta });
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!enviando) onOpenChange(value); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Anexar consulta ao cliente</DialogTitle>
          <DialogDescription>
            Gravação de {formatDuration(durationSec)}. Escolha de quem é esta consulta.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          {!criando ? (
            <>
              <div>
                <Label htmlFor="busca-cliente">Buscar cliente</Label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="busca-cliente"
                    autoFocus
                    value={busca}
                    onChange={e => { setBusca(e.target.value); setSelecionado(null); }}
                    placeholder="Nome ou número de WhatsApp…"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
                {resultados.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Nenhum cliente encontrado.
                  </div>
                ) : (
                  resultados.map(deal => {
                    const ativo = selecionado?.id === deal.id;
                    return (
                      <button
                        key={deal.id}
                        type="button"
                        onClick={() => setSelecionado(deal)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left transition",
                          ativo ? "bg-primary-soft text-primary" : "hover:bg-secondary/60",
                        )}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={deal.avatar} alt={deal.customer} />
                          <AvatarFallback>{initials(deal.customer)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{deal.customer}</div>
                          <div className="truncate text-xs text-muted-foreground">{deal.phone}</div>
                        </div>
                        {ativo && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setCriando(true);
                  // Aproveita o que o médico já digitou na busca.
                  const digitos = somenteDigitos(busca);
                  if (digitos.length >= 10) setNovoTelefone(busca.trim());
                  else setNovoNome(busca.trim());
                }}
              >
                <UserPlus className="h-4 w-4" /> Cliente novo (cadastrar pelo WhatsApp)
              </Button>
            </>
          ) : (
            <div className="grid gap-3 rounded-xl border border-border p-3">
              <div className="text-sm font-medium">Novo cliente</div>
              <div>
                <Label htmlFor="novo-telefone">WhatsApp *</Label>
                <Input
                  id="novo-telefone"
                  autoFocus
                  value={novoTelefone}
                  onChange={e => setNovoTelefone(e.target.value)}
                  onBlur={buscarNaLista}
                  placeholder="+55 27 99999-0000"
                />
                {buscandoLista && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> procurando na lista de leads…
                  </div>
                )}
                {dealExistentePeloNumero && (
                  <div className="mt-1 text-xs text-destructive">
                    Este número já pertence a {dealExistentePeloNumero.customer}.
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="novo-nome">Nome (opcional)</Label>
                <Input
                  id="novo-nome"
                  value={novoNome}
                  onChange={e => setNovoNome(e.target.value)}
                  placeholder="Sem nome, o número identifica o cliente"
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCriando(false)}>
                Voltar para a busca
              </Button>
            </div>
          )}

          <div>
            <Label htmlFor="titulo-consulta">Nome da consulta</Label>
            <Input
              id="titulo-consulta"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder={tituloSugerido}
            />
          </div>

          {enviando && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Enviando o áudio…</span>
                <span>{progresso}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progresso}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando} className="gap-2 bg-gradient-primary">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {enviando ? "Enviando…" : "Anexar e transcrever"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
