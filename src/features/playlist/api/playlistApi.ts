// src/features/playlist/api/playlistApi.ts

export type Img = { url: string };

export type TrackLite = {
  id: string;
  name: string;
  uri: string;
  artists?: { name: string }[];
  album?: { name?: string; images?: Img[] };
};

export type PlaylistLite = {
  id: string;
  name: string;
  uri: string;
  images?: Img[];
  owner?: { display_name?: string; id?: string };
  tracks?: { total?: number };
};

export type PlaylistItemLite = {
  uri: string;
  name: string;
  artists: string;
  album: string;
  cover: string;
};

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
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(msg || `HTTP ${res.status}`);
  }

  return data as T;
}

// -------------------------
// AUTH / ME / SEARCH
// -------------------------
export function apiAuthStatus() {
  return apiJson<{ hasRefreshToken: boolean; updated_at?: string; scope?: string }>(`/api/auth/status`);
}

export function apiMe() {
  return apiJson<{ ok: true; me: any }>(`/api/me`);
}

export function apiSearchTrack(q: string) {
  return apiJson<{ ok: true; items: TrackLite[] }>(`/api/search-track?q=${encodeURIComponent(q)}`);
}

// (Opcional) você já tem rota no backend: /api/search-playlist
export function apiSearchPlaylist(q: string) {
  return apiJson<{ ok: true; items: PlaylistLite[] }>(`/api/search-playlist?q=${encodeURIComponent(q)}`);
}

// -------------------------
// PLAYLISTS - MINHAS
// -------------------------
export function apiMyPlaylists(all = true) {
  return apiJson<{ ok: true; items: PlaylistLite[]; next?: string | null; total?: number | null }>(
    `/api/me/playlists?all=${all ? "1" : "0"}`
  );
}

// -------------------------
// PLAYLIST CRUD (COMPLETO - padrão 2026 do seu backend)
// -------------------------

// Create
export function apiCreatePlaylist(body: { name: string; description?: string; isPublic?: boolean }) {
  return apiJson<{ ok: true; playlist: { id: string; name: string; uri: string; images?: Img[] } }>(`/api/playlists/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Read (detalhes) — GET /api/playlists/:playlistId
export function apiGetPlaylistDetails(playlistId: string, opts?: { market?: string; fields?: string; additional_types?: string }) {
  const market = opts?.market ?? "BR";
  const qs = new URLSearchParams();
  if (market) qs.set("market", market);
  if (opts?.fields) qs.set("fields", opts.fields);
  if (opts?.additional_types) qs.set("additional_types", opts.additional_types);

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiJson<{ ok: true; playlist: any }>(`/api/playlists/${encodeURIComponent(playlistId)}${suffix}`);
}

// Update details — PUT /api/playlists/:playlistId/details
export function apiUpdatePlaylistDetails(
  playlistId: string,
  body: { name?: string; description?: string; isPublic?: boolean; collaborative?: boolean }
) {
  return apiJson<{ ok: true }>(`/api/playlists/${encodeURIComponent(playlistId)}/details`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// Follow — PUT /api/playlists/:playlistId/follow
export function apiFollowPlaylist(playlistId: string) {
  return apiJson<{ ok: true }>(`/api/playlists/${encodeURIComponent(playlistId)}/follow`, {
    method: "PUT",
  });
}

// Unfollow — DELETE /api/playlists/:playlistId/unfollow
export function apiUnfollowPlaylist(playlistId: string) {
  return apiJson<{ ok: true }>(`/api/playlists/${encodeURIComponent(playlistId)}/unfollow`, {
    method: "DELETE",
  });
}

// -------------------------
// PLAYLIST ITEMS (tracks/episodes) — padrão 2026 (/items)
// -------------------------

// List (paginado) — mantido
export function apiGetPlaylistItems(playlistId: string, limit = 50, offset = 0, market = "BR") {
  return apiJson<{ ok: true; data: any }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=${offset}&market=${encodeURIComponent(market)}`
  );
}

