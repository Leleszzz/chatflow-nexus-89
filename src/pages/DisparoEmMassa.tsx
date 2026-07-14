import { ChangeEvent, useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCRM } from "@/store/crm-store";
import { downloadCsv } from "@/lib/csv";
import { AlertTriangle, Bot, CheckCircle2, CreditCard, Download, FileSpreadsheet, LockKeyhole, MessageSquare, Send, Upload } from "lucide-react";
import { toast } from "sonner";

const COST_PER_MESSAGE = 0.2;
const sampleRows = [
  { nome: "Marina Souza", numero: "+55 11 99999-1010", campo1: "Ortodontia", campo2: "manha" },
  { nome: "Carlos Lima", numero: "+55 11 98888-2020", campo1: "Avaliacao", campo2: "tarde" },
  { nome: "Juliana Rocha", numero: "+55 11 97777-3030", campo1: "Clareamento", campo2: "sexta" },
];
const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function DisparoEmMassa() {
  const { isAdmin } = useCRM();
  const [fileName, setFileName] = useState("");
  const [estimatedRows, setEstimatedRows] = useState(0);
  const [message, setMessage] = useState("Oi {{Nome}}, tudo bem? Temos uma oportunidade especial para voce sobre {{Campo1}}. Toque no botao abaixo para falar com nossa equipe.");
  const [buttonName, setButtonName] = useState("Falar com a clinica");
  const [targetNumber, setTargetNumber] = useState("+55 11 98888-0101");
  const [creditBalance, setCreditBalance] = useState(120);
  const [creditTopUp, setCreditTopUp] = useState("100");
  const [lastReport, setLastReport] = useState<{
    createdAt: string;
    fileName: string;
    targetNumber: string;
    contacts: number;
    estimatedCost: number;
    buttonName: string;
  } | null>(null);
  const totalCost = useMemo(() => estimatedRows * COST_PER_MESSAGE, [estimatedRows]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setEstimatedRows(250);
    toast.success("Planilha carregada para simulacao");
    event.target.value = "";
  };

  const insertToken = (token: string) => {
    setMessage(current => `${current}${current.endsWith(" ") || !current ? "" : " "}${token}`);
  };

  const prepareBlast = () => {
    if (!fileName) return toast.error("Suba uma planilha antes de preparar o disparo");
    if (!message.trim()) return toast.error("Informe a mensagem do disparo");
    if (!buttonName.trim()) return toast.error("Informe o nome do botao");
    if (!targetNumber.trim()) return toast.error("Informe o numero da instancia de destino");
    if (totalCost > creditBalance) return toast.error("Saldo insuficiente. Adicione créditos antes de preparar o disparo.");
    setLastReport({
      createdAt: new Date().toISOString(),
      fileName,
      targetNumber: targetNumber.trim(),
      contacts: estimatedRows,
      estimatedCost: totalCost,
      buttonName: buttonName.trim(),
    });
    setCreditBalance(current => Math.max(0, current - totalCost));
    toast.success("Disparo preparado para revisao");
  };

  const addCredits = () => {
    const amount = Number(creditTopUp);
    if (!amount || amount <= 0) return toast.error("Informe um valor válido para adicionar créditos");
    setCreditBalance(current => current + amount);
    toast.success("Créditos adicionados");
  };

  const downloadReport = () => {
    if (!lastReport) return;
    downloadCsv("relatorio-disparo-em-massa.csv", [
      ["data", "arquivo", "instancia_destino", "contatos", "custo_por_envio", "custo_estimado", "botao"],
      [
        new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(lastReport.createdAt)),
        lastReport.fileName,
        lastReport.targetNumber,
        lastReport.contacts,
        formatBRL(COST_PER_MESSAGE),
        formatBRL(lastReport.estimatedCost),
        lastReport.buttonName,
      ],
    ]);
  };

  if (!isAdmin) {
    return (
      <AppLayout title="Disparo em massa" subtitle="Recurso pago">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Somente administradores podem acessar disparos em massa.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Disparo em massa" subtitle="Recurso pago para clientes ainda nao contactados">
      <div className="mb-6 rounded-xl border border-warning/30 bg-warning-soft p-4 text-warning">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="text-sm font-semibold">Custo por disparo: {formatBRL(COST_PER_MESSAGE)}</div>
            <div className="text-xs">
              O envio sera feito por um WhatsApp aquecido aleatorio fora do painel. O vendedor so tera acesso aos clientes que clicarem no botao e iniciarem conversa com a instancia da clinica.
            </div>
          </div>
        </div>
      </div>

      <section className="card-elevated mb-6 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-display text-base font-bold">Saldo de créditos</h2>
            <p className="text-sm text-muted-foreground">O disparo só pode ser preparado quando houver saldo suficiente na plataforma.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Saldo disponível</div>
              <div className="text-xl font-bold">{formatBRL(creditBalance)}</div>
            </div>
            <div>
              <Label>Adicionar créditos</Label>
              <Input type="number" value={creditTopUp} onChange={event => setCreditTopUp(event.target.value)} />
            </div>
            <Button className="bg-gradient-primary" onClick={addCredits}>Adicionar saldo</Button>
          </div>
        </div>
      </section>

      <section className="card-elevated mb-6 p-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold">Criar disparo pago</h2>
            <p className="text-sm text-muted-foreground">Importe contatos externos e configure a mensagem com campos personalizados.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{estimatedRows}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">contatos</div>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{formatBRL(COST_PER_MESSAGE)}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">por envio</div>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-3">
              <div className="text-lg font-bold">{formatBRL(totalCost)}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">estimado</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <div>
              <Label>Planilha de contatos</Label>
              <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background px-4 py-8 text-center hover:bg-secondary/60">
                <Upload className="mb-3 h-7 w-7 text-primary" />
                <span className="text-sm font-semibold">{fileName || "Selecionar arquivo .csv ou .xlsx"}</span>
                <span className="mt-1 text-xs text-muted-foreground">Colunas obrigatorias: Nome e Numero. Campos opcionais: Campo1 a Campo6.</span>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFile} />
              </label>
            </div>

            <div className="rounded-xl border border-border/70 bg-background p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-success" /> Resumo dos contatos
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                <div className="rounded-lg bg-success-soft p-3 text-success"><div className="font-bold">{estimatedRows ? 238 : 0}</div><div>válidos</div></div>
                <div className="rounded-lg bg-destructive-soft p-3 text-destructive"><div className="font-bold">{estimatedRows ? 12 : 0}</div><div>inválidos</div></div>
                <div className="rounded-lg bg-warning-soft p-3 text-warning"><div className="font-bold">{estimatedRows ? 6 : 0}</div><div>duplicados</div></div>
                <div className="rounded-lg bg-warning-soft p-3 text-warning"><div className="font-bold">{estimatedRows ? 4 : 0}</div><div>sem DDD</div></div>
                <div className="rounded-lg bg-muted p-3 text-muted-foreground"><div className="font-bold">{estimatedRows ? 2 : 0}</div><div>incompletos</div></div>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-background p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-primary" /> Estrutura esperada
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {["Nome", "Numero", "Campo1", "Campo2", "Campo3", "Campo4", "Campo5", "Campo6"].map(column => (
                  <div key={column} className="rounded-lg bg-secondary px-2 py-2 font-medium">{column}</div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Botao da mensagem</Label>
                <Input value={buttonName} onChange={event => setButtonName(event.target.value)} />
              </div>
              <div>
                <Label>Numero da instancia de destino</Label>
                <Input value={targetNumber} onChange={event => setTargetNumber(event.target.value)} placeholder="+55 11 99999-0000" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label>Mensagem personalizada</Label>
              <Textarea value={message} onChange={event => setMessage(event.target.value)} rows={9} className="mt-1" />
            </div>
            <div className="flex flex-wrap gap-2">
              {["{{Nome}}", "{{Numero}}", "{{Campo1}}", "{{Campo2}}", "{{Campo3}}", "{{Campo4}}", "{{Campo5}}", "{{Campo6}}"].map(token => (
                <Button key={token} type="button" variant="outline" size="sm" onClick={() => insertToken(token)}>
                  {token}
                </Button>
              ))}
            </div>

            <div className="rounded-xl bg-secondary p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <MessageSquare className="h-4 w-4" /> Previa
              </div>
              <div className="rounded-xl bg-background p-4 text-sm shadow-sm">
                <div className="whitespace-pre-wrap">
                  {message
                    .replaceAll("{{Nome}}", sampleRows[0].nome)
                    .replaceAll("{{Numero}}", sampleRows[0].numero)
                    .replaceAll("{{Campo1}}", sampleRows[0].campo1)
                    .replaceAll("{{Campo2}}", sampleRows[0].campo2)}
                </div>
                <Button variant="outline" className="mt-4 w-full gap-2">
                  <Bot className="h-4 w-4" /> {buttonName || "Botao"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="h-4 w-4 text-primary" /> Acesso no painel</div>
                <p className="text-xs text-muted-foreground">Contatos importados nao aparecem para vendedores ate clicarem no botao.</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-primary" /> Cobranca</div>
                <p className="text-xs text-muted-foreground">Valor calculado por contato enviado: {formatBRL(COST_PER_MESSAGE)}.</p>
              </div>
            </div>

            <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-xs text-warning">
              <div className="mb-1 font-semibold">Boas práticas e segurança</div>
              Use apenas contatos com permissão, evite mensagens repetitivas, respeite limites de envio e use templates aprovados quando necessário.
            </div>

            <Button className="w-full gap-2 bg-gradient-primary" onClick={prepareBlast}>
              <Send className="h-4 w-4" /> Preparar disparo
            </Button>
            {totalCost > creditBalance && (
              <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-3 text-xs font-medium text-destructive">
                Saldo insuficiente para este envio. Custo estimado: {formatBRL(totalCost)}.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card-elevated p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-bold">Relatorio do disparo</h2>
            <p className="text-sm text-muted-foreground">Resumo operacional do ultimo disparo preparado.</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={downloadReport} disabled={!lastReport}>
            <Download className="h-4 w-4" /> Baixar CSV
          </Button>
        </div>
        {lastReport ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">arquivo</div>
              <div className="mt-1 truncate text-sm font-semibold">{lastReport.fileName}</div>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">destino</div>
              <div className="mt-1 truncate text-sm font-semibold">{lastReport.targetNumber}</div>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">contatos</div>
              <div className="mt-1 text-sm font-semibold">{lastReport.contacts}</div>
            </div>
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">custo estimado</div>
              <div className="mt-1 text-sm font-semibold">{formatBRL(lastReport.estimatedCost)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
            Prepare um disparo para gerar o relatorio.
          </div>
        )}
      </section>
    </AppLayout>
  );
}
