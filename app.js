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
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});


app.use('/', router);
router.get('/', function (req, res, next) {
  res.render('index', {});
});



//create deck
var deck = []; //['🂡', '🂢', '🂣', '🂤', '🂥', '🂦', '🂧', '🂨', '🂩', '🂪', '🂫', '🂭', '🂮', '🂱', '🂲', '🂳', '🂴', '🂵', '🂶', '🂷', '🂸', '🂹', '🂺', '🂻', '🂽', '🂾', '🃁', '🃂', '🃃', '🃄', '🃅', '🃆', '🃇', '🃈', '🃉', '🃊', '🃋', '🃍', '🃎', '🃑', '🃒', '🃓', '🃔', '🃕', '🃖', '🃗', '🃘', '🃙', '🃚', '🃛', '🃝', '🃞', '🂿', '🃟'];
glob("./public/cards/*", function (er, files) {
  deck = files;
  deck.forEach((card, index, array) => array[index] = card.replace(`/public`, ``));
  //console.log(deck);
})

//globals for tracking state
var players = [];
var playerdata = [];
var discard = [];
var pile = [];
var turn = 0;
var dontWaitUp = null;
var dontWaitUpCard = '';
var reverseDirection = false;
var dealer = 0;
var inProgress = false;
var challengeEnabled = false;
var drawEnabled = false;
var drawAmount = 0;
var slapdownCounter = 0;
var wildColour = ' ';
var currentColour = ' ';
var prevCurrentColour = ' ';
var lowestValue = 1000;
var highestValue = 0;
var winner = '';
var loser = '';
var resetEnabled;

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
        playerdata[playerIndex].cardsInHand = 0;
        playerdata[playerIndex].name = players[playerIndex].name;
      });
    } else {
      //create new player
      console.log(`player ${uuid} created`);
      players.push({ uuid, hand: [], socket: socket.id, name: `Player ${players.length + 1}` });
      let newplayerindex = uuidToIndex(uuid);
      playerdata.push({ cardsInHand: 0, score: 0, wins: 0, name: players[newplayerindex].name, uno: false, unotime: null });
      if (inProgress) {
        message(`new player ${uuidToName(uuid)} - joined halfway through a game`);
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
        players[newplayerindex].hand.push(pile.pop());
        checkPile();
      }
    }
    updateState();
  });

  //sort your hand
  socket.on('sort', function (uuid) {
    let playerIndex = null;
    playerIndex = uuidToIndex(uuid);
    console.log(`${uuidToName(uuid)} sorted their hand`);
    players[playerIndex].hand.sort();
    updateState()
  });

  //user start a new game
  socket.on('deal', function (uuid) {
    if (players[dealer].uuid == uuid) {
      message(`${uuidToName(uuid)} - dealt`);
      clearHands();
      deal();
      updateState()
    }
    else {
      message(`${uuidToName(uuid)} dealt out of turn`);
    }
  });

  //uno and catch
  socket.on('uno', function (uuid) {
    let playerIndex = null;
    playerIndex = uuidToIndex(uuid);
    if (players[playerIndex].hand.length == 1) {
      message(`${uuidToName(uuid)} - Said Uno!`);
      playerdata[playerIndex].uno = true;
      updateState();
    }
  });
  socket.on('catch', function (playerIndex) {
    message(`Someone tried to catch ${playerdata[playerIndex].name}`);
	if(playerdata[playerIndex].unotime == null)
	{
      message(`${playerdata[playerIndex].name} was not in Uno`);
		
	} else {
		   if (playerdata[playerIndex].uno) {
				message(`${playerdata[playerIndex].name} had already said Uno!`);	
		   } else {
			   var catchtime = new Date().getTime();
		       var timesince = (catchtime - playerdata[playerIndex].unotime)/1000;
			   if (timesince < 5.0) {
					message(`${playerdata[playerIndex].name} went into Uno ${timesince} seconds ago, they have 5 seconds to say Uno!`);	
					
				} else {
					message(`${playerdata[playerIndex].name} has not said Uno, and it's been ${timesince} seconds since they went into Uno - CAUGHT! `);	
					playerdata[playerIndex].uno = false;
					playerdata[playerIndex].unotime = null;
					for (let drawIndex = 0; drawIndex < 2; drawIndex++) {
					  players[playerIndex].hand.push(pile.pop());
					  checkPile();
					}
					playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
				}

		   }
		
	}
	
	updateState();

  });

  //user picks up a card
  socket.on('pickupanddraw', function (uuid) {
    message(`${uuidToName(uuid)} picked up from the deck`);
	if(drawEnabled) {
		message(`${uuidToName(uuid)} - had to pick up ${drawAmount} cards`);
		playerIndex = uuidToIndex(uuid);
		turn = playerIndex;
		for (let drawIndex = 0; drawIndex < drawAmount; drawIndex++) {
		  players[playerIndex].hand.push(pile.pop());
		  checkPile();
		}
		drawAmount = 0;
		drawEnabled = false;
		challengeEnabled = false;
		dontWaitUp = null;
		dontWaitUpCard = '';
		nextTurn(false);
		playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
		updateState();
	} else {
		message(`${uuidToName(uuid)} picked up a card`);
		if (players[turn].uuid == uuid) {
		  let pickupCard = pile.pop();
		  players[turn].hand.push(pickupCard);
		  //check if the player can put it down straight away
		  dontWaitUp = uuid;
		  dontWaitUpCard = pickupCard;
		  challengeEnabled = false; // Turn off challenge of wild if someone picks up.
		  playerdata[turn].uno = false;
		  playerdata[turn].unotime = null;
		  checkPile();
		  nextTurn(false);
		}
    else {
      message(`${uuidToName(uuid)} played out of turn`);
    }
    updateState();
	}
  });


  //user picks up a card - This is the original single button command
  socket.on('pickup', function (uuid) {
    message(`${uuidToName(uuid)} picked up a card`);
    if (players[turn].uuid == uuid) {
      let pickupCard = pile.pop();
      players[turn].hand.push(pickupCard);
      //check if the player can put it down straight away
      dontWaitUp = uuid;
      dontWaitUpCard = pickupCard;
      challengeEnabled = false; // Turn off challenge of wild if someone picks up.
      playerdata[turn].uno = false;
	  playerdata[turn].unotime = null;
	  checkPile();
	  nextTurn();	  
    }
    else {
      message(`${uuidToName(uuid)} played out of turn`);
    }
    updateState();
  });

  //user plays a card
  socket.on('playcard', function (data) {
    let uuid = data.uuid;
    let card = data.card;

    wildColour = data.wildColour;
    if (card == 'challenge' || card == 'deal') {
      message(`${uuidToName(uuid)} - Wild colour has been set to ${wildColour}`)
      //is this called?
      currentColour = wildColour;
      updateState();
    } else {

      if (clickPolice(uuid)) {
        message(`${uuidToName(uuid)} - has been clicking too rapidly and has been temporarily throttled`);
        return;
      }
      playCard(card, uuid, wildColour);
    }

  });

  //user plays challenge
  socket.on('challenge', function (uuid) {
    previousPlayerIndex = nextPlayer(turn, !reverseDirection);
    message(`${uuidToName(uuid)} challenged ${players[previousPlayerIndex].name}`);

    let invalid = false;
    //check if that colour could have been played
    players[previousPlayerIndex].hand.forEach(card => {
      invalid = invalid || card.includes(prevCurrentColour);
    });

    if (invalid) {
      //play was invalid
      message(`challenge succeeded`);
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      if (discard.slice(-1).pop().includes('wild_pick')) {
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        playerdata[previousPlayerIndex].uno = false;
		playerdata[previousPlayerIndex].unotime = null;
      }

      //this player now chooses the colour
      socket.emit('rechooseColour');

    } else {
      message(`challenge failed`);
      players[turn].hand.push(pile.pop());
      checkPile();
      players[turn].hand.push(pile.pop());
      checkPile();
      if (discard.slice(-1).pop().includes('picker')) {
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        playerdata[turn].uno = false;
        playerdata[turn].unotime = null;
      }
      else if (discard.slice(-1).pop().includes('wild_pick')) {
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        playerdata[turn].uno = false;
        playerdata[turn].unotime = null;
      }

    }
    challengeEnabled = false;
    drawAmount = 0;
    drawEnabled = false;
    dontWaitUp = null;
    dontWaitUpCard = '';
    playerdata[turn].cardsInHand = players[turn].hand.length;
    playerdata[previousPlayerIndex].cardsInHand = players[previousPlayerIndex].hand.length;
	if((!invalid) && (discard.slice(-1).pop().includes('wild_pick')))
	{
		//The challenge failed, this person needs to pick up more but they don't get a turn if it's a Draw 4.
		nextTurn(false);
	}
    updateState();
  });

  //user plays pick two - This is the original single button command
  socket.on('drawCard', function (uuid) {
    message(`${uuidToName(uuid)} - had to pick up ${drawAmount} cards`);
    playerIndex = uuidToIndex(uuid);
    turn = playerIndex;
    for (let drawIndex = 0; drawIndex < drawAmount; drawIndex++) {
      players[playerIndex].hand.push(pile.pop());
      checkPile();
    }
    drawAmount = 0;
    drawEnabled = false;
    challengeEnabled = false;
    dontWaitUp = null;
    dontWaitUpCard = '';
    nextTurn(false);
    playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
    updateState();
  });

  //user changes name
  socket.on('namechange', function (data) {
    let uuid = data.uuid;
    let name = data.name;

    let invalid = false;

    name = name.replace(/[\W_]+/g, "");

    players.forEach(player => {
      if (player.name == name) {
        invalid = true;
      }
    })

    if (name.length < 2 || name.length > 20) {
      message(`${uuidToName(uuid)} tried to change their name and it was too short or too long - ${name}`);
    }
    else if (invalid) {
      message(`${uuidToName(uuid)} tried to change their name to the same name as another player - ${name}`);
    } else {
      message(`${uuidToName(uuid)} changed name to - ${name}`);
      players[uuidToIndex(uuid)].name = name;
      playerdata[uuidToIndex(uuid)].name = name;
    }
    updateState();

  });

  //reset the game
  socket.on('reset', function (uuid) {
	  
    message(`${uuidToName(uuid)} reset the game`);
    io.sockets.emit('refresh');
    //init all of the gobals to their default state
	reset();
    return '';
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
    playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
  });
  //one for the top of the discard

  discard.push(pile.pop());
  let topCard = discard.slice(-1).pop()
  if (!topCard.includes('wild')) {
    currentColour = cardColour(topCard);
  } else {
    // Choose colour
  }

  //draw two
  if (topCard.includes('picker')) {
    drawAmount = drawAmount + 2;
    drawEnabled = true;
  }

  //draw four
  if (topCard.includes('wild_pick')) {
    drawAmount = 4;
    drawEnabled = true;
  }

  //skip
  let skip = false;
  if (topCard.includes('skip')) {
    skip = true;
  }

  //reverse
  if (topCard.includes('reverse')) {
    reverseDirection = !reverseDirection;
  }

  nextTurn(skip);

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
  //update player data
  playerdata.forEach((player, playerindex) => {
    //update cards in hand
    playerdata[playerindex].cardsInHand = players[playerindex].hand.length;
    //is turn
    playerdata[playerindex].isTurn = (playerindex == turn) && inProgress;
    //is uno
    playerdata[playerindex].isUno = playerdata[playerindex].uno;
    //won
    playerdata[playerindex].isWinner = players[playerindex].hand.length == 0 && !inProgress && playerdata[playerindex].wins > 0;
    //cansort
    players[playerindex].isSortable = !(JSON.stringify(players[playerindex].hand) == JSON.stringify([...players[playerindex].hand].sort()));
    
  });

  updateAllPlayers();
  let discardTop = discard.slice(-1).pop() || ' ';
  let playerNext = players[turn].name;
  let dealerNext = players[dealer].name;
  io.sockets.emit('state', {
    discard,
    discardTop,
    discardCount: discard.length,
    pileCount: pile.length,
    playerNext,
    dealerNext,
    playerCount: players.length,
    inProgress,
    challengeEnabled,
    slapdownCount: slapdownCounter,
    drawAmount,
    drawEnabled,
    wildColour,
    reverseDirection,
    currentColour,
    playerdata,
	resetEnabled
  });
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

  if (!inProgress) {
    message(`${uuidToName(uuid)} - tried to play after the game ended`);
    return;
  }

  if ((players[turn].uuid != uuid)) {
    message(`${uuidToName(uuid)} - played a ${cardColour(card)} ${cardNumber(card)} out of turn!`);
    if (isSlapdown(card)) {
      message(`${uuidToName(uuid)} - played a slapdown ${cardColour(card)} ${cardNumber(card)}!`);
      playerIndex = uuidToIndex(uuid);
      turn = playerIndex;
    } else if (dontWaitUp == uuid) {
      if ((card == dontWaitUpCard) && (isPlayable(dontWaitUpCard))) {
        message(`${uuidToName(uuid)} reminded ${playerdata[turn].name} not to wait up!`);
        playerIndex = uuidToIndex(uuid);
        turn = playerIndex;
      } else {
        if (card != dontWaitUpCard) {
          message(`${uuidToName(uuid)} - picked up a card and tried to play a different card`);
        } else {
          message(`${uuidToName(uuid)} - picked up a card and tried to play it, but it wasn't playable`);
        }
        return false;
      }
    } else {
      return false;
    }
  } else {
    playerIndex = turn;
  }

  //player must draw or challenge
  if (challengeEnabled && drawEnabled) {
    message(`${uuidToName(uuid)} - tried to play a card but needs to pickup or challenge`);
    return false;
  }

  //player has card
  if (players[playerIndex].hand.indexOf(card) < 0) {
    message(`${uuidToName(uuid)} - does not have a ${cardColour(card)} ${cardNumber(card)}`);
    return false;
  }


  if (!isPlayable(card)) {
    message(`${uuidToName(uuid)} - a ${cardColour(card)} ${cardNumber(card)} cannot be played on a ${cardColour(discard.slice(-1).pop())} ${cardNumber(discard.slice(-1).pop())}`);
    return false;
  }


  dontWaitUp = null;
  dontWaitUpCard = '';

  //Modifiers
  //wild choose colour
  if (card.includes('wild')) {
    challengeEnabled = true;
    message(`${uuidToName(uuid)} - wild colour choice was ${wildColour}`);
    prevCurrentColour = currentColour;
    currentColour = wildColour;
  } else {
    challengeEnabled = false;
  }

  //draw two
  if (card.includes('picker')) {
    drawAmount = drawAmount + 2;
    drawEnabled = true;
  }

  //draw four
  if (card.includes('wild_pick')) {
    drawAmount = 4;
    drawEnabled = true;
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

  if (isSlapdown(card)) {
    slapdownCounter++;
  }

  if (!card.includes('wild')) {
    currentColour = cardColour(card);
  }

  //log put down
  message(`${uuidToName(uuid)} - played a ${cardColour(card)} ${cardNumber(card)} `);
  //add card to discard
  discard.push(card);
  //remove from hand
  players[playerIndex].hand = players[playerIndex].hand.filter((item) => { return item !== card });

  //check for win
  if (players[playerIndex].hand.length == 0) {
    message(`${uuidToName(uuid)} won the round`);
    //if there are cards to draw, draw them for the next player
    if (drawEnabled) {
      let drawIndex = nextPlayer(turn, reverseDirection);
      for (let draws = 0; draws < drawAmount; draws++) {
        players[drawIndex].hand.push(pile.pop());
        checkPile();
      }
    }
    //cancel all interim states
    drawAmount = 0;
    drawEnabled = false;
    challengeEnabled = false;

    inProgress = false;
    updateScore();
    playerdata[playerIndex].wins += 1;
    lowestValue = 1000;
	highestValue = 0;
	winner = '';
	loser = '';
	//check game over
	for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
		if(playerdata[thisPlayer].score < lowestValue) {
		  lowestValue = playerdata[thisPlayer].score;
		  winner = playerdata[thisPlayer].name;		
		}
		if(playerdata[thisPlayer].score > highestValue) {
		  highestValue = playerdata[thisPlayer].score;
		  loser = playerdata[thisPlayer].name;		
		}
	}
	if(highestValue > 50) {
		
		message(`${winner} won the game with a score of ${lowestValue}. ${loser} had the highest score of ${highestValue}.`);
		inProgress = false;
		resetEnabled = true;
		updateState(); 
		return true;
	}
	


  }
  //Check if now in Uno
  if (players[playerIndex].hand.length == 1) {
	 playerdata[playerIndex].unotime = new Date().getTime(); 
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
  let valid = false;
  if (drawEnabled) {
    valid = valid || (topCard.includes('picker') && card.includes('picker'));
  } else {
    valid = card.includes('wild') || topCard == ' ';
    colours.forEach(colour => {
      cardsets.forEach(cardset => {
        valid = valid || (topCard.includes(colour) && card.includes(colour))
          || (topCard.includes(cardset) && card.includes(cardset)) || (card.includes(currentColour));
      });
    });
  }
  return valid;
}

