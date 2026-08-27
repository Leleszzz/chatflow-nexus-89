import { useEffect, useState } from "react";

/**
 * Altura do teclado virtual, em pixels.
 *
 * Quando o teclado abre no celular, o layout viewport NÃO muda — só o visual
 * viewport encolhe. Sem compensar isso, o composer do chat fica atrás do
 * teclado e o usuário digita às cegas.
 */
function useKeyboardHeight(publishCssVar: boolean) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // offsetTop entra na conta porque o iOS desloca o visual viewport pra
        // cima em vez de só encolher quando a página está rolada.
        const raw = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        // Abaixo de 120px é ruído de barra de URL colapsando, não teclado.
        const keyboard = raw > 120 ? raw : 0;
        if (publishCssVar) root.style.setProperty("--kb-inset", `${keyboard}px`);
        setInset(keyboard);
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      if (publishCssVar) root.style.setProperty("--kb-inset", "0px");
    };
  }, [publishCssVar]);

  return inset;
}

/**
 * Publica a altura do teclado na variável CSS `--kb-inset`, que a classe
 * `.app-pane` (src/index.css) desconta da própria altura. Deve ser chamado
 * uma única vez, no AppLayout — quem só precisa reagir ao valor usa
 * {@link useKeyboardInset}.
 */
export function useViewportInset() {
  return useKeyboardHeight(true);
}

/** Só lê a altura do teclado, sem mexer na variável CSS global. */
export function useKeyboardInset() {
  return useKeyboardHeight(false);
}
