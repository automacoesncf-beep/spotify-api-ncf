// server/index.js
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

const SPOTIFY_REDIRECT_URI = String(
  process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3001/auth/callback"
).trim();

// IA (opcional)
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY ?? "").trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL ?? "gpt-5").trim();

// CORS
// - Se CORS_ORIGIN estiver setado: usa o que você definiu
// - Se NÃO estiver setado e estiver em dev: libera (evita erro no Vite/localhost)
const CORS_ORIGIN = String(process.env.CORS_ORIGIN ?? "").trim();
const NODE_ENV = String(process.env.NODE_ENV ?? "development").trim();

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
  console.log("[BOOT] SCHEDULE_TZ =", SCHEDULE_TZ);
  console.log("[BOOT] OPENAI_API_KEY =", OPENAI_API_KEY ? "OK" : "(vazio)");
  console.log("[BOOT] OPENAI_MODEL =", OPENAI_MODEL);
  console.log("[BOOT] CORS_ORIGIN =", CORS_ORIGIN || "(dev: origin=true)");
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

// Spotify Search (Feb/2026): limit tem range 0–10 (default 5). Então capamos em 10.
function parseSearchLimit(req, fallback = 10) {
  const raw = req.query.limit;
  const n = toInt(raw, fallback);
  return clamp(n, 0, 10);
}

// Offset do /search tem limites práticos (e docs apontam range/limites).
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
    } catch { }
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
  } catch { }
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

// garante arquivos
ensureFile(TOKENS_PATH, "{}");
ensureFile(SCHEDULE_PATH, JSON.stringify({ items: [] }, null, 2));

// favicon
app.get("/favicon.ico", (req, res) => res.status(204).end());

// -------------------------
// Cookies (state OAuth)
// -------------------------
function setCookie(res, name, value) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`);
}
function clearCookie(res, name) {
  res.setHeader(
    "Set-Cookie",
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

    const tokens = readJsonFile(TOKENS_PATH, {});
    if (isNonEmptyString(tokenData?.refresh_token)) tokens.refresh_token = tokenData.refresh_token;

    tokens.scope = tokenData?.scope ?? tokens.scope ?? null;
    tokens.updated_at = new Date().toISOString();
    writeJsonFile(TOKENS_PATH, tokens);

    res.send("Conectado! tokens.json atualizado. Pode fechar esta página.");
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
// Spotify token cache
// -------------------------
let accessToken = "";
let accessTokenExp = 0;
let refreshingPromise = null;

function getRefreshTokenOrThrow() {
  const tokens = readJsonFile(TOKENS_PATH, {});
  const rt = tokens.refresh_token;
  if (!isNonEmptyString(rt)) throw new Error("Sem refresh_token. Acesse /auth/login para conectar.");
  return rt;
}

async function refreshAccessToken() {
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

  if (!res.ok) {
    const err = new Error(data?.error_description ?? "Erro ao refresh token");
    err.status = res.status;
    err.data = data;
    throw err;
  }

  accessToken = data.access_token;
  const expiresIn = Number(data.expires_in ?? 3600);
  accessTokenExp = Date.now() + (expiresIn - 60) * 1000;
  return accessToken;
}

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExp) return accessToken;
  if (!refreshingPromise) refreshingPromise = refreshAccessToken().finally(() => (refreshingPromise = null));
  return refreshingPromise;
}

// ✅ Melhorado: retry 1x se pegar 401 (token inválido/expirou de verdade)
async function spotifyFetch(url, init = {}, _retried = false) {
  const token = await getAccessToken();

  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    const err = new Error(e?.message ? String(e.message) : "fetch failed");
    err.status = 500;
    err.data = null;
    throw err;
  }

  if (res.status === 401 && !_retried) {
    try {
      // força refresh e repete uma vez
      accessToken = "";
      accessTokenExp = 0;
      refreshingPromise = null;
      await refreshAccessToken();
      return spotifyFetch(url, init, true);
    } catch {
      // se falhar, cai no tratamento normal abaixo
    }
  }

  if (res.status === 204) return null;

  const text = await res.text();
  const data = safeJsonParse(text);

  if (!res.ok) {
    const status = data?.error?.status ?? res.status;
    const message = data?.error?.message ?? data?.error_description ?? "Erro Spotify";
    const err = new Error(message);
    err.status = status;
    err.data = data;
    throw err;
  }

  return data;
}

function sendSpotifyError(res, err) {
  const status = Number(err?.status ?? 500);
  const msg = String(err?.message ?? err ?? "");
  const data = err?.data ?? null;

  if (msg.includes("Sem refresh_token")) return res.status(401).json({ error: msg, raw: data });

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

// “novidade”/compat: alguns setups usam /me/library?uris=...
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

  if (u.startsWith("spotify:track:")) return withPos({ uris: [u] });

  if (u.startsWith("spotify:album:") || u.startsWith("spotify:playlist:") || u.startsWith("spotify:artist:")) {
    return withPos({ context_uri: u });
  }

  return null;
}

// -------------------------
// Health
// -------------------------
app.get("/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

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
// SEARCH (Track / Playlist / Artist / Album) + Artist Albums
// -------------------------

// TRACK
app.get("/api/search-track", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 10);
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

// PLAYLIST
app.get("/api/search-playlist", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 10);
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

// ARTIST
app.get("/api/search-artist", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const limit = parseSearchLimit(req, 10);
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

// ALBUM (busca direta por nome)
app.get("/api/search-album", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const limit = parseSearchLimit(req, 10);
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
        release_date: String(a?.release_date ?? ""), // ✅ sempre string (evita quebra no TS/front)
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

// ARTIST ALBUMS (pra aba "Álbuns" do seu Search.tsx)
app.get("/api/artist-albums", async (req, res) => {
  try {
    const artistId = String(req.query.artistId ?? "").trim();
    if (!artistId) return res.status(400).json({ error: "missing artistId" });

    const market = String(req.query.market ?? "BR").trim() || "BR";
    const include_groups = String(req.query.include_groups ?? "album,single").trim() || "album,single";

    // aqui NÃO é /search — pode ser maior; mas ainda assim blindamos
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
// MINHAS PLAYLISTS (GET /me/playlists)
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

// CREATE
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

// READ playlist detalhes
app.get("/api/playlists/:playlistId", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const market = String(req.query.market ?? "BR").trim() || "BR";

    const url = new URL(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}`);
    if (market) url.searchParams.set("market", market);

    if (isNonEmptyString(req.query.fields)) url.searchParams.set("fields", String(req.query.fields));
    if (isNonEmptyString(req.query.additional_types)) url.searchParams.set("additional_types", String(req.query.additional_types));

    const data = await spotifyFetch(url.toString());
    res.json({ ok: true, playlist: data });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// UPDATE playlist detalhes
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
      return res.status(400).json({ error: "nothing to update. Send { name?, description?, isPublic?, collaborative? }" });
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

