import express from "express";
import cors from "cors";
import cron from "node-cron";
import fs from "fs";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

// -------------------------
// ENV (com trim e defaults consistentes)
// -------------------------
const PORT = Number(process.env.PORT ?? 3001);

const SPOTIFY_CLIENT_ID = String(process.env.SPOTIFY_CLIENT_ID ?? "").trim();
const SPOTIFY_CLIENT_SECRET = String(process.env.SPOTIFY_CLIENT_SECRET ?? "").trim();

const SCHEDULE_PATH = String(process.env.SCHEDULE_PATH ?? "/app/schedule.json").trim();
const TOKENS_PATH = String(process.env.TOKENS_PATH ?? "/app/tokens.json").trim();

const SCHEDULE_TZ = String(process.env.SCHEDULE_TZ ?? "America/Sao_Paulo").trim();

// ✅ default em 127.0.0.1 (pra não dar mismatch com seu dashboard)
const SPOTIFY_REDIRECT_URI = String(
  process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3001/auth/callback"
).trim();

// CORS
const CORS_ORIGIN = String(process.env.CORS_ORIGIN ?? "").trim();
if (CORS_ORIGIN) {
  const origin =
    CORS_ORIGIN === "*"
      ? true
      : CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

  app.use(cors({ origin }));
}

function assertEnv() {
  const missing = [];
  if (!SPOTIFY_CLIENT_ID) missing.push("SPOTIFY_CLIENT_ID");
  if (!SPOTIFY_CLIENT_SECRET) missing.push("SPOTIFY_CLIENT_SECRET");

  if (missing.length) {
    console.log("[BOOT] Faltam envs:", missing.join(", "));
  }

  console.log("[BOOT] PORT =", PORT);
  console.log("[BOOT] SPOTIFY_REDIRECT_URI =", SPOTIFY_REDIRECT_URI);
  console.log("[BOOT] SCHEDULE_PATH =", SCHEDULE_PATH);
  console.log("[BOOT] TOKENS_PATH =", TOKENS_PATH);
  console.log("[BOOT] SCHEDULE_TZ =", SCHEDULE_TZ);
}
assertEnv();

// -------------------------
// Utils
// -------------------------
function safeJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureFile(path, fallbackContent = "{}") {
  try {
    fs.accessSync(path, fs.constants.F_OK);
  } catch {
    fs.writeFileSync(path, fallbackContent, "utf-8");
  }
}

function readJsonFile(path, fallback = {}) {
  try {
    const raw = fs.readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, obj) {
  fs.writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
}

// garante tokens.json existir
ensureFile(TOKENS_PATH, "{}");

// -------------------------
// OAuth (gerar refresh automaticamente)
// -------------------------
const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

let oauthState = ""; // ok pra localhost/127

app.get("/auth/login", (req, res) => {
  if (!SPOTIFY_CLIENT_ID) return res.status(500).send("Missing SPOTIFY_CLIENT_ID");

  oauthState = crypto.randomBytes(16).toString("hex");

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  url.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  url.searchParams.set("scope", SPOTIFY_SCOPES);
  url.searchParams.set("state", oauthState);

  // ✅ debug: mostra exatamente o que está indo pro Spotify
  console.log("[AUTH] redirect_uri =", SPOTIFY_REDIRECT_URI);
  console.log("[AUTH] authorize_url =", url.toString());

  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) return res.status(400).send("missing code");
    if (!state || state !== oauthState) return res.status(400).send("invalid state");

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return res.status(500).send("Missing SPOTIFY_CLIENT_ID/SECRET");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: SPOTIFY_REDIRECT_URI,
    });

    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const text = await tokenRes.text();
    const tokenData = safeJsonParse(text);

    if (!tokenRes.ok) {
      console.log("[AUTH] token error:", tokenData);
      return res.status(500).send(JSON.stringify(tokenData, null, 2));
    }

    // salva refresh_token
    const tokens = readJsonFile(TOKENS_PATH, {});
    tokens.refresh_token = tokenData.refresh_token;
    tokens.scope = tokenData.scope;
    tokens.updated_at = new Date().toISOString();
    writeJsonFile(TOKENS_PATH, tokens);

    res.send("Conectado! refresh_token salvo em tokens.json. Pode fechar esta página.");
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.get("/api/auth/status", (req, res) => {
  const tokens = readJsonFile(TOKENS_PATH, {});
  res.json({
    hasRefreshToken: isNonEmptyString(tokens.refresh_token),
    updated_at: tokens.updated_at ?? null,
    scope: tokens.scope ?? null,
  });
});

// -------------------------
// Token cache (com lock)
// -------------------------
let accessToken = "";
let accessTokenExp = 0;
let refreshingPromise = null;

function getRefreshTokenOrThrow() {
  const tokens = readJsonFile(TOKENS_PATH, {});
  const rt = tokens.refresh_token;

  if (!isNonEmptyString(rt)) {
    throw new Error("Sem refresh_token. Acesse http://127.0.0.1:3001/auth/login para conectar.");
  }
  return rt;
}

