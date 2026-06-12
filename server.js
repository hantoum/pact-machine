
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');

const app=express();
const server=http.createServer(app);
const io=new Server(server);

app.use(express.static('public'));

const rooms={};

function score(a,b){
 if(a==='cooperate'&&b==='cooperate') return [3,3];
 if(a==='cooperate'&&b==='compete') return [0,5];
 if(a==='compete'&&b==='cooperate') return [5,0];
 return [1,1];
}

io.on('connection',socket=>{
 socket.on('join',room=>{
   socket.join(room);

   if(!rooms[room]) rooms[room]={players:[],choices:{},scores:{}};

   if(!rooms[room].players.includes(socket.id))
      rooms[room].players.push(socket.id);

   io.to(room).emit('state',rooms[room]);
 });

 socket.on('choice',({room,choice})=>{
   const r=rooms[room];
   if(!r) return;

   r.choices[socket.id]=choice;

   if(Object.keys(r.choices).length>=2){
      const ids=Object.keys(r.choices);
      const [s1,s2]=score(r.choices[ids[0]],r.choices[ids[1]]);

      r.scores[ids[0]]=(r.scores[ids[0]]||0)+s1;
      r.scores[ids[1]]=(r.scores[ids[1]]||0)+s2;

      r.lastRound={
        choices:r.choices,
        result:[s1,s2]
      };

      r.choices={};
   }

   io.to(room).emit('state',r);
 });
});

server.listen(process.env.PORT||3000);
