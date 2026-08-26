import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { whatsappApi, WhatsAppInstance, InstanceStatus, HistorySyncMode } from "@/lib/whatsapp-api";
import { InstanceKind } from "@/lib/instance-kinds";
import { getSocket } from "@/lib/whatsapp-socket";
import { mensagemDeErro } from "@/lib/erros";

export function useInstances() {
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrByInstance, setQrByInstance] = useState<Record<string, string>>({});
  const [pairingCodeByInstance, setPairingCodeByInstance] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await whatsappApi.listInstances();
      setInstances(data);
    } catch (err) {
      setError(mensagemDeErro(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    instances.forEach(inst => socket.emit("join", inst.id));

    const onStatus = (payload: { instanceId: string; status: InstanceStatus; phone?: string }) => {
      setInstances(curr => curr.map(i => i.id === payload.instanceId
        ? { ...i, status: payload.status, phone: payload.phone || i.phone }
        : i));
      if (payload.status === "ativa") {
        setQrByInstance(curr => {
          const next = { ...curr };
          delete next[payload.instanceId];
          return next;
        });
        setPairingCodeByInstance(curr => {
          const next = { ...curr };
          delete next[payload.instanceId];
          return next;
        });
      }
    };
    const onQr = (payload: { instanceId: string; qr: string }) => {
      setQrByInstance(curr => ({ ...curr, [payload.instanceId]: payload.qr }));
    };
    const onPairingCode = (payload: { instanceId: string; code: string }) => {
      setPairingCodeByInstance(curr => ({ ...curr, [payload.instanceId]: payload.code }));
    };
    const onReady = (payload: { instanceId: string; phone: string }) => {
      setInstances(curr => curr.map(i => i.id === payload.instanceId
        ? { ...i, status: "ativa", phone: payload.phone }
        : i));
    };
    const onSyncProgress = (payload: { instanceId: string; chatsDone: number; chatsTotal: number }) => {
      setInstances(curr => curr.map(i => i.id === payload.instanceId
        ? { ...i, conversations: payload.chatsTotal }
        : i));
    };
    const onSyncRecentDone = (payload: { instanceId: string; chatsChecked: number; ok: boolean }) => {
      const now = new Date().toISOString();
      setInstances(curr => curr.map(i => i.id === payload.instanceId
        ? { ...i, lastSync: now }
        : i));
      const inst = instances.find(i => i.id === payload.instanceId);
      const label = inst?.name || "Instância";
      if (payload.ok) {
        toast.success(`${label}: mensagens verificadas e sincronizadas (${payload.chatsChecked} conversas)`);
      } else {
        toast.error(`${label}: falha ao verificar a sincronização das mensagens`);
      }
    };

    socket.on("instance:status", onStatus);
    socket.on("instance:qr", onQr);
    socket.on("instance:pairing-code", onPairingCode);
    socket.on("instance:ready", onReady);
    socket.on("instance:sync-progress", onSyncProgress);
    socket.on("instance:sync-recent-done", onSyncRecentDone);

    return () => {
      socket.off("instance:status", onStatus);
      socket.off("instance:qr", onQr);
      socket.off("instance:pairing-code", onPairingCode);
      socket.off("instance:ready", onReady);
      socket.off("instance:sync-progress", onSyncProgress);
      socket.off("instance:sync-recent-done", onSyncRecentDone);
    };
  }, [instances.length]);

  const createInstance = useCallback(async (name: string, historySync: HistorySyncMode = "recent", tipo?: InstanceKind) => {
    const created = await whatsappApi.createInstance(name, historySync, tipo);
    setInstances(curr => [...curr, created]);
    getSocket().emit("join", created.id);
    return created;
  }, []);

  const restartInstance = useCallback(async (id: string) => {
    await whatsappApi.restartInstance(id);
    setInstances(curr => curr.map(i => i.id === id ? { ...i, status: "conectando" as InstanceStatus } : i));
  }, []);

  const resyncHistory = useCallback(async (id: string) => {
    await whatsappApi.resyncHistory(id);
    setInstances(curr => curr.map(i => i.id === id
      ? { ...i, status: "conectando" as InstanceStatus, historySynced: false, conversations: 0, lastSync: "" }
      : i));
  }, []);

  const deleteInstance = useCallback(async (id: string) => {
    await whatsappApi.deleteInstance(id);
    setInstances(curr => curr.filter(i => i.id !== id));
    setQrByInstance(curr => {
      const next = { ...curr };
      delete next[id];
      return next;
    });
    setPairingCodeByInstance(curr => {
      const next = { ...curr };
      delete next[id];
      return next;
    });
  }, []);

  const renameInstance = useCallback(async (id: string, name: string) => {
    const updated = await whatsappApi.updateInstance(id, { name });
    setInstances(curr => curr.map(i => i.id === id ? { ...i, ...updated } : i));
    return updated;
  }, []);

  // Responsável pela instância. Sem dono, só o admin enxerga o canal.
  const setInstanceOwner = useCallback(async (id: string, ownerId: string | null) => {
    const updated = await whatsappApi.updateInstance(id, { ownerId });
    setInstances(curr => curr.map(i => i.id === id ? { ...i, ...updated } : i));
    return updated;
  }, []);

  // Número do doutor ou da recepção — decide por onde a secretaria cobra e a
  // quem aparece o botão de falar pelo WhatsApp próprio.
  const setInstanceKind = useCallback(async (id: string, tipo: InstanceKind) => {
    const updated = await whatsappApi.updateInstance(id, { tipo });
    setInstances(curr => curr.map(i => i.id === id ? { ...i, ...updated } : i));
    return updated;
  }, []);

  const fetchQr = useCallback(async (id: string) => {
    try {
      const { qr } = await whatsappApi.getQr(id);
      setQrByInstance(curr => ({ ...curr, [id]: qr }));
      return qr;
    } catch {
      return null;
    }
  }, []);

  const requestPairingCode = useCallback(async (id: string, phone: string) => {
    const { code } = await whatsappApi.requestPairingCode(id, phone);
    setPairingCodeByInstance(curr => ({ ...curr, [id]: code }));
    setInstances(curr => curr.map(i => i.id === id ? { ...i, status: "codigo-pendente" as InstanceStatus } : i));
    return code;
  }, []);

  return { instances, loading, error, qrByInstance, pairingCodeByInstance, refresh, createInstance, restartInstance, resyncHistory, deleteInstance, fetchQr, requestPairingCode, renameInstance, setInstanceOwner, setInstanceKind };
}
