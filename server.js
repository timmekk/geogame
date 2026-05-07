const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── FRAGEN-POOL ──────────────────────────────────────────────────────────────
const ALL_QUESTIONS = [
  { q: 'Wo wurde 1945 die Kapitulation Deutschlands im Zweiten Weltkrieg unterzeichnet?', lat: 49.2639, lng: 4.0314, info: 'Reims, Frankreich – die deutsche Kapitulationsurkunde wurde am 7. Mai 1945 hier unterzeichnet.' },
  { q: 'Wo fanden die ersten modernen Olympischen Spiele (1896) statt?', lat: 37.9714, lng: 23.7267, info: 'Athen, Griechenland – im Panathinaiko-Stadion.' },
  { q: 'In welcher Stadt wurde die Atombombe erstmals im Krieg eingesetzt (1945)?', lat: 34.3963, lng: 132.4549, info: 'Hiroshima, Japan – 6. August 1945.' },
  { q: 'Wo befindet sich die Inka-Ruinenstadt Machu Picchu?', lat: -13.1631, lng: -72.5450, info: 'Machu Picchu, Peru – hoch in den Anden.' },
  { q: 'In welcher Stadt wurde Wolfgang Amadeus Mozart geboren?', lat: 47.8095, lng: 13.0550, info: 'Salzburg, Österreich – Geburtshaus in der Getreidegasse.' },
  { q: 'Wo wurde die UNO (Vereinte Nationen) im Jahr 1945 gegründet?', lat: 37.7749, lng: -122.4194, info: 'San Francisco, USA – die UN-Charta wurde dort unterzeichnet.' },
  { q: 'Wo befindet sich der Tempelkomplex Angkor Wat?', lat: 13.4125, lng: 103.8670, info: 'Siem Reap, Kambodscha – größtes religiöses Bauwerk der Welt.' },
  { q: 'Wo befindet sich Stonehenge?', lat: 51.1789, lng: -1.8262, info: 'Wiltshire, England – prähistorisches Steinmonument.' },
  { q: 'Wo wurde der Versailler Vertrag unterzeichnet, der den Ersten Weltkrieg beendete?', lat: 48.8049, lng: 2.1204, info: 'Schloss Versailles, Frankreich – 28. Juni 1919.' },
  { q: 'Wo steht die Sagrada Família von Antoni Gaudí?', lat: 41.4036, lng: 2.1744, info: 'Barcelona, Spanien – Bau seit 1882 noch nicht abgeschlossen.' },
  { q: 'Wo lag das antike Karthago?', lat: 36.8572, lng: 10.3236, info: 'Nahe Tunis, Tunesien – Rivale Roms in der Antike.' },
  { q: 'In welcher Stadt wurde 1914 das Attentat auf Franz Ferdinand verübt, das den Ersten Weltkrieg auslöste?', lat: 43.8563, lng: 18.4131, info: 'Sarajevo, Bosnien-Herzegowina – 28. Juni 1914.' },
  { q: 'Wo befindet sich das Tal der Könige mit Tutanchamuns Grab?', lat: 25.7402, lng: 32.6014, info: 'Luxor, Ägypten – Nekropole der ägyptischen Pharaonen.' },
  { q: 'Wo wurde Napoleon Bonaparte geboren?', lat: 41.9181, lng: 8.7375, info: 'Ajaccio, Korsika, Frankreich – 15. August 1769.' },
  { q: 'Wo liegt der Titicacasee, der höchste schiffbare See der Welt?', lat: -15.8406, lng: -69.3328, info: 'Grenze Peru/Bolivien – auf 3.812 m Höhe.' },
  { q: 'In welcher Stadt wurde 1948 die Allgemeine Erklärung der Menschenrechte proklamiert?', lat: 48.8566, lng: 2.3522, info: 'Paris, Frankreich – Palais de Chaillot, 10. Dezember 1948.' },
  { q: 'Wo steht das Sydney Opera House?', lat: -33.8568, lng: 151.2153, info: 'Sydney, Australien – entworfen von Jørn Utzon, eröffnet 1973.' },
  { q: 'Wo befindet sich der Petersdom (Vatikan)?', lat: 41.9022, lng: 12.4539, info: 'Vatikanstadt, Rom – größte Kirche der Welt.' },
  { q: 'Wo steht das Taj Mahal?', lat: 27.1751, lng: 78.0421, info: 'Agra, Indien – erbaut von Mughal-Kaiser Shah Jahan.' },
  { q: 'Wo liegt der Mount Everest, der höchste Berg der Erde?', lat: 27.9881, lng: 86.9250, info: 'Grenze Nepal/Tibet (China) – 8.849 m über dem Meeresspiegel.' },
  { q: 'Wo befindet sich das Kolosseum?', lat: 41.8902, lng: 12.4922, info: 'Rom, Italien – erbaut 70–80 n. Chr., fasste bis zu 80.000 Zuschauer.' },
  { q: 'Wo steht die Freiheitsstatue?', lat: 40.6892, lng: -74.0445, info: 'Liberty Island, New York Harbor, USA – Geschenk Frankreichs, eingeweiht 1886.' },
  { q: 'Wo liegt Alcatraz, das berühmte Bundesgefängnis?', lat: 37.8267, lng: -122.4230, info: 'San Francisco Bay, Kalifornien, USA – 1934–1963 als Hochsicherheitsgefängnis genutzt.' },
  { q: 'Wo befand sich der Reaktor, der beim Unglück von Tschernobyl 1986 explodierte?', lat: 51.2738, lng: 30.2218, info: 'Tschornobyl, Ukraine – Kernkraftwerk Tschornobyl, Reaktor Nr. 4.' },
  { q: 'Wo lag die antike Stadt Pompeji, die 79 n. Chr. vom Vesuv verschüttet wurde?', lat: 40.7462, lng: 14.4989, info: 'Pompeji, Kampanien, Italien – heute UNESCO-Welterbe.' },
  { q: 'Wo wurde die erste Mondlandung (1969) von der Erde aus koordiniert?', lat: 29.5590, lng: -95.0930, info: 'Johnson Space Center, Houston, Texas, USA – Mission Control.' },
  { q: 'Wo befindet sich die Akropolis mit dem Parthenon?', lat: 37.9715, lng: 23.7267, info: 'Athen, Griechenland – erbaut im 5. Jahrhundert v. Chr.' },
  { q: 'Wo liegt der Tiananmen-Platz (Platz des Himmlischen Friedens)?', lat: 39.9055, lng: 116.3976, info: 'Peking (Beijing), China – größter Stadtplatz der Welt.' },
  { q: 'Wo befindet sich der berühmte Karneval von Rio de Janeiro?', lat: -22.9068, lng: -43.1729, info: 'Rio de Janeiro, Brasilien – weltberühmter Straßenkarneval.' },
  { q: 'Wo liegt das Bermuda-Dreieck (ungefähre Mitte)?', lat: 25.0, lng: -71.0, info: 'Nordatlantik, zwischen Bermuda, Miami und Puerto Rico.' }
];

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
    }))
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
    correct: { lat: q.lat, lng: q.lng, info: q.info },
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
    io.to(code).emit('new_question', { text: q.q, qIdx: room.qIdx, totalQ: room.questions.length });
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

  socket.on('start_game', () => {
    const code = socket.data?.room;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) { socket.emit('err', 'Mindestens 2 Spieler benötigt.'); return; }

    room.questions = shuffle(ALL_QUESTIONS).slice(0, 10);
    room.qIdx = 0;
    room.phase = 'question';
    room.answers = {};
    room.readySet = new Set();

    const q = room.questions[0];
    io.to(code).emit('new_question', { text: q.q, qIdx: 0, totalQ: room.questions.length });
    emitState(code);
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
    room.readySet.delete(socket.id);

    if (Object.keys(room.players).length === 0) { delete rooms[code]; return; }
    if (room.host === socket.id) room.host = Object.keys(room.players)[0];

    io.to(code).emit('msg', `${name} hat das Spiel verlassen.`);
    emitState(code);

    const playerCount = Object.keys(room.players).length;
    if (room.phase === 'question' && playerCount > 0 &&
      Object.keys(room.answers).length >= playerCount) {
      closeRound(code);
    }
    if (room.phase === 'results' && playerCount > 0 &&
      room.readySet.size >= playerCount) {
      advanceRound(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌍 GeoQuiz-Server läuft auf http://localhost:${PORT}`);
});
