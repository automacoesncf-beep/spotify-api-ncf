// src/features/reproduction/api/types.ts

export type SpotifyImage = {
  url: string;
  height?: number | null;
  width?: number | null;
};

export type SpotifyExternalUrls = {
  spotify?: string;
};

export type SpotifyArtistLite = {
  id?: string;
  name: string;
};

export type SpotifyAlbum = {
  id?: string;
  name: string;
  uri?: string;
  release_date?: string;
  images?: SpotifyImage[];
  external_urls?: SpotifyExternalUrls;
  total_tracks?: number | null;
  album_type?: string | null;
  artists?: SpotifyArtistLite[];
};

export type SpotifyDevice = {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
  supports_volume?: boolean | null;
  volume_percent?: number | null;
};

export type SpotifyPlaybackItem = {
  id?: string | null;
  name?: string;
  uri?: string;
  duration_ms?: number | null;
  artists?: SpotifyArtistLite[];
  album?: {
    name?: string;
    images?: SpotifyImage[];
  } | null;
};

export type SpotifyPlaybackContext = {
  uri?: string;
} | null;

export type SpotifyPlaybackState = {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: SpotifyPlaybackItem | null;
  device?: SpotifyDevice | null;
  context?: SpotifyPlaybackContext;
};

export type SpotifyTrack = {
  id?: string;
  name: string;
  uri: string;
  artists?: SpotifyArtistLite[];
  album?: {
    name?: string;
    images?: SpotifyImage[];
  };
};

export type SpotifyPlaylist = {
  id?: string;
  name: string;
  uri: string;
  images?: SpotifyImage[];
  owner?: {
    display_name?: string;
    id?: string;
  };
  tracks?: {
    total?: number;
  } | null;
};

export type ScheduleItem = {
  id: string;
  cron: string;
  uri: string;
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  enabled?: boolean;
  deviceId?: string;
  devices?: string[];
  shuffle?: boolean;
  startFromBeginning?: boolean;
  remember?: boolean;
  mode?: "switch" | "break";
  repeat?: "off" | "track" | "context";
  resume?: boolean;
  resumeAfterMs?: number;
};

export type ApiOkResponse = {
  ok: true;
};

export type ApiReloadScheduleResponse = {
  ok: true;
  tasks: number;
};

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

export type ApiStatusMap = {
  devices?: number;
  player?: number;
  currentlyPlaying?: number;
};

export type ApiDevicesResponse = {
  ok: true;
  devices: SpotifyDevice[];
  count?: number;
  activeDeviceId?: string | null;
  timedOut?: boolean;
  source?: string;
  apiStatus?: ApiStatusMap | null;
  message?: string | null;
  error?: string | null;
};

export type ApiPlaybackStateResponse = {
  ok: true;
  hasActivePlayback: boolean;
  player: SpotifyPlaybackState | null;
  timedOut?: boolean;
  source?: string;
  apiStatus?: ApiStatusMap | null;
  message?: string | null;
  error?: string | null;
};

export type ApiScheduleResponse = {
  ok: true;
  items: ScheduleItem[];
  legacy?: boolean;
};