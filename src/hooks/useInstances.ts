import { useEffect, useState, useCallback } from "react";
import { whatsappApi, WhatsAppInstance, InstanceStatus } from "@/lib/whatsapp-api";
import { getSocket } from "@/lib/whatsapp-socket";

export function useInstances() {
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrByInstance, setQrByInstance] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await whatsappApi.listInstances();
      setInstances(data);
    } catch (err) {
      setError((err as Error).message);
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
      }
    };
    const onQr = (payload: { instanceId: string; qr: string }) => {
      setQrByInstance(curr => ({ ...curr, [payload.instanceId]: payload.qr }));
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

    socket.on("instance:status", onStatus);
    socket.on("instance:qr", onQr);
    socket.on("instance:ready", onReady);
    socket.on("instance:sync-progress", onSyncProgress);

    return () => {
      socket.off("instance:status", onStatus);
      socket.off("instance:qr", onQr);
      socket.off("instance:ready", onReady);
      socket.off("instance:sync-progress", onSyncProgress);
    };
  }, [instances.length]);

  const createInstance = useCallback(async (name: string) => {
    const created = await whatsappApi.createInstance(name);
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
  }, []);

  const renameInstance = useCallback(async (id: string, name: string) => {
    const updated = await whatsappApi.updateInstance(id, { name });
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

  return { instances, loading, error, qrByInstance, refresh, createInstance, restartInstance, resyncHistory, deleteInstance, fetchQr, renameInstance };
}
