var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var socket = require('socket.io')
var glob = require("glob")

var indexRouter = require('./routes/index');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//express server
const server = require('http').Server(app);
const io = socket(server);
const port = process.env.PORT || 3001
server.listen(port, () => {
  console.log('Listening on ' + port)
})


//create deck
var deck = []; //['🂡', '🂢', '🂣', '🂤', '🂥', '🂦', '🂧', '🂨', '🂩', '🂪', '🂫', '🂭', '🂮', '🂱', '🂲', '🂳', '🂴', '🂵', '🂶', '🂷', '🂸', '🂹', '🂺', '🂻', '🂽', '🂾', '🃁', '🃂', '🃃', '🃄', '🃅', '🃆', '🃇', '🃈', '🃉', '🃊', '🃋', '🃍', '🃎', '🃑', '🃒', '🃓', '🃔', '🃕', '🃖', '🃗', '🃘', '🃙', '🃚', '🃛', '🃝', '🃞', '🂿', '🃟'];
glob("./public/cards/*", function (er, files) {
  deck = files;
  deck.forEach((card, index, array) => array[index] = card.replace(`/public`, ``));
  console.log(deck);
})

//globals for tracking state
var players = [];
var discard = [];
var pile = [];
var turn = 0;
var reverseDirection = false;
var prevWildColour = null;
var dealer = 0;

//open a socket
io.on('connection', function (socket) {
  console.log(`a user connected - ${socket.id}`);

  //log message on disconnect
  socket.on('disconnect', function () {
    console.log(`user disconnected`);
  });

  //user connected and sends uuid to identify
  socket.on('register', function (uuid) {
    console.log('register: ' + uuid);

    //does player exist?
    if (players.find(player => player.uuid == uuid) != null) {
      //player exists
      console.log(`player ${uuid} exists`);
      players.find((player, playerIndex) => {
        players[playerIndex].socket = socket.id;
        players[playerIndex].name = `Player ${playerIndex + 1}`;
      });
    } else {
      //create new player
      console.log(`player ${uuid} created`);
      players.push({ uuid, hand: [], socket: socket.id, name: `Player ${players.length + 1}` });
    }
    updateState();
  });

  //user start a new game
  socket.on('startgame', function (uuid) {
    if (players[turn].uuid == uuid) {
      console.log(`${uuidToName(uuid)} dealt`);
      clearHands();
      deal();
      updateState()
    }
    else {
      message(`${uuidToName(uuid)} dealt out of turn`);
    }
  });

  //user picks up a card
  socket.on('pickup', function (uuid) {
    message(`${uuidToName(uuid)} picked up a card`);
    if (players[turn].uuid == uuid) {
      players[turn].hand.push(pile.pop());
      nextTurn();
      updateState()
    }
    else {
      message(`${uuidToName(uuid)} played out of turn`);
    }
  });

  //user plays a card
  socket.on('playcard', function (data) {
    let uuid = data.uuid;
    let card = data.card;
    let wildColour = data.wildColour;
    message(`${uuidToName(uuid)} played card - ${card}`);
    playCard(card, uuid, wildColour);

  });

  //user plays challenge
  socket.on('challenge', function (uuid) {
    message(`player challenged - ${uuidToName(uuid)}`);
    //todo
  });

  //send state to all players
  function updateAllPlayers() {
    players.forEach(player => {
      //emit each hand to the specific player
      io.sockets.emit(player.uuid, player);
    });
  }

  //update everything to each player
  function updateState() {
    updateAllPlayers();
    let discardTop = discard.slice(-1).pop() || ' ';
    let playerNext = `Player ${turn + 1}`;
    io.sockets.emit('state', { discardTop, discardCount: discard.length, pileCount: pile.length, playerNext });
  }

  //send a log message to all players
  function message(text) {
    console.log(text);
    io.sockets.emit('message', text);
  }

  //apply play card and rules
  function playCard(card, uuid, wildColour = null) {
    //apply rules
    //player's turn
    let playerIndex = null;
    if (players[turn].uuid != uuid) {
      message(`${uuidToName(uuid)} - played out of turn`);
      return false;
    } else {
      playerIndex = turn;
    }

    //player has card
    if (players[playerIndex].hand.indexOf(card) < 0) {
      message(`${uuidToName(uuid)} - does not have a ${card}`);
      return false;
    }

    //same colour, number or is a wild
    let topCard = discard.slice(-1).pop() || ' ';
    let colours = ['yellow', 'blue', 'red', 'green'];
    let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
    let valid = card.includes('wild') || topCard == ' ';
    colours.forEach(colour => {
      cardsets.forEach(cardset => {
        valid = valid || (topCard.includes(colour) && card.includes(colour))
          || (topCard.includes(cardset) && card.includes(cardset)) || (card.includes(prevWildColour));
      });
    });
    if (!valid) {
      message(`${uuidToName(uuid)} - ${card} cannot be played on ${topCard}`);
      return false;
    }

    //Modifiers
    //wild choose colour
    if (card.includes('wild')) {
      message(`${uuidToName(uuid)} - Wild colour choice was ${wildColour}`);
    }
    prevWildColour = wildColour;

    //draw two
    if (card.includes('picker')) {
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    }

    //draw four
    if (card.includes('wild_pick')) {
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
      players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    }

    //skip
    let skip = false;
    if (card.includes('skip')) {
      skip = true;
    }

    //reverse
    if (card.includes('reverse')) {
      reverseDirection = !reverseDirection;
    }

    //add card to discard
    discard.push(card);
    //remove from hand
    players[playerIndex].hand = players[playerIndex].hand.filter((item) => { return item !== card });

    //check for win
    if (players[playerIndex].hand.length == 0) {
      message(`${uuidToName(uuid)} won the game`);
    }

    nextTurn(skip);

    updateState();
    return true;
  }
});

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

//deal the cards
function deal() {
  //clear the discard pile
  discard = [];
  //get the deck from the pile
  pile = [...deck]
  //randomly sort
  pile.sort(() => Math.random() - 0.5);
  //deal
  players.forEach((player, playerIndex) => {
    for (let cardIndex = 0; cardIndex < 7; cardIndex++) {
      players[playerIndex].hand.push(pile.pop());
    }
    players[playerIndex].hand.sort();
  });
  //one for the top of the discard
  //discard.push(pile.pop());
}

//remove all cards from hands
function clearHands() {
  players.forEach((player, playerIndex) => {
    for (let i = 0; i < 7; i++) {
      players[playerIndex].hand = [];
    }
  });
}

//work out which player is next under certain conditions
function nextPlayer(playerIndex, reverse = false) {
  if (!reverse) {
    return playerIndex = (playerIndex + 1) % players.length;
  } else {
    let newindex = (playerIndex - 1);
    if (newindex < 0) newindex = players.length - 1;
    return newindex;
  }

}

//apply the next turn
function nextTurn(skip) {
  turn = nextPlayer(turn, reverseDirection);
  if (skip) turn = nextPlayer(turn, reverseDirection);
  console.log(`turn = ${turn}`)
  io.sockets.emit('turn', turn);
}

//convert a uuid to a friendly name
function uuidToName(uuid) {
  let name = '';
  let index = 0;
  players.forEach((player, playerIndex) => {
    if (player.uuid == uuid) {
      name = player.name;
      index = playerIndex;
    }
  });
  return name;
}

module.exports = app;
