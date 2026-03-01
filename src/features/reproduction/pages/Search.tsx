// src/features/reproduction/pages/Search.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiPage, SpotifyAlbum, SpotifyTrack, SpotifyPlaylist } from "../api/types";
import {
  apiSearchArtist,
  apiGetArtistAlbums,
  apiSearchTrack,
  apiSearchPlaylist,
  apiSearchAlbum,
} from "../api/radioApi";

type Mode = "album" | "track" | "playlist";
type AlbumSearchBy = "album" | "artist";

const LIMIT = 10;

function hasMore(page: ApiPage | null, currentCount: number) {
  if (!page) return false;
  if (typeof page.total === "number") return currentCount < page.total;
  return !!page.next;
}

export default function Search() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("album");
  const [albumBy, setAlbumBy] = useState<AlbumSearchBy>("album");
  const [searchInput, setSearchInput] = useState("");

  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);

  const [albumPage, setAlbumPage] = useState<ApiPage | null>(null);
  const [trackPage, setTrackPage] = useState<ApiPage | null>(null);
  const [playlistPage, setPlaylistPage] = useState<ApiPage | null>(null);

  const [albumArtistId, setAlbumArtistId] = useState<string>("");

  const [lastQuery, setLastQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  function resetResults() {
    setAlbums([]);
    setTracks([]);
    setPlaylists([]);
    setAlbumPage(null);
    setTrackPage(null);
    setPlaylistPage(null);
    setAlbumArtistId("");
    setLastQuery("");
    setMsg("");
  }

  async function search() {
    const q = searchInput.trim();
    if (!q) return;

    setLoading(true);
    setMsg("");
    setAlbums([]);
    setTracks([]);
    setPlaylists([]);
    setAlbumPage(null);
    setTrackPage(null);
    setPlaylistPage(null);

    try {
      if (mode === "album") {
        // 1) Busca direta por NOME DO ÁLBUM
        if (albumBy === "album") {
          setAlbumArtistId("");
          const r = await apiSearchAlbum(q, { market: "BR", limit: LIMIT, offset: 0 });
          setAlbums(r.items ?? []);
          setAlbumPage(r.page ?? null);
          if (!r.items?.length) setMsg("Nenhum álbum encontrado.");
        }

        // 2) Busca por ARTISTA e lista discografia
        if (albumBy === "artist") {
          const r1 = await apiSearchArtist(q, { limit: LIMIT, offset: 0 });
          const artistId = r1.artist?.id;

          if (!artistId) {
            setMsg("Nenhum artista encontrado.");
            setAlbumArtistId("");
            return;
          }

          setAlbumArtistId(artistId);

          const r2 = await apiGetArtistAlbums(artistId, {
            market: "BR",
            include_groups: "album", // troque para "album,single" se quiser incluir singles
            limit: LIMIT,
            offset: 0,
          });

          setAlbums(r2.items ?? []);
          setAlbumPage(r2.page ?? null);
          if (!r2.items?.length) setMsg("Artista encontrado, mas sem álbuns retornados.");
        }
      }

      if (mode === "track") {
        const r = await apiSearchTrack(q, { market: "BR", limit: LIMIT, offset: 0 });
        setTracks(r.items ?? []);
        setTrackPage(r.page ?? null);
        if (!r.items?.length) setMsg("Nenhuma música encontrada.");
      }

      if (mode === "playlist") {
        const r = await apiSearchPlaylist(q, { market: "BR", limit: LIMIT, offset: 0 });
        setPlaylists(r.items ?? []);
        setPlaylistPage(r.page ?? null);
        if (!r.items?.length) setMsg("Nenhuma playlist encontrada.");
      }

      setLastQuery(q);
    } catch (e: any) {
      console.log(e);
      setMsg("Erro ao buscar (veja o console).");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    const q = lastQuery.trim();
    if (!q) return;

    setLoading(true);
    setMsg("");

    try {
      if (mode === "track") {
        if (!hasMore(trackPage, tracks.length)) return;
        const r = await apiSearchTrack(q, { market: "BR", limit: LIMIT, offset: tracks.length });
        setTracks((prev) => prev.concat(r.items ?? []));
        setTrackPage(r.page ?? trackPage);
      }

      if (mode === "playlist") {
        if (!hasMore(playlistPage, playlists.length)) return;
        const r = await apiSearchPlaylist(q, { market: "BR", limit: LIMIT, offset: playlists.length });
        setPlaylists((prev) => prev.concat(r.items ?? []));
        setPlaylistPage(r.page ?? playlistPage);
      }

      if (mode === "album") {
        if (!hasMore(albumPage, albums.length)) return;

        if (albumBy === "album") {
          const r = await apiSearchAlbum(q, { market: "BR", limit: LIMIT, offset: albums.length });
          setAlbums((prev) => prev.concat(r.items ?? []));
          setAlbumPage(r.page ?? albumPage);
        } else {
          if (!albumArtistId) return;
          const r = await apiGetArtistAlbums(albumArtistId, {
            market: "BR",
            include_groups: "album",
            limit: LIMIT,
            offset: albums.length,
          });
          setAlbums((prev) => prev.concat(r.items ?? []));
          setAlbumPage(r.page ?? albumPage);
        }
      }
    } catch (e) {
      console.log(e);
      setMsg("Erro ao carregar mais (veja o console).");
    } finally {
      setLoading(false);
    }
  }

  const placeholder =
    mode === "album"
      ? albumBy === "album"
        ? "Buscar álbum..."
        : "Buscar artista..."
      : mode === "track"
      ? "Buscar música..."
      : "Buscar playlist...";

  const showLoadMore =
    (mode === "album" && albums.length > 0 && hasMore(albumPage, albums.length)) ||
    (mode === "track" && tracks.length > 0 && hasMore(trackPage, tracks.length)) ||
    (mode === "playlist" && playlists.length > 0 && hasMore(playlistPage, playlists.length));

  return (
    <section className="min-h-screen bg-zinc-100">
      <div className="container mx-auto max-w-5xl p-4 md:p-6">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            {(["album", "track", "playlist"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  resetResults();
                }}
                className={[
                  "px-3 py-2 rounded-xl text-sm font-semibold",
                  mode === m ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200",
                ].join(" ")}
              >
                {m === "album" ? "Álbuns" : m === "track" ? "Músicas" : "Playlists"}
              </button>
            ))}
          </div>

          {mode === "album" ? (
            <div className="flex items-center gap-2 mb-3">
              {(["album", "artist"] as AlbumSearchBy[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setAlbumBy(m);
                    resetResults();
                  }}
                  className={[
                    "px-3 py-2 rounded-xl text-sm font-semibold",
                    albumBy === m ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200",
                  ].join(" ")}
                >
                  {m === "album" ? "Por nome do álbum" : "Por artista (discografia)"}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-4">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={placeholder}
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-300"
              onKeyDown={(e) => e.key === "Enter" && search()}
            />

            <button
              className="w-40 px-4 py-2 bg-indigo-600 text-white rounded-xl disabled:opacity-60"
              onClick={search}
              disabled={loading}
            >
              {loading ? "Buscando..." : "Procurar"}
            </button>
          </div>

          {msg ? <p className="mt-3 text-sm text-zinc-600">{msg}</p> : null}

          {showLoadMore ? (
            <div className="mt-4">
              <button
                onClick={loadMore}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-zinc-900 text-white disabled:opacity-60"
              >
                {loading ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          ) : null}
        </div>

        {/* ÁLBUNS */}
        {mode === "album" && albums.length ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {albums.map((album) => {
              const cover = album.images?.[0]?.url;
              return (
                <button
                  key={album.id}
                  className="text-left bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
                  onClick={() =>
                    navigate("/reproduction", {
                      state: {
                        playMode: "context",
                        contextUri: album.uri,
                        selectedUri: album.uri,
                        title: album.name,
                      },
                    })
                  }
                >
                  <div className="w-full h-48 bg-zinc-200">
                    {cover ? <img src={cover} alt={album.name} className="w-full h-48 object-cover" /> : null}
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-zinc-900 line-clamp-2">{album.name}</h2>
                    <p className="text-sm text-zinc-600 mt-1">{album.release_date}</p>
                    <p className="text-xs text-zinc-500 mt-2">Clique para tocar</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* MÚSICAS */}
        {mode === "track" && tracks.length ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {tracks.map((t) => {
              const cover = t.album?.images?.[0]?.url;
              return (
                <button
                  key={t.id}
                  className="text-left bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden flex"
                  onClick={() =>
                    navigate("/reproduction", {
                      state: {
                        playMode: "uris",
                        uris: [t.uri],
                        selectedUri: t.uri,
                        title: t.name,
                      },
                    })
                  }
                >
                  <div className="w-24 h-24 bg-zinc-200 shrink-0">
                    {cover ? <img src={cover} alt={t.name} className="w-24 h-24 object-cover" /> : null}
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-zinc-900">{t.name}</h2>
                    <p className="text-sm text-zinc-600 mt-1">{t.artists?.map((a) => a.name).join(", ")}</p>
                    <p className="text-xs text-zinc-500 mt-2">Clique para tocar</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* PLAYLISTS */}
        {mode === "playlist" && playlists.length ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {playlists.map((p) => {
              const cover = p.images?.[0]?.url;
              return (
                <button
                  key={p.id}
                  className="text-left bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
                  onClick={() =>
                    navigate("/reproduction", {
                      state: {
                        playMode: "context",
                        contextUri: p.uri,
                        selectedUri: p.uri,
                        title: p.name,
                      },
                    })
                  }
                >
                  <div className="w-full h-40 bg-zinc-200">
                    {cover ? <img src={cover} alt={p.name} className="w-full h-40 object-cover" /> : null}
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-zinc-900 line-clamp-2">{p.name}</h2>
                    <p className="text-xs text-zinc-500 mt-2">Clique para tocar</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}