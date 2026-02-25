import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./features/dashboard/pages/Dashboard";
import Login from "./features/login/pages/Login";
import Reproduction from "./features/reproduction/pages/Reproduction";
import Schadule from "./features/schadule/pages/Schadule";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />

        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reproduction" element={<Reproduction />} />
        <Route path="/schadule" element={<Schadule />} />

        <Route path="*" element={<div>404</div>} />
      </Routes>
    </BrowserRouter>
  );
}