import { useState } from "react";
import { toast } from "sonner";
import { closestCenter, DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useCRM } from "@/store/crm-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stage } from "@/lib/mock-data";
import { KANBAN_COLORS } from "@/lib/kanban-colors";
import { cn } from "@/lib/utils";

const COLOR_GROUPS = [
  { id: "tema" as const, label: "Tema" },
  { id: "paleta" as const, label: "Cores" },
].map(group => ({ ...group, colors: KANBAN_COLORS.filter(color => color.group === group.id) }));

function SortableStageItem({
  stage,
  onUpdate,
  onColor,
  onRemove,
}: {
  stage: Stage;
  onUpdate: (title: string) => void;
  onColor: (color: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-border/70 bg-card p-3 shadow-sm ${isDragging ? "z-10 opacity-70 shadow-lg" : ""}`}
    >
      <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground cursor-grab active:cursor-grabbing"
          title="Arrastar etapa"
          aria-label="Arrastar etapa"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={stage.title}
          onChange={event => onUpdate(event.target.value)}
          onBlur={() => toast.success("Etapa atualizada")}
          className="h-9 bg-background"
        />
        <div className="flex justify-end">
          <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onRemove} title="Remover etapa">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mt-2 space-y-1.5 sm:pl-11">
        <span className="text-[11px] text-muted-foreground">Cor da coluna:</span>
        {COLOR_GROUPS.map(group => (
          <div key={group.id} className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{group.label}</span>
            {group.colors.map(color => (
              <button
                key={color.value}
                type="button"
                title={color.label}
                aria-label={`Cor ${color.label}`}
                aria-pressed={stage.color === color.value}
                onClick={() => onColor(color.value)}
                className={cn(
                  "h-5 w-5 rounded-full transition",
                  color.swatch,
                  stage.color === color.value ? "ring-2 ring-offset-1 ring-foreground" : "opacity-70 hover:opacity-100",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StageManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { stages, deals, addStage, updateStage, reorderStage, removeStage } = useCRM();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [newTitle, setNewTitle] = useState("");

  const handleAdd = () => {
    const title = newTitle.trim();
    if (!title) return;

    addStage(title);
    setNewTitle("");
    toast.success("Etapa adicionada");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : "";
    if (!overId || activeId === overId) return;
    reorderStage(activeId, overId);
    toast.success("Ordem das etapas atualizada");
  };

  const handleRemove = (id: string, title: string) => {
    if (id === "fechado" || id === "perdido") {
      toast.error("Esta etapa e usada para finalizar atendimentos e nao pode ser removida");
      return;
    }

    const count = deals.filter(deal => deal.stage === id).length;
    const message = count > 0
      ? `Remover "${title}"? Os ${count} leads desta etapa serao movidos para a primeira etapa do funil.`
      : `Remover "${title}"?`;

    if (!window.confirm(message)) return;
    removeStage(id);
    toast.success("Etapa removida");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Organizar etapas</DialogTitle>
          <DialogDescription>Arraste as etapas para reorganizar o funil e edite os nomes quando precisar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 rounded-lg border border-border/70 bg-secondary/40 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="stage-title">Nova etapa</Label>
              <Input
                id="stage-title"
                value={newTitle}
                onChange={event => setNewTitle(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") handleAdd();
                }}
                placeholder="Ex: Follow-up"
              />
            </div>
            <Button type="button" className="gap-2" onClick={handleAdd}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={stages.map(stage => stage.id)} strategy={verticalListSortingStrategy}>
              <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                {stages.map(stage => (
                  <SortableStageItem
                    key={stage.id}
                    stage={stage}
                    onUpdate={title => updateStage(stage.id, { title })}
                    onColor={color => { updateStage(stage.id, { color }); toast.success("Cor da coluna atualizada"); }}
                    onRemove={() => handleRemove(stage.id, stage.title)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
