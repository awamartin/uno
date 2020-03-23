
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
console.log(deck);

//shuffle deck into pile
pile = deck;
pile.sort(() => Math.random() - 0.5);
console.log(pile);

//deal into hands



setTimeout(()=>{},30000);