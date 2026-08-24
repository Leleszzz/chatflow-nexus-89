import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { AppLayout } from "./AppLayout";
import { useCRM } from "@/store/crm-store";
import { canRoleAccess, ROUTE_ROLES } from "@/lib/roles";

/**
 * Guard de cargo por rota. Fica em App.tsx, envolvendo o element — e não dentro
 * de AppLayout — porque AppLayout é renderizado *dentro* de cada página: um
 * bloqueio lá ainda deixaria os hooks e os fetches da página rodarem antes.
 *
 * A tabela de acesso é ROUTE_ROLES (@/lib/roles), a mesma que a Sidebar usa.
 */
export function RequireRole({ path, title, children }: { path: keyof typeof ROUTE_ROLES | string; title: string; children: ReactNode }) {
  const { currentUser, authReady } = useCRM();

  if (!authReady) return null;
  if (!currentUser) return <Navigate to="/login" replace />;

  if (!canRoleAccess(currentUser.role, path)) {
    return (
      <AppLayout title={title} subtitle="Acesso restrito">
        <div className="card-elevated p-6 text-sm text-muted-foreground">
          Seu cargo não tem acesso a esta área. Fale com um administrador se precisar dela.
        </div>
      </AppLayout>
    );
  }

  return <>{children}</>;
}
