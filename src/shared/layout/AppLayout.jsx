import { NavLink, Outlet } from "react-router-dom";

const navClass = ({ isActive }) =>
  [
    "rounded-xl px-3 py-2 text-sm font-semibold transition",
    isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100",
  ].join(" ");

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="font-bold text-zinc-900">Spotify Nautico</div>

          <nav className="flex gap-2">
            <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
            <NavLink to="/search" className={navClass}>Search</NavLink>
            <NavLink to="/reproduction" className={navClass}>Player</NavLink>
            <NavLink to="/schadule" className={navClass}>Agenda</NavLink>
            <NavLink to="/playlist" className={navClass}>Playlists</NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}