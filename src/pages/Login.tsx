import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { LockKeyhole, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCRM } from "@/store/crm-store";

export default function Login() {
  const { currentUser, authReady, login } = useCRM();
  const [identifier, setIdentifier] = useState("admin");
  const [password, setPassword] = useState("");

  if (!authReady) return null;
  if (currentUser) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const resultado = await login(identifier, password);
    if (resultado.ok === true) {
      toast.success("Login realizado");
      return;
    }
    // Mostra o motivo real: bloqueio por tentativas demais é uma orientação
    // diferente de senha errada, e tratar os dois igual faz o usuário insistir.
    toast.error(resultado.motivo);
  };

  return (
    <main className="min-h-screen bg-background grid place-items-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-border/70 bg-card p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">Entrar no CRM</h1>
            <p className="text-xs text-muted-foreground">Informe suas credenciais para acessar.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="identifier">Usuário, e-mail ou nome</Label>
            <Input id="identifier" value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full gap-2 bg-gradient-primary">
            <LogIn className="h-4 w-4" /> Entrar
          </Button>
        </div>
      </form>
    </main>
  );
}
