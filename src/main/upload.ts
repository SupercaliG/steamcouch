// "Send a photo from your phone": a tiny web server on the home network that
// only runs while Settings shows its QR code. The phone scans the code, opens
// a page, picks a photo, crops it to a square in the phone's browser, and
// sends a small JPEG back. It is saved as the profile picture.
//
// Safety: the server listens only while the TV screen is open (and at most
// UPLOAD_TTL_MS), every URL carries a random one-time-session token, it only
// accepts JPEG data up to MAX_BYTES, and it can only write the one avatar
// file for the profile the TV asked for.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

/** Port on the home network (Bazzite's default firewall zone allows 1025-65535). */
export const UPLOAD_PORT = 7690;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadSession {
  url: string;
  profileId: string;
}

/** First IPv4 address on the home network (Wi-Fi or Ethernet). */
function lanAddress(): string | undefined {
  const all = Object.entries(networkInterfaces());
  // Real network cards first; skip loopback, containers and VPN tunnels.
  const ranked = all
    .filter(([name]) => !/^(lo|docker|br-|veth|virbr|tun|tap|tailscale|wg)/.test(name))
    .flatMap(([, addrs]) => addrs ?? [])
    .filter((a) => a.family === "IPv4" && !a.internal);
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return (ranked.find((a) => isPrivate(a.address)) ?? ranked[0])?.address;
}

export function createUploads(avatarDir: string) {
  let server: Server | null = null;
  let token = "";
  let profileId = "";
  let expiry: NodeJS.Timeout | undefined;

  const tokenOk = (given: string) => {
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return token !== "" && a.length === b.length && timingSafeEqual(a, b);
  };

  function stop() {
    clearTimeout(expiry);
    server?.close();
    server = null;
    token = "";
  }

  function saveAvatar(jpeg: Buffer) {
    mkdirSync(avatarDir, { recursive: true });
    const file = join(avatarDir, `${profileId}.jpg`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, jpeg);
    renameSync(tmp, file); // never leave a half-written picture
  }

  function handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    const m = /^\/u\/([a-f0-9]+)$/.exec((req.url ?? "").split("?")[0] ?? "");
    if (!m || !tokenOk(m[1]!)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("This link has expired. Scan the code on the TV again.");
      return;
    }
    if (req.method === "GET") {
      res
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; img-src blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        })
        .end(phonePage());
      return;
    }
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          res.writeHead(413).end("Too big");
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks);
        // JPEG files start with FF D8 FF.
        if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
          res.writeHead(415).end("Not a JPEG");
          return;
        }
        try {
          saveAvatar(body);
          res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
        } catch (err) {
          console.error("[steamcouch] avatar upload:", err);
          res.writeHead(500).end("Could not save");
        }
      });
      return;
    }
    res.writeHead(405).end();
  }

  return {
    /** Start (or restart) accepting a photo for one profile. */
    async start(id: string): Promise<UploadSession> {
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad profile id");
      const ip = lanAddress();
      if (!ip) throw new Error("No network connection");
      stop();
      token = randomBytes(16).toString("hex");
      profileId = id;
      server = createServer(handler);
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(UPLOAD_PORT, "0.0.0.0", () => resolve());
      });
      expiry = setTimeout(stop, UPLOAD_TTL_MS);
      return { url: `http://${ip}:${UPLOAD_PORT}/u/${token}`, profileId: id };
    },
    stop,
  };
}

export type Uploads = ReturnType<typeof createUploads>;

/** The page the phone opens. Self-contained: no outside files, works offline on the LAN. */
function phonePage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send a picture to the TV</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; min-height: 100vh; background: radial-gradient(120% 80% at 50% 0%, #1b2a5c, #070a16 70%);
         color: #f4f6fb; display: flex; flex-direction: column; align-items: center; padding: 32px 20px; box-sizing: border-box; }
  h1 { font-weight: 400; font-size: 26px; margin: 8px 0 6px; text-align: center; }
  p { color: rgba(244,246,251,.7); margin: 0 0 28px; text-align: center; font-size: 16px; }
  .pic { width: 220px; height: 220px; border-radius: 50%; background: #1a2240 center/cover no-repeat;
         border: 3px solid rgba(255,255,255,.85); margin-bottom: 28px; }
  label, button { display: block; width: 100%; max-width: 320px; box-sizing: border-box; text-align: center;
         padding: 16px; border-radius: 30px; font-size: 18px; font-weight: 600; border: 0; margin-bottom: 14px; }
  label { background: #fff; color: #0a0d16; }
  button { background: #2f7df6; color: #fff; }
  button:disabled { opacity: .4; }
  input { display: none; }
  .msg { min-height: 24px; font-size: 17px; text-align: center; }
</style></head>
<body>
  <h1>Profile picture</h1>
  <p>Pick a photo. It shows up on the TV right away.</p>
  <div class="pic" id="pic"></div>
  <label for="file">Choose a photo</label>
  <input id="file" type="file" accept="image/*">
  <button id="send" disabled>Send to TV</button>
  <div class="msg" id="msg"></div>
<script>
  const SIZE = 512;
  let blob = null;
  const msg = (t) => (document.getElementById("msg").textContent = t);
  document.getElementById("file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    msg("");
    try {
      const img = await createImageBitmap(file);
      // Center square crop, scaled to 512x512.
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = SIZE;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      document.getElementById("pic").style.backgroundImage = "url(" + URL.createObjectURL(blob) + ")";
      document.getElementById("send").disabled = false;
    } catch {
      msg("That photo could not be opened. Try another one.");
    }
  });
  document.getElementById("send").addEventListener("click", async () => {
    if (!blob) return;
    document.getElementById("send").disabled = true;
    msg("Sending...");
    try {
      const res = await fetch(location.pathname, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      msg(res.ok ? "Done! Look at the TV." : "The TV said no (" + res.status + "). Scan the code again.");
    } catch {
      msg("Could not reach the TV. Is this phone on the same Wi-Fi?");
    }
    document.getElementById("send").disabled = false;
  });
</script>
</body></html>`;
}
