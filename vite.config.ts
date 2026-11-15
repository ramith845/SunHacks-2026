import { defineConfig, loadEnv } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import os from "node:os";
import { resolve } from "node:path";
import { pocketFilmSet } from "./server/plugin";

// First LAN IPv4 that isn't a virtual adapter, so the QR code and ZIG SIM hint point somewhere the phone can reach.
function lanIp(): string {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, l]) =>
    (l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ name, ip: i.address })),
  );
  const real = all.filter((x) => !/vEthernet|WSL|VirtualBox|VMware|Hyper-V|docker|br-|vbox|Loopback/i.test(x.name));
  return (real[0] ?? all[0])?.ip ?? "localhost";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const zigPort = Number(env.ZIGSIM_PORT || 50000);
  return {
    plugins: [
      basicSsl(),
      pocketFilmSet({ geminiKey: env.GEMINI_API_KEY, geminiModel: env.GEMINI_MODEL, zigPort }),
    ],
    define: { __LAN_IP__: JSON.stringify(lanIp()), __ZIG_PORT__: JSON.stringify(zigPort) },
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
