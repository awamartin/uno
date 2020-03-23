const express = require('express');

const app = require('express')();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
io.on('connection', () => {
    console.log(`socket connect`);
});

app.use('/', express.static(path.join(__dirname, 'public')));

server.listen(3000);

var playerCount = 4;

var deck = [];
var pile = [];
var players = [];


//players sit down
for (let player = 1; player <= playerCount; player++) {
    players.push({
        name: `Player ${player}`,
        hand: []
    });
}


//generate deck
for (let number = 1; number <= 13; number++) {
    deck.push({ suit: 0, card: number });
    deck.push({ suit: 1, card: number });
    deck.push({ suit: 2, card: number });
    deck.push({ suit: 3, card: number });
}

//shuffle deck into pile
pile = deck;
pile.sort(() => Math.random() - 0.5);

//deal into hands
for (let player = 0; player < playerCount; player++) {
    for (let cards = 0; cards < 7; cards++) {
        players[player].hand.push(pile.pop());
    }
}
