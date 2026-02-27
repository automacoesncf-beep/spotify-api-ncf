// features/reproduction/api/types.ts

export type SpotifyImage = { url: string; height: number; width: number };

export type SpotifyAlbum = {
  id: string;
  name: string;
  uri: string;
  release_date: string;
  images: SpotifyImage[];
  external_urls: { spotify: string };
};

export type SpotifyAlbumsResponse = {
  items: SpotifyAlbum[];
  next: string | null;
  total: number;
};

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
};

export type SpotifyDevicesResponse = {
  devices: SpotifyDevice[];
};

export type SpotifyPlaybackState = {
  is_playing: boolean;
  progress_ms: number | null;
  item: {
    id: string;
    name: string;
    duration_ms: number;
    uri: string;
    artists: { name: string }[];
    album: { name: string; images: SpotifyImage[] };
  } | null;
  device: SpotifyDevice;
};