const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

const LETTERS = ["A","B","C","D","E","F"];

const AGENT_STRATEGIES = [
  "titfortat",
  "grudger",
  "random",
  "alwayscoop"
];

function shuffle(arr){
  return [...arr].sort(()=>Math.random()-0.5);
}

function score(a,b){

  if(a==="cooperate" && b==="cooperate")
    return [3,3];

  if(a==="cooperate" && b==="compete")
    return [0,5];

  if(a==="compete" && b==="cooperate")
    return [5,0];

  return [1,1];
}

function createRoom(roomId){

  const participants = {};

  LETTERS.forEach(letter=>{

    participants[letter] = {
      id: letter,
      type: letter === "A" || letter === "B"
        ? "empty"
        : "agent",
      score: 0
    };

  });

  const strategyLetters =
    shuffle(["C","D","E","F"]);

  const strategies =
    shuffle(AGENT_STRATEGIES);

  strategyLetters.forEach((letter,index)=>{

    participants[letter] = {
      id: letter,
      type: "agent",
      strategy: strategies[index],
      score: 0
    };

  });

  rooms[roomId] = {

    roomId,

    round: 1,

    maxRounds: 20,

    participants,

    humans: {},

    pairings: [],

    choices: {},

    history: {},

    reveal: {},

    gameOver: false

  };
}

function getOpponent(room,id){

  const pair =
    room.pairings.find(
      p => p.includes(id)
    );

  if(!pair) return null;

  return pair[0]===id
    ? pair[1]
    : pair[0];
}

function getHistory(room,a,b){

  const key =
    [a,b].sort().join("-");

  if(!room.history[key])
    room.history[key]=[];

  return room.history[key];
}

function lastOpponentMove(room,agentId,otherId){

  const h =
    getHistory(room,agentId,otherId);

  if(!h.length) return null;

  const last = h[h.length-1];

  if(last[agentId])
    return last[agentId];

  return null;
}

function opponentEverDefected(room,agentId,otherId){

  const h =
    getHistory(room,agentId,otherId);

  return h.some(
    round =>
      round[otherId]==="compete"
  );
}

function agentMove(room,agentId){

  const agent =
    room.participants[agentId];

  const opponent =
    getOpponent(room,agentId);

  switch(agent.strategy){

    case "alwayscoop":
      return "cooperate";

    case "random":
      return Math.random()<0.7
        ? "cooperate"
        : "compete";

    case "grudger":

      if(
        opponentEverDefected(
          room,
          agentId,
          opponent
        )
      ){
        return "compete";
      }

      return "cooperate";

    case "titfortat":

      const last =
        lastOpponentMove(
          room,
          agentId,
          opponent
        );

      return last || "cooperate";

    default:
      return "cooperate";
  }
}

function makePairings(){

  const letters =
    shuffle([...LETTERS]);

  const pairs = [];

  for(let i=0;i<letters.length;i+=2){

    pairs.push([
      letters[i],
      letters[i+1]
    ]);

  }

  return pairs;
}

function leaderboard(room){

  return LETTERS.map(letter=>({

    id: letter,

    score:
      room.participants[letter].score

  }))
  .sort((a,b)=>b.score-a.score);
}

function startRound(room){

  room.choices = {};

  room.pairings =
    makePairings();
}

function resolveRound(room){

  room.pairings.forEach(pair=>{

    const [a,b] = pair;

    if(!room.choices[a])
      room.choices[a] =
        agentMove(room,a);

    if(!room.choices[b])
      room.choices[b] =
        agentMove(room,b);

    const moveA =
      room.choices[a];

    const moveB =
      room.choices[b];

    const [sA,sB] =
      score(moveA,moveB);

    room.participants[a].score += sA;
    room.participants[b].score += sB;

    const history =
      getHistory(room,a,b);

    history.push({

      round: room.round,

      [a]: moveA,

      [b]: moveB,

      scoreA: sA,

      scoreB: sB

    });

  });

  room.round++;

  if(room.round > room.maxRounds){

    room.gameOver = true;

    LETTERS.forEach(letter=>{

      const p =
        room.participants[letter];

      room.reveal[letter] =
        p.type==="human"
          ? "human"
          : p.strategy;

    });

    return;
  }

  startRound(room);
}

io.on("connection",socket=>{

  socket.on("join",({roomId,name})=>{

    if(!rooms[roomId])
      createRoom(roomId);

    const room =
      rooms[roomId];

    const humans =
      Object.values(
        room.participants
      ).filter(
        p=>p.type==="human"
      );

    if(humans.length >= 2){

      socket.emit("roomFull");
      return;
    }

    const slot =
      ["A","B"]
      .find(
        l =>
          room.participants[l]
          .type==="empty"
      );

    room.participants[slot] = {

      id: slot,

      type: "human",

      name,

      socketId: socket.id,

      score: 0

    };

    room.humans[socket.id] =
      slot;

    socket.join(roomId);

    if(
      Object.values(room.participants)
      .filter(
        p =>
          p.type==="human"
      ).length === 2
    ){
      startRound(room);
    }

    emitState(roomId);
  });

  socket.on(
    "choice",
    ({roomId,choice})=>{

      const room =
        rooms[roomId];

      if(!room) return;

      const me =
        room.humans[socket.id];

      room.choices[me] =
        choice;

      const humansReady =
        Object.values(
          room.participants
        )
        .filter(
          p=>p.type==="human"
        )
        .every(
          p =>
            room.choices[p.id]
        );

      if(humansReady){

        resolveRound(room);
      }

      emitState(roomId);
    }
  );

  socket.on("disconnect",()=>{

    Object.values(rooms)
      .forEach(room=>{

      const letter =
        room.humans[socket.id];

      if(letter){

        room.participants[letter] = {

          id: letter,
          type: "empty",
          score: 0

        };

        delete room.humans[socket.id];
      }

    });

  });

});

function emitState(roomId){

  const room =
    rooms[roomId];

  if(!room) return;

  Object.entries(
    room.humans
  ).forEach(([socketId,letter])=>{

    const opponent =
      getOpponent(room,letter);

    io.to(socketId)
      .emit("state",{

      me: letter,

      round: room.round,

      maxRounds:
        room.maxRounds,

      opponent,

      leaderboard:
        leaderboard(room),

      history:
        room.history,

      gameOver:
        room.gameOver,

      reveal:
        room.reveal

    });

  });

}

server.listen(
  process.env.PORT || 3000,
  ()=>{
    console.log(
      "Server running"
    );
  }
);
