// src/features/schadule/api/scheduleApi.ts

export type SpotifyImage = { url: string; height?: number | null; width?: number | null };

export type SpotifyTrackLite = {
  id: string;
  name: string;
  uri: string;
  artists: { name: string }[];
  album: { name: string; images: SpotifyImage[] };
};

export type SpotifyPlaylistLite = {
  id: string;
  name: string;
  uri: string;
  images: SpotifyImage[];
  owner?: { display_name?: string; id?: string };
  tracks?: any;
};

export type SpotifyAlbumLite = {
  id: string;
  name: string;
  uri: string;
  release_date?: string;
  images: SpotifyImage[];
  external_urls?: { spotify?: string };
};

export type PageInfo = {
  limit: number;
  offset: number;
  total: number | null;
  next: string | null;
  previous: string | null;
};

export type RepeatMode = "off" | "track" | "context";

/**
 * ✅ Novo modelo “rádio”
 * - mode="switch": troca o “programa” (playlist/album/artist) e tenta continuar do cursor salvo
 * - mode="break": vinheta/propaganda (track/playlist curta) e depois volta pro ponto exato (se resume=true)
 */
export type ScheduleMode = "switch" | "break";

export type ScheduleItem = {
  id: string;
  cron: string; // "15 8 * * *"
  uri: string;  // spotify:track/... spotify:album/... spotify:playlist:... (ou URL se backend converte)

  title?: string;
  enabled?: boolean;

  // ✅ qualidade de vida (UI)
  kind?: "playlist" | "track" | "album" | "artist" | "episode";
  imageUrl?: string;
  subtitle?: string;

  // ✅ opções do scheduler (legacy)
  shuffle?: boolean;
  startFromBeginning?: boolean;

  // ✅ opções do scheduler (rádio completo - A/B/C)
  mode?: ScheduleMode;        // "switch" | "break"
  remember?: boolean;         // salva cursor do que estava tocando (default true no backend)
  resume?: boolean;           // só no mode="break": volta pro ponto exato
  resumeAfterMs?: number;     // opcional: força voltar após X ms (ex: 90000)
  repeat?: RepeatMode;        // "off" | "track" | "context"
};

/** Debug do rádio (estado persistido no backend) */
export type RadioState = {
  devices: Record<
    string,
    {
      cursors: Record<string, any>;
      last: any | null;
    }
  >;
};

type ApiError = { status: number; message: string; raw?: unknown };

const API_BASE = String((import.meta as any).env?.VITE_API_BASE ?? "").replace(/\/$/, "");

function buildUrl(p: string) {
  const path = p.startsWith("/") ? p : `/${p}`;
  return API_BASE ? `${API_BASE}${path}` : path;
}

function toQuery(params: Record<string, any>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
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
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : (data as any)?.error
        ? String((data as any).error)
        : JSON.stringify(data);

    const err: ApiError = { status: res.status, message: msg || `HTTP ${res.status}`, raw: data };
    const e = new Error(err.message) as Error & ApiError;
    e.status = err.status;
    e.raw = err.raw;
    throw e;
  }

  return data as T;
}

// -------- Schedule --------
export function apiGetSchedule() {
  return apiJson<{ ok: true; items: ScheduleItem[]; legacy?: boolean }>(`/api/schedule`);
}

export function apiSaveSchedule(items: ScheduleItem[]) {
  return apiJson<{ ok: true; count: number }>(`/api/schedule`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export function apiReloadSchedule() {
  return apiJson<{ ok: true; tasks: number }>(`/api/schedule/reload`, { method: "POST" });
}

// (debug) ver cursor salvo do rádio no backend
export function apiGetRadioState() {
  return apiJson<{ ok: true; state: RadioState }>(`/api/radio/state`);
}

// -------- Search (pra “Adicionar no agendador”) --------
// Feb/2026: /search limit máx 10
export function apiSearchPlaylist(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const qs = toQuery({
    q,
    market: opts?.market ?? "BR",
    limit: opts?.limit,
    offset: opts?.offset,
  });

  return apiJson<{ ok: true; items: SpotifyPlaylistLite[]; page: PageInfo }>(`/api/search-playlist${qs}`);
}

export function apiSearchTrack(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const qs = toQuery({
    q,
    market: opts?.market ?? "BR",
    limit: opts?.limit,
    offset: opts?.offset,
  });

  return apiJson<{ ok: true; items: SpotifyTrackLite[]; page: PageInfo }>(`/api/search-track${qs}`);
}

// Álbuns “por artista” (2 passos)
export function apiSearchArtist(q: string, opts?: { limit?: number; offset?: number }) {
  const qs = toQuery({
    q,
    limit: opts?.limit,
    offset: opts?.offset,
  });

  return apiJson<{
    ok: true;
    artist: { id: string; name?: string; uri?: string } | null;
    items: { id: string; name: string; uri: string; images: SpotifyImage[]; genres?: string[]; popularity?: number | null }[];
    page: PageInfo;
  }>(`/api/search-artist${qs}`);
}

export function apiGetArtistAlbums(
  artistId: string,
  opts?: { market?: string; include_groups?: string; limit?: number; offset?: number }
) {
  const qs = toQuery({
    artistId,
    market: opts?.market ?? "BR",
    include_groups: opts?.include_groups ?? "album,single",
    limit: opts?.limit,
    offset: opts?.offset,
  });

  return apiJson<{ ok: true; items: SpotifyAlbumLite[]; page: PageInfo }>(`/api/artist-albums${qs}`);
}