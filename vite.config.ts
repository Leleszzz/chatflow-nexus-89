import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import basicSsl from "@vitejs/plugin-basic-ssl";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    https: true,
    hmr: {
      overlay: false,
    },
    // O projeto vive dentro do OneDrive, e o watcher nativo do Windows não recebe
    // os eventos de arquivo dessas pastas sincronizadas — sem polling, as edições
    // não chegam ao navegador e ele segue rodando um bundle velho.
    watch: {
      usePolling: true,
      interval: 400,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3030",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3030",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  plugins: [react(), basicSsl(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
