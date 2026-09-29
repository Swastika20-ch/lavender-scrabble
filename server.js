// Lavender Scrabble server: no npm packages needed (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const CODE = process.env.ACCESS_CODE || 'lavender';
const PORT = process.env.PORT || 3000;
const TIME = (+process.env.TIME_MINUTES || 15) * 60000; // per-player clock
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
if (!process.env.ACCESS_CODE) console.warn('WARNING: using default access code "lavender". Set ACCESS_CODE!');

let rooms = {}; try { rooms = JSON.parse(fs.readFileSync(DATA)); } catch (e) {}
const live = {}, fails = {};
const save = () => { try { fs.writeFileSync(DATA, JSON.stringify(rooms)); } catch (e) {} };
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const push = n => (live[n] || []).forEach(res => res.write('data: ' + JSON.stringify({ state: rooms[n].state, now: Date.now() }) + '\n\n'));
const body = req => new Promise((ok, no) => { let b = ''; req.on('data', d => { b += d; if (b.length > 2e5) { req.destroy(); no(); } }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(); } }); });
const same = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
setInterval(() => Object.values(live).forEach(s => s.forEach(r => r.write(': hb\n\n'))), 25000);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (u.pathname === '/healthz') return send(res, 200, { ok: 1 });

    if (req.method === 'POST' && u.pathname === '/api/join') {
      const b = await body(req), ip = req.socket.remoteAddress;
      if ((fails[ip] || 0) >= 10) return send(res, 429, { error: 'Too many wrong tries. Wait a few minutes.' });
      if (!same(b.code || '', CODE)) { fails[ip] = (fails[ip] || 0) + 1; setTimeout(() => fails[ip]--, 600000); return send(res, 403, { error: 'Wrong access code.' }); }
      const name = String(b.name || '').trim().slice(0, 20), rn = String(b.room || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
      if (!name || !rn) return send(res, 400, { error: 'Need a name and a room.' });
      if (!rooms[rn] && Object.keys(rooms).length >= 50) return send(res, 400, { error: 'Server is full.' });
      const r = rooms[rn] = rooms[rn] || { seats: [null, null], state: null };
      let seat = r.seats.findIndex(s => s && s.name.toLowerCase() === name.toLowerCase());
      if (seat < 0) {
        seat = r.seats.findIndex(s => !s);
        if (seat < 0) return send(res, 403, { error: 'That room already has two players.' });
        r.seats[seat] = { name, token: crypto.randomBytes(12).toString('hex') };
      }
      const st = r.state;
      if (st && !st.n[seat]) { st.n[seat] = name; st.v++; if (st.n[0] && st.n[1]) st.ts = Date.now(); }
      save(); push(rn);
      return send(res, 200, { seat, token: r.seats[seat].token, time: TIME });
    }

    if (u.pathname === '/api/events') {
      const rn = u.searchParams.get('room'), r = rooms[rn];
      if (!r || !r.seats.some(s => s && s.token === u.searchParams.get('token'))) return send(res, 403, { error: 'no' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      (live[rn] = live[rn] || new Set()).add(res);
      res.write('data: ' + JSON.stringify({ state: r.state, now: Date.now() }) + '\n\n');
      req.on('close', () => live[rn].delete(res));
      return;
    }

    if (req.method === 'POST' && u.pathname === '/api/act') {
      const b = await body(req), r = rooms[b.room];
      const seat = r ? r.seats.findIndex(s => s && s.token === b.token) : -1;
      if (seat < 0) return send(res, 403, { error: 'Not allowed.' });
      const cur = r.state, now = Date.now(), inc = b.state; let out;
      const lose = (who, extra) => { const o = { ...cur, over: true, timeup: who, v: cur.v + 1, rem: [...cur.rem], ...extra }; o.rem[who] = 0; o.log = [...cur.log, `${cur.n[who]} ran out of time.`]; return o; };
      if (b.kind === 'init') {
        if (cur && !cur.over) return send(res, 409, { error: 'A game is already in progress.' });
        if (!inc || !Array.isArray(inc.b)) return send(res, 400, { error: 'Bad state.' });
        out = inc; out.n = [r.seats[0] ? r.seats[0].name : '', r.seats[1] ? r.seats[1].name : ''];
        out.rem = [TIME, TIME]; out.ts = out.n[0] && out.n[1] ? now : 0; out.v = (cur ? cur.v : 0) + 1; out.timeup = null;
      } else if (!cur) return send(res, 409, { error: 'No game yet.' });
      else if (b.kind === 'timeout') {
        if (cur.over || !cur.ts || cur.rem[cur.t] - (now - cur.ts) > 0) return send(res, 200, { ok: 1 });
        out = lose(cur.t);
      } else if (!inc || inc.v !== cur.v + 1 || cur.over) return send(res, 409, { error: 'Out of sync, try again.' });
      else if (b.kind === 'move') {
        if (seat !== cur.t) return send(res, 409, { error: "It's not your turn." });
        const rem = [...cur.rem]; rem[seat] -= now - cur.ts;
        if (rem[seat] <= 0) out = lose(seat);
        else { out = inc; out.rem = rem; out.ts = now; out.n = cur.n; }
      } else if (b.kind === 'undo') { out = inc; out.rem = cur.rem; out.n = cur.n; out.ts = now; }
      else return send(res, 400, { error: 'Unknown action.' });
      r.state = out; save(); push(b.room);
      return send(res, 200, { ok: 1 });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { try { send(res, 500, { error: 'Server error' }); } catch (_) {} }
}).listen(PORT, () => console.log('Lavender Scrabble running on port ' + PORT));
