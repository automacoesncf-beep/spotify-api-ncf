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
  owner?: { display_name?: string };
};

export type SpotifyAlbumLite = {
  id: string;
  name: string;
  uri: string;
  release_date?: string;
  images: SpotifyImage[];
};

export type ScheduleItem = {
  id: string;
  cron: string; // "15 8 * * *"
  uri: string;  // spotify:track/... spotify:album/... spotify:playlist:...  (ou URL se seu backend converte)

  title?: string;
  enabled?: boolean;

  // ✅ qualidade de vida (UI)
  kind?: "playlist" | "track" | "album";
  imageUrl?: string;
  subtitle?: string;

  // ✅ opções do scheduler
  shuffle?: boolean;
  startFromBeginning?: boolean;
};

type ApiError = { status: number; message: string; raw?: unknown };

const API_BASE = String((import.meta as any).env?.VITE_API_BASE ?? "").replace(/\/$/, "");

function buildUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
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

// -------- Search (pra “Adicionar no agendador”) --------
export function apiSearchPlaylist(q: string) {
  return apiJson<{ items: SpotifyPlaylistLite[] }>(`/api/search-playlist?q=${encodeURIComponent(q)}`);
}

export function apiSearchTrack(q: string) {
  return apiJson<{ items: SpotifyTrackLite[] }>(`/api/search-track?q=${encodeURIComponent(q)}`);
}

// Álbuns “por artista” (2 passos)
export function apiSearchArtist(q: string) {
  return apiJson<{ artist: { id: string } | null }>(`/api/search-artist?q=${encodeURIComponent(q)}`);
}

export function apiGetArtistAlbums(artistId: string) {
  return apiJson<{ items: SpotifyAlbumLite[] }>(`/api/artist-albums?artistId=${encodeURIComponent(artistId)}`);
}