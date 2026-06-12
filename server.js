const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const MAX_ROUNDS = 10;

const rooms = {};

function score(a, b) {
  if (a === "cooperate" && b === "cooperate") return [3, 3];
  if (a === "cooperate" && b === "compete") return [0, 5];
  if (a === "compete" && b === "cooperate") return [5, 0];
  return [1, 1];
}

function publicState(roomId) {
  const room = rooms[roomId];

  return {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    })),
    round: room.round,
    maxRounds: MAX_ROUNDS,
    gameOver: room.round > MAX_ROUNDS,
    choicesSubmitted: Object.keys(room.choices).length,
    lastRound: room.lastRound || null
  };
}

io.on("connection", socket => {

  socket.on("join", ({ roomId, name }) => {

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        choices: {},
        round: 1,
        lastRound: null
      };
    }

    const room = rooms[roomId];

    if (room.players.length >= 2) {
      socket.emit("roomFull");
      return;
    }

    room.players.push({
      id: socket.id,
      name,
      score: 0
    });

    socket.join(roomId);

    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("choice", ({ roomId, choice }) => {

    const room = rooms[roomId];
    if (!room) return;

    room.choices[socket.id] = choice;

    io.to(roomId).emit("state", publicState(roomId));

    if (Object.keys(room.choices).length === 2) {

      const p1 = room.players[0];
      const p2 = room.players[1];

      const c1 = room.choices[p1.id];
      const c2 = room.choices[p2.id];

      const [s1, s2] = score(c1, c2);

      p1.score += s1;
      p2.score += s2;

      room.lastRound = {
        round: room.round,
        player1: p1.name,
        player2: p2.name,
        choice1: c1,
        choice2: c2,
        score1: s1,
        score2: s2
      };

      room.choices = {};
      room.round++;

      io.to(roomId).emit("state", publicState(roomId));
    }
  });

  socket.on("disconnect", () => {

    Object.keys(rooms).forEach(roomId => {

      const room = rooms[roomId];

      room.players = room.players.filter(
        p => p.id !== socket.id
      );

      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("state", publicState(roomId));
      }
    });
  });
});

server.listen(process.env.PORT || 3000);
