// src/features/reproduction/pages/Reproduction.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { SpotifyDevice, SpotifyPlaybackState } from "../api/types";
import {
  apiGetDevices,
  apiGetPlaybackState,
  apiNext,
  apiPause,
  apiPlayContext,
  apiPlayUris,
  apiPrevious,
  apiReloadSchedule,
  apiResume,
  apiSeek,
} from "../api/radioApi";

type NavState =
  | {
      playMode: "context";
      contextUri: string;
      selectedUri?: string;
      title?: string;
    }
  | {
      playMode: "uris";
      uris: string[];
      selectedUri?: string;
      title?: string;
    };

function fmtMs(ms?: number | null) {
  const v = Number(ms ?? 0);
  const total = Math.max(0, Math.floor(v / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Reproduction() {
  const { state } = useLocation() as { state?: Partial<NavState> };

  const playMode = (state?.playMode ?? "context") as "context" | "uris";
  const contextUri = (state as any)?.contextUri as string | undefined;
  const uris = (state as any)?.uris as string[] | undefined;
  const selectedUri = (state as any)?.selectedUri as string | undefined;
  const selectedTitle = (state as any)?.title as string | undefined;

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("spotify_device_id") ?? "");
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [msg, setMsg] = useState<string>("");

  const autoPlayed = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGetDevices();
        setDevices(d.devices ?? []);

        if (!deviceId) {
          const active = d.devices?.find((x) => x.is_active)?.id;
          const first = d.devices?.[0]?.id;
          const chosen = active ?? first ?? "";
          if (chosen) {
            setDeviceId(chosen);
            localStorage.setItem("spotify_device_id", chosen);
          }
        }
      } catch (e) {
        console.log(e);
        setMsg("Não consegui listar devices. Abra o Spotify no PC/celular e dê play 1x.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = async () => {
      const s = await apiGetPlaybackState().catch(() => null);
      setPlayback(s ?? null);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const isPlayingNow = !!playback?.is_playing;

  const isSelectedPlaying = useMemo(() => {
    if (!selectedUri) return false;
    if (!playback?.is_playing) return false;

    if (playMode === "uris") return playback?.item?.uri === selectedUri;

    const ctx = (playback as any)?.context?.uri;
    return ctx === selectedUri;
  }, [playback, playMode, selectedUri]);

  async function playSelected() {
    if (!deviceId) {
      setMsg("Selecione um device primeiro.");
      return;
    }

    try {
      if (playMode === "context") {
        if (!contextUri) {
          setMsg("Volte no Search e selecione um álbum/playlist.");
          return;
        }
        await apiPlayContext(deviceId, contextUri);
      } else {
        if (!uris?.length) {
          setMsg("Volte no Search e selecione uma música.");
          return;
        }
        await apiPlayUris(deviceId, uris);
      }
      setMsg(`Tocando: ${selectedTitle ?? "selecionado"}`);
    } catch (e) {
      console.log(e);
      setMsg("Falha ao tocar. Confirme se o device está ativo (Spotify aberto e tocando).");
      autoPlayed.current = false;
    }
  }

  useEffect(() => {
    if (!deviceId) return;
    if (autoPlayed.current) return;

    const hasSelection = (playMode === "context" && !!contextUri) || (playMode === "uris" && !!uris?.length);
    if (!hasSelection) return;

    autoPlayed.current = true;
    playSelected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const duration = playback?.item?.duration_ms ?? 0;
  const progress = playback?.progress_ms ?? 0;

  const trackName = playback?.item?.name ?? "";
  const artistName = playback?.item?.artists?.map((a) => a.name).join(", ") ?? "";
  const albumName = playback?.item?.album?.name ?? "";
  const cover =
    playback?.item?.album?.images?.[0]?.url ??
    playback?.item?.album?.images?.[1]?.url ??
    playback?.item?.album?.images?.[2]?.url ??
    "";

  const activeDeviceName = playback?.device?.name ?? devices.find((d) => d.id === deviceId)?.name ?? "";
  const activeDeviceType = playback?.device?.type ?? devices.find((d) => d.id === deviceId)?.type ?? "";

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-zinc-200">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900">Player</h1>
              <p className="text-sm text-zinc-600">
                {activeDeviceName ? `Device: ${activeDeviceName} (${activeDeviceType})` : "Selecione um device para tocar"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={async () => {
                  const r = await apiReloadSchedule().catch(() => null);
                  setMsg(r ? `Agendamento recarregado. Jobs: ${r.tasks}` : "Falha ao recarregar agendamento.");
                }}
              >
                Recarregar agenda
              </button>

              <select
                value={deviceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setDeviceId(id);
                  localStorage.setItem("spotify_device_id", id);
                  setMsg(`Device selecionado: ${devices.find((d) => d.id === id)?.name ?? id}`);
                  autoPlayed.current = false;
                }}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Selecione um device...</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.type}) {d.is_active ? "• ativo" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-6 p-6">
            {/* Cover */}
            <div className="flex flex-col items-center">
              <div className="relative w-full max-w-[320px] aspect-square rounded-3xl overflow-hidden bg-zinc-200 shadow-sm">
                {cover ? (
                  <img src={cover} alt="Capa" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-zinc-500 text-sm">
                    Sem capa (nada tocando)
                  </div>
                )}
              </div>

              <div className="mt-4 w-full max-w-[320px]">
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                      isPlayingNow ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-700",
                    ].join(" ")}
                  >
                    {isPlayingNow ? "Tocando agora" : "Pausado"}
                  </span>

                  {selectedTitle ? (
                    <span className="text-xs text-zinc-500 truncate max-w-[180px]">
                      Selecionado: {selectedTitle}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Info + Controls */}
            <div className="flex flex-col">
              <div>
                <h2 className="text-2xl font-bold text-zinc-900 leading-tight">
                  {trackName || "Nada tocando"}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">{artistName || "—"}</p>
                <p className="mt-1 text-sm text-zinc-500">{albumName || ""}</p>
              </div>

              {/* Progress */}
              <div className="mt-6">
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={progress}
                  onChange={(e) => deviceId && apiSeek(deviceId, Number(e.target.value))}
                  className="w-full"
                  disabled={!deviceId || !duration}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-600">
                  <span>{fmtMs(progress)}</span>
                  <span>{fmtMs(duration)}</span>
                </div>
              </div>

              {/* Buttons */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                  onClick={() => deviceId && apiPrevious(deviceId)}
                  disabled={!deviceId}
                >
                  ⏮ Prev
                </button>

                {/* Play/Pause agora */}
                <button
                  className={[
                    "rounded-2xl px-5 py-2 text-sm font-semibold transition disabled:opacity-60",
                    isPlayingNow ? "bg-zinc-900 text-white hover:bg-zinc-800" : "bg-white border border-zinc-300 text-zinc-900 hover:bg-zinc-50",
                  ].join(" ")}
                  onClick={() => {
                    if (!deviceId) return;
                    return isPlayingNow ? apiPause(deviceId) : apiResume(deviceId);
                  }}
                  disabled={!deviceId}
                >
                  {isPlayingNow ? "⏸ Pause (Agora)" : "▶ Play (Agora)"}
                </button>

                {/* Play selecionado */}
                <button
                  className={[
                    "rounded-2xl px-5 py-2 text-sm font-semibold transition disabled:opacity-60",
                    isSelectedPlaying
                      ? "bg-emerald-600 text-white cursor-not-allowed"
                      : "bg-indigo-600 text-white hover:bg-indigo-700",
                  ].join(" ")}
                  onClick={playSelected}
                  disabled={!deviceId || isSelectedPlaying}
                >
                  {isSelectedPlaying ? "✅ Selecionado tocando" : "▶ Play selecionado"}
                </button>

                <button
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                  onClick={() => deviceId && apiNext(deviceId)}
                  disabled={!deviceId}
                >
                  Next ⏭
                </button>
              </div>

              {msg ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  {msg}
                </div>
              ) : null}

              <div className="mt-6 text-xs text-zinc-500">
                Dica: se não aparecer device, abra o Spotify no PC/celular e dê play 1x.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}