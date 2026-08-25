import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { CustomField, CustomFieldType } from "@/lib/mock-data";
import { whatsappApi } from "@/lib/whatsapp-api";
import { useCRM } from "@/store/crm-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensagemDeErro } from "@/lib/erros";

const TIPOS: { id: CustomFieldType; label: string; hint: string }[] = [
  { id: "texto", label: "Texto", hint: "Qualquer texto livre" },
  { id: "numero", label: "Número", hint: "Aceita 1.234,56 ou 1234.56" },
  { id: "data", label: "Data", hint: "Guardada como AAAA-MM-DD" },
  { id: "lista", label: "Lista", hint: "Opções fixas que você define" },
];

const parseOptions = (raw: string) => raw.split(",").map(s => s.trim()).filter(Boolean);

export function CustomFieldsManager() {
  const { customFields, refreshCustomFields, isAdmin } = useCRM();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("texto");
  const [options, setOptions] = useState("");
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    const nome = label.trim();
    if (!nome) return toast.error("Informe o nome do campo");
    if (type === "lista" && parseOptions(options).length === 0) {
      return toast.error("Campo do tipo lista precisa de ao menos uma opção");
    }
    setSalvando(true);
    try {
      const criado = await whatsappApi.createCustomField({
        label: nome,
        type,
        options: type === "lista" ? parseOptions(options) : [],
      });
      await refreshCustomFields();
      setLabel("");
      setOptions("");
      setType("texto");
      toast.success(`Campo criado com a chave ${criado.key}`);
    } catch (err) {
      toast.error(`Falha ao criar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  };

  const patch = async (field: CustomField, mudanca: Partial<CustomField>) => {
    try {
      await whatsappApi.updateCustomField(field.id, mudanca);
      await refreshCustomFields();
    } catch (err) {
      toast.error(`Falha ao salvar: ${mensagemDeErro(err)}`);
      await refreshCustomFields();
    }
  };

  const remover = async (field: CustomField) => {
    const aviso = [
      `Remover o campo "${field.label}"?`,
      "",
      "Os valores já preenchidos nos leads NÃO são apagados — eles só deixam de aparecer.",
      `Recriar um campo com a mesma chave (${field.key}) traz o histórico de volta.`,
    ].join("\n");
    if (!window.confirm(aviso)) return;
    try {
      await whatsappApi.deleteCustomField(field.id);
      await refreshCustomFields();
      toast.success("Campo removido");
    } catch (err) {
      toast.error(`Falha ao remover: ${mensagemDeErro(err)}`);
    }
  };

  if (!isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Somente administradores podem definir os campos personalizados do lead.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-base font-bold">Campos do lead</h3>
        <p className="text-xs text-muted-foreground">
          Campos extras que aparecem no cadastro de cada lead. Os agentes de IA podem receber a
          meta de coletá-los durante a conversa (aba Regras do agente).
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/70 bg-secondary/40 p-3 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <Label htmlFor="cf-label">Nome do campo</Label>
          <Input
            id="cf-label"
            value={label}
            onChange={event => setLabel(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && type !== "lista") criar(); }}
            placeholder="Ex: Nome completo"
          />
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={type} onValueChange={v => setType(v as CustomFieldType)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPOS.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex flex-col">
                    <span>{t.label}</span>
                    <span className="text-[10px] text-muted-foreground">{t.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="button" className="w-full gap-2" onClick={criar} disabled={salvando}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
        {type === "lista" && (
          <div className="sm:col-span-3">
            <Label htmlFor="cf-options">Opções (separadas por vírgula)</Label>
            <Input
              id="cf-options"
              value={options}
              onChange={event => setOptions(event.target.value)}
              placeholder="Indicação, Instagram, Google, Outro"
            />
          </div>
        )}
      </div>

      {customFields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Nenhum campo personalizado ainda. Crie o primeiro acima.
        </p>
      ) : (
        <div className="space-y-2">
          {customFields.map(field => (
            <div key={field.id} className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
                <div className="min-w-0">
                  <Input
                    className="h-9"
                    defaultValue={field.label}
                    onBlur={event => {
                      const novo = event.target.value.trim();
                      if (novo && novo !== field.label) patch(field, { label: novo });
                    }}
                  />
                  {/* A chave é imutável: é ela que liga os valores já gravados nos
                      leads e a meta configurada nos agentes. */}
                  <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                    {field.key} · {field.type}
                  </span>
                </div>
                <div className="flex h-9 items-center gap-2 text-xs">
                  <Switch checked={field.required} onCheckedChange={checked => patch(field, { required: checked })} />
                  <span className="text-muted-foreground">Obrigatório</span>
                </div>
                <div className="flex h-9 items-center justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remover(field)}
                    title="Remover campo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {field.type === "lista" && (
                <div className="mt-2">
                  <Label className="text-[11px] text-muted-foreground">Opções (separadas por vírgula)</Label>
                  <Input
                    className="h-9"
                    defaultValue={field.options.join(", ")}
                    onBlur={event => {
                      const novas = parseOptions(event.target.value);
                      if (!novas.length) return toast.error("A lista precisa de ao menos uma opção");
                      if (novas.join("|") !== field.options.join("|")) patch(field, { options: novas });
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
