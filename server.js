const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // Längere Timeouts → kurzer Tab-Wechsel trennt nicht sofort
  pingInterval: 10000,   // alle 10s ping
  pingTimeout:  60000    // erst nach 60s ohne Antwort trennen
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── HILFSFUNKTIONEN ──────────────────────────────────────────────────────────
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function genCode()  { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function genToken() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r, dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*d2r)*Math.cos(lat2*d2r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── SESSION-VERWALTUNG ───────────────────────────────────────────────────────
// token → { room, socketId, name }
const sessions = {};
// socketId → setTimeout-Handle (Grace-Period-Timer)
const disconnectTimers = {};

function createSession(socketId, room, name) {
  const token = genToken();
  sessions[token] = { room, socketId, name };
  return token;
}

function clearDisconnectTimer(socketId) {
  if (disconnectTimers[socketId]) {
    clearTimeout(disconnectTimers[socketId]);
    delete disconnectTimers[socketId];
  }
}

// Spieler wirklich entfernen (nach Grace-Period oder wenn Raum leer)
function removePlayer(socketId, code) {
  const room = rooms[code];
  if (!room || !room.players[socketId]) return;

  const name = room.players[socketId].name || '?';
  delete room.players[socketId];
  delete room.answers[socketId];
  if (room.playerQuestions) delete room.playerQuestions[socketId];
  if (room.doneCreating)    room.doneCreating.delete(socketId);
  if (room.readySet)        room.readySet.delete(socketId);

  if (Object.keys(room.players).length === 0) { delete rooms[code]; return; }
  if (room.host === socketId) room.host = Object.keys(room.players)[0];

  io.to(code).emit('msg', `${name} hat das Spiel verlassen.`);
  emitState(code);

  const pc = Object.keys(room.players).length;
  if (room.phase === 'creating' && pc > 0 && room.doneCreating.size >= pc)
    setTimeout(() => startGameFromQuestions(code), 1500);
  if (room.phase === 'question' && pc > 0 && Object.keys(room.answers).length >= pc)
    closeRound(code);
  if (room.phase === 'results' && pc > 0 && room.readySet.size >= pc)
    advanceRound(code);
}

// ── STATE-BROADCAST ──────────────────────────────────────────────────────────
function getCreationProgress(room) {
  return Object.entries(room.players).map(([id, p]) => ({
    id, name: p.name,
    count: (room.playerQuestions[id] || []).length,
    done:  room.doneCreating.has(id),
    max:   room.questionsPerPlayer
  }));
}

function publicState(room) {
  return {
    phase: room.phase,
    hostId: room.host,
    qIdx:   room.qIdx,
    totalQ: room.questions ? room.questions.length : 0,
    questionsPerPlayer: room.questionsPerPlayer || 5,
    players: Object.entries(room.players).map(([id, p]) => ({
      id, name: p.name, score: p.score, isHost: id === room.host,
      locked: !!room.answers[id]
    })),
    creationProgress: room.phase === 'creating' ? getCreationProgress(room) : null
  };
}

function emitState(code) {
  const room = rooms[code];
  if (!room) return;
  const base = publicState(room);
  Object.keys(room.players).forEach(id =>
    io.to(id).emit('state', { ...base, myId: id })
  );
}

// ── SPIELLOGIK ───────────────────────────────────────────────────────────────
function startGameFromQuestions(code) {
  const room = rooms[code];
  const allQ = [];
  Object.values(room.playerQuestions).forEach(qs => allQ.push(...qs));
  room.questions  = shuffle(allQ);
  room.qIdx       = 0;
  room.phase      = 'question';
  room.answers    = {};
  room.readySet   = new Set();
  const q = room.questions[0];
  io.to(code).emit('new_question', { text: q.q, qIdx: 0, totalQ: room.questions.length, creatorName: q.creatorName });
  emitState(code);
}

function closeRound(code) {
  const room = rooms[code];
  const q = room.questions[room.qIdx];
  const results = Object.entries(room.answers).map(([id, ans]) => ({
    id, name: room.players[id]?.name || '?',
    lat: ans.lat, lng: ans.lng,
    dist: haversine(ans.lat, ans.lng, q.lat, q.lng)
  }));
  results.sort((a, b) => a.dist - b.dist);

  const pts = [8, 5, 2];
  results.forEach((r, i) => {
    r.pts = pts[i] || 0;
    if (room.players[r.id]) room.players[r.id].score += r.pts;
  });

  room.phase    = 'results';
  room.readySet = new Set();
  const scores  = Object.entries(room.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);

  const payload = {
    results, scores,
    correct: { lat: q.lat, lng: q.lng, info: q.info, creatorName: q.creatorName },
    qIdx: room.qIdx, totalQ: room.questions.length
  };
  room.lastRoundResults = payload; // für Wiederverbindung
  io.to(code).emit('round_results', payload);
  emitState(code);
}

function advanceRound(code) {
  const room = rooms[code];
  room.qIdx++;
  if (room.qIdx >= room.questions.length) {
    room.phase = 'gameover';
    const final = Object.entries(room.players)
      .map(([id, p]) => ({ id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);
    const payload = { scores: final };
    room.lastGameOver = payload;
    io.to(code).emit('game_over', payload);
    emitState(code);
  } else {
    room.phase    = 'question';
    room.answers  = {};
    room.readySet = new Set();
    const q = room.questions[room.qIdx];
    io.to(code).emit('new_question', { text: q.q, qIdx: room.qIdx, totalQ: room.questions.length, creatorName: q.creatorName });
    emitState(code);
  }
}

// ── RÄUME ────────────────────────────────────────────────────────────────────
const rooms = {};

io.on('connection', socket => {

  // ── RAUM ERSTELLEN ──────────────────────────────────────────────
  socket.on('create_room', ({ name, questionsPerPlayer }) => {
    const qpp  = Math.min(10, Math.max(1, parseInt(questionsPerPlayer) || 5));
    const code = genCode();
    rooms[code] = {
      host: socket.id,
      players: { [socket.id]: { name, score: 0 } },
      phase: 'lobby', questionsPerPlayer: qpp,
      questions: null, playerQuestions: {}, doneCreating: new Set(),
      qIdx: 0, answers: {}, readySet: new Set(),
      lastRoundResults: null, lastGameOver: null
    };
    socket.join(code);
    socket.data = { room: code, name };

    const token = createSession(socket.id, code, name);
    socket.emit('room_created', { code });
    socket.emit('session', { token, code });
    emitState(code);
  });

  // ── RAUM BEITRETEN ──────────────────────────────────────────────
  socket.on('join_room', ({ code, name }) => {
    const c = code.toUpperCase().trim();
    const room = rooms[c];
    if (!room)                                { socket.emit('err', 'Raum nicht gefunden.');        return; }
    if (room.phase !== 'lobby')               { socket.emit('err', 'Das Spiel läuft bereits.');    return; }
    if (Object.keys(room.players).length >= 8){ socket.emit('err', 'Raum ist voll (max. 8).');     return; }

    room.players[socket.id] = { name, score: 0 };
    socket.join(c);
    socket.data = { room: c, name };

    const token = createSession(socket.id, c, name);
    socket.emit('joined', { code: c });
    socket.emit('session', { token, code: c });
    io.to(c).emit('msg', `${name} ist beigetreten 🎉`);
    emitState(c);
  });

  // ── WIEDERVERBINDUNG ─────────────────────────────────────────────
  socket.on('rejoin_room', ({ token }) => {
    const session = sessions[token];
    if (!session) { socket.emit('rejoin_failed', 'Session abgelaufen.'); return; }

    const { room: code, socketId: oldId, name } = session;
    const room = rooms[code];
    if (!room)    { socket.emit('rejoin_failed', 'Raum nicht mehr vorhanden.'); return; }

    // Grace-Period-Timer abbrechen – Spieler kommt zurück
    clearDisconnectTimer(oldId);

    // Socket-ID im Token aktualisieren
    sessions[token].socketId = socket.id;

    // Spieler-Daten von alter auf neue Socket-ID migrieren
    const playerData = room.players[oldId] || { name, score: 0 };
    room.players[socket.id] = playerData;
    if (oldId !== socket.id) delete room.players[oldId];

    if (room.answers[oldId])                    { room.answers[socket.id] = room.answers[oldId];                       delete room.answers[oldId]; }
    if (room.readySet?.has(oldId))              { room.readySet.delete(oldId);        room.readySet.add(socket.id); }
    if (room.doneCreating?.has(oldId))          { room.doneCreating.delete(oldId);    room.doneCreating.add(socket.id); }
    if (room.playerQuestions?.[oldId])          { room.playerQuestions[socket.id] = room.playerQuestions[oldId]; delete room.playerQuestions[oldId]; }
    if (room.host === oldId)                    room.host = socket.id;

    socket.join(code);
    socket.data = { room: code, name };

    socket.emit('rejoined', { code });
    socket.emit('session', { token, code }); // Token bestätigen
    emitState(code);
    io.to(code).emit('msg', `${name} ist zurück 👋`);

    // Aktuellen Spielzustand wiederherstellen
    if (room.phase === 'creating') {
      const count = (room.playerQuestions[socket.id] || []).length;
      socket.emit('start_creating', { questionsPerPlayer: room.questionsPerPlayer });
      if (count > 0) socket.emit('question_ack', { count, max: room.questionsPerPlayer });
      socket.emit('creation_progress', getCreationProgress(room));
    } else if (room.phase === 'question' && room.questions) {
      const q = room.questions[room.qIdx];
      socket.emit('new_question', { text: q.q, qIdx: room.qIdx, totalQ: room.questions.length, creatorName: q.creatorName });
      // Falls Spieler schon geantwortet hatte, Status wiederherstellen
      if (room.answers[socket.id]) socket.emit('already_locked');
    } else if (room.phase === 'results' && room.lastRoundResults) {
      socket.emit('round_results', room.lastRoundResults);
    } else if (room.phase === 'gameover' && room.lastGameOver) {
      socket.emit('game_over', room.lastGameOver);
    }
  });

  // ── SPIEL STARTEN (→ Erstellungsphase) ──────────────────────────
  socket.on('start_game', () => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) { socket.emit('err', 'Mindestens 2 Spieler benötigt.'); return; }

    room.phase          = 'creating';
    room.playerQuestions = {};
    room.doneCreating   = new Set();
    Object.keys(room.players).forEach(id => { room.playerQuestions[id] = []; });
    io.to(code).emit('start_creating', { questionsPerPlayer: room.questionsPerPlayer });
    emitState(code);
  });

  // ── FRAGE EINREICHEN ────────────────────────────────────────────
  socket.on('submit_question', ({ text, lat, lng, hint }) => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'creating') return;
    const playerQ = room.playerQuestions[socket.id] || [];
    if (playerQ.length >= room.questionsPerPlayer) return;
    const creatorName = room.players[socket.id]?.name || '?';
    playerQ.push({
      q: text.trim(), lat, lng,
      info: hint?.trim() ? `${hint.trim()} · von ${creatorName}` : `Frage von ${creatorName}`,
      creatorName, createdBy: socket.id
    });
    room.playerQuestions[socket.id] = playerQ;
    socket.emit('question_ack', { count: playerQ.length, max: room.questionsPerPlayer });
    io.to(code).emit('creation_progress', getCreationProgress(room));
    if (playerQ.length >= room.questionsPerPlayer) {
      room.doneCreating.add(socket.id);
      io.to(code).emit('msg', `${creatorName} hat alle Fragen eingereicht ✓`);
    }
    if (room.doneCreating.size >= Object.keys(room.players).length)
      setTimeout(() => startGameFromQuestions(code), 1500);
  });

  // ── ANTWORT EINLOGGEN ────────────────────────────────────────────
  socket.on('lock_answer', ({ lat, lng }) => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'question' || room.answers[socket.id]) return;
    room.answers[socket.id] = { lat, lng };
    io.to(code).emit('player_locked', { playerId: socket.id, name: room.players[socket.id]?.name });
    emitState(code);
    if (Object.keys(room.answers).length >= Object.keys(room.players).length) closeRound(code);
  });

  // ── WEITER ──────────────────────────────────────────────────────
  socket.on('ready_next', () => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'results') return;
    room.readySet.add(socket.id);
    io.to(code).emit('ready_update', { count: room.readySet.size, total: Object.keys(room.players).length });
    if (room.readySet.size >= Object.keys(room.players).length) advanceRound(code);
  });

  // ── VERBINDUNG GETRENNT ──────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data?.room;
    if (!code || !rooms[code]) return;
    const room  = rooms[code];
    const name  = room.players[socket.id]?.name || '?';

    // 30 Sekunden Grace-Period: Spieler bleibt im Raum, Timer läuft
    disconnectTimers[socket.id] = setTimeout(() => {
      delete disconnectTimers[socket.id];
      removePlayer(socket.id, code);
    }, 30_000);

    // Kurze Info ohne Alarm – Spieler könnte sofort zurück sein
    io.to(code).emit('player_away', { name, playerId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 GeoQuiz läuft auf http://localhost:${PORT}`));
