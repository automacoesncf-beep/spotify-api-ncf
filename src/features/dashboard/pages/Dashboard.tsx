import { useState } from "react";

export default function Dashboard() {
  return (
   <section>


    <div className="min-h-screen bg-zinc-50 p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-zinc-900">Reprodução</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Controle a lista de Reproduçao do Spotify
        </p>

        <button className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">
          Ação
        </button>
      </div>
    </div>

    </section> 
  );
}