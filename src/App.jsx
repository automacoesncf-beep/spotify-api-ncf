import { Routes, Route, Navigate } from "react-router-dom";

import AppLayout from "./shared/layout/AppLayout.jsx";

import Dashboard from "./features/dashboard/pages/Dashboard";
import Login from "./features/login/pages/Login";
import Reproduction from "./features/reproduction/pages/Reproduction";
import Search from "./features/reproduction/pages/Search";
import Schadule from "./features/schadule/pages/Schadule";
import Playlists from "./features/playlist/pages/Playlists";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route path="dashboard" element={<Dashboard />} />
        <Route path="login" element={<Login />} />
        <Route path="reproduction" element={<Reproduction />} />
        <Route path="search" element={<Search />} />
        <Route path="schadule" element={<Schadule />} />
        <Route path="playlist" element={<Playlists />} />

        <Route path="*" element={<div className="text-zinc-700">Página não encontrada</div>} />
      </Route>
    </Routes>
  );
}