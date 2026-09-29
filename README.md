# Lavender Scrabble

Two-player Scrabble, gated by a secret access code. No npm packages needed (Node 18+).

Run locally: `ACCESS_CODE=yoursecret TIME_MINUTES=15 node server.js` then open http://localhost:3000

Deploy (e.g. Render / Railway / Fly): push this folder to a GitHub repo, create a Node web service,
start command `npm start`, and set env vars ACCESS_CODE (your secret) and optionally TIME_MINUTES (per-player clock, default 15).
A static host (Netlify, GitHub Pages) will NOT work: the game needs this server.