// List ALL — GET /api/playlists/:playlistId/items/all
export function apiGetPlaylistItemsAll(playlistId: string, market = "BR") {
  return apiJson<{ ok: true; total?: number | null; count: number; items: any[] }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/items/all?market=${encodeURIComponent(market)}`
  );
}

// Add — POST /api/playlists/:playlistId/add-items (agora com position opcional)
export function apiAddItemsToPlaylist(playlistId: string, uris: string[], position?: number) {
  return apiJson<{ ok: true; added: number; snapshot_id?: string }>(`/api/playlists/${encodeURIComponent(playlistId)}/add-items`, {
    method: "POST",
    body: JSON.stringify(Number.isInteger(position) ? { uris, position } : { uris }),
  });
}

// Remove — DELETE /api/playlists/:playlistId/remove-items
// - mantém seu formato antigo (uris[])
// - permite snapshot_id opcional (quando você quiser “encadear” mudanças)
export function apiRemoveItemsFromPlaylist(playlistId: string, uris: string[], snapshot_id?: string) {
  const body = snapshot_id ? { uris, snapshot_id } : { uris };
  return apiJson<{ ok: true; removed: number; snapshot_id?: string }>(`/api/playlists/${encodeURIComponent(playlistId)}/remove-items`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

// Clear — mantido
export function apiClearPlaylist(playlistId: string) {
  return apiJson<{ ok: true; removed: number; snapshot_id?: string }>(`/api/playlists/${encodeURIComponent(playlistId)}/clear`, {
    method: "PUT",
  });
}

// Update items — PUT /api/playlists/:playlistId/items
// REORDER
export function apiReorderPlaylistItems(
  playlistId: string,
  body: { range_start: number; insert_before: number; range_length?: number; snapshot_id?: string }
) {
  return apiJson<{ ok: true; mode: "reorder"; snapshot_id?: string | null }>(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// REPLACE (substituir lista toda)
// Observação: backend já lida com >100 dividindo PUT+POST internamente
export function apiReplacePlaylistItems(playlistId: string, uris: string[]) {
  return apiJson<{ ok: true; mode: "replace"; count: number; appendedAfterPut?: number }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/items`,
    {
      method: "PUT",
      body: JSON.stringify({ uris }),
    }
  );
}

// -------------------------
// IA
// -------------------------
export function apiAiPreview(body: { prompt: string; count: number; market: string }) {
  return apiJson<{
    ok: true;
    plan: { name: string; description: string };
    resolved: { uris: string[]; picked: Array<{ query: string; track: TrackLite | null }> };
  }>(`/api/ai/playlist/preview`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function apiAiCreate(body: { prompt: string; count: number; market: string; isPublic: boolean }) {
  return apiJson<{
    ok: true;
    playlist: { id: string; name: string; uri: string; images?: Img[] };
    added: number;
    resolved: { uris: string[]; picked: Array<{ query: string; track: TrackLite | null }> };
  }>(`/api/ai/playlist/create`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// -------------------------
// Helpers opcionais (para sua UI) — converter resposta do Spotify em lista simples
// -------------------------
export function mapPlaylistItemsToLite(items: any[]): PlaylistItemLite[] {
  return (items ?? []).map((it) => {
    const obj = it?.track ?? it?.episode ?? it?.item ?? null;
    const uri = String(obj?.uri ?? "").trim();
    const name = String(obj?.name ?? "").trim();

    const artistsArr = (obj?.artists ?? []).map((a: any) => a?.name).filter(Boolean);
    const artists = artistsArr.join(", ");

    const album = String(obj?.album?.name ?? "").trim();
    const cover = String(obj?.album?.images?.[0]?.url ?? obj?.images?.[0]?.url ?? "").trim();

    return { uri, name, artists, album, cover };
  });
}