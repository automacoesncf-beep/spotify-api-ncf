import { useState } from "react";

export default function Dashboard(){

    return(

    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-zinc-900">Título do card</h3>
      <p className="mt-1 text-sm text-zinc-600">
        Aqui vai um texto/descrição do card.
      </p>

      <button className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">
        Ação
      </button>
    </div>
  );

}