// LIST playlist items
app.get("/api/playlists/:playlistId/items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const limit = clamp(toInt(req.query.limit, 50), 1, 50);
    const offset = Math.max(0, toInt(req.query.offset, 0));
    const market = String(req.query.market ?? "BR").trim() || "BR";

    const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&market=${encodeURIComponent(market)}`;
    const data = await spotifyFetch(url);

    res.json({ ok: true, data });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// LIST ALL items
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
      const url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&market=${encodeURIComponent(market)}`;
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

// ADD items (position opcional)
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

// REMOVE items (uris[] OU items[] + snapshot_id opcional)
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

// UPDATE playlist items — REORDER ou REPLACE
app.put("/api/playlists/:playlistId/items", async (req, res) => {
  try {
    const playlistId = String(req.params.playlistId ?? "").trim();
    if (!playlistId) return res.status(400).json({ error: "missing playlistId" });

    const body = req.body ?? {};

    // REPLACE: { uris:[...] }
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

    // REORDER: { range_start, insert_before, range_length?, snapshot_id? }
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

// CLEAR playlist (remove track+episode)
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

// FOLLOW/UNFOLLOW (mantém suas rotas; tenta /me/library e, se não existir, tenta /followers)
async function tryFollowUnfollow({ playlistId, method }) {
  const playlistUri = playlistIdToUri(playlistId);

  // 1) tenta “library”
  try {
    await spotifyFetch(buildLibraryUrl([playlistUri]), { method });
    return { mode: "library" };
  } catch (e) {
    // se der 404/unsupported, tenta followers
    const status = Number(e?.status ?? 0);
    const msg = String(e?.message ?? "");
    if (status === 404 || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("unknown")) {
      // followers
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
// PLAYER (devices/state + controles usados pelo Reproduction.tsx)
// -------------------------
app.get("/api/player/devices", async (req, res) => {
  try {
    const data = await spotifyFetch("https://api.spotify.com/v1/me/player/devices");
    res.json(data ?? { devices: [] });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.get("/api/player/state", async (req, res) => {
  try {
    const data = await spotifyFetch("https://api.spotify.com/v1/me/player");
    res.json(data ?? null);
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/play-context", async (req, res) => {
  try {
    const { deviceId, contextUri } = req.body ?? {};
    if (!isNonEmptyString(contextUri)) return res.status(400).json({ error: "missing contextUri" });

    const payload = buildPlayPayloadFromUri(contextUri, true);
    if (!payload || !payload.context_uri) return res.status(400).json({ error: "invalid contextUri" });

    const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(playUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    res.json({ ok: true });
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

    const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) playUrl.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(playUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: cleaned, position_ms: 0 }),
    });

    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/pause", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/pause");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/resume", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/play");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.post("/api/player/next", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/next");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "POST" });
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.post("/api/player/previous", async (req, res) => {
  try {
    const { deviceId } = req.body ?? {};
    const url = new URL("https://api.spotify.com/v1/me/player/previous");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));
    await spotifyFetch(url.toString(), { method: "POST" });
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

    const url = new URL("https://api.spotify.com/v1/me/player/seek");
    url.searchParams.set("position_ms", String(Math.floor(pos)));
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

app.put("/api/player/shuffle", async (req, res) => {
  try {
    const { deviceId, state } = req.body ?? {};
    const on = !!state;

    const url = new URL("https://api.spotify.com/v1/me/player/shuffle");
    url.searchParams.set("state", on ? "true" : "false");
    if (isNonEmptyString(deviceId)) url.searchParams.set("device_id", String(deviceId));

    await spotifyFetch(url.toString(), { method: "PUT" });
    res.json({ ok: true });
  } catch (e) {
    return sendSpotifyError(res, e);
  }
});

// -------------------------
// SCHEDULE
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

function clearScheduledJobs() {
  for (const t of scheduledTasks) {
    try {
      t.stop();
    } catch { }
  }
  scheduledTasks = [];
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
    const uri = String(it?.uri ?? "").trim();

    if (!enabled) continue;
    if (!expr || !isCronValid(expr)) continue;

    const shuffle = typeof it?.shuffle === "boolean" ? it.shuffle : false;
    const startFromBeginning = it?.startFromBeginning !== false;

    const payload = buildPlayPayloadFromUri(uri, startFromBeginning);
    if (!payload) continue;

    const task = cron.schedule(
      expr,
      async () => {
        try {
          const current = loadScheduleRaw();
          const devices = resolveDevicesFrom(current, it);

          const runOnDevice = async (deviceIdOrNull) => {
            const shUrl = new URL("https://api.spotify.com/v1/me/player/shuffle");
            shUrl.searchParams.set("state", shuffle ? "true" : "false");
            if (isNonEmptyString(deviceIdOrNull)) shUrl.searchParams.set("device_id", deviceIdOrNull);
            await spotifyFetch(shUrl.toString(), { method: "PUT" });

            const playUrl = new URL("https://api.spotify.com/v1/me/player/play");
            if (isNonEmptyString(deviceIdOrNull)) playUrl.searchParams.set("device_id", deviceIdOrNull);

            await spotifyFetch(playUrl.toString(), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
          };

          if (devices.length) for (const d of devices) await runOnDevice(d);
          else await runOnDevice(null);

          console.log("[SCHEDULE] tocou:", it?.title ?? it?.id ?? "item");
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
  } catch { }
  return "";
}

async function openaiCall(body) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
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

  const bodyNew = {
    model: OPENAI_MODEL,
    // ✅ melhor separar instruções (system) do prompt (user)
    instructions,
    input: [{ role: "user", content: String(prompt ?? "").trim() }],

    reasoning: { effort: "low" },

    // ✅ aumenta pra não truncar / não “morrer” no reasoning
    max_output_tokens: 13000,

    text: {
      format: {
        type: "json_schema",
        name: "playlist_plan",
        schema,
        strict: true,
      },
    },
  };
  let data;
  try {
    data = await openaiCall(bodyNew);
  } catch (e) {
    const msg = String(e?.message ?? "");
    const status = Number(e?.status ?? 0);
    if (status === 400 && msg.includes("text.format")) throw e;

    const bodyOld = {
      model: OPENAI_MODEL,
      input: `${instructions}\n\nPROMPT DO USUÁRIO:\n${String(prompt ?? "").trim()}`,
      max_output_tokens: 1200,
      response_format: {
        type: "json_schema",
        json_schema: { name: "playlist_plan", schema, strict: true },
      },
    };

    data = await openaiCall(bodyOld);
  }

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

// Preview (POST)
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

// Create (POST)
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