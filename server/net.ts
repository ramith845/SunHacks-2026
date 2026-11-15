// The laptop's current LAN addresses, best guess first. Read live so the QR code follows Wi-Fi changes.
import os from "node:os";

const VIRTUAL = /vEthernet|WSL|VirtualBox|VMware|Hyper-V|docker|br-|vbox|Loopback|Bluetooth|Tailscale|ZeroTier|vnic|utun|tun|tap/i;
const WIFI = /wi-?fi|wlan|wireless|^en0$|^wl/i;

export function lanAddresses(): { name: string; ip: string }[] {
  const score = (name: string, ip: string) =>
    (VIRTUAL.test(name) ? -100 : 0) +
    (WIFI.test(name) ? 50 : 0) +
    (ip.startsWith("169.254.") ? -80 : 0) + // self-assigned: no real network
    (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? 20 : 0);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, l]) => (l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ name, ip: i.address })))
    .sort((a, b) => score(b.name, b.ip) - score(a.name, a.ip));
}
