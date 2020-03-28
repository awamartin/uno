var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var glob = require("glob")
var router = express.Router();

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
const io = require('socket.io')(server);
if (module === require.main) {
  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
  });
}

app.use('/', router);
router.get('/', function (req, res, next) {
  res.render('index', {});
});



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
var inProgress = false;
var challengeEnabled = false; 

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
  socket.on('deal', function (uuid) {
    if (players[dealer].uuid == uuid) {
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
      let pickupCard = pile.pop();
      players[turn].hand.push(pickupCard);
      //check if the player can put it down straight away
      if (!isPlayable(pickupCard)) nextTurn();
      updateState()
    }
    else {
      message(`${uuidToName(uuid)} played out of turn`);
    }

    checkPile();
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
    previousPlayerIndex = nextPlayer(turn, !reverseDirection);
    message(`${uuidToName(uuid)} challenged - ${players[previousPlayerIndex].name}`);

    let invalid = false;
    //check if that colour could have been played
    players[previousPlayerIndex].hand.forEach(card => {
      invalid = invalid || card.includes(prevWildColour);
    });

    if (invalid) {
      //play was invalid
      message(`challenge correct`);
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      if (discard.slice(-1).pop().includes('wild_pick')) {
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        pile.push(players[turn].hand.pop());
        pile.push(players[turn].hand.pop());
        pile.push(players[turn].hand.pop());
        pile.push(players[turn].hand.pop());
      }

      //reshuffle the deck since we unplayed some cards
      pile.sort(() => Math.random() - 0.5);

    } else {
      message(`challenge failed`);
      players[turn].hand.push(pile.pop());
      checkPile();
      players[turn].hand.push(pile.pop());
      checkPile();
    }
    challengeEnabled = false;
    updateState();
  });

  //reset the game
  socket.on('reset', function (uuid) {
    message(`${uuidToName(uuid)} reset the game`);
    io.sockets.emit('refresh');
    //init all of the gobals to their default state
    players = [];
    discard = [];
    pile = [];
    turn = 0;
    reverseDirection = false;
    prevWildColour = null;
    dealer = 0;
    inProgress = false;
    challengeEnabled = false;
  });
});





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

  inProgress = true;
  turn = nextPlayer(dealer);
  dealer = nextPlayer(dealer);

}

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
  io.sockets.emit('state', { discardTop, discardCount: discard.length, pileCount: pile.length, playerNext, playerCount: players.length, inProgress, challengeEnabled });
}

//send a log message to all players
function message(text) {
  console.log(text);
  io.sockets.emit('message', text);
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


  if (!isPlayable(card)) {
    message(`${uuidToName(uuid)} - ${card} cannot be played on ${discard.slice(-1).pop()}`);
    return false;
  }

  //Modifiers
  //wild choose colour
  if (card.includes('wild')) {
    challengeEnabled = true;
    message(`${uuidToName(uuid)} - Wild colour choice was ${wildColour}`);
  } else {
    challengeEnabled = false;
  }
  prevWildColour = wildColour;

  //draw two
  if (card.includes('picker')) {
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
  }

  //draw four
  if (card.includes('wild_pick')) {
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
    players[nextPlayer(playerIndex, reverseDirection)].hand.push(pile.pop());
    checkPile();
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
    inProgress = false;
  }

  nextTurn(skip);

  updateState();
  return true;
}

//check if the card is playable
function isPlayable(card) {
  //same colour, number or is a wild
  let topCard = discard.slice(-1).pop() || ' ';
  let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
  let colours = ['yellow', 'blue', 'red', 'green'];
  let valid = card.includes('wild') || topCard == ' ';
  colours.forEach(colour => {
    cardsets.forEach(cardset => {
      valid = valid || (topCard.includes(colour) && card.includes(colour))
        || (topCard.includes(cardset) && card.includes(cardset)) || (card.includes(prevWildColour));
    });
  });
  return valid;
}

//check to see if there are plenty of cards in the pile
function checkPile() {
  //if there are no more cards in the pile, reshuffle discard
  if (pile.length < 2) {
    //hold the top card
    let topcard = discard.pop();
    //randomly sort
    pile.sort(() => Math.random() - 0.5);
    //put them in the pile
    discard.forEach(card => pile.push(card));
    //empty discard and put the original card back on
    discard = [topcard];
  }
}

//apply the next turn
function nextTurn(skip = false) {
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
