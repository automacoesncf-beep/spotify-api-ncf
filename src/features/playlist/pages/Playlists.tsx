// src/features/playlist/pages/Playlists.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  apiAddItemsToPlaylist,
  apiAiCreate,
  apiAiPreview,
  apiAuthStatus,
  apiClearPlaylist,
  apiCreatePlaylist,
  apiGetPlaylistDetails,
  apiGetPlaylistItems,
  apiGetPlaylistItemsAll,
  apiMe,
  apiMyPlaylists,
  apiRemoveItemsFromPlaylist,
  apiSearchTrack,
  apiUnfollowPlaylist,
  apiUpdatePlaylistDetails,
  type PlaylistItemLite,
  type PlaylistLite,
  type TrackLite,
} from "../api/playlistApi";

function pickImg(images?: { url: string }[]) {
  return images?.[0]?.url ?? images?.[1]?.url ?? images?.[2]?.url ?? "";
}

function uniqByUri(list: TrackLite[]) {
  const seen = new Set<string>();
  const out: TrackLite[] = [];
  for (const t of list) {
    if (!t?.uri) continue;
    if (seen.has(t.uri)) continue;
    seen.add(t.uri);
    out.push(t);
  }
  return out;
}

type Tab = "minhas" | "criar" | "ia";

// Mapeia itens (track ou episode) para o UI
function mapPlaylistItemsToLite(raw: any): PlaylistItemLite[] {
  const items = raw?.items ?? raw ?? [];
  const out: PlaylistItemLite[] = [];

  for (const it of items) {
    const obj = it?.track ?? it?.episode ?? it?.item ?? null;
    const uri = String(obj?.uri ?? "").trim();
    if (!uri) continue;

    const name = String(obj?.name ?? "").trim();

    const artists =
      Array.isArray(obj?.artists) && obj.artists.length
        ? obj.artists.map((a: any) => a?.name).filter(Boolean).join(", ")
        : "";

    // Track tem album; episode geralmente tem show/images
    const albumName = String(obj?.album?.name ?? obj?.show?.name ?? "").trim();
    const cover = pickImg(obj?.album?.images ?? obj?.images ?? obj?.show?.images);

    out.push({ uri, name, artists, album: albumName, cover });
  }

  return out;
}

