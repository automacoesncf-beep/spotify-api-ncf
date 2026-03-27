// server/index.js
// Node 18+ (fetch global). Se sua Node for antiga, use: npm i node-fetch e importe.

import express from "express";
import cors from "cors";
import cron from "node-cron";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "2mb" }));

// -------------------------
// ENV
// -------------------------
const PORT = Number(process.env.PORT ?? 3001);

const SPOTIFY_CLIENT_ID = String(process.env.SPOTIFY_CLIENT_ID ?? "").trim();
const SPOTIFY_CLIENT_SECRET = String(process.env.SPOTIFY_CLIENT_SECRET ?? "").trim();

const SCHEDULE_PATH = String(process.env.SCHEDULE_PATH ?? "/app/schedule.json").trim();
const TOKENS_PATH = String(process.env.TOKENS_PATH ?? "/app/tokens.json").trim();
const SCHEDULE_TZ = String(process.env.SCHEDULE_TZ ?? "America/Sao_Paulo").trim();

// ✅ Estado persistente do “rádio” (cursor por device + contexto)
const STATE_PATH = String(process.env.STATE_PATH ?? "/app/playback_state.json").trim();

const SPOTIFY_REDIRECT_URI = String(
  process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3001/auth/callback"
).trim();

// IA (opcional)
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY ?? "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL ?? "gpt-5").trim();

// CORS
const CORS_ORIGIN = String(process.env.CORS_ORIGIN ?? "").trim();
const NODE_ENV = String(process.env.NODE_ENV ?? "development").trim();

// timeout padrão p/ chamadas externas
const FETCH_TIMEOUT_MS = Math.max(3000, Number(process.env.FETCH_TIMEOUT_MS ?? 12000));

// timeouts específicos do player
const PLAYER_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.PLAYER_PROBE_TIMEOUT_MS ?? 3500));
const PLAYER_ROUTE_TIMEOUT_MS = Math.max(1500, Number(process.env.PLAYER_ROUTE_TIMEOUT_MS ?? 6000));

// cache curto para evitar empilhamento
const PLAYER_CACHE_TTL_MS = Math.max(1000, Number(process.env.PLAYER_CACHE_TTL_MS ?? 4000));
const PLAYER_STALE_TTL_MS = Math.max(5000, Number(process.env.PLAYER_STALE_TTL_MS ?? 20000));

// cache curtíssimo por endpoint do player para evitar sondagens repetidas na mesma janela
const PLAYER_ENDPOINT_CACHE_TTL_MS = Math.max(
  250,
  Number(process.env.PLAYER_ENDPOINT_CACHE_TTL_MS ?? 1500)
);

// cooldown local quando Spotify responder 429 nos endpoints /me/player*
const PLAYER_RATE_LIMIT_COOLDOWN_MS = Math.max(
  1000,
  Number(process.env.PLAYER_RATE_LIMIT_COOLDOWN_MS ?? 5000)
);

if (CORS_ORIGIN) {
  const origin =
    CORS_ORIGIN === "*"
      ? true
      : CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

  app.use(cors({ origin }));
} else if (NODE_ENV !== "production") {
  app.use(cors({ origin: true }));
}

function assertEnv() {
  const missing = [];
  if (!SPOTIFY_CLIENT_ID) missing.push("SPOTIFY_CLIENT_ID");
  if (!SPOTIFY_CLIENT_SECRET) missing.push("SPOTIFY_CLIENT_SECRET");

  if (missing.length) console.log("[BOOT] Faltam envs:", missing.join(", "));

  console.log("[BOOT] NODE_ENV =", NODE_ENV);
  console.log("[BOOT] PORT =", PORT);
  console.log("[BOOT] SPOTIFY_REDIRECT_URI =", SPOTIFY_REDIRECT_URI);
  console.log("[BOOT] SCHEDULE_PATH =", SCHEDULE_PATH);
  console.log("[BOOT] TOKENS_PATH =", TOKENS_PATH);
  console.log("[BOOT] STATE_PATH =", STATE_PATH);
  console.log("[BOOT] SCHEDULE_TZ =", SCHEDULE_TZ);
  console.log("[BOOT] OPENAI_API_KEY =", OPENAI_API_KEY ? "OK" : "(vazio)");
  console.log("[BOOT] OPENAI_MODEL =", OPENAI_MODEL);
  console.log("[BOOT] CORS_ORIGIN =", CORS_ORIGIN || "(dev: origin=true)");
  console.log("[BOOT] FETCH_TIMEOUT_MS =", FETCH_TIMEOUT_MS);
  console.log("[BOOT] PLAYER_PROBE_TIMEOUT_MS =", PLAYER_PROBE_TIMEOUT_MS);
  console.log("[BOOT] PLAYER_ROUTE_TIMEOUT_MS =", PLAYER_ROUTE_TIMEOUT_MS);
  console.log("[BOOT] PLAYER_CACHE_TTL_MS =", PLAYER_CACHE_TTL_MS);
  console.log("[BOOT] PLAYER_STALE_TTL_MS =", PLAYER_STALE_TTL_MS);
  console.log("[BOOT] PLAYER_ENDPOINT_CACHE_TTL_MS =", PLAYER_ENDPOINT_CACHE_TTL_MS);
  console.log("[BOOT] PLAYER_RATE_LIMIT_COOLDOWN_MS =", PLAYER_RATE_LIMIT_COOLDOWN_MS);
}
assertEnv();

// -------------------------
// Utils
// -------------------------
function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text) };
  }
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isAbortError(err) {
  const name = String(err?.name ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return name === "AbortError" || msg.includes("aborted") || msg.includes("abort");
}

function toErrorMessage(err) {
  return err?.message ? String(err.message) : String(err);
}

function withTimeout(promise, ms, timeoutMessage = "Timeout") {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(timeoutMessage);
        err.status = 504;
        reject(err);
      }, ms);
    }),
  ]);
}

async function readResponseTextWithTimeout(res, ms = FETCH_TIMEOUT_MS, label = "response body") {
  return withTimeout(res.text(), ms, `Timeout ao ler ${label}`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function headersToObject(headers) {
  try {
    return Object.fromEntries(headers.entries());
  } catch {
    return {};
  }
}

function parseRetryAfterMs(source, fallbackMs = 1000) {
  let raw = null;

  try {
    if (typeof source === "string" || typeof source === "number") {
      raw = source;
    } else if (source?.get) {
      raw = source.get("retry-after");
    } else if (source && typeof source === "object") {
      raw = source["retry-after"] ?? source["Retry-After"] ?? null;
    }
  } catch {}

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.max(1000, Math.floor(seconds * 1000));
  }

  return Math.max(1000, fallbackMs);
}

function isSpotifyPlayerUrl(url) {
  try {
    const u = new URL(String(url));
    return u.origin === "https://api.spotify.com" && u.pathname.startsWith("/v1/me/player");
  } catch {
    return String(url ?? "").includes("https://api.spotify.com/v1/me/player");
  }
}

// Feb/2026: /search limit range 0–10 (default 5). Cap em 10.
function parseSearchLimit(req, fallback = 5) {
  const raw = req.query.limit;
  const n = toInt(raw, fallback);
  return clamp(n, 0, 10);
}

// Feb/2026: /search offset range 0–1000
const SEARCH_OFFSET_MAX = 1000;
function parseOffset(req, fallback = 0) {
  const n = toInt(req.query.offset, fallback);
  return clamp(Math.max(0, n), 0, SEARCH_OFFSET_MAX);
}

// Padroniza paginação no retorno
function pageFromBlock(block, limit, offset) {
  return {
    limit: Number(block?.limit ?? limit),
    offset: Number(block?.offset ?? offset),
    total: typeof block?.total === "number" ? block.total : null,
    next: block?.next ?? null,
    previous: block?.previous ?? null,
  };
}

function ensureFile(filePath, fallbackContent = "{}") {
  try {
    const st = fs.statSync(filePath);
    if (st.isDirectory()) throw new Error(`${filePath} é um DIRETÓRIO. Apague e crie como arquivo JSON.`);
  } catch {
    const dir = path.dirname(filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    fs.writeFileSync(filePath, fallbackContent, "utf-8");
  }
}

function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const txt = String(raw ?? "").trim();
    if (!txt) return fallback;
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, obj) {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

function nowMs() {
  return Date.now();
}

// garante arquivos
ensureFile(TOKENS_PATH, "{}");
ensureFile(SCHEDULE_PATH, JSON.stringify({ items: [] }, null, 2));
ensureFile(STATE_PATH, JSON.stringify({ devices: {} }, null, 2));

// favicon
app.get("/favicon.ico", (req, res) => res.status(204).end());

// -------------------------
// Cookies (state OAuth)
// -------------------------
function appendSetCookie(res, cookieLine) {
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookieLine);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", prev.concat(cookieLine));
  else res.setHeader("Set-Cookie", [String(prev), cookieLine]);
}

function setCookie(res, name, value) {
  appendSetCookie(res, `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`);
}
function clearCookie(res, name) {
  appendSetCookie(
    res,
    `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`
  );
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === name) return decodeURIComponent(v || "");
  }
  return "";
}

// -------------------------
// Spotify OAuth
// -------------------------
const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-modify",
].join(" ");

