import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Deal } from "@/lib/mock-data";
import { useCRM } from "@/store/crm-store";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

const LOSS_REASONS = [
  "Preço",
  "Sem interesse",
  "Comprou de concorrente",
  "Sem resposta",
  "Fora do perfil",
  "Sem orçamento",
  "Atendimento demorado",
  "Apenas pesquisando",
  "Outros",
];

export function FinishDealModal({ deal, open, onOpenChange }: { deal: Deal | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { finishDeal } = useCRM();
  const [result, setResult] = useState<"venda" | "recusa">("venda");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [product, setProduct] = useState("");
  const [payment, setPayment] = useState("");
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => { setAmount(""); setDescription(""); setProduct(""); setPayment(""); setReason(""); setOtherReason(""); setNotes(""); setResult("venda"); };

  const handleConfirm = () => {
    if (!deal) return;
    if (result === "venda" && !description.trim()) {
      return toast.error("Informe a descrição da venda");
    }
    if (result === "recusa") {
      if (!reason) return toast.error("Selecione um motivo da perda");
      if (reason === "Outros" && !otherReason.trim()) return toast.error("Descreva o motivo");
    }
    finishDeal({
      dealId: deal.id,
      result,
      amount: amount ? +amount : undefined,
      description, product, payment,
      reason: reason === "Outros" ? otherReason : reason,
      notes,
      finishedAt: new Date().toISOString(),
      operatorId: "s1",
    });
    toast.success(result === "venda" ? "Venda confirmada com sucesso" : "Perda registrada");
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Finalizar atendimento</DialogTitle>
          <p className="text-sm text-muted-foreground">{deal?.customer}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-2 block">Resultado</Label>
            <Tabs value={result} onValueChange={(v) => setResult(v as "venda" | "recusa")}>
              <TabsList className="grid w-full grid-cols-2 bg-secondary">
                <TabsTrigger value="venda" className="data-[state=active]:bg-success data-[state=active]:text-success-foreground gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Venda realizada
                </TabsTrigger>
                <TabsTrigger value="recusa" className="data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground gap-2">
                  <XCircle className="w-4 h-4" /> Perda
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {result === "venda" ? (
            <div className="space-y-3 animate-fade-in">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                <Label htmlFor="amount">Valor da venda (R$)</Label>
                  <Input id="amount" type="number" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="payment">Forma de pagamento</Label>
                  <Select value={payment} onValueChange={setPayment}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="cartao">Cartão de crédito</SelectItem>
                      <SelectItem value="parcelado">Parcelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="product">Produto/serviço vendido</Label>
                <Input id="product" value={product} onChange={e => setProduct(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="description">Descrição da venda <span className="text-destructive">*</span></Label>
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="O que foi vendido, condições combinadas e próximos passos." />
              </div>
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in">
              <div>
                <Label htmlFor="reason">Motivo da perda <span className="text-destructive">*</span></Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue placeholder="Selecione um motivo" /></SelectTrigger>
                  <SelectContent>
                    {LOSS_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {reason === "Outros" && (
                <div>
                  <Label htmlFor="other">Descreva o motivo <span className="text-destructive">*</span></Label>
                  <Textarea id="other" value={otherReason} onChange={e => setOtherReason(e.target.value)} rows={3} placeholder="Detalhe o motivo..." />
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="notes">Observações internas</Label>
            <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleConfirm} className={result === "venda" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}>
            {result === "venda" ? "Confirmar venda" : "Finalizar atendimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