export default function Playlists() {
  const nav = useNavigate();

  const [tab, setTab] = useState<Tab>("minhas");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [authOk, setAuthOk] = useState<boolean | null>(null);
  const [meId, setMeId] = useState<string>("");

  // Minhas playlists
  const [playlists, setPlaylists] = useState<PlaylistLite[]>([]);
  const [selected, setSelected] = useState<PlaylistLite | null>(null);

  // Detalhes da playlist selecionada (pra editar)
  const [plDetailsLoading, setPlDetailsLoading] = useState(false);
  const [plDetails, setPlDetails] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPublic, setEditPublic] = useState<boolean>(false);

  // Criar playlist
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPublic, setNewPublic] = useState(false);

  // Add tracks
  const [trackQ, setTrackQ] = useState("");
  const [trackResults, setTrackResults] = useState<TrackLite[]>([]);
  const [queue, setQueue] = useState<TrackLite[]>([]);

  // Itens da playlist (pra remover faixa)
  const [plItems, setPlItems] = useState<PlaylistItemLite[]>([]);
  const [plItemsLoading, setPlItemsLoading] = useState(false);

  // IA
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiCount, setAiCount] = useState(25);
  const [aiPreview, setAiPreview] = useState<null | {
    name: string;
    description: string;
    picked: Array<{ query: string; track: TrackLite | null }>;
    uris: string[];
  }>(null);
  const [aiPublic, setAiPublic] = useState(false);

  const selectedCover = pickImg(selected?.images);
  const queueUris = useMemo(() => queue.map((t) => t.uri).filter(Boolean), [queue]);

  const canProbablyEdit = useMemo(() => {
    if (!selected?.owner?.id) return true;
    if (!meId) return true;
    return selected.owner.id === meId;
  }, [selected?.owner?.id, meId]);

  async function loadAuthAndPlaylists(selectId?: string) {
    setLoading(true);
    setMsg("");
    try {
      const a = await apiAuthStatus();
      setAuthOk(!!a?.hasRefreshToken);

      const me = await apiMe().catch(() => null);
      setMeId(me?.me?.id ?? "");

      const r = await apiMyPlaylists(true);
      setPlaylists(r.items ?? []);

      const nextSelected =
        (selectId && r.items?.find((x) => x.id === selectId)) ||
        (selected?.id ? r.items?.find((x) => x.id === selected.id) : null) ||
        (r.items?.[0] ?? null);

      setSelected(nextSelected);
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao carregar playlists.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAuthAndPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sempre que trocar a playlist selecionada, carrega detalhes (pra editar)
  useEffect(() => {
    const id = selected?.id;
    if (!id) {
      setPlDetails(null);
      setEditName("");
      setEditDesc("");
      setEditPublic(false);
      return;
    }

    (async () => {
      setPlDetailsLoading(true);
      try {
        const r = await apiGetPlaylistDetails(id, { market: "BR" });
        const p = r?.playlist ?? null;
        setPlDetails(p);

        setEditName(String(p?.name ?? selected?.name ?? "").trim());
        setEditDesc(String(p?.description ?? "").trim());

        // Spotify pode retornar public null em alguns casos; trata como false
        setEditPublic(typeof p?.public === "boolean" ? p.public : false);
      } catch (e) {
        // Não bloqueia o resto do app se falhar (ex: playlist não acessível)
        console.log(e);
        setPlDetails(null);
      } finally {
        setPlDetailsLoading(false);
      }
    })();
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function searchTracks() {
    const q = trackQ.trim();
    if (!q) return;
    setLoading(true);
    setMsg("");
    try {
      const r = await apiSearchTrack(q);
      setTrackResults(r.items ?? []);
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao buscar músicas.");
    } finally {
      setLoading(false);
    }
  }

  async function createPlaylist() {
    const name = newName.trim();
    if (!name) return setMsg("Digite um nome para a playlist.");

    setLoading(true);
    setMsg("");
    try {
      const r = await apiCreatePlaylist({ name, description: newDesc.trim(), isPublic: newPublic });

      setNewName("");
      setNewDesc("");
      setNewPublic(false);

      setMsg("Playlist criada! Agora você pode adicionar músicas nela.");
      setTab("minhas");

      await loadAuthAndPlaylists(r.playlist.id);
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao criar playlist.");
    } finally {
      setLoading(false);
    }
  }

  async function savePlaylistDetails() {
    if (!selected?.id) return;

    const name = editName.trim();
    const description = editDesc.trim();

    if (!name) return setMsg("Nome não pode ficar vazio.");

    setLoading(true);
    setMsg("");
    try {
      await apiUpdatePlaylistDetails(selected.id, {
        name,
        description,
        isPublic: editPublic,
      });

      setMsg("Detalhes atualizados ✅");
      // recarrega listagem pra refletir o novo nome
      await loadAuthAndPlaylists(selected.id);
    } catch (e: any) {
      console.log(e);
      const m = e?.message ?? "Falha ao atualizar detalhes da playlist.";
      if (String(m).includes("403")) {
        setMsg("Sem permissão para editar detalhes dessa playlist (precisa ser sua ou colaborativa).");
      } else {
        setMsg(m);
      }
    } finally {
      setLoading(false);
    }
  }

  async function addQueueToPlaylist() {
    if (!selected?.id) return setMsg("Selecione uma playlist.");
    if (!queueUris.length) return setMsg("Adicione músicas na fila primeiro.");

    setLoading(true);
    setMsg("");
    try {
      const r = await apiAddItemsToPlaylist(selected.id, queueUris);
      setMsg(`Adicionado! Total: ${r.added}`);
      setQueue([]);
      setPlItems([]); // opcional: força recarregar itens
    } catch (e: any) {
      console.log(e);
      const m = e?.message ?? "Falha ao adicionar músicas.";
      if (String(m).includes("403")) {
        setMsg("Sem permissão para editar essa playlist. Só dá para editar playlists suas ou colaborativas.");
      } else {
        setMsg(m);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedItems(all = true) {
    if (!selected?.id) return;
    setPlItemsLoading(true);
    setMsg("");
    try {
      if (all) {
        // ✅ rota nova do backend: /items/all
        const r = await apiGetPlaylistItemsAll(selected.id, "BR");
        const lite = mapPlaylistItemsToLite(r.items);
        setPlItems(lite);
        if (!lite.length) setMsg("Não achei itens (ou a playlist está vazia / não acessível).");
        return;
      }

      // fallback (página 1)
      const r = await apiGetPlaylistItems(selected.id, 50, 0, "BR");
      const lite = mapPlaylistItemsToLite(r.data);
      setPlItems(lite);
      if (!lite.length) setMsg("Não achei itens (ou a playlist está vazia / não acessível).");
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao carregar itens da playlist.");
    } finally {
      setPlItemsLoading(false);
    }
  }

  async function removeOneTrack(trackUri: string) {
    if (!selected?.id) return;
    if (!trackUri) return;

    setLoading(true);
    setMsg("");
    try {
      const r = await apiRemoveItemsFromPlaylist(selected.id, [trackUri]);
      setMsg(`Removido! Itens: ${r.removed}`);
      setPlItems((prev) => prev.filter((x) => x.uri !== trackUri));
    } catch (e: any) {
      console.log(e);
      const m = e?.message ?? "Falha ao remover item.";
      if (String(m).includes("403")) {
        setMsg("Sem permissão para remover itens dessa playlist (precisa ser sua ou colaborativa).");
      } else {
        setMsg(m);
      }
    } finally {
      setLoading(false);
    }
  }

  async function clearPlaylist() {
    if (!selected?.id) return;

    const ok = window.confirm("Tem certeza? Isso vai ESVAZIAR a playlist.");
    if (!ok) return;

    setLoading(true);
    setMsg("");
    try {
      const r = await apiClearPlaylist(selected.id);
      setMsg(`Playlist esvaziada ✅ (removidos: ${r.removed})`);
      setPlItems([]);
    } catch (e: any) {
      console.log(e);
      const m = e?.message ?? "Falha ao limpar playlist.";
      if (String(m).includes("403")) {
        setMsg("Sem permissão para limpar essa playlist (precisa ser sua).");
      } else {
        setMsg(m);
      }
    } finally {
      setLoading(false);
    }
  }

  async function unfollowPlaylist() {
    if (!selected?.id) return;

    const ok = window.confirm("Remover essa playlist da sua conta (unfollow)? Ela some da sua biblioteca.");
    if (!ok) return;

    setLoading(true);
    setMsg("");
    try {
      await apiUnfollowPlaylist(selected.id);
      setMsg("Playlist removida da sua conta ✅");
      setSelected(null);
      setPlItems([]);
      await loadAuthAndPlaylists();
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao remover playlist.");
    } finally {
      setLoading(false);
    }
  }

  async function runAiPreview() {
    const p = aiPrompt.trim();
    if (!p) return setMsg("Escreva o comando da IA (ex: playlist de rock anos 80…).");

    setLoading(true);
    setMsg("");
    setAiPreview(null);
    try {
      const r = await apiAiPreview({ prompt: p, count: aiCount, market: "BR" });
      setAiPreview({
        name: r.plan.name,
        description: r.plan.description,
        picked: r.resolved.picked ?? [],
        uris: r.resolved.uris ?? [],
      });
      if (!r.resolved.uris?.length) {
        setMsg("Preview gerou 0 músicas resolvidas. Tente um prompt mais específico (ex: 'rock anos 80 internacional').");
      } else {
        setMsg("Preview pronto. Se curtir, crie a playlist com 1 clique.");
      }
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao gerar preview IA. (Confirme OPENAI_API_KEY no backend)");
    } finally {
      setLoading(false);
    }
  }

  async function createFromAi() {
    const p = aiPrompt.trim();
    if (!p) return setMsg("Escreva o comando da IA.");

    setLoading(true);
    setMsg("");
    try {
      const r = await apiAiCreate({ prompt: p, count: aiCount, market: "BR", isPublic: aiPublic });
      setMsg(`Playlist IA criada ✅ (${r.added} músicas)`);
      setTab("minhas");
      await loadAuthAndPlaylists(r.playlist.id);
    } catch (e: any) {
      console.log(e);
      setMsg(e?.message ?? "Falha ao criar playlist com IA.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Header */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">Playlists</h1>
              <p className="text-sm text-zinc-600">Criar, buscar, adicionar e remover faixas direto no seu Spotify.</p>
            </div>

            <button
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
              onClick={() => loadAuthAndPlaylists()}
              disabled={loading}
            >
              Atualizar
            </button>
          </div>

          {authOk === false ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              Spotify não conectado. Abra <b>http://127.0.0.1:3001/auth/login</b> para autorizar e salvar o refresh_token.
            </div>
          ) : null}

          {msg ? <p className="mt-3 text-sm text-zinc-600">{msg}</p> : null}

          {/* Tabs */}
          <div className="mt-4 flex gap-2 flex-wrap">
            {[
              { key: "minhas", label: "Minhas playlists" },
              { key: "criar", label: "Criar" },
              { key: "ia", label: "IA" },
            ].map((t: any) => (
              <button
                key={t.key}
                className={[
                  "rounded-xl px-3 py-2 text-sm font-semibold",
                  tab === t.key ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
                ].join(" ")}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Criar */}
        {tab === "criar" ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Criar playlist</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-zinc-700">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Rádio Eletrônica"
                />
              </div>

              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={newPublic} onChange={(e) => setNewPublic(e.target.checked)} />
                  Pública
                </label>
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-zinc-700">Descrição (opcional)</label>
                <textarea
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Ex: Playlist pra tocar no bar..."
                  rows={3}
                />
              </div>
            </div>

            <button
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              onClick={createPlaylist}
              disabled={loading}
            >
              Criar no Spotify
            </button>
          </div>
        ) : null}

        {/* IA */}
        {tab === "ia" ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-900">Criar playlist com IA</h2>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-zinc-700">Comando</label>
                <textarea
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder='Ex: "crie uma playlist animada para academia, com 40 músicas"'
                  rows={4}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-zinc-700">Quantidade</label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={aiCount}
                  onChange={(e) => setAiCount(Number(e.target.value))}
                />

                <label className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={aiPublic} onChange={(e) => setAiPublic(e.target.checked)} />
                  Playlist pública
                </label>

                <button
                  className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                  onClick={runAiPreview}
                  disabled={loading}
                >
                  Gerar preview
                </button>

                <button
                  className="mt-2 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  onClick={createFromAi}
                  disabled={loading}
                >
                  Criar no Spotify
                </button>
              </div>
            </div>

            {aiPreview ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm text-zinc-600">Nome</div>
                    <div className="text-lg font-semibold text-zinc-900">{aiPreview.name}</div>
                    <div className="text-sm text-zinc-600 mt-1">{aiPreview.description}</div>
                  </div>
                  <div className="text-sm text-zinc-700">
                    Resolvidas: <b>{aiPreview.uris.length}</b>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {aiPreview.picked.slice(0, 30).map((p, idx) => {
                    const t = p.track;
                    const cover = t ? pickImg(t.album?.images) : "";
                    return (
                      <div key={idx} className="flex items-center gap-3 rounded-xl bg-white border border-zinc-200 p-2">
                        <div className="h-10 w-10 rounded-lg bg-zinc-200 overflow-hidden">
                          {cover ? <img src={cover} alt="" className="h-10 w-10 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-zinc-900 truncate">
                            {t ? t.name : `Não resolvido: ${p.query}`}
                          </div>
                          <div className="text-xs text-zinc-600 truncate">
                            {t ? `${t.artists?.map((a) => a.name).join(", ") ?? ""} • ${t.album?.name ?? ""}` : p.query}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Minhas playlists + gerenciar */}
        {tab === "minhas" ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-4">
            {/* list */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900">Minhas playlists</h2>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {playlists.map((p) => {
                  const img = pickImg(p.images);
                  const isSel = selected?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelected(p);
                        setPlItems([]);
                      }}
                      className={[
                        "text-left rounded-2xl border p-3 hover:bg-zinc-50 transition",
                        isSel ? "border-indigo-300 bg-indigo-50" : "border-zinc-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="flex gap-3">
                        <div className="w-14 h-14 rounded-xl bg-zinc-200 overflow-hidden shrink-0">
                          {img ? <img src={img} alt={p.name} className="w-14 h-14 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-zinc-900 truncate">{p.name}</div>
                          <div className="text-xs text-zinc-600 truncate">
                            {p.owner?.display_name ? `por ${p.owner.display_name}` : ""}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            {typeof p.tracks?.total === "number" ? `${p.tracks.total} músicas` : ""}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {!playlists.length ? <p className="mt-4 text-sm text-zinc-600">Nenhuma playlist encontrada.</p> : null}
            </div>

            {/* manage */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900">Gerenciar</h2>

              {selected ? (
                <>
                  <div className="mt-3 flex gap-3">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-200 overflow-hidden shrink-0">
                      {selectedCover ? <img src={selectedCover} alt="" className="w-16 h-16 object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-zinc-900 truncate">{selected.name}</div>
                      <div className="text-xs text-zinc-600 truncate">{selected.owner?.display_name ?? ""}</div>
                      <div className="text-xs text-zinc-500 mt-1 truncate">{selected.uri}</div>
                    </div>
                  </div>

                  {!canProbablyEdit ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                      Aviso: essa playlist parece não ser sua. Pode dar <b>403</b> ao tentar adicionar/remover/editar.
                    </div>
                  ) : null}

                  {/* Ações principais */}
                  <div className="mt-3 flex gap-2 flex-wrap">
                    <button
                      className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                      onClick={() =>
                        nav("/reproduction", {
                          state: {
                            playMode: "context",
                            contextUri: selected.uri,
                            selectedUri: selected.uri,
                            title: selected.name,
                          },
                        })
                      }
                    >
                      Tocar no Player
                    </button>

                    <button
                      className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                      onClick={() => navigator.clipboard.writeText(selected.uri)}
                    >
                      Copiar URI
                    </button>

                    <button
                      className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                      onClick={() => loadSelectedItems(true)}
                      disabled={plItemsLoading}
                    >
                      {plItemsLoading ? "Carregando..." : "Carregar TODAS as músicas"}
                    </button>

                    <button
                      className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                      onClick={clearPlaylist}
                      disabled={loading}
                    >
                      Esvaziar playlist
                    </button>

                    <button
                      className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100"
                      onClick={unfollowPlaylist}
                      disabled={loading}
                    >
                      Remover do meu Spotify
                    </button>
                  </div>

                  {/* Editar detalhes */}
                  <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-900">Editar detalhes</div>
                      <div className="text-xs text-zinc-600">{plDetailsLoading ? "Carregando detalhes..." : ""}</div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="text-xs font-semibold text-zinc-700">Nome</label>
                        <input
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-zinc-700">Descrição</label>
                        <textarea
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          rows={3}
                        />
                      </div>

                      <label className="flex items-center gap-2 text-sm text-zinc-700">
                        <input type="checkbox" checked={editPublic} onChange={(e) => setEditPublic(e.target.checked)} />
                        Pública
                      </label>

                      <button
                        className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        onClick={savePlaylistDetails}
                        disabled={loading}
                      >
                        Salvar alterações
                      </button>

                      {plDetails ? (
                        <div className="text-[11px] text-zinc-600 mt-1">
                          Snapshot: <b>{String(plDetails?.snapshot_id ?? "-")}</b>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Itens da playlist (remover item) */}
                  {plItems.length ? (
                    <div className="mt-4">
                      <div className="text-sm font-semibold text-zinc-900">Itens na playlist (remover)</div>
                      <div className="mt-2 max-h-56 overflow-auto space-y-2">
                        {plItems.map((x) => (
                          <div key={x.uri} className="flex gap-3 items-center rounded-xl border border-zinc-200 bg-white p-2">
                            <div className="w-10 h-10 rounded-lg bg-zinc-200 overflow-hidden shrink-0">
                              {x.cover ? <img src={x.cover} alt="" className="w-10 h-10 object-cover" /> : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-zinc-900 truncate">{x.name}</div>
                              <div className="text-xs text-zinc-600 truncate">
                                {x.artists ? `${x.artists} • ` : ""}
                                {x.album}
                              </div>
                            </div>
                            <button
                              className="rounded-xl border px-3 py-1 text-sm font-semibold hover:bg-zinc-50"
                              onClick={() => removeOneTrack(x.uri)}
                              disabled={loading}
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Search tracks */}
                  <div className="mt-5">
                    <div className="text-sm font-semibold text-zinc-900">Buscar músicas e adicionar</div>

                    <div className="mt-2 flex gap-2">
                      <input
                        value={trackQ}
                        onChange={(e) => setTrackQ(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchTracks()}
                        placeholder="Ex: livin 50 cent"
                        className="w-full rounded-xl border px-3 py-2"
                      />
                      <button
                        className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        onClick={searchTracks}
                        disabled={loading}
                      >
                        Buscar
                      </button>
                    </div>

                    {trackResults.length ? (
                      <div className="mt-3 max-h-56 overflow-auto space-y-2">
                        {trackResults.map((t) => {
                          const img = pickImg(t.album?.images);
                          const sub = `${t.artists?.map((a) => a.name).join(", ") ?? ""} • ${t.album?.name ?? ""}`;
                          return (
                            <div key={t.id} className="flex gap-3 items-center rounded-xl border border-zinc-200 bg-white p-2">
                              <div className="w-10 h-10 rounded-lg bg-zinc-200 overflow-hidden shrink-0">
                                {img ? <img src={img} alt="" className="w-10 h-10 object-cover" /> : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-zinc-900 truncate">{t.name}</div>
                                <div className="text-xs text-zinc-600 truncate">{sub}</div>
                              </div>
                              <button
                                className="rounded-xl border px-3 py-1 text-sm font-semibold hover:bg-zinc-50"
                                onClick={() => setQueue((prev) => uniqByUri([...prev, t]))}
                              >
                                + Fila
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-600">Digite e busque para aparecer resultados.</p>
                    )}
                  </div>

                  {/* queue */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-zinc-900">Fila para adicionar</div>
                      <button className="text-sm font-semibold text-zinc-600 hover:text-zinc-900" onClick={() => setQueue([])}>
                        Limpar
                      </button>
                    </div>

                    {queue.length ? (
                      <>
                        <div className="mt-2 max-h-40 overflow-auto space-y-2">
                          {queue.map((t) => (
                            <div key={t.uri} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 p-2">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-zinc-900 truncate">{t.name}</div>
                                <div className="text-xs text-zinc-600 truncate">{t.artists?.map((a) => a.name).join(", ") ?? ""}</div>
                              </div>
                              <button
                                className="rounded-xl border px-3 py-1 text-sm font-semibold hover:bg-zinc-50"
                                onClick={() => setQueue((prev) => prev.filter((x) => x.uri !== t.uri))}
                              >
                                Remover
                              </button>
                            </div>
                          ))}
                        </div>

                        <button
                          className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          onClick={addQueueToPlaylist}
                          disabled={loading}
                        >
                          Adicionar {queue.length} músicas na playlist
                        </button>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-600">Nenhuma música na fila.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-zinc-600">Selecione uma playlist à esquerda.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}