import { defineConfig, loadEnv } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";
import { pocketFilmSet } from "./server/plugin";
import { lanAddresses } from "./server/net";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const zigPort = Number(env.ZIGSIM_PORT || 50000);
  const freedPort = Number(env.FREED_PORT || 40000);
  return {
    plugins: [
      basicSsl(),
      pocketFilmSet({ geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, zigPort, freedPort }),
    ],
    define: { __LAN_IP__: JSON.stringify(lanAddresses()[0]?.ip ?? "localhost"), __ZIG_PORT__: JSON.stringify(zigPort), __FREED_PORT__: JSON.stringify(freedPort) },
    server: { port: 5173, strictPort: true },
    build: {
      target: "esnext",
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        input: { director: resolve(__dirname, "index.html"), camera: resolve(__dirname, "camera.html") },
      },
    },
  };
});
