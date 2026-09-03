import { useCallback, useEffect, useRef, useState } from "react";
import {
  whatsappApi,
  type AssistantMessage, type AssistantPasso, type AssistantThread, type AssistantEntrada,
} from "@/lib/whatsapp-api";
import { getSocket } from "@/lib/whatsapp-socket";
import { mensagemDeErro } from "@/lib/erros";

/**
 * Estado da tela do assistente.
 *
 * O turno não tem streaming: a resposta chega inteira, e um turno que consulta
 * quatro ferramentas leva dezenas de segundos. Por isso o backend emite
 * `assistant:step` a cada ferramenta e este hook acumula os passos — sem eles a
 * tela ficaria parada num tempo em que parece travamento.
 *
 * O backend entrega os eventos na sala pessoal `user:<id>`, na qual o socket já
 * entra sozinho no connect — não é preciso dar join em nada aqui.
 */
export function useAssistant() {
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadAtiva, setThreadAtiva] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<AssistantMessage[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [pensando, setPensando] = useState(false);
  const [passos, setPassos] = useState<AssistantPasso[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // A thread ativa é lida dentro do handler de socket, que é registrado uma vez
  // só. Sem a ref, o handler enxergaria para sempre o valor da primeira render.
  const threadAtivaRef = useRef<string | null>(null);
  threadAtivaRef.current = threadAtiva;

  const carregarThreads = useCallback(async () => {
    try {
      const lista = await whatsappApi.listAssistantThreads();
      setThreads(lista);
      return lista;
    } catch (err) {
      setErro(mensagemDeErro(err));
      return [];
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const lista = await carregarThreads();
      if (!vivo) return;
      // Abre a conversa mais recente, como quem volta de onde parou.
      if (lista.length) setThreadAtiva(lista[0].id);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [carregarThreads]);

  useEffect(() => {
    if (!threadAtiva) {
      setMensagens([]);
      return;
    }
    let vivo = true;
    whatsappApi.listAssistantMessages(threadAtiva, { limit: 100 })
      .then(lista => { if (vivo) setMensagens(lista); })
      .catch(err => { if (vivo) setErro(mensagemDeErro(err)); });
    return () => { vivo = false; };
  }, [threadAtiva]);

  useEffect(() => {
    const socket = getSocket();

    const aoPasso = (payload: { threadId: string; passo: AssistantPasso }) => {
      if (payload.threadId !== threadAtivaRef.current) return;
      setPassos(atuais => [...atuais, payload.passo]);
    };

    // Chega quando o MESMO médico usa o assistente em outra aba. A aba que fez a
    // pergunta já inseriu a resposta pela chamada HTTP, daí o dedupe por id.
    const aoMensagem = (payload: { threadId: string; mensagem: AssistantMessage; thread: AssistantThread }) => {
      setThreads(atuais => {
        const resto = atuais.filter(t => t.id !== payload.thread.id);
        return [payload.thread, ...resto];
      });
      if (payload.threadId !== threadAtivaRef.current) return;
      setMensagens(atuais => (
        atuais.some(m => m.id === payload.mensagem.id) ? atuais : [...atuais, payload.mensagem]
      ));
    };

    socket.on("assistant:step", aoPasso);
    socket.on("assistant:message", aoMensagem);
    return () => {
      socket.off("assistant:step", aoPasso);
      socket.off("assistant:message", aoMensagem);
    };
  }, []);

  const criarThread = useCallback(async () => {
    try {
      const nova = await whatsappApi.createAssistantThread();
      setThreads(atuais => [nova, ...atuais]);
      setThreadAtiva(nova.id);
      setMensagens([]);
      return nova;
    } catch (err) {
      setErro(mensagemDeErro(err));
      return null;
    }
  }, []);

  const excluirThread = useCallback(async (id: string) => {
    try {
      await whatsappApi.deleteAssistantThread(id);
      setThreads(atuais => {
        const resto = atuais.filter(t => t.id !== id);
        setThreadAtiva(ativa => (ativa === id ? (resto[0]?.id ?? null) : ativa));
        return resto;
      });
    } catch (err) {
      setErro(mensagemDeErro(err));
    }
  }, []);

  /**
   * Envia a pergunta e espera o turno inteiro.
   *
   * A pergunta entra na lista otimista antes da resposta chegar — esperar
   * quarenta segundos para ver o que se acabou de digitar é péssimo. Se a
   * chamada falhar, ela sai da lista e o erro aparece.
   */
  const enviar = useCallback(async (texto: string, entrada: AssistantEntrada = "texto") => {
    const corpo = texto.trim();
    if (!corpo || pensando) return;

    let alvo = threadAtiva;
    if (!alvo) {
      const nova = await criarThread();
      if (!nova) return;
      alvo = nova.id;
    }

    const provisoria: AssistantMessage = {
      id: `tmp-${Date.now()}`,
      threadId: alvo,
      userId: "",
      role: "user",
      body: corpo,
      createdAt: new Date().toISOString(),
      entrada,
    };
    setMensagens(atuais => [...atuais, provisoria]);
    setPassos([]);
    setPensando(true);
    setErro(null);

    try {
      const turno = await whatsappApi.sendAssistantMessage(alvo, corpo, entrada);
      setMensagens(atuais => {
        const semProvisoria = atuais.filter(m => m.id !== provisoria.id);
        const jaTem = semProvisoria.some(m => m.id === turno.resposta.id);
        return jaTem ? semProvisoria : [...semProvisoria, turno.pergunta, turno.resposta];
      });
      setThreads(atuais => {
        const resto = atuais.filter(t => t.id !== turno.thread.id);
        return [turno.thread, ...resto];
      });
    } catch (err) {
      setMensagens(atuais => atuais.filter(m => m.id !== provisoria.id));
      setErro(mensagemDeErro(err));
    } finally {
      setPensando(false);
      setPassos([]);
    }
  }, [criarThread, pensando, threadAtiva]);

  /** Substitui a mensagem inteira: a decisão da proposta vive dentro dela. */
  const atualizarMensagem = useCallback((mensagem: AssistantMessage) => {
    setMensagens(atuais => atuais.map(m => (m.id === mensagem.id ? mensagem : m)));
  }, []);

  return {
    threads, threadAtiva, mensagens, carregando, pensando, passos, erro,
    setThreadAtiva, criarThread, excluirThread, enviar, atualizarMensagem, setErro,
  };
}
