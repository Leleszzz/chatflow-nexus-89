import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCRM } from "@/store/crm-store";
import { useInstances } from "@/hooks/useInstances";
import { whatsappApi } from "@/lib/whatsapp-api";
import { MessageSquare, ShieldCheck, Smartphone, Tags } from "lucide-react";
import { toast } from "sonner";
import { ROLES, roleLabel, isAdminRole, type Role } from "@/lib/roles";

const ROLE_PROFILES: { name: string; role: Role; desc: string }[] = [
  { name: "Administrador", role: ROLES.ADMIN, desc: "Acesso total: usuários, instâncias, agentes e configurações. Não tem WhatsApp próprio." },
  { name: "Doutor(a)", role: ROLES.DOUTOR, desc: "Consultas e prontuários, o WhatsApp dele e os canais liberados abaixo. Vê os atendimentos que são dele." },
  { name: "Secretária", role: ROLES.SECRETARIA, desc: "Atende, agenda e encaminha pelo WhatsApp dela. Vê todos os atendimentos; não vê consultas." },
];

export default function Usuarios() {
  const { teamUsers, refreshTeamUsers, deals, tags, hasPermission, currentUser } = useCRM();
  const { instances } = useInstances();
  const configurableUsers = useMemo(() => teamUsers.filter(user => !isAdminRole(user.role)), [teamUsers]);
  const [selectedUserId, setSelectedUserId] = useState(configurableUsers[0]?.id || "");
  const selectedUser = teamUsers.find(user => user.id === selectedUserId) || configurableUsers[0];

  const patchSelectedUser = async (patch: Partial<typeof selectedUser>) => {
    if (!selectedUser) return;
    try {
      await whatsappApi.updateUser(selectedUser.id, patch);
      await refreshTeamUsers();
    } catch (err) {
      toast.error(`Falha ao atualizar: ${(err as Error).message}`);
    }
  };

  const toggleListValue = (key: "allowedTags" | "allowedConversationIds" | "allowedInstanceIds", value: string) => {
    if (!selectedUser) return;
    const current = selectedUser[key] || [];
    const next = current.includes(value)
      ? current.filter(item => item !== value)
      : [...current, value];
    patchSelectedUser({ [key]: next });
  };

  const setListValues = (key: "allowedTags" | "allowedConversationIds" | "allowedInstanceIds", values: string[]) => {
    if (!selectedUser) return;
    patchSelectedUser({ [key]: values });
  };

  if (!hasPermission("Alterar configurações da empresa")) {
    return (
      <AppLayout title="Usuários" subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Seu usuário não tem permissão para configurar acessos de vendedores.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Usuários" subtitle="Controle perfis, acesso por vendedor, tag, conversa e instância">
      <section className="card-elevated mb-6 p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">Perfis prontos de permissão</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {ROLE_PROFILES.map(profile => (
            <button
              key={profile.name}
              type="button"
              onClick={() => {
                if (selectedUser) patchSelectedUser({ role: profile.role });
                toast.success(`Perfil ${profile.name} aplicado`);
              }}
              className="rounded-xl border border-border/70 bg-background p-3 text-left transition hover:border-primary/30 hover:bg-secondary/50"
            >
              <div className="text-sm font-semibold">{profile.name}</div>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{profile.desc}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="card-elevated mb-6 overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="font-display text-base font-bold">Lista de usuários</h2>
          <p className="text-xs text-muted-foreground">Status, último acesso, conversas atribuídas e vendas realizadas.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-5 py-3 font-semibold">Nome</th>
                <th className="px-5 py-3 font-semibold">E-mail</th>
                <th className="px-5 py-3 font-semibold">Cargo</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Último acesso</th>
                <th className="px-5 py-3 font-semibold">Conversas</th>
                <th className="px-5 py-3 font-semibold">Vendas</th>
              </tr>
            </thead>
            <tbody>
              {teamUsers.map(user => {
                const userDeals = deals.filter(deal => [deal.sellerId, ...(deal.assignedSellerIds || [])].includes(user.id));
                return (
                  <tr key={user.id} className="border-b border-border/40">
                    <td className="px-5 py-3 font-medium">{user.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-5 py-3">{roleLabel(user.role)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.active ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                          {user.active ? "Ativo" : "Inativo"}
                        </span>
                        {currentUser?.id === user.id && (
                          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">Logado agora</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{currentUser?.id === user.id ? "Agora" : "—"}</td>
                    <td className="px-5 py-3">{userDeals.length}</td>
                    <td className="px-5 py-3">{userDeals.filter(deal => deal.stage === "fechado").length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-elevated mb-6 p-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
          <div>
            <Label>Vendedor</Label>
            <Select value={selectedUser?.id || ""} onValueChange={setSelectedUserId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
              <SelectContent>
                {configurableUsers.map(user => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser && (
            <div className="flex flex-col gap-4 rounded-xl bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={selectedUser.photoUrl} alt={selectedUser.name} />
                  <AvatarFallback className="bg-primary-soft text-primary font-semibold">{selectedUser.avatar}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{selectedUser.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedUser.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-semibold">Recebe novos leads</div>
                  <div className="text-xs text-muted-foreground">Distribuição automática</div>
                </div>
                <Switch checked={selectedUser.receivesNewLeads ?? false} onCheckedChange={receivesNewLeads => patchSelectedUser({ receivesNewLeads })} />
              </div>
            </div>
          )}
        </div>
      </section>

      {selectedUser && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="card-elevated p-5">
            <div className="mb-4 flex items-center gap-2">
              <Tags className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-bold">Tags permitidas</h2>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              Se nenhuma tag estiver marcada, o acesso por tag fica livre e continuam valendo os responsáveis da conversa.
            </div>
            <div className="mb-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setListValues("allowedTags", tags)}>Selecionar todos</Button>
              <Button variant="outline" size="sm" onClick={() => setListValues("allowedTags", [])}>Limpar</Button>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border/70 bg-background p-2">
              {tags.map(tag => (
                <label key={tag} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                  <Checkbox checked={(selectedUser.allowedTags || []).includes(tag)} onCheckedChange={() => toggleListValue("allowedTags", tag)} />
                  <span className="truncate">{tag}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="card-elevated p-5">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-bold">Conversas permitidas</h2>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              Marque conversas específicas para liberar acesso mesmo quando o vendedor não for responsável direto.
            </div>
            <div className="mb-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setListValues("allowedConversationIds", deals.map(deal => deal.id))}>Selecionar todos</Button>
              <Button variant="outline" size="sm" onClick={() => setListValues("allowedConversationIds", [])}>Limpar</Button>
            </div>
            <div className="max-h-[420px] overflow-y-auto rounded-xl border border-border/70 bg-background p-2">
              {deals.map(deal => (
                <label key={deal.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
                  <Checkbox checked={(selectedUser.allowedConversationIds || []).includes(deal.id)} onCheckedChange={() => toggleListValue("allowedConversationIds", deal.id)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{deal.customer}</span>
                    <span className="block truncate text-xs text-muted-foreground">{deal.phone}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card-elevated p-5">
            <div className="mb-4 flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-bold">Instâncias permitidas</h2>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              Canais de WhatsApp que este usuário pode ler e usar para enviar, <strong>além do canal em que
              ele já é o responsável</strong> (definido em Instâncias). É aqui que o doutor ganha acesso ao
              WhatsApp da secretária.
            </div>
            <div className="space-y-2">
              {instances.map(instance => (
                <label key={instance.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 bg-background p-3 hover:bg-secondary">
                  <Checkbox checked={(selectedUser.allowedInstanceIds || []).includes(instance.id)} onCheckedChange={() => toggleListValue("allowedInstanceIds", instance.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{instance.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{instance.phone || "—"}</span>
                  </span>
                </label>
              ))}
              {instances.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                  Nenhuma instância cadastrada. Adicione em Instâncias para liberar acesso por canal.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </AppLayout>
  );
}
