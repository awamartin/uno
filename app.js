var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var socket = require('socket.io')

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


var players = [];



io.on('connection', function (socket) {
  console.log(`a user connected`);

  socket.on('disconnect', function () {
    console.log(`user disconnected`);
  });

  socket.on('register', function (uuid) {
    console.log('register: ' + uuid);
    if (typeof players[uuid] === 'undefined') {
      //new player
      players[uuid] = { hand: [] };
      players['uuid2'] = { hand: [] };
      console.log(players);
    }
  });

  socket.on('startgame', function () {
    console.log('startgame');

  });
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

module.exports = app;