app.get("/auth/login", (req, res) => {
  if (!SPOTIFY_CLIENT_ID) return res.status(500).send("Missing SPOTIFY_CLIENT_ID");

  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, "spotify_oauth_state", state);

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  url.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  url.searchParams.set("scope", SPOTIFY_SCOPES);
  url.searchParams.set("state", state);

  console.log("[AUTH] authorize_url =", url.toString());
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("missing code");

    const expected = getCookie(req, "spotify_oauth_state");
    if (!state || String(state) !== expected) return res.status(400).send("invalid state");
    clearCookie(res, "spotify_oauth_state");

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return res.status(500).send("Missing SPOTIFY_CLIENT_ID/SECRET");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: SPOTIFY_REDIRECT_URI,
    });

    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

    const tokenRes = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const text = await readResponseTextWithTimeout(tokenRes, FETCH_TIMEOUT_MS, "body do token OAuth");
    const tokenData = safeJsonParse(text);

    if (!tokenRes.ok) {
      console.log("[AUTH] token error:", tokenData);
      return res.status(500).send(JSON.stringify(tokenData, null, 2));
    }

    const tokens = readJsonFile(TOKENS_PATH, {});

    if (isNonEmptyString(tokenData?.refresh_token)) tokens.refresh_token = tokenData.refresh_token;

    if (isNonEmptyString(tokenData?.access_token)) {
      const expiresIn = Number(tokenData?.expires_in ?? 3600);
      const expMs = Date.now() + Math.max(60, expiresIn - 60) * 1000;

      tokens.access_token = tokenData.access_token;
      tokens.access_token_exp = expMs;

      accessToken = tokenData.access_token;
      accessTokenExp = expMs;
    }

    tokens.scope = tokenData?.scope ?? tokens.scope ?? null;
    tokens.updated_at = new Date().toISOString();
    writeJsonFile(TOKENS_PATH, tokens);

    res.send("Conectado! tokens.json atualizado. Pode fechar esta página.");
  } catch (e) {
    const msg = isAbortError(e) ? "Timeout no callback OAuth do Spotify" : toErrorMessage(e);
    res.status(500).send(msg);
  }
});

// ✅ status do auth
app.get("/api/auth/status", (req, res) => {
  const tokens = readJsonFile(TOKENS_PATH, {});
  const exp = Number(tokens?.access_token_exp ?? 0);

  res.json({
    hasRefreshToken: isNonEmptyString(tokens.refresh_token),
    hasAccessTokenOnDisk: isNonEmptyString(tokens.access_token),
    expires_in_sec_left: Number.isFinite(exp) ? Math.max(0, Math.floor((exp - Date.now()) / 1000)) : null,
    updated_at: tokens.updated_at ?? null,
    scope: tokens.scope ?? null,
  });
});

// -------------------------
// Spotify token cache
// -------------------------
let accessToken = "";
let accessTokenExp = 0; // epoch ms
let refreshingPromise = null;

function readTokens() {
  return readJsonFile(TOKENS_PATH, {});
}
function writeTokens(tokens) {
  writeJsonFile(TOKENS_PATH, tokens);
}

function loadAccessFromDiskIfValid() {
  const t = readTokens();
  const tok = t?.access_token;
  const exp = Number(t?.access_token_exp ?? 0);
  if (isNonEmptyString(tok) && Number.isFinite(exp) && Date.now() < exp) {
    accessToken = tok;
    accessTokenExp = exp;
    return tok;
  }
  return "";
}

function getRefreshTokenOrThrow() {
  const tokens = readTokens();
  const rt = tokens.refresh_token;
  if (!isNonEmptyString(rt)) {
    const err = new Error("Sem refresh_token. Acesse /auth/login para conectar.");
    err.status = 401;
    throw err;
  }
  return rt;
}

async function refreshAccessToken() {
  console.log("[TOKEN] refresh:start");

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    const err = new Error("Missing SPOTIFY_CLIENT_ID/SECRET");
    err.status = 500;
    throw err;
  }

  const refresh_token = getRefreshTokenOrThrow();
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
  });

  let res;
  try {
    res = await fetchWithTimeout("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
    });
  } catch (e) {
    const err = new Error(
      isAbortError(e)
        ? "Timeout ao renovar access token no Spotify"
        : `Falha de rede ao renovar access token: ${toErrorMessage(e)}`
    );
    err.status = 504;
    err.data = null;
    throw err;
  }

  const text = await readResponseTextWithTimeout(res, FETCH_TIMEOUT_MS, "body do refresh token");
  const data = safeJsonParse(text);

  console.log("[TOKEN] refresh:status =", res.status);

  if (!res.ok) {
    const err = new Error(data?.error_description ?? data?.error ?? "Erro ao refresh token");
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const tok = String(data?.access_token ?? "").trim();
  if (!tok) {
    const err = new Error("Refresh retornou sem access_token");
    err.status = 500;
    err.data = data;
    throw err;
  }

  const expiresIn = Number(data?.expires_in ?? 3600);
  const expMs = Date.now() + Math.max(60, expiresIn - 60) * 1000;

  accessToken = tok;
  accessTokenExp = expMs;

  const t = readTokens();
  if (isNonEmptyString(data?.refresh_token)) t.refresh_token = data.refresh_token;
  t.access_token = accessToken;
  t.access_token_exp = accessTokenExp;
  t.scope = data?.scope ?? t.scope ?? null;
  t.updated_at = new Date().toISOString();
  writeTokens(t);

  console.log("[TOKEN] refresh:ok expiresIn =", expiresIn);
  return accessToken;
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExp) return accessToken;

  const diskTok = loadAccessFromDiskIfValid();
  if (diskTok) return diskTok;

  if (!refreshingPromise) {
    refreshingPromise = refreshAccessToken().finally(() => {
      refreshingPromise = null;
    });
  }

  return refreshingPromise;
}

// request “detalhado”: não explode em 204, e permite inspecionar status/headers/data
async function spotifyRequest(url, init = {}, options = {}) {
  const {
    retried = false,
    timeoutMs = FETCH_TIMEOUT_MS,
    retryOn401 = true,
    retryOn429 = true,
  } = options;

  const token = await getAccessToken();

  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      },
      timeoutMs
    );
  } catch (e) {
    const err = new Error(
      isAbortError(e)
        ? `Timeout ao chamar Spotify: ${url}`
        : `Falha de rede ao chamar Spotify: ${toErrorMessage(e)}`
    );
    err.status = 504;
    err.data = null;
    throw err;
  }

  const retryAfterMs =
    res.status === 429
      ? parseRetryAfterMs(res.headers, PLAYER_RATE_LIMIT_COOLDOWN_MS)
      : 0;

  if (res.status === 401 && retryOn401 && !retried) {
    try {
      accessToken = "";
      accessTokenExp = 0;
      refreshingPromise = null;
      await refreshAccessToken();

      return spotifyRequest(url, init, {
        ...options,
        retried: true,
        retryOn401: false,
      });
    } catch {
      // segue para leitura normal
    }
  }

  if (res.status === 429 && isSpotifyPlayerUrl(url)) {
    markPlayerRateLimit(url, res.headers, "spotify-request-429");
  }

  if (res.status === 429 && retryOn429 && !retried) {
    await sleep(retryAfterMs);

    return spotifyRequest(url, init, {
      ...options,
      retried: true,
      retryOn401: false,
      retryOn429: false,
    });
  }

  let data = null;
  if (res.status !== 204) {
    const text = await readResponseTextWithTimeout(res, timeoutMs, `body Spotify ${url}`);
    data = safeJsonParse(text);
  }

  return {
    ok: res.ok,
    status: res.status,
    data,
    headers: headersToObject(res.headers),
    retryAfterMs,
  };
}

// wrapper normal
async function spotifyFetch(url, init = {}, options = {}) {
  const out = await spotifyRequest(url, init, options);

  if (out.status === 204) return null;

  if (!out.ok) {
    const status = out?.data?.error?.status ?? out.status;
    const message =
      out?.data?.error?.message ??
      out?.data?.error_description ??
      out?.data?.raw ??
      "Erro Spotify";

    console.log("[SPOTIFY FETCH ERROR]", {
      url,
      status,
      retryAfterMs: out?.retryAfterMs ?? 0,
      data: out.data,
    });

    const err = new Error(message);
    err.status = status;
    err.data = out.data;
    err.retryAfterMs = out?.retryAfterMs ?? 0;
    throw err;
  }

  return out.data;
}

function sendSpotifyError(res, err) {
  const status = Number(err?.status ?? 500);
  const msg = String(err?.message ?? err ?? "");
  const data = err?.data ?? null;

  if (msg.includes("Sem refresh_token")) return res.status(401).json({ error: msg, raw: data });

  if (status === 403 && msg.toUpperCase().includes("PREMIUM")) {
    return res.status(403).json({
      error: "Spotify Premium é necessário para controlar playback via Web API (play/pause/seek/shuffle).",
      raw: data,
    });
  }

  if (status === 429) {
    return res.status(429).json({
      error: "Spotify limitou temporariamente as requisições. Aguarde alguns segundos e tente novamente.",
      raw: data,
    });
  }

  if (Number.isFinite(status) && status >= 400 && status <= 599) {
    return res.status(status).json({ error: msg, raw: data });
  }
  return res.status(500).json({ error: msg, raw: data });
}

