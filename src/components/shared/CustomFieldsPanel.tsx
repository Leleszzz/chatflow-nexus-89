import { Deal, CustomField } from "@/lib/mock-data";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useCRM } from "@/store/crm-store";
import { cn } from "@/lib/utils";
import { Target, X } from "lucide-react";

// Um input por tipo de campo. O <input type="date"> trabalha em YYYY-MM-DD, que
// é exatamente o formato normalizado por coerceFieldValue no backend — por isso
// o valor vai e volta sem conversão.
function FieldInput({ field, value, onChange }: {
  field: CustomField;
  value: string | number | undefined;
  onChange: (value: string | number | null) => void;
}) {
  const texto = value === undefined || value === null ? "" : String(value);

  if (field.type === "lista") {
    return (
      <div className="flex items-center gap-1">
        <Select value={texto || undefined} onValueChange={v => onChange(v)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Selecione..." />
          </SelectTrigger>
          <SelectContent>
            {field.options.map(option => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {texto && (
          // O Select do Radix não tem "desmarcar" — sem isto um campo de lista
          // preenchido por engano ficaria impossível de limpar.
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground"
            title="Limpar campo" onClick={() => onChange(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Input
      className="h-9"
      type={field.type === "numero" ? "number" : field.type === "data" ? "date" : "text"}
      defaultValue={texto}
      // onBlur (e não onChange) para não disparar um PATCH por tecla digitada.
      onBlur={event => {
        const bruto = event.target.value.trim();
        if (bruto === texto) return;
        if (!bruto) return onChange(null);
        onChange(field.type === "numero" ? Number(bruto) : bruto);
      }}
    />
  );
}

export function CustomFieldsPanel({ deal, className }: { deal: Deal; className?: string }) {
  const { customFields, setDealCustomField, agents } = useCRM();
  if (!customFields.length) return null;

  const values = deal.customFields || {};
  // Progresso só faz sentido contra a meta do agente vinculado a ESTE lead.
  const agente = deal.aiAgentId ? agents.find(a => a.id === deal.aiAgentId) : undefined;
  const meta = (agente?.extractFields || []).filter(key => customFields.some(f => f.key === key));
  const coletados = meta.filter(key => values[key] !== undefined);
  const metaCompleta = meta.length > 0 && coletados.length === meta.length;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Label>Campos personalizados</Label>
        {meta.length > 0 && (
          <span className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            metaCompleta ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
          )}>
            <Target className="h-3 w-3" />
            Meta de {agente?.name}: {coletados.length}/{meta.length}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {customFields.map(field => {
          const naMeta = meta.includes(field.key);
          const vazioObrigatorio = field.required && values[field.key] === undefined;
          return (
            <div key={field.id}>
              <Label htmlFor={`cf-${field.id}`} className="text-xs text-muted-foreground">
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
                {naMeta && <span className="ml-1 text-[10px] uppercase tracking-wide text-primary">meta</span>}
              </Label>
              <div className={cn("mt-1", vazioObrigatorio && "rounded-md ring-1 ring-destructive/40")}>
                <FieldInput
                  field={field}
                  value={values[field.key]}
                  onChange={value => setDealCustomField(deal.id, field.key, value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
