import * as React from "react";

// Os mesmos breakpoints padrão do Tailwind — se mudarem no tailwind.config.ts,
// mude aqui junto, senão o CSS e o JS discordam sobre o que é "mobile".
const MOBILE_BREAKPOINT = 768; // md
const COMPACT_BREAKPOINT = 1024; // lg

function useMaxWidth(breakpoint: number) {
  // undefined no primeiro render (SSR/hidratação não sabem a largura ainda);
  // vira boolean assim que o efeito roda.
  const [matches, setMatches] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!matches;
}

/** true abaixo de 768px (md) — onde a sidebar vira drawer e aparece a barra inferior. */
export function useIsMobile() {
  return useMaxWidth(MOBILE_BREAKPOINT);
}

/** true abaixo de 1024px (lg) — onde as telas de duas colunas viram painel único. */
export function useIsCompact() {
  return useMaxWidth(COMPACT_BREAKPOINT);
}