// -------------------------
// Helpers Spotify URL/URI
// -------------------------
function spotifyUrlToUri(input) {
  let s = String(input ?? "").trim();
  if (!s) return "";

  if (s.startsWith("spotify:")) return s;

  if (s.includes("open.spotify.com/")) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      const type = parts[0];
      const id = parts[1];
      if (!type || !id) return "";
      if (["track", "album", "playlist", "artist", "episode", "show"].includes(type)) return `spotify:${type}:${id}`;
      return "";
    } catch {
      return "";
    }
  }

  return s;
}

function playlistIdToUri(id) {
  const pid = String(id ?? "").trim();
  return pid ? `spotify:playlist:${pid}` : "";
}

function buildLibraryUrl(uris) {
  const list = (Array.isArray(uris) ? uris : [uris])
    .map((u) => spotifyUrlToUri(u))
    .map((u) => String(u).trim())
    .filter(Boolean);

  const url = new URL("https://api.spotify.com/v1/me/library");
  url.searchParams.set("uris", list.join(","));
  return url.toString();
}

function buildPlayPayloadFromUri(uri, startFromBeginning = true) {
  const u = spotifyUrlToUri(uri);
  if (!isNonEmptyString(u)) return null;

  const withPos = (payload) => {
    if (startFromBeginning) payload.position_ms = 0;
    return payload;
  };

  if (u.startsWith("spotify:track:") || u.startsWith("spotify:episode:")) return withPos({ uris: [u] });

  if (u.startsWith("spotify:album:") || u.startsWith("spotify:playlist:") || u.startsWith("spotify:artist:")) {
    return withPos({ context_uri: u });
  }

  return null;
}

// -------------------------
// Estado persistente do rádio (cursor)
// -------------------------
function readState() {
  return readJsonFile(STATE_PATH, { devices: {} });
}
function writeState(st) {
  writeJsonFile(STATE_PATH, st);
}

function snapshotFromPlayback(pb) {
  const item = pb?.item ?? null;
  const device = pb?.device ?? null;
  return {
    device_id: device?.id ?? null,
    context_uri: pb?.context?.uri ?? null,
    item_uri: item?.uri ?? null,
    progress_ms: typeof pb?.progress_ms === "number" ? pb.progress_ms : 0,
    item_duration_ms: typeof item?.duration_ms === "number" ? item.duration_ms : null,
    shuffle_state: !!pb?.shuffle_state,
    repeat_state: typeof pb?.repeat_state === "string" ? pb.repeat_state : "off",
    is_playing: !!pb?.is_playing,
    currently_playing_type: pb?.currently_playing_type ?? null,
    captured_at: new Date().toISOString(),
  };
}

async function getPlaybackSnapshot() {
  const pb = await spotifyFetch("https://api.spotify.com/v1/me/player");
  if (!pb) return null;
  return snapshotFromPlayback(pb);
}

function saveCursor(deviceId, snap) {
  if (!isNonEmptyString(deviceId)) return;
  if (!isNonEmptyString(snap?.context_uri)) return;

  const st = readState();
  st.devices ??= {};
  st.devices[deviceId] ??= { cursors: {}, last: null };
  st.devices[deviceId].cursors[snap.context_uri] = snap;
  st.devices[deviceId].last = snap;
  writeState(st);
}

function loadCursor(deviceId, contextUri) {
  if (!isNonEmptyString(deviceId) || !isNonEmptyString(contextUri)) return null;
  const st = readState();
  return st?.devices?.[deviceId]?.cursors?.[contextUri] ?? null;
}

function loadLastCursor(deviceId) {
  if (!isNonEmptyString(deviceId)) return null;
  const st = readState();
  return st?.devices?.[deviceId]?.last ?? null;
}

app.get("/api/radio/state", (req, res) => {
  const st = readState();
  res.json({ ok: true, state: st });
});

// -------------------------
// Helpers de restore
// -------------------------
async function setShuffleRepeat(deviceId, shuffle, repeatState) {
  const shUrl = new URL("https://api.spotify.com/v1/me/player/shuffle");
  shUrl.searchParams.set("state", shuffle ? "true" : "false");
  if (isNonEmptyString(deviceId)) shUrl.searchParams.set("device_id", deviceId);
  await spotifyFetch(shUrl.toString(), { method: "PUT" });

  const rpUrl = new URL("https://api.spotify.com/v1/me/player/repeat");
  rpUrl.searchParams.set("state", repeatState || "off");
  if (isNonEmptyString(deviceId)) rpUrl.searchParams.set("device_id", deviceId);
  await spotifyFetch(rpUrl.toString(), { method: "PUT" });

  await sleep(150);
}