//check if the card is a slapdown 
function isSlapdown(card) {
  //same colour and number 
  let topCard = discard.slice(-1).pop() || ' ';
  let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
  let colours = ['yellow', 'blue', 'red', 'green'];
  let slap = false;
  colours.forEach(colour => {
    cardsets.forEach(cardset => {
      slap = slap || ((topCard.includes(colour) && card.includes(colour))
        && (topCard.includes(cardset) && card.includes(cardset)));
    });
  });
  return slap;
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

//check to see if there are plenty of cards in the pile
function updateScore() {
  var scoreInHand;
  for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
    scoreInHand = 0;

    players[thisPlayer].hand.forEach(card => {
      if (card.includes('0')) scoreInHand += 0;
      if (card.includes('1')) scoreInHand += 1;
      if (card.includes('2')) scoreInHand += 2;
      if (card.includes('3')) scoreInHand += 3;
      if (card.includes('4')) scoreInHand += 4;
      if (card.includes('5')) scoreInHand += 5;
      if (card.includes('6')) scoreInHand += 6;
      if (card.includes('7')) scoreInHand += 7;
      if (card.includes('8')) scoreInHand += 8;
      if (card.includes('9')) scoreInHand += 9;
      if (card.includes('picker')) scoreInHand += 20;
      if (card.includes('reverse')) scoreInHand += 20;
      if (card.includes('skip')) scoreInHand += 20;
      if (card.includes('colora')) scoreInHand += 50;
      if (card.includes('pick_four')) scoreInHand += 50;
    });
    playerdata[thisPlayer].score = playerdata[thisPlayer].score + scoreInHand;
  }
}
//apply the next turn
function nextTurn(skip = false) {
	
  turn = nextPlayer(turn, reverseDirection);
  if (skip) turn = nextPlayer(turn, reverseDirection);
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

//convert a uuid to player index
function uuidToIndex(uuid) {
  let index = 0;
  players.forEach((player, playerIndex) => {
    if (player.uuid == uuid) {
      name = player.name;
      index = playerIndex;
    }
  });
  return index;
}

function cardColour(card, capitalise = false) {
  if (card.includes('red')) return 'red';
  if (card.includes('blue')) return 'blue';
  if (card.includes('yellow')) return 'yellow';
  if (card.includes('green')) return 'green';
  return '';
}

function reset() {
    players = [];
    playerdata = [];
    discard = [];
    pile = [];
    turn = 0;
    dontWaitUp = null;
    dontWaitUpCard = '';
    reverseDirection = false;
    dealer = 0;
    inProgress = false;
    challengeEnabled = false;
    drawEnabled = false;
    slapdownCounter = 0;
    drawAmount = 0;
    wildColour = ' ';
    currentColour = ' ';
	resetEnabled = false;
	
}

function cardNumber(card) {
  if (card.includes('0')) return 'zero';
  if (card.includes('1')) return 'one';
  if (card.includes('2')) return 'two';
  if (card.includes('3')) return 'three';
  if (card.includes('4')) return 'four';
  if (card.includes('5')) return 'five';
  if (card.includes('6')) return 'six';
  if (card.includes('7')) return 'seven';
  if (card.includes('8')) return 'eight';
  if (card.includes('9')) return 'nine';
  if (card.includes('picker')) return 'draw two';
  if (card.includes('reverse')) return 'reverse';
  if (card.includes('skip')) return 'skip';
  if (card.includes('colora')) return 'wild';
  if (card.includes('pick_four')) return 'wild draw four';
}

//count the number of clicks and restrict if too many
var clickCounter = [];
function clickPolice(uuid, timeout_ms = 5000, limit = 5) {

  if (!inProgress) {
	  return false;
  }
	
  var time = new Date().getTime();

  //initialise array if it is not initialised
  clickCounter[uuid] = (typeof clickCounter[uuid] != 'undefined' && clickCounter[uuid] instanceof Array) ? clickCounter[uuid] : []
  //add the current time to end
  clickCounter[uuid].push(time)

  //filter to just samples within timeout
  clickCounter[uuid] = clickCounter[uuid].filter(el => { return el > (time - timeout_ms) });

  //check if samples exceeds limit
  if (clickCounter[uuid].length > limit) return true;

  return false;
}

module.exports = app;
