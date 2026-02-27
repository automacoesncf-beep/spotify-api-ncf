import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { SpotifyDevice, SpotifyPlaybackState } from "../api/types";
import {
  getDevices,
  getPlaybackState,
  nextTrack,
  pause,
  playContext,
  prevTrack,
  seek,
  setVolume,
} from "../api/spotify";

export default function Reproduction() {
  const { state } = useLocation() as any;
  const contextUri = state?.contextUri as string | undefined;

  // ✅ você pode colocar esse token vindo do seu login (PKCE) depois
  const tokenUser = useMemo(() => localStorage.getItem("spotify_user_token") ?? "", []);

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);

  useEffect(() => {
    if (!tokenUser) return;

    getDevices(tokenUser)
      .then((d) => {
        setDevices(d.devices ?? []);
        const active = d.devices?.find((x) => x.is_active)?.id;
        setDeviceId(active ?? d.devices?.[0]?.id ?? "");
      })
      .catch(console.log);
  }, [tokenUser]);

  useEffect(() => {
    if (!tokenUser) return;

    const tick = async () => {
      const s = await getPlaybackState(tokenUser).catch(() => null);
      setPlayback(s ?? null);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tokenUser]);

  if (!tokenUser) {
    return (
      <div className="p-6">
        <div className="bg-white border rounded-2xl p-4">
          <p className="text-zinc-800 font-semibold">Token de usuário ausente.</p>
          <p className="text-zinc-600 text-sm mt-1">
            Para usar Play/Pause/Next/Seek você precisa do token de usuário (PKCE/refresh_token).
          </p>
        </div>
      </div>
    );
  }

  const duration = playback?.item?.duration_ms ?? 0;
  const progress = playback?.progress_ms ?? 0;

  return (
    <div className="p-6">
      <div className="bg-white border rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.type}) {d.is_active ? "• ativo" : ""}
              </option>
            ))}
          </select>

          <button className="px-3 py-2 border rounded" onClick={() => prevTrack(tokenUser, deviceId)}>
            Prev
          </button>

          <button className="px-3 py-2 border rounded" onClick={() => pause(tokenUser, deviceId)}>
            Pause
          </button>

          <button
            className="px-3 py-2 bg-indigo-600 text-white rounded"
            onClick={() => {
              if (!contextUri) return;
              playContext(tokenUser, deviceId, contextUri);
            }}
          >
            Play selecionado
          </button>

          <button className="px-3 py-2 border rounded" onClick={() => nextTrack(tokenUser, deviceId)}>
            Next
          </button>
        </div>

        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={duration}
            value={progress}
            onChange={(e) => seek(tokenUser, deviceId, Number(e.target.value))}
            className="w-full"
          />
          <div className="text-sm text-zinc-600 mt-1">
            {playback?.item ? `${playback.item.name} — ${playback.item.artists?.[0]?.name ?? ""}` : "Nada tocando"}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm text-zinc-700">Volume</label>
          <input
            type="range"
            min={0}
            max={100}
            defaultValue={playback?.device?.volume_percent ?? 50}
            onChange={(e) => setVolume(tokenUser, deviceId, Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}