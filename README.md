# Pocket Film Set

Use your iPhone as a handheld camera inside a Gaussian-splat scan of a real place. Every take becomes a storyboard panel.

Plan: [docs/PLAN.md](docs/PLAN.md)

## Run it (laptop + iPhone on the same Wi-Fi)

```bash
npm install
npm run dev
```

1. On the laptop open **https://localhost:5173**. Your browser warns about the self-signed certificate: click *Advanced → Proceed*.
2. Scan the QR code in the top right with the iPhone camera. Safari shows the same warning: tap *Show Details → visit this website*.
3. Tap **Tap to start camera** and allow motion access.
4. Point the phone where you want the shot to face and tap **Set mark**. Now turn and tilt the phone; the laptop view follows.
5. Hold the arrow pads to push in / pull out / truck / crane. Slide the lens between 14 and 135 mm.
6. Tap **● REC**, move, tap **■ STOP**. The take lands in the storyboard strip. Click a panel to replay it.

No phone? Drag with the mouse to look, **WASD/QE** to move, **R** to record.

### Your own scans
Export `.spz` (or `.ply`) from Scaniverse and drag it onto the laptop window, or put it in `public/scenes/` and open `https://localhost:5173/?scene=/scenes/yourscan.spz`.
If the scene is upside down, press **F**.

### Troubleshooting
- **QR shows the wrong IP** (e.g. a VPN or WSL adapter): open `https://<your laptop's Wi-Fi IP>:5173/camera.html` on the phone instead. `ipconfig` shows it.
- **Phone can't reach the laptop**: allow Node through Windows Firewall on private networks, or put both on your phone's hotspot.
- **"Motion access denied"**: Settings → Safari → Advanced → Website Data, remove the site, reload.

## Layout
```
index.html / src/director.ts   laptop: splat viewer, camera rig, takes + storyboard
camera.html / src/phone.ts     iPhone: motion sensors, dolly pads, lens, REC
src/protocol.ts                message types + WebSocket helper
vite.config.ts                 HTTPS dev server + /relay WebSocket (same port)
```
