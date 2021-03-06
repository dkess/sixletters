/**
 * When in a multiplayer game, this module communicates with gamestate.js
 * through a set of callback functions.  These functions should be implemented:
 *
 * onLobbyCreate(String lobbyname)
 * Only necessary for hosting.  Will be called once the multiplayer game has
 * been registered server-side and is ready to accept new players to join.
 *
 * onPlayerJoin(String name)
 * Will be called if a player joins the game.
 *
 * onNameTaken()
 * Will be called if the user tries to join a game with a name that has been
 * taken.
 *
 * onPlayerQuit(String name)
 * Will be called if a player quits the game.
 *
 * onWordAttempt(String word, String playername)
 * Will be called whenever a player guesses a word.
 *
 * onGiveUpVote(String playername, boolean on)
 * Will be called if a player votes to give up, or removes their vote to give
 * up.  `on` is true if the vote is to give up, and false if the player is
 * removing their vote.
 *
 * onAllGiveUp()
 * Will be called when everyone has given up.
 *
 * makeGame(Array gamewords)
 * Only necessary for joining an already existing game.  After joining, this
 * function will be called with the array of every word in the game.
 *
 * noLobbyError()
 * Only necessary for joining an already existing game.  This function will be
 * called if the user has joined a game that does not exist.
 *
 * onDisconnect()
 * Will be called if the server ever loses connection.
 */
var MULTIPLAYER = (function() {
	var m = {};

	function split(s, separator, limit) {
	  // split the initial string using limit
	  var arr = s.split(separator, limit);
	  // get the rest of the string...
	  var left = s.substring(arr.join(separator).length + separator.length);
	  // and append it to the array
	  arr.push(left);
	  return arr;
	}

	var sock;
	var playername = null;
	var lobby = null;
	var callbacks;

	// the list of players in this game
	var players = [];

	/**
	 * Get the name of the local player.
	 *
	 * @return String The name of the local player, or null if there is no game
	 *                running.
	 */
	m.getPlayername = function () {
		return playername;
	}

	/**
	 * Should be called whenever a new player joins the game
	 * 
	 * @param name String The name of whoever joined
	 */
	function onPlayerJoin(name) {
		callbacks.onPlayerJoin(name);

		players.push(name);
	}

	/**
	 * Should be called whenever a player quits the game
	 *
	 * @param name String The name of whoever quit
	 */
	function onPlayerQuit(name) {
		callbacks.onPlayerQuit(name);

		players.splice(players.indexOf(name), 1);
	}

	function onServerMsg(event) {
		var attempt_command = ":attempt ";
		if (event.data.substring(0, attempt_command.length) === attempt_command) {
			sdata = split(event.data, " ", 2);
			// underscore means this game has been given up on
			if (sdata[2] === "_") {
				sdata[2] = 1;
			}
			callbacks.onWordAttempt(sdata[1], sdata[2]);
		} else if (event.data === ":allgiveup") {
			callbacks.onAllGiveUp();
		} else {
			var sdata = split(event.data, " ", 1);
			if (sdata[0] === ":join") {
				onPlayerJoin(sdata[1]);
			} else if (sdata[0] === ":quit") {
				onPlayerQuit(sdata[1]);
			} else if (sdata[0] === ":giveup") {
				callbacks.onGiveUpVote(true, sdata[1]);
			} else if (sdata[0] === ":ungiveup") {
				callbacks.onGiveUpVote(false, sdata[1]);
			}
		}
	}

	function onServerClose(event) {
		console.log("socket closed");
		callbacks.onDisconnect();
	}

	/**
	 * Announce to the server that the player has guessed a word.
	 *
	 * @param word String The word that was guessed.  Not case sensitive.
	 */
	m.announceWordGuess = function (word) {
		if (sock && word) {
			sock.send(":attempt "+word.toLowerCase());
		}
	}

	/**
	 * Should be called when the user votes or unvotes to give up.
	 *
	 * @param on Boolean True if the player is voting to give up, false if the
	 *                   vote is being removed.
	 */
	m.voteGiveUp = function (on) {
		if (sock) {
			if (on) {
				sock.send(":giveup");
			} else {
				sock.send(":ungiveup");
			}
		}
	}

	/**
	 * Creates a connection to the game server and begins hosting a game.
	 *
	 * The answers variable will be modified.  Each word that has already been
	 * guessed will be credited to the playername of this local player, rather
	 * than the default `true` value.
	 *
	 * @param name String The name of whoever is hosting
	 * @param answers String A list of word groups containing every word in the
	 * 						 game. Each "word" should actually be a triple, as
	 * 						 described in GAMESTATE#answers.
	 * @param cbacks Object An object with multiplayer callback functions.
	 */
	m.hostGame = function (name, answers, cbacks) {
		sock = new WebSocket(WEBSOCKET_SERVER + "/hostcoop/" + name);
		playername = name;
		callbacks = cbacks;

		sock.onopen = function (event) {
			words = ""
			for (var i = 0; i < answers.length; i++) {
				for (var j = 0; j < answers[i].length; j++) {
					words += answers[i][j][0];
					if (answers[i][j][1]) {
						words += "_ ";
					} else {
						words += " ";
					}
				}
			}

			sock.send(words.trim());
		};

		sock.onmessage = function (event) {
			callbacks.onLobbyCreate("c" + event.data);
			onPlayerJoin(name);
			sock.onmessage = onServerMsg;
			sock.onclose = onServerClose;
		};
	}

	/**
	 * Set the name of this player.  Should only be called while in the process
	 * of joining a game.
	 *
	 * @param name String The name to choose.
	 */
	m.sendName = function (name) {
		playername = name;
		sock.send(name);
	}

	/**
	 * Creates a connection to the game server and joins an existing game.
	 *
	 * @param gamename String The name of the game to join
	 * @param cbacks Object An object with multiplayer callback functions.
	 */
	m.joinGame = function (gamename, cbacks) {
		sock = new WebSocket(WEBSOCKET_SERVER + "/join/" + gamename);
		callbacks = cbacks;

		var state = 0;

		sock.onclose = callbacks.noLobbyError;

		sock.onmessage = function (event) {
			if (state === 0) {
				if (event.data === ":noexist") {
					callbacks.noLobbyError();
				} else if (event.data === ":ok") {
					state = 1;
				}
			} else if (state === 1) {
				if (event.data === ":badname") {
				} else if (event.data === ":taken") {
					callbacks.onNameTaken();
				} else {
					state = 2;
				}
			}
			if (state === 2) {
				var sdata = event.data.split(" ");
				for (var i = 0; i < sdata.length; i++) {
					var n = sdata[i];
					if (n.endsWith("_")) {
						n = n.substring(0, n.length - 1);
						onPlayerJoin(n);
						onPlayerQuit(n);
					} else {
						onPlayerJoin(n);
					}
				}
				state = 3;
				mp_sock = sock;
			} else if (state === 3) {
				var wordslist = event.data.split(" ");

				callbacks.makeGame(wordslist);
				lobby = gamename;
				sock.onmessage = onServerMsg;
			}
		};
	}

	return m;
}());
