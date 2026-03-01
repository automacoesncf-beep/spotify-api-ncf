// src/features/schadule/pages/Schadule.tsx
import { useEffect, useMemo, useState } from "react";
import {
  apiGetSchedule,
  apiReloadSchedule,
  apiSaveSchedule,
  apiSearchPlaylist,
  apiSearchTrack,
  apiSearchArtist,
  apiGetArtistAlbums,
  type ScheduleItem,
  type SpotifyPlaylistLite,
  type SpotifyTrackLite,
  type SpotifyAlbumLite,
} from "../api/scheduleApi";

function makeId() {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cronToTime(cron: string) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  const min = parts[0] ?? "0";
  const hour = parts[1] ?? "0";
  const hh = String(hour).padStart(2, "0");
  const mm = String(min).padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeToCron(time: string, oldCron: string) {
  const [hh = "00", mm = "00"] = String(time ?? "00:00").split(":");
  const parts = String(oldCron ?? "0 0 * * *").trim().split(/\s+/);
  while (parts.length < 5) parts.push("*");
  parts[0] = String(Number(mm));
  parts[1] = String(Number(hh));
  return parts.join(" ");
}

function nowPlusMinutes(mins: number) {
  const d = new Date(Date.now() + mins * 60_000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

type Mode = "playlist" | "track" | "album";

type Row = ScheduleItem & { time: string };

export default function Schadule() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Quick add
  const [mode, setMode] = useState<Mode>("playlist");
  const [q, setQ] = useState("");
  const [quickTime, setQuickTime] = useState(() => nowPlusMinutes(2));

  const [playlistResults, setPlaylistResults] = useState<SpotifyPlaylistLite[]>([]);
  const [trackResults, setTrackResults] = useState<SpotifyTrackLite[]>([]);
  const [albumResults, setAlbumResults] = useState<SpotifyAlbumLite[]>([]);

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await apiGetSchedule();
      setItems(r.items ?? []);
    } catch (e) {
      console.log(e);
      setMsg("Falha ao carregar schedule.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows: Row[] = useMemo(
    () =>
      (items ?? []).map((it) => ({
        ...it,
        time: cronToTime(it.cron),
        enabled: it.enabled ?? true,
        shuffle: it.shuffle ?? false,
        startFromBeginning: it.startFromBeginning ?? true,
      })),
    [items]
  );

  function addRowManual() {
    setItems((prev) => [
      ...prev,
      {
        id: makeId(),
        cron: "0 8 * * *",
        uri: "",
        title: "Novo item",
        enabled: true,
        shuffle: false,
        startFromBeginning: true,
      },
    ]);
  }

  function addFromSearch(payload: {
    kind: Mode;
    title: string;
    uri: string;
    imageUrl?: string;
    subtitle?: string;
  }) {
    const cron = timeToCron(quickTime, "0 0 * * *");

    setItems((prev) => [
      ...prev,
      {
        id: makeId(),
        cron,
        uri: payload.uri,
        title: payload.title,
        enabled: true,
        kind: payload.kind,
        imageUrl: payload.imageUrl,
        subtitle: payload.subtitle,

        // defaults “bons”:
        shuffle: payload.kind === "playlist" ? true : false,
        startFromBeginning: true,
      },
    ]);

    // facilita adicionar vários: incrementa 1 min automaticamente
    const [hh, mm] = quickTime.split(":").map(Number);
    const d = new Date();
    d.setHours(hh);
    d.setMinutes(mm + 1);
    setQuickTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  }

  async function runSearch() {
    const term = q.trim();
    if (!term) return;

    setLoading(true);
    setMsg("");
    setPlaylistResults([]);
    setTrackResults([]);
    setAlbumResults([]);

    try {
      if (mode === "playlist") {
        const r = await apiSearchPlaylist(term);
        setPlaylistResults(r.items ?? []);
      }

      if (mode === "track") {
        const r = await apiSearchTrack(term);
        setTrackResults(r.items ?? []);
      }

      if (mode === "album") {
        // álbum “por artista”
        const r1 = await apiSearchArtist(term);
        const artistId = r1.artist?.id;
        if (!artistId) {
          setMsg("Nenhum artista encontrado.");
        } else {
          const r2 = await apiGetArtistAlbums(artistId);
          setAlbumResults(r2.items ?? []);
        }
      }
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao buscar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setMsg("");
    try {
      const r = await apiSaveSchedule(items);
      setMsg(`Salvo! Itens: ${r.count}`);
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao salvar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveAndReload() {
    setLoading(true);
    setMsg("");
    try {
      await apiSaveSchedule(items);
      const r = await apiReloadSchedule();
      setMsg(`Salvo e recarregado. Jobs: ${r.tasks}`);
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao salvar/recarregar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Quick Add */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">Schadule</h1>
              <p className="text-sm text-zinc-600">Pesquise e adicione direto no agendador.</p>
            </div>

            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border" onClick={load} disabled={loading}>
                Atualizar
              </button>
              <button className="px-3 py-2 rounded-xl bg-zinc-900 text-white" onClick={addRowManual}>
                + Adicionar manual
              </button>
              <button className="px-3 py-2 rounded-xl border disabled:opacity-60" onClick={save} disabled={loading}>
                Salvar
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-60"
                onClick={saveAndReload}
                disabled={loading}
              >
                Salvar e Recarregar
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["playlist", "track", "album"] as Mode[]).map((m) => (
              <button
                key={m}
                className={[
                  "px-3 py-2 rounded-xl text-sm font-semibold",
                  mode === m ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200",
                ].join(" ")}
                onClick={() => setMode(m)}
              >
                {m === "playlist" ? "Playlists" : m === "track" ? "Músicas" : "Álbuns (por artista)"}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder={mode === "album" ? "Digite o nome do artista..." : "Digite para buscar..."}
              className="flex-1 min-w-[240px] border border-zinc-200 rounded-xl px-3 py-2"
            />

            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-600">Horário:</span>
              <input
                type="time"
                value={quickTime}
                onChange={(e) => setQuickTime(e.target.value)}
                className="border border-zinc-200 rounded-xl px-3 py-2"
              />
            </div>

            <button
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-60"
              onClick={runSearch}
              disabled={loading}
            >
              Buscar
            </button>
          </div>

          {msg ? <p className="mt-3 text-sm text-zinc-600">{msg}</p> : null}

          {/* Results */}
          {mode === "playlist" && playlistResults.length ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {playlistResults.map((p) => {
                const img = p.images?.[0]?.url;
                return (
                  <div key={p.id} className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
                    <div className="flex gap-3 p-3">
                      <div className="w-16 h-16 rounded-xl bg-zinc-200 overflow-hidden shrink-0">
                        {img ? <img src={img} alt={p.name} className="w-16 h-16 object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 truncate">{p.name}</div>
                        <div className="text-xs text-zinc-600 truncate">
                          {p.owner?.display_name ? `por ${p.owner.display_name}` : ""}
                        </div>
                        <button
                          className="mt-2 px-3 py-1 rounded-xl bg-zinc-900 text-white text-sm font-semibold"
                          onClick={() =>
                            addFromSearch({
                              kind: "playlist",
                              title: p.name,
                              uri: p.uri, // pode ser URL se seu backend converter, mas URI é o ideal
                              imageUrl: img,
                              subtitle: p.owner?.display_name ? `por ${p.owner.display_name}` : "",
                            })
                          }
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {mode === "track" && trackResults.length ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {trackResults.map((t) => {
                const img = t.album?.images?.[0]?.url;
                const subtitle = `${t.artists?.map((a) => a.name).join(", ") ?? ""} • ${t.album?.name ?? ""}`;
                return (
                  <div key={t.id} className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
                    <div className="flex gap-3 p-3">
                      <div className="w-16 h-16 rounded-xl bg-zinc-200 overflow-hidden shrink-0">
                        {img ? <img src={img} alt={t.name} className="w-16 h-16 object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 truncate">{t.name}</div>
                        <div className="text-xs text-zinc-600 truncate">{subtitle}</div>
                        <button
                          className="mt-2 px-3 py-1 rounded-xl bg-zinc-900 text-white text-sm font-semibold"
                          onClick={() =>
                            addFromSearch({
                              kind: "track",
                              title: t.name,
                              uri: t.uri,
                              imageUrl: img,
                              subtitle,
                            })
                          }
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {mode === "album" && albumResults.length ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {albumResults.map((a) => {
                const img = a.images?.[0]?.url;
                return (
                  <div key={a.id} className="border border-zinc-200 rounded-2xl overflow-hidden bg-white">
                    <div className="flex gap-3 p-3">
                      <div className="w-16 h-16 rounded-xl bg-zinc-200 overflow-hidden shrink-0">
                        {img ? <img src={img} alt={a.name} className="w-16 h-16 object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-zinc-900 truncate">{a.name}</div>
                        <div className="text-xs text-zinc-600 truncate">{a.release_date ?? ""}</div>
                        <button
                          className="mt-2 px-3 py-1 rounded-xl bg-zinc-900 text-white text-sm font-semibold"
                          onClick={() =>
                            addFromSearch({
                              kind: "album",
                              title: a.name,
                              uri: a.uri,
                              imageUrl: img,
                              subtitle: a.release_date ?? "",
                            })
                          }
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Table */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-600">
                  <th className="py-2 pr-2">Ativo</th>
                  <th className="py-2 pr-2">Hora</th>
                  <th className="py-2 pr-2">Capa</th>
                  <th className="py-2 pr-2">Título</th>
                  <th className="py-2 pr-2">URI/URL</th>
                  <th className="py-2 pr-2">Aleatório</th>
                  <th className="py-2 pr-2">Começar do início</th>
                  <th className="py-2"></th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={row.enabled ?? true}
                        onChange={(e) =>
                          setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, enabled: e.target.checked } : x)))
                        }
                      />
                    </td>

                    <td className="py-2 pr-2">
                      <input
                        type="time"
                        value={row.time}
                        className="border rounded-xl px-2 py-1"
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === row.id ? { ...x, cron: timeToCron(e.target.value, x.cron) } : x))
                          )
                        }
                      />
                    </td>

                    <td className="py-2 pr-2">
                      <div className="w-10 h-10 rounded-xl bg-zinc-200 overflow-hidden">
                        {row.imageUrl ? <img src={row.imageUrl} alt="capa" className="w-10 h-10 object-cover" /> : null}
                      </div>
                    </td>

                    <td className="py-2 pr-2">
                      <input
                        value={row.title ?? ""}
                        className="w-full border rounded-xl px-2 py-1"
                        onChange={(e) =>
                          setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, title: e.target.value } : x)))
                        }
                      />
                      {row.subtitle ? <div className="mt-1 text-xs text-zinc-500">{row.subtitle}</div> : null}
                    </td>

                    <td className="py-2 pr-2">
                      <input
                        value={row.uri ?? ""}
                        placeholder="spotify:... OU https://open.spotify.com/..."
                        className="w-full border rounded-xl px-2 py-1"
                        onChange={(e) =>
                          setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, uri: e.target.value } : x)))
                        }
                      />
                    </td>

                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={row.shuffle ?? false}
                        onChange={(e) =>
                          setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, shuffle: e.target.checked } : x)))
                        }
                      />
                    </td>

                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={row.startFromBeginning ?? true}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.id === row.id ? { ...x, startFromBeginning: e.target.checked } : x))
                          )
                        }
                      />
                    </td>

                    <td className="py-2 text-right">
                      <button
                        className="px-3 py-1 rounded-xl border"
                        onClick={() => setItems((prev) => prev.filter((x) => x.id !== row.id))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!rows.length ? <p className="mt-4 text-zinc-600">Sem itens no schedule.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}