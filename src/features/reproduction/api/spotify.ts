// features/reproduction/api/spotify.ts
import type {
  SpotifyAlbumsResponse,
  SpotifyDevicesResponse,
  SpotifyPlaybackState,
} from "./types";

export async function spotifyJson<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data as T;
}

// ---------- Search ----------
export async function searchArtistId(token: string, q: string) {
  const url =
    "https://api.spotify.com/v1/search?q=" +
    encodeURIComponent(q) +
    "&type=artist&market=BR&limit=10&offset=0";

  const data = await spotifyJson<any>(url, token);
  return data?.artists?.items?.[0]?.id as string | undefined;
}

export async function getArtistAlbums(token: string, artistId: string) {
  const url =
    `https://api.spotify.com/v1/artists/${artistId}/albums` +
    `?include_groups=album&market=BR&limit=10`;

  const data = await spotifyJson<SpotifyAlbumsResponse>(url, token);
  return data.items ?? [];
}

// ---------- Playback (token de USUÁRIO) ----------
export async function getDevices(token: string) {
  return spotifyJson<SpotifyDevicesResponse>(
    "https://api.spotify.com/v1/me/player/devices",
    token
  );
}

export async function getPlaybackState(token: string) {
  return spotifyJson<SpotifyPlaybackState>(
    "https://api.spotify.com/v1/me/player",
    token
  );
}

export async function playContext(
  token: string,
  deviceId: string,
  contextUri: string,
  positionMs = 0
) {
  const url = new URL("https://api.spotify.com/v1/me/player/play");
  if (deviceId) url.searchParams.set("device_id", deviceId);

  return spotifyJson<void>(url.toString(), token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context_uri: contextUri, position_ms: positionMs }),
  });
}

export async function playTrack(
  token: string,
  deviceId: string,
  trackUri: string,
  positionMs = 0
) {
  const url = new URL("https://api.spotify.com/v1/me/player/play");
  if (deviceId) url.searchParams.set("device_id", deviceId);

  return spotifyJson<void>(url.toString(), token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [trackUri], position_ms: positionMs }),
  });
}

export async function pause(token: string, deviceId: string) {
  const url = new URL("https://api.spotify.com/v1/me/player/pause");
  if (deviceId) url.searchParams.set("device_id", deviceId);
  return spotifyJson<void>(url.toString(), token, { method: "PUT" });
}

export async function nextTrack(token: string, deviceId: string) {
  const url = new URL("https://api.spotify.com/v1/me/player/next");
  if (deviceId) url.searchParams.set("device_id", deviceId);
  return spotifyJson<void>(url.toString(), token, { method: "POST" });
}

export async function prevTrack(token: string, deviceId: string) {
  const url = new URL("https://api.spotify.com/v1/me/player/previous");
  if (deviceId) url.searchParams.set("device_id", deviceId);
  return spotifyJson<void>(url.toString(), token, { method: "POST" });
}

export async function seek(token: string, deviceId: string, positionMs: number) {
  const url = new URL("https://api.spotify.com/v1/me/player/seek");
  url.searchParams.set("position_ms", String(positionMs));
  if (deviceId) url.searchParams.set("device_id", deviceId);
  return spotifyJson<void>(url.toString(), token, { method: "PUT" });
}

export async function setVolume(token: string, deviceId: string, volumePercent: number) {
  const url = new URL("https://api.spotify.com/v1/me/player/volume");
  url.searchParams.set("volume_percent", String(volumePercent));
  if (deviceId) url.searchParams.set("device_id", deviceId);
  return spotifyJson<void>(url.toString(), token, { method: "PUT" });
}

export async function transferPlayback(token: string, deviceId: string, play = true) {
  return spotifyJson<void>("https://api.spotify.com/v1/me/player", token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}