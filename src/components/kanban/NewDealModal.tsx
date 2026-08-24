import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Deal, Temperature } from "@/lib/mock-data";
import { useCRM } from "@/store/crm-store";
import { toast } from "sonner";
import { isAtendente } from "@/lib/roles";

const initialForm = {
  customer: "",
  phone: "",
  sellerId: "s1",
  temperature: "morno" as Temperature,
  estimatedValue: "",
  notes: "",
  productInterest: "",
};

export function NewDealModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { addDeal, teamUsers, currentUser, isAdmin } = useCRM();
  const defaultSellerId = isAdmin ? teamUsers.find(user => user.active && isAtendente(user.role))?.id || initialForm.sellerId : currentUser?.id || initialForm.sellerId;
  const [form, setForm] = useState(() => ({ ...initialForm, sellerId: defaultSellerId }));

  const reset = () => setForm({ ...initialForm, sellerId: defaultSellerId });

  const save = () => {
    if (!form.customer.trim()) return toast.error("Informe o nome do cliente");
    if (!form.phone.trim()) return toast.error("Informe o telefone do cliente");

    const deal: Deal = {
      id: `d${Date.now()}`,
      customer: form.customer.trim(),
      phone: form.phone.trim(),
      lastMessage: form.productInterest.trim()
        ? `Atendimento presencial registrado. Interesse: ${form.productInterest.trim()}`
        : "Atendimento presencial registrado na loja.",
      interest: form.productInterest.trim() || undefined,
      lastInteraction: new Date().toISOString(),
      sellerId: isAdmin ? form.sellerId : currentUser?.id || form.sellerId,
      temperature: form.temperature,
      tags: ["Presencial"],
      unread: false,
      estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
      stage: "novo-lead",
      notes: form.notes.trim() || undefined,
    };

    addDeal(deal);
    toast.success("Atendimento presencial criado");
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) reset(); onOpenChange(value); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Criar atendimento presencial</DialogTitle>
          <p className="text-sm text-muted-foreground">Cadastre o cliente que chegou fora do WhatsApp e coloque-o no funil.</p>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="customer">Nome do cliente *</Label>
              <Input id="customer" value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} placeholder="Ex: João Almeida" />
            </div>
            <div>
              <Label htmlFor="phone">Telefone *</Label>
              <Input id="phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+55 11 99999-0000" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Responsável</Label>
              <Select value={isAdmin ? form.sellerId : currentUser?.id || form.sellerId} onValueChange={(sellerId) => setForm({ ...form, sellerId })} disabled={!isAdmin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {teamUsers.filter(user => user.active && isAtendente(user.role)).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Temperatura</Label>
              <Select value={form.temperature} onValueChange={(temperature) => setForm({ ...form, temperature: temperature as Temperature })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quente">Quente</SelectItem>
                  <SelectItem value="morno">Morno</SelectItem>
                  <SelectItem value="frio">Frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="estimatedValue">Valor estimado</Label>
              <Input id="estimatedValue" type="number" min="0" value={form.estimatedValue} onChange={e => setForm({ ...form, estimatedValue: e.target.value })} placeholder="0,00" />
            </div>
          </div>

          <div>
            <Label htmlFor="productInterest">Interesse do cliente</Label>
            <Input id="productInterest" value={form.productInterest} onChange={e => setForm({ ...form, productInterest: e.target.value })} placeholder="Produto, serviço ou necessidade" />
          </div>

          <div>
            <Label htmlFor="notes">Observações internas</Label>
            <Textarea id="notes" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} className="bg-gradient-primary">Criar atendimento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
