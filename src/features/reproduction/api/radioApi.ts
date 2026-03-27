import type {
  SpotifyAlbum,
  SpotifyTrack,
  SpotifyPlaylist,
  ScheduleItem,
  ApiOkResponse,
  ApiReloadScheduleResponse,
  ApiPage,
  ApiListResponse,
  ApiDevicesResponse,
  ApiPlaybackStateResponse,
  ApiScheduleResponse,
} from "./types";

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

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      typeof data === "string"
        ? data
        : data?.error ?? data?.message ?? JSON.stringify(data);

    throw new Error(msg || `HTTP ${res.status}`);
  }

  return data as T;
}

const SEARCH_LIMIT_MAX = 10;
const CLIENT_PLAYER_TTL_MS = 60000;
const CLIENT_DEVICES_TTL_MS = 60000;
const CLIENT_SCHEDULE_TTL_MS = 60000;

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

type CacheEntry<T> = {
  ts: number;
  value: T | null;
};

const cache = {
  playback: { ts: 0, value: null } as CacheEntry<ApiPlaybackStateResponse>,
  devices: { ts: 0, value: null } as CacheEntry<ApiDevicesResponse>,
  schedule: { ts: 0, value: null } as CacheEntry<ApiScheduleResponse>,
};

const inFlight = {
  playback: null as Promise<ApiPlaybackStateResponse> | null,
  devices: null as Promise<ApiDevicesResponse> | null,
  schedule: null as Promise<ApiScheduleResponse> | null,
};

function isFresh(ts: number, ttl: number) {
  return ts > 0 && Date.now() - ts <= ttl;
}

export function invalidatePlayerClientCache() {
  cache.playback.ts = 0;
  cache.playback.value = null;
  cache.devices.ts = 0;
  cache.devices.value = null;
}

export function invalidateScheduleClientCache() {
  cache.schedule.ts = 0;
  cache.schedule.value = null;
}

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

export function apiSearchTrack(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyTrack>>(`/api/search-track${qs({ q, market, limit, offset })}`);
}

export function apiSearchPlaylist(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyPlaylist>>(`/api/search-playlist${qs({ q, market, limit, offset })}`);
}

export function apiSearchAlbum(q: string, opts?: { market?: string; limit?: number; offset?: number }) {
  const market = (opts?.market ?? "BR").trim() || "BR";
  const limit = clampSearchLimit(opts?.limit, SEARCH_LIMIT_MAX);
  const offset = clampOffset(opts?.offset, 0);

  return apiJson<ApiListResponse<SpotifyAlbum>>(`/api/search-album${qs({ q, market, limit, offset })}`);
}

export async function apiGetDevices(opts?: { force?: boolean }) {
  const force = !!opts?.force;

  if (!force && cache.devices.value && isFresh(cache.devices.ts, CLIENT_DEVICES_TTL_MS)) {
    return cache.devices.value;
  }

  if (!force && inFlight.devices) {
    return inFlight.devices;
  }

  inFlight.devices = apiJson<ApiDevicesResponse>(`/api/player/devices`)
    .then((data) => {
      cache.devices = { ts: Date.now(), value: data };
      return data;
    })
    .finally(() => {
      inFlight.devices = null;
    });

  return inFlight.devices;
}

export async function apiGetPlaybackState(opts?: { force?: boolean }) {
  const force = !!opts?.force;

  if (!force && cache.playback.value && isFresh(cache.playback.ts, CLIENT_PLAYER_TTL_MS)) {
    return cache.playback.value;
  }

  if (!force && inFlight.playback) {
    return inFlight.playback;
  }

  inFlight.playback = apiJson<ApiPlaybackStateResponse>(`/api/player/state`)
    .then((data) => {
      cache.playback = { ts: Date.now(), value: data };
      return data;
    })
    .finally(() => {
      inFlight.playback = null;
    });

  return inFlight.playback;
}

export function apiPlayContext(deviceId: string, contextUri: string) {
  return apiJson<ApiOkResponse>(`/api/player/play-context`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, contextUri }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiPlayUris(deviceId: string, uris: string[]) {
  return apiJson<ApiOkResponse>(`/api/player/play-uris`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, uris }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiPause(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/pause`, {
    method: "PUT",
    body: JSON.stringify({ deviceId }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiResume(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/resume`, {
    method: "PUT",
    body: JSON.stringify({ deviceId }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiNext(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/next`, {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiPrevious(deviceId: string) {
  return apiJson<ApiOkResponse>(`/api/player/previous`, {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiSeek(deviceId: string, positionMs: number) {
  return apiJson<ApiOkResponse>(`/api/player/seek`, {
    method: "PUT",
    body: JSON.stringify({ deviceId, positionMs }),
  }).then((r) => {
    invalidatePlayerClientCache();
    return r;
  });
}

export function apiReloadSchedule() {
  return apiJson<ApiReloadScheduleResponse>(`/api/schedule/reload`, {
    method: "POST",
  }).then((r) => {
    invalidateScheduleClientCache();
    return r;
  });
}

export async function apiGetSchedule(opts?: { force?: boolean }) {
  const force = !!opts?.force;

  if (!force && cache.schedule.value && isFresh(cache.schedule.ts, CLIENT_SCHEDULE_TTL_MS)) {
    return cache.schedule.value;
  }

  if (!force && inFlight.schedule) {
    return inFlight.schedule;
  }

  inFlight.schedule = apiJson<ApiScheduleResponse>(`/api/schedule`)
    .then((data) => {
      cache.schedule = { ts: Date.now(), value: data };
      return data;
    })
    .finally(() => {
      inFlight.schedule = null;
    });

  return inFlight.schedule;
}

export function apiSaveSchedule(items: ScheduleItem[]) {
  return apiJson<{ ok: true; count: number }>(`/api/schedule`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  }).then((r) => {
    invalidateScheduleClientCache();
    return r;
  });
}