async function refreshAccessToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify env vars (CLIENT_ID/SECRET).");
  }

  const refresh_token = getRefreshTokenOrThrow();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) throw new Error(JSON.stringify(data));

  accessToken = data.access_token;
  const expiresIn = Number(data.expires_in ?? 3600);
  accessTokenExp = Date.now() + (expiresIn - 60) * 1000;

  return accessToken;
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExp) return accessToken;

  if (!refreshingPromise) {
    refreshingPromise = refreshAccessToken().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

async function spotifyFetch(url, init = {}) {
  const token = await getAccessToken();

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 204) return null;

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// -------------------------
// Health
// -------------------------
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// -------------------------
// API: Search / Albums
// -------------------------
app.get("/api/search-artist", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(q) +
      "&type=artist&market=BR&limit=10&offset=0";

    const data = await spotifyFetch(url);
    const artist = data?.artists?.items?.[0] ?? null;
    res.json({ artist });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/artist-albums", async (req, res) => {
  try {
    const artistId = String(req.query.artistId ?? "").trim();
    if (!artistId) return res.status(400).json({ error: "missing artistId" });

    const url =
      `https://api.spotify.com/v1/artists/${artistId}/albums` +
      `?include_groups=album&market=BR&limit=10`;

    const data = await spotifyFetch(url);
    res.json({ items: data?.items ?? [] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// -------------------------
// API: Player
// -------------------------
app.get("/api/player/devices", async (req, res) => {
  try {
    const data = await spotifyFetch("https://api.spotify.com/v1/me/player/devices");
    res.json(data ?? { devices: [] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/player/state", async (req, res) => {
  try {
    const data = await spotifyFetch("https://api.spotify.com/v1/me/player");
    res.json(data ?? null);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/player/play-context", async (req, res) => {
  try {
    const { deviceId, contextUri } = req.body ?? {};
    if (!isNonEmptyString(contextUri)) return res.status(400).json({ error: "missing contextUri" });

    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_uri: contextUri, position_ms: 0 }),
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/player/play-track", async (req, res) => {
  try {
    const { deviceId, trackUri } = req.body ?? {};
    if (!isNonEmptyString(trackUri)) return res.status(400).json({ error: "missing trackUri" });

    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [trackUri], position_ms: 0 }),
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/player/pause", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/pause");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/player/next", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/next");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), { method: "POST" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/player/previous", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/previous");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), { method: "POST" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put("/api/player/seek", async (req, res) => {
  try {
    const { deviceId, positionMs } = req.body ?? {};
    const ms = Number(positionMs);
    if (!Number.isFinite(ms) || ms < 0) return res.status(400).json({ error: "invalid positionMs" });

    const url = new URL("https://api.spotify.com/v1/me/player/seek");
    url.searchParams.set("position_ms", String(ms));
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", deviceId);

    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// -------------------------
// Scheduler
// -------------------------
let scheduledTasks = [];

function loadSchedule() {
  return readJsonFile(SCHEDULE_PATH, {});
}

function resolveDevices(cfg) {
  if (isNonEmptyString(cfg.deviceId)) return [cfg.deviceId];
  if (Array.isArray(cfg.devices)) return cfg.devices.filter(isNonEmptyString);
  return [];
}

function clearScheduledJobs() {
  for (const t of scheduledTasks) {
    try { t.stop(); } catch {}
  }
  scheduledTasks = [];
}

function buildBomDiaPayload(current) {
  if (isNonEmptyString(current.bomDiaTrackUri)) return { uris: [current.bomDiaTrackUri], position_ms: 0 };
  if (isNonEmptyString(current.bomDiaContextUri)) return { context_uri: current.bomDiaContextUri, position_ms: 0 };
  return null;
}

function scheduleJobs() {
  clearScheduledJobs();

  const cfg = loadSchedule();
  const times = Array.isArray(cfg.bomDiaTimes) ? cfg.bomDiaTimes : [];

  if (!times.length) {
    console.log("[SCHEDULE] bomDiaTimes vazio. Nenhum job criado.");
    return;
  }

  for (const hhmm of times) {
    const [hh, mm] = String(hhmm).split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
      console.log("[SCHEDULE] horário inválido ignorado:", hhmm);
      continue;
    }

    const expr = `${mm} ${hh} * * *`;

    const task = cron.schedule(
      expr,
      async () => {
        try {
          const current = loadSchedule();
          const currentDevices = resolveDevices(current);

          if (!currentDevices.length) return console.log("[SCHEDULE] sem device. Pulei:", hhmm);
          if (!isNonEmptyString(current.playlistUri)) return console.log("[SCHEDULE] faltou playlistUri. Pulei:", hhmm);

          const bomDiaPayload = buildBomDiaPayload(current);
          if (!bomDiaPayload) return console.log("[SCHEDULE] faltou bomDiaTrackUri/bomDiaContextUri. Pulei:", hhmm);

          console.log("[SCHEDULE] Bom dia", hhmm, "devices:", currentDevices.length);

          for (const deviceId of currentDevices) {
            const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
            playUrl.searchParams.set("device_id", deviceId);

            await spotifyFetch(playUrl.toString(), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bomDiaPayload),
            });

            const waitMs = Number(current.bomDiaDurationMs ?? 90000);
            await sleep(Number.isFinite(waitMs) ? waitMs : 90000);

            await spotifyFetch(playUrl.toString(), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ context_uri: current.playlistUri, position_ms: 0 }),
            });
          }
        } catch (e) {
          console.log("[SCHEDULE ERROR]", String(e));
        }
      },
      { timezone: SCHEDULE_TZ }
    );

    scheduledTasks.push(task);
    console.log("[SCHEDULE] criado:", expr, "tz:", SCHEDULE_TZ);
  }
}

app.post("/api/schedule/reload", (req, res) => {
  scheduleJobs();
  res.json({ ok: true, tasks: scheduledTasks.length });
});

scheduleJobs();
app.listen(PORT, () => console.log("API on port", PORT));