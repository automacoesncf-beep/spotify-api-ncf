// src/features/reproduction/api/radioApi.ts
import type {
  SpotifyAlbum,
  SpotifyDevice,
  SpotifyPlaybackState,
  SpotifyTrack,
  SpotifyPlaylist,
  ScheduleItem,
  ApiOkResponse,
  ApiReloadScheduleResponse,
  ApiPage,
  ApiListResponse,
} from "./types";

// ✅ Preferir same-origin (nginx proxy /api) e permitir override via .env
// Ex.: VITE_API_BASE=http://127.0.0.1:3001
const API_BASE = (((import.meta as any).env?.VITE_API_BASE ?? "") as string).replace(/\/$/, "");

function buildUrl(path: string) {
  if (!path.startsWith("/")) path = `/${path}`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildUrl(path), {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  const text = await res.text();

  // nem sempre o backend devolve JSON
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data as T;
}

// -------------------------
// Query helpers
// -------------------------
const SEARCH_LIMIT_MAX = 10;

function clampInt(n: unknown, fallback: number) {
  const v = Number.parseInt(String(n ?? ""), 10);
  return Number.isFinite(v) ? v : fallback;
}

function clampSearchLimit(limit?: number, fallback = SEARCH_LIMIT_MAX) {
  const n = clampInt(limit, fallback);
  return Math.max(0, Math.min(SEARCH_LIMIT_MAX, n));
}

function clampOffset(offset?: number, fallback = 0) {
  const n = clampInt(offset, fallback);
  return Math.max(0, n);
}

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v);
    if (!s) return;
    sp.set(k, s);
  });
  const q = sp.toString();
  return q ? `?${q}` : "";
}

// -------------------------
// Search
// -------------------------

// ARTIST (search)
export function apiSearchArtist(q: string, opts?: { limit?: number; offset?: number }) {
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<{
    ok: true;
    artist: { id: string; name?: string; uri?: string } | null;
    items?: any[];
    page?: ApiPage;
  }>(`/api/search-artist${qs({ q, limit, offset })}`);
}

// ARTIST ALBUMS (artists/{id}/albums) — pós Fev/2026: limit também 0–10
export function apiGetArtistAlbums(
  artistId: string,
  opts?: { market?: string; include_groups?: string; limit?: number; offset?: number }
) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const include_groups = (opts?.include_groups ?? "album").trim() || "album";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyAlbum>>(
    `/api/artist-albums${qs({ artistId, market, include_groups, limit, offset })}`
  );
}

// TRACK (search)
export function apiSearchTrack(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyTrack>>(`/api/search-track${qs({ q, market, limit, offset })}`);
}

// PLAYLIST (search)
export function apiSearchPlaylist(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyPlaylist>>(`/api/search-playlist${qs({ q, market, limit, offset })}`);
}

// ALBUM (search)
export function apiSearchAlbum(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyAlbum>>(`/api/search-album${qs({ q, market, limit, offset })}`);
}

// -------------------------
// Player
// -------------------------
export function apiGetDevices() {
  return apiJson<{ devices: SpotifyDevice[] }>(`/api/player/devices`);
}

export function apiGetPlaybackState() {
  return apiJson<SpotifyPlaybackState | null>(`/api/player/state`);
}

export function apiPlayContext(deviceId: string, contextUri: string) {
  return apiJson<ApiOkResponse>(`/api/player/play-context`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, contextUri }),
  });
}

export function apiPlayUris(deviceId: string, uris: string[]) {
  return apiJson<ApiOkResponse>(`/api/player/play-uris`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, uris }),
  });
}

export function apiPause(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/pause`, {
    method: "PUT",
    body: JSON.stringify({ deviceId }),
  });
}

export function apiResume(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/resume`, {
    method: "PUT",
    body: JSON.stringify({ deviceId }),
  });
}

export function apiNext(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/next`, {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
}

export function apiPrevious(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/previous`, {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
}

export function apiSeek(deviceId: string, positionMs: number) {
  return apiJson<ApiOkResponse>(`/api/player/seek`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, positionMs }),
  });
}

// -------------------------
// Schedule
// -------------------------
export function apiReloadSchedule() {
  return apiJson<ApiReloadScheduleResponse>(`/api/schedule/reload`, { method: "POST" });
}

export function apiGetSchedule() {
  return apiJson<{ ok: true; items: ScheduleItem[] }>(`/api/schedule`);
}

export function apiSaveSchedule(items: ScheduleItem[]) {
  return apiJson<{ ok: true; count: number }>(`/api/schedule`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}