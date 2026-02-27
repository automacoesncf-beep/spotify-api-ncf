import express from "express";

const app = express();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:5179/callback";

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

function base64(str) {
  return Buffer.from(str).toString("base64");
}

app.get("/", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).send("Faltou SPOTIFY_CLIENT_ID ou SPOTIFY_CLIENT_SECRET no env");
    return;
  }

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);

  res.send(`
    <h2>Gerar Refresh Token</h2>
    <a href="${authUrl.toString()}">1) Clique aqui para autorizar</a>
    <p>Depois do login, você volta com o code e eu te mostro o refresh_token.</p>
  `);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Sem code na URL");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: REDIRECT_URI,
  });

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const tokenData = await tokenRes.json();

  res.send(`
    <h2>Tokens</h2>
    <pre>${JSON.stringify(tokenData, null, 2)}</pre>
    <p><b>Copie o refresh_token</b> e coloque no seu .env (SPOTIFY_REFRESH_TOKEN).</p>
  `);
});

app.listen(5179, () => console.log("Abra: http://localhost:5179"));