// -------------------------
// Health
// -------------------------
app.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get("/api/debug/spotify", async (req, res) => {
  try {
    const token = await getAccessToken();
    const me = await spotifyFetch("https://api.spotify.com/v1/me");

    res.json({
      ok: true,
      tokenLoaded: !!token,
      me: {
        id: me?.id ?? null,
        display_name: me?.display_name ?? null,
        product: me?.product ?? null,
      },
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// debug bruto do player
app.get("/api/debug/player/devices-raw", async (req, res) => {
  try {
    const out = await spotifyRequest("https://api.spotify.com/v1/me/player/devices");
    return res.status(200).json({
      ok: out.ok,
      status: out.status,
      headers: out.headers,
      data: out.data,
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/debug/player/state-raw", async (req, res) => {
  try {
    const out = await spotifyRequest("https://api.spotify.com/v1/me/player");
    return res.status(200).json({
      ok: out.ok,
      status: out.status,
      headers: out.headers,
      data: out.data,
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/debug/player/currently-playing-raw", async (req, res) => {
  try {
    const out = await spotifyRequest("https://api.spotify.com/v1/me/player/currently-playing");
    return res.status(200).json({
      ok: out.ok,
      status: out.status,
      headers: out.headers,
      data: out.data,
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// ME
// -------------------------
app.get("/api/me", async (req, res) => {
  try {
    const data = await spotifyFetch("https://api.spotify.com/v1/me");
    res.json({ ok: true, me: data });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// SEARCH
// -------------------------
app.get("/api/search-track", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 5);
    const offset = parseOffset(req, 0);

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(q) +
      `&type=track&market=${encodeURIComponent(market)}&limit=${limit}&offset=${offset}`;

    const data = await spotifyFetch(url);

    const items = (data?.tracks?.items ?? [])
      .filter(Boolean)
      .map((t) => ({
        id: t?.id ?? "",
        name: t?.name ?? "",
        uri: t?.uri ?? "",
        artists: (t?.artists ?? []).map((a) => ({ name: a?.name ?? "" })).filter((a) => a.name),
        album: { name: t?.album?.name ?? "", images: t?.album?.images ?? [] },
      }))
      .filter((t) => t.id && t.uri);

    const page = pageFromBlock(data?.tracks, limit, offset);
    res.json({ ok: true, items, page });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/search-playlist", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 5);
    const offset = parseOffset(req, 0);

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(q) +
      `&type=playlist&market=${encodeURIComponent(market)}&limit=${limit}&offset=${offset}`;

    const data = await spotifyFetch(url);

    const items = (data?.playlists?.items ?? [])
      .filter(Boolean)
      .map((p) => ({
        id: p?.id ?? "",
        name: p?.name ?? "",
        uri: p?.uri ?? "",
        images: p?.images ?? [],
        owner: p?.owner ? { display_name: p.owner.display_name ?? "", id: p.owner.id ?? "" } : undefined,
        tracks: p?.tracks ?? null,
      }))
      .filter((p) => p.id && p.uri);

    const page = pageFromBlock(data?.playlists, limit, offset);
    res.json({ ok: true, items, page });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/search-artist", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const limit = parseSearchLimit(req, 5);
    const offset = parseOffset(req, 0);

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(q) +
      `&type=artist&limit=${limit}&offset=${offset}`;

    const data = await spotifyFetch(url);

    const items = (data?.artists?.items ?? [])
      .filter(Boolean)
      .map((a) => ({
        id: a?.id ?? "",
        name: a?.name ?? "",
        uri: a?.uri ?? "",
        images: a?.images ?? [],
        genres: a?.genres ?? [],
        popularity: a?.popularity ?? null,
      }))
      .filter((a) => a.id && a.uri);

    const artist = items.length ? { id: items[0].id, name: items[0].name, uri: items[0].uri } : null;

    const page = pageFromBlock(data?.artists, limit, offset);
    res.json({ ok: true, artist, items, page });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/search-album", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 5);
    const offset = parseOffset(req, 0);

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(q) +
      `&type=album&market=${encodeURIComponent(market)}&limit=${limit}&offset=${offset}`;

    const data = await spotifyFetch(url);

    const items = (data?.albums?.items ?? [])
      .filter(Boolean)
      .map((a) => ({
        id: a?.id ?? "",
        name: a?.name ?? "",
        uri: a?.uri ?? "",
        images: a?.images ?? [],
        release_date: String(a?.release_date ?? ""),
        total_tracks: a?.total_tracks ?? null,
        album_type: a?.album_type ?? null,
        external_urls: a?.external_urls ?? { spotify: "" },
        artists: (a?.artists ?? []).map((x) => ({ id: x?.id ?? "", name: x?.name ?? "" })).filter((x) => x.name),
      }))
      .filter((a) => a.id && a.uri);

    const page = pageFromBlock(data?.albums, limit, offset);
    res.json({ ok: true, items, page });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/artist-albums", async (req, res) => {
  try {
    const artistId = String(req.query.artistId ?? "").trim();
    if (!artistId) return res.status(400).json({ error: "missing artistId" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const include_groups = String(req.query.include_groups ?? "album,single").trim() || "album,single";

    const limit = clamp(toInt(req.query.limit, 10), 0, 10);
    const offset = Math.max(0, toInt(req.query.offset, 0));

    const url = new URL(`https://api.spotify.com/v1/artists/${encodeURIComponent(artistId)}/albums`);
    url.searchParams.set("include_groups", include_groups);
    url.searchParams.set("market", market);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const data = await spotifyFetch(url.toString());

    const items = (data?.items ?? [])
      .filter(Boolean)
      .map((a) => ({
        id: a?.id ?? "",
        name: a?.name ?? "",
        uri: a?.uri ?? "",
        release_date: String(a?.release_date ?? ""),
        images: a?.images ?? [],
        external_urls: a?.external_urls ?? { spotify: "" },
      }))
      .filter((a) => a.id && a.uri);

    const page = {
      limit: Number(data?.limit ?? limit),
      offset: Number(data?.offset ?? offset),
      total: typeof data?.total === "number" ? data.total : null,
      next: data?.next ?? null,
      previous: data?.previous ?? null,
    };

    res.json({ ok: true, items, page });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// MINHAS PLAYLISTS
// -------------------------
app.get("/api/me/playlists", async (req, res) => {
  try {
    const limit = clamp(toInt(req.query.limit, 50), 1, 50);
    const offset = Math.max(0, toInt(req.query.offset, 0));
    const all = String(req.query.all ?? "").trim() === "1";

    const fetchPage = async (off) => {
      const url = `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${off}`;
      const data = await spotifyFetch(url);

      const items = (data?.items ?? [])
        .filter(Boolean)
        .map((p) => ({
          id: p?.id ?? "",
          name: p?.name ?? "",
          uri: p?.uri ?? "",
          images: p?.images ?? [],
          owner: p?.owner ? { display_name: p.owner.display_name ?? "", id: p.owner.id ?? "" } : undefined,
          tracks: p?.tracks ?? null,
        }))
        .filter((p) => p.id && p.uri);

      return {
        items,
        next: data?.next ?? null,
        total: data?.total ?? null,
        limit: data?.limit ?? limit,
        offset: data?.offset ?? off,
      };
    };

    if (!all) {
      const page = await fetchPage(offset);
      return res.json({ ok: true, ...page });
    }

    let off = offset;
    let merged = [];
    let next = null;
    let total = null;

    for (let i = 0; i < 20; i++) {
      const page = await fetchPage(off);
      merged = merged.concat(page.items);
      next = page.next;
      total = page.total;
      if (!next) break;
      off += limit;
    }

    return res.json({ ok: true, items: merged, next, total, limit });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// PLAYLIST CRUD
// -------------------------
app.post("/api/playlists/create", async (req, res) => {
  try {
    const { name, description, isPublic } = req.body ?? {};
    const n = String(name ?? "").trim();
    if (!n) return res.status(400).json({ error: "missing name" });

    const body = {
      name: n,
      public: typeof isPublic === "boolean" ? isPublic : false,
      collaborative: false,
      description: typeof description === "string" ? String(description) : "",
    };

    const data = await spotifyFetch("https://api.spotify.com/v1/me/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    res.json({
      ok: true,
      playlist: {
        id: data?.id,
        name: data?.name,
        uri: data?.uri,
        external_urls: data?.external_urls ?? null,
        images: data?.images ?? [],
      },
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/playlists/:playlistId", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const market = String(req.query.market ?? "BR").trim() || "BR";

    const url = new URL(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`);
    if (market) url.searchParams.set("market", market);

    if (isNonEmptyString(req.query.fields)) url.searchParams.set("fields", String(req.query.fields));
    if (isNonEmptyString(req.query.additional_types)) {
      url.searchParams.set("additional_types", String(req.query.additional_types));
    }

    const data = await spotifyFetch(url.toString());
    res.json({ ok: true, playlist: data });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/playlists/:playlistId/details", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const { name, description, isPublic, collaborative } = req.body ?? {};
    const body = {};
    if (isNonEmptyString(name)) body.name = String(name).trim();
    if (typeof description === "string") body.description = String(description);
    if (typeof isPublic === "boolean") body.public = isPublic;
    if (typeof collaborative === "boolean") body.collaborative = collaborative;

    if (!Object.keys(body).length) {
      return res
        .status(400)
        .json({ error: "nothing to update. Send { name?, description?, isPublic?, collaborative? }" });
    }

    await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/playlists/:playlistId/items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const limit = clamp(toInt(req.query.limit, 50), 1, 50);
    const offset = Math.max(0, toInt(req.query.offset, 0));
    const market = String(req.query.market ?? "BR").trim() || "BR";

    const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&market=${encodeURIComponent(
      market
    )}`;
    const data = await spotifyFetch(url);

    res.json({ ok: true, data });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/playlists/:playlistId/items/all", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = 50;

    let offset = 0;
    let merged = [];
    let total = null;

    for (let guard = 0; guard < 200; guard++) {
      const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&market=${encodeURIComponent(
        market
      )}`;
      const data = await spotifyFetch(url);

      const items = data?.items ?? [];
      merged = merged.concat(items);

      total = data?.total ?? total;
      if (items.length < limit) break;

      offset += limit;
      await sleep(40);
    }

    res.json({ ok: true, total, count: merged.length, items: merged });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.post("/api/playlists/:playlistId/add-items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const { uris, position } = req.body ?? {};
    if (!Array.isArray(uris) || !uris.length) return res.status(400).json({ error: "missing uris[]" });

    const cleaned = uris.map(spotifyUrlToUri).map((u) => String(u).trim()).filter(Boolean);

    const chunks = [];
    for (let i = 0; i < cleaned.length; i += 100) chunks.push(cleaned.slice(i, i + 100));

    let added = 0;
    let lastSnapshot = null;

    const hasPos = Number.isInteger(position);
    let pos = hasPos ? Number(position) : null;

    for (const c of chunks) {
      const body = { uris: c };
      if (hasPos) body.position = pos;

      const data = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      added += c.length;
      lastSnapshot = data?.snapshot_id ?? lastSnapshot;

      if (hasPos) pos += c.length;
      await sleep(40);
    }

    res.json({ ok: true, added, snapshot_id: lastSnapshot });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.delete("/api/playlists/:playlistId/remove-items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const body = req.body ?? {};
    const snapshotInput = isNonEmptyString(body.snapshot_id) ? String(body.snapshot_id).trim() : null;

    let items = [];

    if (Array.isArray(body.items) && body.items.length) {
      items = body.items.map((it) => ({ uri: spotifyUrlToUri(it?.uri) })).filter((it) => isNonEmptyString(it.uri));
    } else if (Array.isArray(body.uris) && body.uris.length) {
      const cleaned = body.uris.map(spotifyUrlToUri).map((u) => String(u).trim()).filter(Boolean);
      items = cleaned.map((uri) => ({ uri }));
    } else {
      return res.status(400).json({ error: "missing uris[] OR items[]" });
    }

    items = items.filter((it) => {
      const u = String(it.uri);
      return u.startsWith("spotify:track:") || u.startsWith("spotify:episode:");
    });

    if (!items.length) return res.status(400).json({ error: "no valid spotify:track:/spotify:episode: URIs" });

    const chunks = [];
    for (let i = 0; i < items.length; i += 100) chunks.push(items.slice(i, i + 100));

    let removed = 0;
    let lastSnapshot = null;
    let snap = snapshotInput;

    for (const c of chunks) {
      const payload = { items: c };
      if (snap) payload.snapshot_id = snap;

      const data = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      removed += c.length;
      lastSnapshot = data?.snapshot_id ?? lastSnapshot;
      snap = data?.snapshot_id ?? snap;

      await sleep(40);
    }

    res.json({ ok: true, removed, snapshot_id: lastSnapshot });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/playlists/:playlistId/items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const body = req.body ?? {};

    if (Array.isArray(body.uris)) {
      const uris = body.uris.map(spotifyUrlToUri).map((u) => String(u).trim()).filter(Boolean);

      const first = uris.slice(0, 100);
      const rest = uris.slice(100);

      await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: first }),
      });

      let appendedAfterPut = 0;
      if (rest.length) {
        for (let i = 0; i < rest.length; i += 100) {
          const chunk = rest.slice(i, i + 100);
          await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uris: chunk }),
          });
          appendedAfterPut += chunk.length;
          await sleep(40);
        }
      }

      return res.json({ ok: true, mode: "replace", count: uris.length, appendedAfterPut });
    }

    const hasReorder = Number.isInteger(body.range_start) && Number.isInteger(body.insert_before);
    if (hasReorder) {
      const payload = {
        range_start: Number(body.range_start),
        insert_before: Number(body.insert_before),
      };
      if (Number.isInteger(body.range_length)) payload.range_length = Number(body.range_length);
      if (isNonEmptyString(body.snapshot_id)) payload.snapshot_id = String(body.snapshot_id).trim();

      const data = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return res.json({ ok: true, mode: "reorder", snapshot_id: data?.snapshot_id ?? null });
    }

    return res.status(400).json({
      error: "Envie { uris:[...] } para REPLACE OU { range_start, insert_before, range_length?, snapshot_id? } para REORDER.",
    });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/playlists/:playlistId/clear", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const allUris = [];
    let offset = 0;
    const limit = 50;

    for (let guard = 0; guard < 200; guard++) {
      const data = await spotifyFetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&market=BR`
      );

      const items = data?.items ?? [];
      for (const it of items) {
        const obj = it?.track ?? it?.episode ?? null;
        const uri = obj?.uri ?? "";
        if (String(uri).startsWith("spotify:track:") || String(uri).startsWith("spotify:episode:")) {
          allUris.push(uri);
        }
      }

      if (items.length < limit) break;
      offset += limit;
      await sleep(40);
    }

    if (!allUris.length) return res.json({ ok: true, removed: 0 });

    const chunks = [];
    for (let i = 0; i < allUris.length; i += 100) chunks.push(allUris.slice(i, i + 100));

    let removed = 0;
    let lastSnapshot = null;

    for (const c of chunks) {
      const data = await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: c.map((uri) => ({ uri })) }),
      });
      removed += c.length;
      lastSnapshot = data?.snapshot_id ?? lastSnapshot;
      await sleep(60);
    }

    res.json({ ok: true, removed, snapshot_id: lastSnapshot });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

async function tryFollowUnfollow({ playlistId, method }) {
  const playlistUri = playlistIdToUri(playlistId);

  try {
    await spotifyFetch(buildLibraryUrl([playlistUri]), { method });
    return { mode: "library" };
  } catch (e) {
    const status = Number(e?.status ?? 0);
    const msg = String(e?.message ?? "");
    if (status === 404 || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("unknown")) {
      if (method === "PUT") {
        await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public: false }),
        });
        return { mode: "followers" };
      }
      if (method === "DELETE") {
        await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, { method: "DELETE" });
        return { mode: "followers" };
      }
    }
    throw e;
  }
}

app.put("/api/playlists/:playlistId/follow", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });
    const r = await tryFollowUnfollow({ playlistId, method: "PUT" });
    res.json({ ok: true, ...r });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.delete("/api/playlists/:playlistId/unfollow", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });
    const r = await tryFollowUnfollow({ playlistId, method: "DELETE" });
    res.json({ ok: true, ...r });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// PLAYER (endurecido para produção)
// -------------------------
function sanitizeDevice(d) {
  return {
    id: d?.id ?? null,
    is_active: !!d?.is_active,
    is_private_session: !!d?.is_private_session,
    is_restricted: !!d?.is_restricted,
    name: d?.name ?? "",
    type: d?.type ?? "",
    volume_percent: typeof d?.volume_percent === "number" ? d.volume_percent : null,
    supports_volume: typeof d?.supports_volume === "boolean" ? d.supports_volume : null,
  };
}

function buildSyntheticDeviceFromPlaybackDevice(d) {
  if (!d || typeof d !== "object") return null;

  return sanitizeDevice({
    id: d?.id ?? null,
    is_active: typeof d?.is_active === "boolean" ? d.is_active : true,
    is_private_session: !!d?.is_private_session,
    is_restricted: !!d?.is_restricted,
    name: d?.name ?? "Dispositivo ativo",
    type: d?.type ?? "unknown",
    volume_percent: typeof d?.volume_percent === "number" ? d.volume_percent : null,
    supports_volume: typeof d?.supports_volume === "boolean" ? d.supports_volume : null,
  });
}

function dedupeDevices(devices) {
  const out = [];
  const seen = new Set();

  for (const d of devices ?? []) {
    if (!d) continue;

    const key =
      d?.id && String(d.id).trim()
        ? `id:${String(d.id).trim()}`
        : `name:${String(d?.name ?? "").trim().toLowerCase()}|type:${String(d?.type ?? "").trim().toLowerCase()}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }

  return out;
}

function isFreshCache(entry) {
  return !!entry?.ts && nowMs() - entry.ts <= PLAYER_CACHE_TTL_MS;
}

function isUsableStale(entry) {
  return !!entry?.ts && nowMs() - entry.ts <= PLAYER_STALE_TTL_MS;
}

const playerCaches = {
  devices: { ts: 0, value: null },
  state: { ts: 0, value: null },
};

let playerDevicesInFlight = null;
let playerStateInFlight = null;

const playerRateLimitState = {
  until: 0,
  reason: "",
};

const playerProbeCache = new Map();
const playerProbeInFlight = new Map();

function getPlayerProbeKey(url, init = {}) {
  return `${String(init?.method ?? "GET").toUpperCase()} ${String(url)}`;
}

function getPlayerRateLimitRemainingMs(url) {
  if (!isSpotifyPlayerUrl(url)) return 0;
  return Math.max(0, playerRateLimitState.until - nowMs());
}

function markPlayerRateLimit(url, headersLike, reason = "Spotify 429") {
  if (!isSpotifyPlayerUrl(url)) return 0;

  const ms = parseRetryAfterMs(headersLike, PLAYER_RATE_LIMIT_COOLDOWN_MS);
  const until = nowMs() + ms;

  if (until > playerRateLimitState.until) {
    playerRateLimitState.until = until;
    playerRateLimitState.reason = reason;
  }

  return ms;
}

function clearPlayerProbeCache() {
  playerProbeCache.clear();
}

function shouldPersistPlayerAggregateCache(result) {
  return !!result && !result.timedOut && !result.rateLimited;
}

async function spotifyPlayerProbe(url, init = {}, fallbackValue = null) {
  const key = getPlayerProbeKey(url, init);

  const cached = playerProbeCache.get(key);
  if (cached && nowMs() - cached.ts <= PLAYER_ENDPOINT_CACHE_TTL_MS) {
    return cached.value;
  }

  if (playerProbeInFlight.has(key)) {
    return playerProbeInFlight.get(key);
  }

  const run = (async () => {
    const cooldownMs = getPlayerRateLimitRemainingMs(url);
    if (cooldownMs > 0) {
      return {
        ok: false,
        status: 429,
        data: fallbackValue,
        headers: {},
        timedOut: false,
        rateLimited: true,
        error: `Player probe em cooldown local por ${cooldownMs}ms`,
      };
    }

    try {
      const out = await spotifyRequest(url, init, {
        timeoutMs: PLAYER_PROBE_TIMEOUT_MS,
        retryOn429: false,
      });

      if (out.status === 429) {
        markPlayerRateLimit(url, out.headers, "spotify-probe-429");
        return {
          ok: false,
          status: 429,
          data: fallbackValue,
          headers: out.headers ?? {},
          timedOut: false,
          rateLimited: true,
          error: "Spotify limitou temporariamente as consultas de player.",
        };
      }

      const normalized = {
        ...out,
        timedOut: false,
        rateLimited: false,
        error: null,
      };

      if (normalized.ok || normalized.status === 204) {
        playerProbeCache.set(key, {
          ts: nowMs(),
          value: normalized,
        });
      }

      return normalized;
    } catch (e) {
      console.log("[PLAYER PROBE FALLBACK]", url, e?.message ?? e);

      return {
        ok: false,
        status: Number(e?.status ?? 504),
        data: fallbackValue,
        headers: {},
        timedOut: Number(e?.status ?? 0) === 504,
        rateLimited: false,
        error: String(e?.message ?? e),
      };
    }
  })();

  playerProbeInFlight.set(key, run);

  try {
    return await run;
  } finally {
    playerProbeInFlight.delete(key);
  }
}

async function getPlayerDevicesRobustUncached() {
  const devicesRes = await spotifyPlayerProbe(
    "https://api.spotify.com/v1/me/player/devices",
    {},
    { devices: [] }
  );

  let playerRes = null;
  let currentRes = null;

  let devices = [];
  let fromPlayer = null;
  let fromCurrent = null;

  if (devicesRes.ok && Array.isArray(devicesRes.data?.devices)) {
    devices.push(...devicesRes.data.devices.map(sanitizeDevice));
  }

  if (!devices.length) {
    [playerRes, currentRes] = await Promise.all([
      spotifyPlayerProbe("https://api.spotify.com/v1/me/player", {}, null),
      spotifyPlayerProbe("https://api.spotify.com/v1/me/player/currently-playing", {}, null),
    ]);

    fromPlayer = buildSyntheticDeviceFromPlaybackDevice(playerRes?.data?.device);
    if (fromPlayer) devices.push(fromPlayer);

    fromCurrent = buildSyntheticDeviceFromPlaybackDevice(currentRes?.data?.device);
    if (fromCurrent) devices.push(fromCurrent);
  }

  devices = dedupeDevices(devices);

  const anyTimeout = [devicesRes, playerRes, currentRes].some((r) => !!r?.timedOut);
  const anyRateLimited = [devicesRes, playerRes, currentRes].some(
    (r) => !!r?.rateLimited || Number(r?.status ?? 0) === 429
  );

  return {
    ok: true,
    devices,
    count: devices.length,
    activeDeviceId: devices.find((d) => d.is_active)?.id ?? null,
    timedOut: anyTimeout,
    rateLimited: anyRateLimited,
    source:
      devices.length && devicesRes.ok && Array.isArray(devicesRes.data?.devices) && devicesRes.data.devices.length
        ? "devices"
        : devices.length && fromPlayer
        ? "player.device"
        : devices.length && fromCurrent
        ? "currently-playing.device"
        : anyRateLimited
        ? "rate-limited"
        : anyTimeout
        ? "timeout"
        : "none",
    apiStatus: {
      devices: devicesRes?.status ?? null,
      player: playerRes?.status ?? null,
      currentlyPlaying: currentRes?.status ?? null,
    },
    message: devices.length
      ? null
      : anyRateLimited
      ? "Spotify limitou temporariamente as consultas de devices/player. Resultado pode estar incompleto."
      : anyTimeout
      ? "Timeout ao consultar devices/player no Spotify. Resultado pode estar incompleto."
      : "Nenhum device retornado pelo Spotify neste momento. Isso pode acontecer mesmo com música tocando, dependendo do tipo/estado do device.",
  };
}

async function getPlaybackStateRobustUncached() {
  const playerRes = await spotifyPlayerProbe("https://api.spotify.com/v1/me/player", {}, null);

  let currentRes = null;

  if (!playerRes.ok || !playerRes.data) {
    currentRes = await spotifyPlayerProbe(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {},
      null
    );
  }

  const anyTimeout = [playerRes, currentRes].some((r) => !!r?.timedOut);
  const anyRateLimited = [playerRes, currentRes].some(
    (r) => !!r?.rateLimited || Number(r?.status ?? 0) === 429
  );

  if (playerRes.ok && playerRes.data) {
    return {
      ok: true,
      hasActivePlayback: true,
      player: playerRes.data,
      timedOut: anyTimeout,
      rateLimited: anyRateLimited,
      source: "player",
      apiStatus: {
        player: playerRes.status,
        currentlyPlaying: currentRes?.status ?? null,
      },
      message: null,
    };
  }

  if (currentRes?.ok && currentRes.data) {
    return {
      ok: true,
      hasActivePlayback: true,
      player: currentRes.data,
      timedOut: anyTimeout,
      rateLimited: anyRateLimited,
      source: "currently-playing",
      apiStatus: {
        player: playerRes.status,
        currentlyPlaying: currentRes.status,
      },
      message: null,
    };
  }

  return {
    ok: true,
    hasActivePlayback: false,
    player: null,
    timedOut: anyTimeout,
    rateLimited: anyRateLimited,
    source: anyRateLimited ? "rate-limited" : anyTimeout ? "timeout" : "none",
    apiStatus: {
      player: playerRes?.status ?? null,
      currentlyPlaying: currentRes?.status ?? null,
    },
    message: anyRateLimited
      ? "Spotify limitou temporariamente as consultas de player. Resultado pode estar incompleto."
      : anyTimeout
      ? "Timeout ao consultar o player do Spotify. Resultado pode estar incompleto."
      : "Nenhum player ativo no momento.",
  };
}

async function getPlayerDevicesRobustCached(force = false) {
  if (!force && isFreshCache(playerCaches.devices)) return playerCaches.devices.value;
  if (!force && playerDevicesInFlight) return playerDevicesInFlight;

  playerDevicesInFlight = (async () => {
    try {
      const result = await getPlayerDevicesRobustUncached();

      if (shouldPersistPlayerAggregateCache(result)) {
        playerCaches.devices = { ts: nowMs(), value: result };
        return result;
      }

      if (isUsableStale(playerCaches.devices)) {
        return {
          ...playerCaches.devices.value,
          timedOut: !!result?.timedOut,
          rateLimited: !!result?.rateLimited,
          source: result?.rateLimited
            ? "stale-cache(rate-limited)"
            : result?.timedOut
            ? "stale-cache(timeout)"
            : "stale-cache",
          message: result?.rateLimited
            ? "Spotify limitou temporariamente as consultas. Usando último resultado conhecido de devices."
            : result?.timedOut
            ? "Timeout atual ao consultar devices. Usando último resultado conhecido."
            : playerCaches.devices.value?.message ?? null,
        };
      }

      return result;
    } finally {
      playerDevicesInFlight = null;
    }
  })();

  return playerDevicesInFlight;
}

async function getPlaybackStateRobustCached(force = false) {
  if (!force && isFreshCache(playerCaches.state)) return playerCaches.state.value;
  if (!force && playerStateInFlight) return playerStateInFlight;

  playerStateInFlight = (async () => {
    try {
      const result = await getPlaybackStateRobustUncached();

      if (shouldPersistPlayerAggregateCache(result)) {
        playerCaches.state = { ts: nowMs(), value: result };
        return result;
      }

      if (isUsableStale(playerCaches.state)) {
        return {
          ...playerCaches.state.value,
          timedOut: !!result?.timedOut,
          rateLimited: !!result?.rateLimited,
          source: result?.rateLimited
            ? "stale-cache(rate-limited)"
            : result?.timedOut
            ? "stale-cache(timeout)"
            : "stale-cache",
          message: result?.rateLimited
            ? "Spotify limitou temporariamente as consultas. Usando último estado conhecido do player."
            : result?.timedOut
            ? "Timeout atual ao consultar o player. Usando último estado conhecido."
            : playerCaches.state.value?.message ?? null,
        };
      }

      return result;
    } finally {
      playerStateInFlight = null;
    }
  })();

  return playerStateInFlight;
}

function invalidatePlayerCaches() {
  playerCaches.devices.ts = 0;
  playerCaches.devices.value = null;
  playerCaches.state.ts = 0;
  playerCaches.state.value = null;
  clearPlayerProbeCache();
}

async function transferPlaybackToDevice(deviceId, play = false) {
  if (!isNonEmptyString(deviceId)) return;

  await spotifyFetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_ids: [String(deviceId)],
      play: !!play,
    }),
  });
}

async function ensureTargetDeviceReady(deviceId, { play = false, waitMs = 450 } = {}) {
  if (!isNonEmptyString(deviceId)) return;

  await transferPlaybackToDevice(String(deviceId), play);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  invalidatePlayerCaches();
}

app.get("/api/player/devices", async (req, res) => {
  console.log("[ROUTE] /api/player/devices:start");

  try {
    req.setTimeout?.(PLAYER_ROUTE_TIMEOUT_MS);
    res.setTimeout?.(PLAYER_ROUTE_TIMEOUT_MS);

    const result = await getPlayerDevicesRobustCached(false);

    console.log("[ROUTE] /api/player/devices:done", {
      count: result?.count ?? 0,
      source: result?.source ?? "none",
      timedOut: !!result?.timedOut,
      rateLimited: !!result?.rateLimited,
      statuses: result?.apiStatus ?? null,
    });

    return res.json(result);
  } catch (e) {
    console.log("[ROUTE] /api/player/devices:error", e?.message ?? e);

    if (isUsableStale(playerCaches.devices)) {
      return res.status(200).json({
        ...playerCaches.devices.value,
        timedOut: true,
        message: playerCaches.devices.value?.message ?? "Usando último resultado conhecido de devices.",
      });
    }

    return res.status(200).json({
      ok: true,
      devices: [],
      count: 0,
      activeDeviceId: null,
      timedOut: true,
      rateLimited: false,
      source: "error",
      apiStatus: null,
      message: "Falha ao consultar devices. Retornando fallback seguro.",
      error: String(e?.message ?? e),
    });
  }
});

app.get("/api/player/state", async (req, res) => {
  console.log("[ROUTE] /api/player/state:start");

  try {
    req.setTimeout?.(PLAYER_ROUTE_TIMEOUT_MS);
    res.setTimeout?.(PLAYER_ROUTE_TIMEOUT_MS);

    const result = await getPlaybackStateRobustCached(false);

    if (!result.hasActivePlayback) {
      const logType = result.rateLimited
        ? "rate-limited"
        : result.timedOut
        ? "timeout"
        : "no-active";

      console.log(`[ROUTE] /api/player/state:${logType}`, result.apiStatus);
      return res.json(result);
    }

    console.log("[ROUTE] /api/player/state:done", {
      source: result.source,
      timedOut: !!result.timedOut,
      rateLimited: !!result.rateLimited,
      statuses: result.apiStatus,
    });

    return res.json(result);
  } catch (e) {
    console.log("[ROUTE] /api/player/state:error", e?.message ?? e);

    if (isUsableStale(playerCaches.state)) {
      return res.status(200).json({
        ...playerCaches.state.value,
        timedOut: true,
        message: playerCaches.state.value?.message ?? "Usando último estado conhecido do player.",
      });
    }

    return res.status(200).json({
      ok: true,
      hasActivePlayback: false,
      player: null,
      timedOut: true,
      rateLimited: false,
      source: "error",
      apiStatus: null,
      message: "Falha ao consultar o player. Retornando fallback seguro.",
      error: String(e?.message ?? e),
    });
  }
});

app.put("/api/player/transfer", async (req, res) => {
  try {
    const { deviceId, play } = req.body ?? {};

    if (!isNonEmptyString(deviceId)) {
      return res.status(400).json({ error: "missing deviceId" });
    }

    await ensureTargetDeviceReady(String(deviceId), {
      play: !!play,
      waitMs: 500,
    });

    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/play-context", async (req, res) => {
  try {
    const { deviceId, contextUri, startFromBeginning, remember } = req.body ?? {};
    if (!isNonEmptyString(contextUri)) return res.status(400).json({ error: "missing contextUri" });

    const snap = await getPlaybackSnapshot().catch(() => null);
    if (snap && remember === true && isNonEmptyString(deviceId) && isNonEmptyString(snap.context_uri)) {
      saveCursor(String(deviceId), snap);
    }

    const ctx = spotifyUrlToUri(contextUri);
    const cursor = isNonEmptyString(deviceId) ? loadCursor(String(deviceId), ctx) : null;

    const payload =
      cursor && cursor.context_uri === ctx
        ? {
            context_uri: ctx,
            offset: cursor.item_uri ? { uri: cursor.item_uri } : undefined,
            position_ms: Math.max(0, Number(cursor.progress_ms ?? 0)),
          }
        : buildPlayPayloadFromUri(ctx, startFromBeginning !== false);

    if (!payload || !payload.context_uri) {
      return res.status(400).json({ error: "invalid contextUri" });
    }

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 500 });
    }

    const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(playUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    invalidatePlayerCaches();
    res.json({ ok: true, mode: cursor ? "resume_cursor" : "play" });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/play-uris", async (req, res) => {
  try {
    const { deviceId, uris } = req.body ?? {};
    if (!Array.isArray(uris) || !uris.length) return res.status(400).json({ error: "missing uris[]" });

    const cleaned = uris
      .map(spotifyUrlToUri)
      .map((u) => String(u).trim())
      .filter((u) => u.startsWith("spotify:track:"));

    if (!cleaned.length) return res.status(400).json({ error: "no valid spotify:track: uris" });

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 500 });
    }

    const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(playUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: cleaned, position_ms: 0 }),
    });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/pause", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/pause");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "PUT" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/resume", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 500 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "PUT" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.post("/api/player/next", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/next");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "POST" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.post("/api/player/previous", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/previous");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "POST" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/seek", async (req, res) => {
  try {
    const { deviceId, positionMs } = req.body ?? {};
    const pos = Number(positionMs);
    if (!Number.isFinite(pos) || pos < 0) return res.status(400).json({ error: "invalid positionMs" });

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/seek");
    url.searchParams.set("position_ms", String(Math.floor(pos)));
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(url.toString(), { method: "PUT" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/shuffle", async (req, res) => {
  try {
    const { deviceId, state } = req.body ?? {};
    const on = !!state;

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/shuffle");
    url.searchParams.set("state", on ? "true" : "false");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(url.toString(), { method: "PUT" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/repeat", async (req, res) => {
  try {
    const { deviceId, state } = req.body ?? {};
    const st = String(state ?? "off");
    if (!["off", "track", "context"].includes(st)) return res.status(400).json({ error: "invalid state" });

    if (isNonEmptyString(deviceId)) {
      await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 300 });
    }

    const url = new URL("https://api.spotify.com/v1/me/player/repeat");
    url.searchParams.set("state", st);
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(url.toString(), { method: "PUT" });

    invalidatePlayerCaches();
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

async function playFromSnapshot(deviceId, snap) {
  if (!snap) return;

  if (isNonEmptyString(deviceId)) {
    await ensureTargetDeviceReady(String(deviceId), { play: false, waitMs: 500 });
  }

  const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
  if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", deviceId);

  await setShuffleRepeat(deviceId, !!snap.shuffle_state, snap.repeat_state);

  const body = {};

  if (isNonEmptyString(snap.context_uri)) {
    body.context_uri = snap.context_uri;
    if (isNonEmptyString(snap.item_uri)) body.offset = { uri: snap.item_uri };
    body.position_ms = Math.max(0, Number(snap.progress_ms ?? 0));
  } else if (isNonEmptyString(snap.item_uri)) {
    body.uris = [snap.item_uri];
    body.position_ms = Math.max(0, Number(snap.progress_ms ?? 0));
  } else {
    return;
  }

  await spotifyFetch(playUrl.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  invalidatePlayerCaches();
}

// -------------------------
// SCHEDULE (mantido na lógica)
// -------------------------
function normalizeScheduleToItems(cfg) {
  if (cfg && Array.isArray(cfg.items)) return { base: cfg, items: cfg.items, legacy: false };
  return { base: cfg ?? {}, items: [], legacy: true };
}

app.get("/api/schedule", (req, res) => {
  try {
    const cfg = readJsonFile(SCHEDULE_PATH, { items: [] });
    const { items, legacy } = normalizeScheduleToItems(cfg);
    res.json({ ok: true, items, legacy });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.put("/api/schedule", (req, res) => {
  try {
    const body = req.body ?? {};
    const items = Array.isArray(body) ? body : body.items;

    if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: "Envie { items: [...] }" });

    const current = readJsonFile(SCHEDULE_PATH, {});
    const next = { ...(current ?? {}), items };
    writeJsonFile(SCHEDULE_PATH, next);

    res.json({ ok: true, count: items.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

let scheduledTasks = [];
const activeBreaks = new Map(); // deviceId -> guardId
const activeBreakTimers = new Map(); // deviceId -> timeoutId

function clearBreakTimers() {
  for (const t of activeBreakTimers.values()) {
    try {
      clearTimeout(t);
    } catch {}
  }
  activeBreakTimers.clear();
  activeBreaks.clear();
}

function clearScheduledJobs() {
  for (const t of scheduledTasks) {
    try {
      t.stop();
    } catch {}
  }
  scheduledTasks = [];
  clearBreakTimers();
}

function loadScheduleRaw() {
  return readJsonFile(SCHEDULE_PATH, {});
}

function resolveDevicesFrom(cfg, item) {
  if (isNonEmptyString(item?.deviceId)) return [item.deviceId];
  if (Array.isArray(item?.devices)) return item.devices.filter(isNonEmptyString);

  if (isNonEmptyString(cfg?.deviceId)) return [cfg.deviceId];
  if (Array.isArray(cfg?.devices)) return cfg.devices.filter(isNonEmptyString);

  return [];
}

function isCronValid(expr) {
  if (typeof cron.validate === "function") return cron.validate(expr);
  return String(expr ?? "").trim().split(/\s+/).length === 5;
}

async function shouldResumeBreak(deviceId, breakTargetUri, guardId) {
  if (!isNonEmptyString(deviceId)) return true;
  if (activeBreaks.get(deviceId) !== guardId) return false;

  const cur = await getPlaybackSnapshot().catch(() => null);
  if (!cur) return false;

  const target = spotifyUrlToUri(breakTargetUri);

  if (target.startsWith("spotify:track:") || target.startsWith("spotify:episode:")) {
    return cur.item_uri === target;
  }

  if (
    target.startsWith("spotify:playlist:") ||
    target.startsWith("spotify:album:") ||
    target.startsWith("spotify:artist:")
  ) {
    return cur.context_uri === target;
  }

  return false;
}

function scheduleJobs() {
  clearScheduledJobs();

  const cfg = loadScheduleRaw();
  if (!cfg || !Array.isArray(cfg.items)) {
    console.log("[SCHEDULE] items vazio. Nenhum job criado.");
    return;
  }

  let created = 0;

  for (const it of cfg.items) {
    const enabled = it?.enabled !== false;
    const expr = String(it?.cron ?? "").trim();
    const uriRaw = String(it?.uri ?? "").trim();

    if (!enabled) continue;
    if (!expr || !isCronValid(expr)) continue;
    if (!uriRaw) continue;

    const task = cron.schedule(
      expr,
      async () => {
        try {
          const currentCfg = loadScheduleRaw();
          const devices = resolveDevicesFrom(currentCfg, it);
          const mode = String(it?.mode ?? "switch").trim();

          const runOnDevice = async (deviceIdOrNull) => {
            const deviceId = isNonEmptyString(deviceIdOrNull) ? String(deviceIdOrNull) : "";

            const targetUri = spotifyUrlToUri(uriRaw);
            const shuffle = typeof it?.shuffle === "boolean" ? it.shuffle : false;

            const repeatState =
              typeof it?.repeat === "string" && ["off", "track", "context"].includes(it.repeat)
                ? it.repeat
                : mode === "break"
                ? "off"
                : "context";

            const remember = it?.remember !== false;
            const resume = it?.resume === true;
            const startFromBeginning = it?.startFromBeginning !== false;

            const before = await getPlaybackSnapshot().catch(() => null);
            if (before && remember && isNonEmptyString(deviceId) && isNonEmptyString(before.context_uri)) {
              saveCursor(deviceId, before);
            }

            if (mode === "switch") {
              let payload = null;
              const cursor = isNonEmptyString(deviceId) ? loadCursor(deviceId, targetUri) : null;

              if (cursor && cursor.context_uri === targetUri) {
                payload = {
                  context_uri: targetUri,
                  offset: cursor.item_uri ? { uri: cursor.item_uri } : undefined,
                  position_ms: Math.max(0, Number(cursor.progress_ms ?? 0)),
                };
              } else {
                payload = buildPlayPayloadFromUri(targetUri, startFromBeginning);
              }

              if (!payload) return;

              const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
              if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", deviceId);

              await spotifyFetch(playUrl.toString(), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });

              await setShuffleRepeat(deviceId, shuffle, repeatState);
              invalidatePlayerCaches();
              return;
            }

            const payload = buildPlayPayloadFromUri(targetUri, true);
            if (!payload) return;

            const guardId = crypto.randomBytes(8).toString("hex");
            if (isNonEmptyString(deviceId)) activeBreaks.set(deviceId, guardId);

            const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
            if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", deviceId);

            await spotifyFetch(playUrl.toString(), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

            await setShuffleRepeat(deviceId, shuffle, repeatState);
            invalidatePlayerCaches();

            if (!resume || !before) return;

            let ms = Number(it?.resumeAfterMs ?? 0);

            if (!Number.isFinite(ms) || ms <= 0) {
              await sleep(250);
              const after = await getPlaybackSnapshot().catch(() => null);
              if (after?.item_duration_ms && typeof after.progress_ms === "number") {
                const remaining = Math.max(1500, after.item_duration_ms - after.progress_ms);
                ms = remaining + 650;
              } else {
                ms = 30000;
              }
            }

            const t = setTimeout(async () => {
              try {
                const ok = await shouldResumeBreak(deviceId, targetUri, guardId);
                if (!ok) return;

                if (isNonEmptyString(deviceId)) {
                  activeBreaks.delete(deviceId);
                  activeBreakTimers.delete(deviceId);
                }

                await playFromSnapshot(deviceId, before);
              } catch (e) {
                console.log("[BREAK RESUME ERROR]", String(e?.message ?? e));
              }
            }, ms);

            if (isNonEmptyString(deviceId)) activeBreakTimers.set(deviceId, t);
          };

          if (devices.length) {
            for (const d of devices) await runOnDevice(d);
          } else {
            await runOnDevice(null);
          }

          console.log("[SCHEDULE] tocou:", it?.title ?? it?.id ?? "item", "mode=", mode);
        } catch (e) {
          console.log("[SCHEDULE ERROR]", String(e?.message ?? e));
        }
      },
      { timezone: SCHEDULE_TZ }
    );

    scheduledTasks.push(task);
    created++;
  }

  console.log("[SCHEDULE] jobs criados:", created);
}

app.post("/api/schedule/reload", (req, res) => {
  scheduleJobs();
  res.json({ ok: true, tasks: scheduledTasks.length });
});

scheduleJobs();

// -------------------------
// IA: Playlist preview/create (OpenAI Responses API)
// -------------------------
function requireOpenAI() {
  if (!OPENAI_API_KEY) {
    const err = new Error("OPENAI_API_KEY não configurada no backend.");
    err.status = 400;
    throw err;
  }
}

function extractOutputText(resp) {
  if (typeof resp?.output_text === "string") return resp.output_text;

  try {
    const out = resp?.output;
    if (Array.isArray(out)) {
      for (const o of out) {
        const content = o?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            const t = c?.text;
            if (typeof t === "string" && t.trim()) return t;
            const t2 = c?.output_text;
            if (typeof t2 === "string" && t2.trim()) return t2;
          }
        }
      }
    }
  } catch {}
  return "";
}

async function openaiCall(body) {
  let res;
  try {
    res = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error(
      isAbortError(e)
        ? "Timeout ao chamar OpenAI"
        : `Falha de rede ao chamar OpenAI: ${toErrorMessage(e)}`
    );
    err.status = 504;
    throw err;
  }

  const text = await readResponseTextWithTimeout(res, FETCH_TIMEOUT_MS, "body OpenAI");
  const data = safeJsonParse(text);

  if (!res.ok) {
    const msg = data?.error?.message ?? "Erro OpenAI";
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

async function openaiGeneratePlan({ prompt, count }) {
  requireOpenAI();

  const n = Math.min(100, Math.max(5, Number(count ?? 25)));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      tracks: {
        type: "array",
        minItems: n,
        maxItems: n,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    },
    required: ["name", "description", "tracks"],
  };

  const instructions = `
Você é um criador de playlists do Spotify.
Gere exatamente ${n} faixas.
Cada item deve ter "query" no formato: "musica - artista".
Não repita músicas.
`.trim();

  const body = {
    model: OPENAI_MODEL,
    instructions,
    input: String(prompt ?? "").trim(),
    reasoning: { effort: "low" },
    max_output_tokens: 4000,
    text: {
      format: {
        type: "json_schema",
        name: "playlist_plan",
        schema,
        strict: true,
      },
    },
  };

  const data = await openaiCall(body);

  const raw = String(extractOutputText(data) ?? "").trim();
  const plan = safeJsonParse(raw);

  if (!plan || plan.raw) {
    const err = new Error("OpenAI não retornou JSON válido (texto vazio ou inválido).");
    err.status = 500;
    err.data = { raw };
    throw err;
  }

  return plan;
}

async function resolveTrackQueriesToUris(queries, market = "BR") {
  const uris = [];
  const picked = [];
  const seen = new Set();

  for (const q of queries) {
    const term = String(q ?? "").trim();
    if (!term) continue;

    const url =
      "https://api.spotify.com/v1/search?q=" +
      encodeURIComponent(term) +
      `&type=track&market=${encodeURIComponent(market)}&limit=10&offset=0`;

    const data = await spotifyFetch(url);
    const t = data?.tracks?.items?.filter(Boolean)?.[0];

    if (t?.uri && !seen.has(t.uri)) {
      seen.add(t.uri);
      uris.push(t.uri);
      picked.push({
        query: term,
        track: {
          id: t.id,
          name: t.name,
          uri: t.uri,
          artists: (t.artists ?? []).map((a) => ({ name: a.name })),
          album: { name: t.album?.name ?? "", images: t.album?.images ?? [] },
        },
      });
    } else {
      picked.push({ query: term, track: null });
    }

    await sleep(70);
  }

  return { uris, picked };
}

app.post("/api/ai/playlist/preview", async (req, res) => {
  try {
    const { prompt, count, market } = req.body ?? {};
    const p = String(prompt ?? "").trim();
    if (!p) return res.status(400).json({ error: "missing prompt" });

    const mk = String(market ?? "BR").trim() || "BR";

    const plan = await openaiGeneratePlan({ prompt: p, count });
    const queries = (plan?.tracks ?? []).map((t) => t?.query).filter(Boolean);

    const resolved = await resolveTrackQueriesToUris(queries, mk);

    res.json({
      ok: true,
      plan: {
        name: String(plan?.name ?? "Playlist IA").trim(),
        description: String(plan?.description ?? "").trim(),
      },
      resolved,
    });
  } catch (e) {
    const status = Number(e?.status ?? 500);
    res.status(status).json({ error: String(e?.message ?? e), raw: e?.data ?? null });
  }
});

app.post("/api/ai/playlist/create", async (req, res) => {
  try {
    const { prompt, count, market, isPublic } = req.body ?? {};
    const p = String(prompt ?? "").trim();
    if (!p) return res.status(400).json({ error: "missing prompt" });

    const mk = String(market ?? "BR").trim() || "BR";

    const plan = await openaiGeneratePlan({ prompt: p, count });
    const queries = (plan?.tracks ?? []).map((t) => t?.query).filter(Boolean);
    const resolved = await resolveTrackQueriesToUris(queries, mk);

    if (!resolved.uris.length) {
      return res.status(422).json({
        error: "IA não conseguiu resolver faixas no Spotify (0 músicas). Tente um prompt mais específico.",
        raw: { plan, resolved },
      });
    }

    const created = await spotifyFetch("https://api.spotify.com/v1/me/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(plan?.name ?? "Playlist IA").trim(),
        public: typeof isPublic === "boolean" ? isPublic : false,
        collaborative: false,
        description: String(plan?.description ?? "").trim(),
      }),
    });

    const playlistId = created?.id;
    if (!playlistId) return res.status(500).json({ error: "Falha ao criar playlist (sem id retornado)" });

    const chunks = [];
    for (let i = 0; i < resolved.uris.length; i += 100) chunks.push(resolved.uris.slice(i, i + 100));

    for (const c of chunks) {
      await spotifyFetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: c }),
      });
      await sleep(70);
    }

    res.json({
      ok: true,
      playlist: {
        id: created?.id,
        name: created?.name,
        uri: created?.uri,
        external_urls: created?.external_urls ?? null,
        images: created?.images ?? [],
      },
      added: resolved.uris.length,
      resolved,
    });
  } catch (e) {
    const status = Number(e?.status ?? 500);
    res.status(status).json({ error: String(e?.message ?? e), raw: e?.data ?? null });
  }
});

// -------------------------
app.listen(PORT, () => console.log("API on port", PORT));

// Ajuda a enxergar crashes em produção/dev
process.on("unhandledRejection", (reason) => {
  console.log("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.log("[uncaughtException]", err);
});