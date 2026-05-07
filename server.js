const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const QUESTIONS_PER_PLAYER = 5;

// ── HILFSFUNKTIONEN ──────────────────────────────────────────────────────────
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function genCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function publicState(room) {
  return {
    phase: room.phase,
    hostId: room.host,
    qIdx: room.qIdx,
    totalQ: room.questions ? room.questions.length : 0,
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
  Object.keys(room.players).forEach(id => {
    io.to(id).emit('state', { ...base, myId: id });
  });
}

function getCreationProgress(room) {
  return Object.entries(room.players).map(([id, p]) => ({
    id, name: p.name,
    count: (room.playerQuestions[id] || []).length,
    done: room.doneCreating.has(id)
  }));
}

function startGameFromQuestions(code) {
  const room = rooms[code];
  const allQ = [];
  Object.values(room.playerQuestions).forEach(qs => allQ.push(...qs));
  room.questions = shuffle(allQ);
  room.qIdx = 0;
  room.phase = 'question';
  room.answers = {};
  room.readySet = new Set();

  const q = room.questions[0];
  io.to(code).emit('new_question', {
    text: q.q, qIdx: 0, totalQ: room.questions.length, creatorName: q.creatorName
  });
  emitState(code);
}

function closeRound(code) {
  const room = rooms[code];
  const q = room.questions[room.qIdx];
  const results = Object.entries(room.answers).map(([id, ans]) => {
    const dist = haversine(ans.lat, ans.lng, q.lat, q.lng);
    return { id, name: room.players[id]?.name || '?', lat: ans.lat, lng: ans.lng, dist };
  });
  results.sort((a, b) => a.dist - b.dist);

  const pts = [8, 5, 2];
  results.forEach((r, i) => {
    r.pts = pts[i] || 0;
    if (room.players[r.id]) room.players[r.id].score += r.pts;
  });

  room.phase = 'results';
  room.readySet = new Set();

  const scores = Object.entries(room.players)
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);

  io.to(code).emit('round_results', {
    results, scores,
    correct: { lat: q.lat, lng: q.lng, info: q.info, creatorName: q.creatorName },
    qIdx: room.qIdx,
    totalQ: room.questions.length
  });
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
    io.to(code).emit('game_over', { scores: final });
    emitState(code);
  } else {
    room.phase = 'question';
    room.answers = {};
    room.readySet = new Set();
    const q = room.questions[room.qIdx];
    io.to(code).emit('new_question', {
      text: q.q, qIdx: room.qIdx, totalQ: room.questions.length, creatorName: q.creatorName
    });
    emitState(code);
  }
}

// ── RÄUME ────────────────────────────────────────────────────────────────────
const rooms = {};

io.on('connection', socket => {

  socket.on('create_room', ({ name }) => {
    const code = genCode();
    rooms[code] = {
      host: socket.id,
      players: { [socket.id]: { name, score: 0 } },
      phase: 'lobby',
      questions: null,
      playerQuestions: {},
      doneCreating: new Set(),
      qIdx: 0,
      answers: {},
      readySet: new Set()
    };
    socket.join(code);
    socket.data = { room: code, name };
    socket.emit('room_created', { code });
    emitState(code);
  });

  socket.on('join_room', ({ code, name }) => {
    const c = code.toUpperCase().trim();
    const room = rooms[c];
    if (!room) { socket.emit('err', 'Raum nicht gefunden.'); return; }
    if (room.phase !== 'lobby') { socket.emit('err', 'Das Spiel läuft bereits.'); return; }
    if (Object.keys(room.players).length >= 8) { socket.emit('err', 'Raum ist voll (max. 8).'); return; }

    room.players[socket.id] = { name, score: 0 };
    socket.join(c);
    socket.data = { room: c, name };
    socket.emit('joined', { code: c });
    io.to(c).emit('msg', `${name} ist beigetreten 🎉`);
    emitState(c);
  });

  // Host startet → Erstellungsphase
  socket.on('start_game', () => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) {
      socket.emit('err', 'Mindestens 2 Spieler benötigt.'); return;
    }

    room.phase = 'creating';
    room.playerQuestions = {};
    room.doneCreating = new Set();
    Object.keys(room.players).forEach(id => { room.playerQuestions[id] = []; });

    io.to(code).emit('start_creating', { questionsPerPlayer: QUESTIONS_PER_PLAYER });
    emitState(code);
  });

  // Spieler reicht eine Frage ein
  socket.on('submit_question', ({ text, lat, lng, hint }) => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'creating') return;

    const playerQ = room.playerQuestions[socket.id] || [];
    if (playerQ.length >= QUESTIONS_PER_PLAYER) return;

    const creatorName = room.players[socket.id]?.name || '?';
    playerQ.push({
      q: text.trim(),
      lat, lng,
      info: hint?.trim() ? `${hint.trim()} · von ${creatorName}` : `Frage von ${creatorName}`,
      creatorName,
      createdBy: socket.id
    });
    room.playerQuestions[socket.id] = playerQ;

    socket.emit('question_ack', { count: playerQ.length, max: QUESTIONS_PER_PLAYER });
    io.to(code).emit('creation_progress', getCreationProgress(room));

    if (playerQ.length >= QUESTIONS_PER_PLAYER) {
      room.doneCreating.add(socket.id);
      io.to(code).emit('msg', `${creatorName} hat alle ${QUESTIONS_PER_PLAYER} Fragen eingereicht ✓`);
    }

    if (room.doneCreating.size >= Object.keys(room.players).length) {
      setTimeout(() => startGameFromQuestions(code), 1500);
    }
  });

  socket.on('lock_answer', ({ lat, lng }) => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'question') return;
    if (room.answers[socket.id]) return;

    room.answers[socket.id] = { lat, lng };
    io.to(code).emit('player_locked', { playerId: socket.id, name: room.players[socket.id]?.name });
    emitState(code);

    if (Object.keys(room.answers).length >= Object.keys(room.players).length) {
      closeRound(code);
    }
  });

  socket.on('ready_next', () => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.phase !== 'results') return;

    room.readySet.add(socket.id);
    io.to(code).emit('ready_update', { count: room.readySet.size, total: Object.keys(room.players).length });

    if (room.readySet.size >= Object.keys(room.players).length) {
      advanceRound(code);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data?.room;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const name = room.players[socket.id]?.name || '?';

    delete room.players[socket.id];
    delete room.answers[socket.id];
    if (room.playerQuestions) delete room.playerQuestions[socket.id];
    if (room.doneCreating) room.doneCreating.delete(socket.id);
    if (room.readySet) room.readySet.delete(socket.id);

    if (Object.keys(room.players).length === 0) { delete rooms[code]; return; }
    if (room.host === socket.id) room.host = Object.keys(room.players)[0];

    io.to(code).emit('msg', `${name} hat das Spiel verlassen.`);
    emitState(code);

    const pc = Object.keys(room.players).length;
    if (room.phase === 'creating' && pc > 0 && room.doneCreating.size >= pc) {
      setTimeout(() => startGameFromQuestions(code), 1500);
    }
    if (room.phase === 'question' && pc > 0 && Object.keys(room.answers).length >= pc) {
      closeRound(code);
    }
    if (room.phase === 'results' && pc > 0 && room.readySet.size >= pc) {
      advanceRound(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 GeoQuiz-Server läuft auf http://localhost:${PORT}`));
