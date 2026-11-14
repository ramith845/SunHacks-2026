import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { WebSocketServer, WebSocket } from "ws";
import os from "node:os";
import { resolve } from "node:path";

// First non-internal IPv4 address, so the laptop can show a QR code the phone can reach.
function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

// Tiny relay on the same HTTPS port as Vite: every message goes to every other client.
// Same port means the phone only has to accept one certificate.
function relay(): Plugin {
  const attach = (httpServer: any) => {
    if (!httpServer) return;
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (req: any, socket: any, head: any) => {
      if (!req.url?.startsWith("/relay")) return; // leave Vite's own HMR socket alone
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data, isBinary) => {
          for (const c of wss.clients) {
            if (c !== ws && c.readyState === WebSocket.OPEN) c.send(data, { binary: isBinary });
          }
        });
      });
    });
  };
  return {
    name: "pocket-relay",
    configureServer: (s) => attach(s.httpServer),
    configurePreviewServer: (s) => attach(s.httpServer),
  };
}

export default defineConfig({
  plugins: [basicSsl(), relay()],
  define: { __LAN_IP__: JSON.stringify(lanIp()) },
  server: { port: 5173, strictPort: true },
  build: {
    target: "esnext",
    rollupOptions: {
      input: { director: resolve(__dirname, "index.html"), camera: resolve(__dirname, "camera.html") },
    },
  },
});
