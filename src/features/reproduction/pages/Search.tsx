import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SpotifyAlbum } from "../api/types";
import { getArtistAlbums, searchArtistId, spotifyJson } from "../api/spotify";

// ⚠️ NÃO deixe CLIENT_SECRET no front em produção.
// Aqui é só pra você não travar o projeto agora.
const CLIENT_ID = "15ac21bfd8844362a70cb1c18c006817";
const CLIENT_SECRET = "0c35325e43274934a9635c0a7a525127";

export default function Search() {
  const navigate = useNavigate();

  const [searchInput, setSearchInput] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [albums, setAlbums] = useState<SpotifyAlbum[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const body =
      "grant_type=client_credentials&client_id=" +
      CLIENT_ID +
      "&client_secret=" +
      CLIENT_SECRET;

    fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
      .then((r) => r.json())
      .then((data) => setAccessToken(data.access_token))
      .catch(console.log);
  }, []);

  async function search() {
    const q = searchInput.trim();
    if (!q || !accessToken) return;

    setLoading(true);
    try {
      const artistId = await searchArtistId(accessToken, q);
      if (!artistId) {
        setAlbums([]);
        return;
      }

      const list = await getArtistAlbums(accessToken, artistId);
      setAlbums(list);
    } catch (e) {
      console.log("Erro search:", e);
      setAlbums([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="min-h-screen bg-zinc-100">
      <div className="container mx-auto max-w-5xl p-4 md:p-6">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-4 md:p-6">
          <div className="flex items-center gap-4">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Digite para buscar..."
              className="w-full px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-300"
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
            />

            <button
              className="w-40 px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-60"
              onClick={search}
              disabled={loading}
            >
              {loading ? "Buscando..." : "Procurar"}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {albums.map((album) => {
            const cover = album.images?.[0]?.url;

            return (
              <button
                key={album.id}
                className="text-left block bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
                onClick={() => {
                  navigate("/reproduction", { state: { contextUri: album.uri } });
                }}
              >
                <div className="w-full h-48 bg-zinc-200">
                  {cover ? (
                    <img src={cover} alt={album.name} className="w-full h-48 object-cover" />
                  ) : null}
                </div>

                <div className="p-4">
                  <h2 className="font-semibold text-zinc-900 line-clamp-2">{album.name}</h2>
                  <p className="text-sm text-zinc-600 mt-1">{album.release_date}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}