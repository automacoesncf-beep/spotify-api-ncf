// src/features/reproduction/api/types.ts

export type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

export type SpotifyExternalUrls = {
  spotify: string;
};

export type SpotifyAlbumArtist = {
  id?: string;
  name: string;
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  uri: string;
  release_date: string;
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;

  // extras que podem vir do /search-album
  total_tracks?: number | null;
  album_type?: string | null;
  artists?: SpotifyAlbumArtist[];
};

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
  supports_volume?: boolean;
  volume_percent?: number | null;
};

export type SpotifyArtistLite = {
  name: string;
};

export type SpotifyPlaybackItem = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists: SpotifyArtistLite[];
  album: {
    name: string;
    images: SpotifyImage[];
  };
};

export type SpotifyPlaybackState = {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyPlaybackItem | null;
  device: SpotifyDevice;
  // alguns backends incluem "context". Se não existir, fica undefined e tudo bem.
  context?: { uri?: string } | null;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  artists: { name: string }[];
  album: { name: string; images: SpotifyImage[] };
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  uri: string;
  images: SpotifyImage[];
  owner?: { display_name?: string; id?: string };
  tracks?: { total?: number } | null;
};

export type ScheduleItem = {
  id: string;
  cron: string; // ex: "15 8 * * *"
  uri: string; // spotify:track/... album/... playlist/...
  title?: string;
  enabled?: boolean;

  // opcionais do seu schedule
  deviceId?: string;
  devices?: string[];
  shuffle?: boolean;
  startFromBeginning?: boolean;
};

// -------------------------
// API shapes (do seu backend)
// -------------------------

export type ApiOkResponse = { ok: true };

export type ApiReloadScheduleResponse = {
  ok: true;
  tasks: number;
};

// paginação usada nas rotas /search e /artist-albums
export type ApiPage = {
  limit: number;
  offset: number;
  total: number | null;
  next: string | null;
  previous?: string | null;
};

export type ApiListResponse<T> = {
  ok: true;
  items: T[];
  page?: ApiPage;
};