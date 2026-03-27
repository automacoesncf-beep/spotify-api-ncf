import { useState, useEffect } from "react";
const CLIENT_ID = "15ac21bfd8844362a70cb1c18c006817"
const CLIENT_SECRET = "0c35325e43274934a9635c0a7a525127"

export default function Search() {

    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [acessToken, setAcessToken] = useState("");
    const [albums , setAlbums] = useState([]);

    useEffect(() => {

        var authParameters = {
            //API TOKEN
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials&client_id=' + CLIENT_ID + '&client_secret=' + CLIENT_SECRET
        }


        fetch('https://accounts.spotify.com/api/token', authParameters)
            .then(result => result.json())
            .then(data => setAcessToken(data.access_token))
    }, [])

    // Buscar

    async function search() {
        console.log("Buscando por " + searchInput);

        //Usando get request para pegar o id do artista
        var searchParameters = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + acessToken
            }

        }

        var artistID = await fetch('https://api.spotify.com/v1/search?q=' + searchInput  + '&type=artist', searchParameters)
        //get request com id para qpegar todos os artdstas
        .then(resposne => resposne.json())
        .then(data => { return data.artists.items[0].id})

        console.log("Artist ID" , + artistID);

        //Receba uma solicitação com o ID do artista e baixe todos os álbuns desse artista.
        var returnedAlbums = await fetch('https://api.spotify.com/v1/artists/' + artistID + '/albums?include_groups=album&market=from_token&limit=20', searchParameters)
        .then(response => response.json())
        .then(data =>{
            console.log(data);
            setAlbums(data.items);
        });




    }

   

    return (
        <section className="min-h-screen bg-zinc-100">
            <div className="container mx-auto max-w-5xl p-4 md:p-6">
                <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-4 md:p-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-zinc-900">Search</h1>
                            <p className="text-sm text-zinc-600">Pesquise e liste resultados</p>
                        </div>

                        <input
                            value={searchInput}
                            onChange={event => setSearchInput(event.target.value)}
                            placeholder="Digite para buscar..."
                            className="w-full max-w-sm px-4 py-3 rounded-xl border border-zinc-200 outline-none focus:ring-2 focus:ring-zinc-300"
                            onKeyPress={event => {

                                if (event.key === "Enter") {
                                    search();
                                }
                            }}

                        />
                        <button className="w-40 px-4 py-2 bg-indigo-600 text-white rounded "
                            onClick={search}
                        >
                            Procurar
                        </button>
                    </div>

                </div>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <a
                            href="https://google.com"
                            target="_blank"
                            className="block bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
                        >
                            <img
                                src="#"
                                alt="Produto"
                                className="w-full h-48 object-cover"
                            />

                            <div className="p-4">
                                <h2 className="font-semibold text-zinc-900">Título do Card</h2>
                                <p className="text-sm text-zinc-600 mt-1">
                                    Pequena descrição aqui
                                </p>
                            </div>
                        </a>
                    </div>
                    <div>
                        <a
                            href="https://google.com"
                            target="_blank"
                            className="block bg-white border border-zinc-200 rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden"
                        >
                            <img
                                src="#"
                                alt="Produto"
                                className="w-full h-48 object-cover"
                            />

                            <div className="p-4">
                                <h2 className="font-semibold text-zinc-900">Título do Card</h2>
                                <p className="text-sm text-zinc-600 mt-1">
                                    Pequena descrição aqui
                                </p>
                            </div>
                        </a>
                    </div>
                </div>

            </div>
        </section>
    );
}