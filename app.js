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

var players = [];
var discard = [];
var pile = [];
var turn = 0;

io.on('connection', function (socket) {
  console.log(`a user connected - ${socket.id}`);

  socket.on('disconnect', function () {
    console.log(`user disconnected`);
  });

  socket.on('register', function (uuid) {
    console.log('register: ' + uuid);

    //does player exist?
    if (players.find(player => player.uuid == uuid) != null) {
      console.log(`player ${uuid} exists`);
      players.find((player, playerIndex) => {
        players[playerIndex].socket = socket.id;
        players[playerIndex].name = `Player ${playerIndex + 1}`;
      });
    } else {
      console.log(`player ${uuid} created`);
      players.push({ uuid, hand: [], socket: socket.id });
    }
    updateState();
  });

  socket.on('startgame', function () {
    console.log('startgame');
    clearHands();
    deal();
    updateState()
    console.log(players);
  });

  socket.on('pickup', function (uuid) {
    console.log(`pickup - ${uuid}`);
    if (players[turn].uuid == uuid) {
      players[turn].hand.push(pile.pop());
      nextTurn();
      updateState()
    }
    else {
      console.log(`error player ${uuid} played out of turn`);
    }
  });

  socket.on('playcard', function (data) {
    let uuid = data.uuid;
    let card = data.card;
    console.log(`played card - ${card} - uuid ${uuid}`);
    playCard(card, uuid);

  });


  function updateAllPlayers() {
    players.forEach(player => {
      io.sockets.emit(player.uuid, player);
    });
  }

  function updateState() {
    updateAllPlayers();
    let discardTop = discard.slice(-1).pop() || ' ';
    let playerNext = `Player ${turn + 1}`;
    io.sockets.emit('state', { discardTop, discardCount: discard.length, pileCount: pile.length, playerNext });
  }

  function nextTurn() {
    turn = (turn + 1) % players.length;
    console.log(`turn = ${turn}`)
    io.sockets.emit('turn', turn);
  }



  function playCard(card, uuid) {
    //apply rules
    //player's turn
    let playerIndex = null;
    if (players[turn].uuid != uuid) {
      console.warn(`Player - ${players[turn].name} - played out of turn`);
      return false;
    } else {
      playerIndex = turn;
    }

    //player has card
    if (players[playerIndex].hand.indexOf(card) < 0) {
      console.warn(`Player - ${players[turn].name} - does not have a ${card}`);
      return false;
    }

    //same colour, number or is a wild
    let topCard = discard.slice(-1).pop() || ' ';
    let colours = ['yellow', 'blue', 'red', 'green'];
    let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
    let valid = card.includes('wild') || topCard == ' ';
    colours.forEach(colour => {
      cardsets.forEach(cardset => {
        valid = valid || ((topCard.includes(colour) && card.includes(colour))
          || ((topCard.includes(cardset) && card.includes(cardset))));
      });
    });
    if (!valid) {
      console.warn(`Player - ${players[turn].name} - ${card} cannot be played on ${topCard}`);
      return false;
    }

    //add card to discard
    discard.push(card);
    //remove from hand
    players[playerIndex].hand = players[playerIndex].hand.filter((item) => { return item !== card });

    nextTurn();
    updateState()
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


function deal() {
  //create deck
  /*
  let deck = [];
  for (let number = 1; number <= 13; number++) {
    deck.push({ suit: '♠', card: number });
    deck.push({ suit: '♡', card: number });
    deck.push({ suit: '♢', card: number });
    deck.push({ suit: '♣', card: number });
  }
  */
  //shuffle to pile
  discard = [];
  pile = deck;
  pile.sort(() => Math.random() - 0.5);
  //deal
  players.forEach((player, playerIndex) => {
    for (let cardIndex = 0; cardIndex < 7; cardIndex++) {
      players[playerIndex].hand.push(pile.pop());
    }
    players[playerIndex].hand.sort();
  });
}

function clearHands() {
  players.forEach((player, playerIndex) => {
    for (let i = 0; i < 7; i++) {
      players[playerIndex].hand = [];
    }
  });
}


function nextPlayer(playerIndex) {
  return playerIndex = (playerIndex + 1) % players.length;
}

module.exports = app;
