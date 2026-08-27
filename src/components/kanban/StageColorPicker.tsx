import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KANBAN_COLORS, kanbanColor } from "@/lib/kanban-colors";
import { cn } from "@/lib/utils";

// As 26 bolinhas soltas no diálogo não cabiam na largura e quebravam a linha.
// Aqui elas vivem num popover, em grade FIXA de 6 colunas — a largura não
// depende mais do espaço disponível, então nunca há sobra nem bolinha órfã.
const COLOR_GROUPS = [
  { id: "tema" as const, label: "Tema" },
  { id: "paleta" as const, label: "Cores" },
].map(group => ({ ...group, colors: KANBAN_COLORS.filter(color => color.group === group.id) }));

export function StageColorPicker({ value, onChange }: { value?: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = kanbanColor(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Cor da coluna: ${current.label}`}
          aria-label={`Cor da coluna: ${current.label}`}
          className={cn(
            "h-7 w-7 shrink-0 rounded-full ring-offset-background transition",
            "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            current.swatch,
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="end">
        <div className="space-y-2">
          {COLOR_GROUPS.map(group => (
            <div key={group.id} className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{group.label}</span>
              <div className="grid grid-cols-6 gap-1.5">
                {group.colors.map(color => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.label}
                    aria-label={`Cor ${color.label}`}
                    aria-pressed={value === color.value}
                    onClick={() => { onChange(color.value); setOpen(false); }}
                    className={cn(
                      "h-8 w-8 rounded-full transition",
                      color.swatch,
                      value === color.value ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : "opacity-75 hover:opacity-100",
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
