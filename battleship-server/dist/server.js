import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8181 });

/** Игроки в системе: [{ name, password, index, ws, wins }] */
const players = [];
let nextPlayerIndex = 1;

/** Комнаты: [{ roomId, players: [playerIndex], readyShips: { [playerIndex]: shipsArray } }] */
const rooms = [];
console.log("Инициализация rooms:", rooms);
let nextRoomId = 1;

/** Игры: {
 *   [gameId]: {
 *     idGame,
 *     roomId,
 *     players: [playerIndex0, playerIndex1],
 *     ships: { [playerIndex]: shipsArray },
 *     boards: { [playerIndex]: boardState },
 *     hits: { [playerIndex]: Set of hit cells },
 *     currentPlayer: playerIndex,
 *     finished: bool
 *   }
 * }
 */
const games = {};
let nextGameId = 1;

// --- Утилиты ---

function send(ws, obj) {
  ws.send(JSON.stringify({ ...obj, id: 0 }));
}

function broadcast(playersIndices, obj) {
  playersIndices.forEach((pi) => {
    const p = players.find((pl) => pl.index === pi);
    if (p && p.ws.readyState === WebSocket.OPEN) {
      send(p.ws, obj);
    }
  });
}

function getPlayerByName(name) {
  return players.find((p) => p.name === name);
}

function getPlayerByWs(ws) {
  return players.find((p) => p.ws === ws);
}

function sendRoomList() {
  // Отправляем список комнат с одним игроком (открытые для присоединения)
  const roomsList = rooms
    .filter((r) => r.players.length === 1)
    .map((r) => ({
      roomId: r.roomId,
      roomUsers: r.players.map((pi) => {
        const pl = players.find((p) => p.index === pi);
        return { name: pl.name, index: pl.index };
      }),
    }));

  players.forEach((p) => {
    if (p.ws.readyState === WebSocket.OPEN) {
      send(p.ws, { type: "update_room", data: roomsList });
    }
  });
}

function updateWinners() {
  // Сортируем по количеству побед
  const winners = players
    .map((p) => ({ name: p.name, wins: p.wins || 0 }))
    .sort((a, b) => b.wins - a.wins);

  players.forEach((p) => {
    if (p.ws.readyState === WebSocket.OPEN) {
      send(p.ws, { type: "update_winners", data: winners });
    }
  });
}

// Проверка попадания по кораблям
// Возвращает статус: "miss", "shot" (попадание), "killed" (уничтожен корабль)
function processAttack(game, attackerIndex, x, y) {
  const defenderIndex = game.players.find((pi) => pi !== attackerIndex);
  const defenderShips = game.ships[defenderIndex];
  const defenderHits = game.hits[defenderIndex];

  // Проверим все корабли, можно ли найти корабль, который включает (x,y)
  let hitShip = null;
  for (const ship of defenderShips) {
    const cells = getShipCells(ship);
    if (cells.some((c) => c.x === x && c.y === y)) {
      hitShip = ship;
      break;
    }
  }

  if (!hitShip) {
    return "miss";
  }

  // Добавим попадание в hits
  defenderHits.add(`${x},${y}`);

  // Проверяем, уничтожен ли корабль (все клетки в hits)
  const shipCells = getShipCells(hitShip);
  const allHit = shipCells.every((c) => defenderHits.has(`${c.x},${c.y}`));

  return allHit ? "killed" : "shot";
}

// Возвращает все клетки корабля
function getShipCells(ship) {
  const cells = [];
  for (let i = 0; i < ship.length; i++) {
    cells.push({
      x: ship.position.x + (ship.direction ? i : 0),
      y: ship.position.y + (ship.direction ? 0 : i),
    });
  }
  return cells;
}

// Проверка победы
function checkWin(game) {
  const defenderIndex = game.players.find((pi) => pi !== game.currentPlayer);
  const defenderShips = game.ships[defenderIndex];
  const defenderHits = game.hits[defenderIndex];

  // Проверяем, все клетки кораблей противника попали
  return defenderShips.every((ship) =>
    getShipCells(ship).every((c) => defenderHits.has(`${c.x},${c.y}`))
  );
}

// Отправить очередь ходов игрокам
function sendTurn(game) {
  broadcast(game.players, {
    type: "turn",
    data: { currentPlayer: game.currentPlayer },
  });
}

function finishGame(game, winnerIndex) {
  game.finished = true;

  // Обновляем статистику
  const winner = players.find((p) => p.index === winnerIndex);
  if (winner) winner.wins = (winner.wins || 0) + 1;

  broadcast(game.players, {
    type: "finish",
    data: { winPlayer: winnerIndex },
  });

  updateWinners();
}

// --- Обработка подключения WebSocket ---

wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", (msg) => {
    let msgObj;
    try {
      msgObj = JSON.parse(msg.toString());
    } catch {
      return;
    }
  console.log("Пришло сообщение от сервера:", msgObj); // 👈 ВРЕМЕННЫЙ ЛОГ

    const { type, data } = msgObj;
    const player = getPlayerByWs(ws);

    // --- РЕГИСТРАЦИЯ ИЛИ ЛОГИН ---
    if (type === "reg") {
      const { name, password } = data;
      if (!name || !password) {
        send(ws, {
          type: "reg",
          data: { error: true, errorText: "Name or password missing" },
        });
        return;
      }

      const existing = getPlayerByName(name);
      if (existing) {
        if (existing.password === password) {
          existing.ws = ws; // Обновляем ws, если уже есть игрок
          send(ws, {
            type: "reg",
            data: { name, index: existing.index, error: false, errorText: "" },
          });
          sendRoomList();
          updateWinners();
        } else {
          send(ws, {
            type: "reg",
            data: { error: true, errorText: "Wrong password" },
          });
        }
      } else {
        const newPlayer = { name, password, ws, index: nextPlayerIndex++, wins: 0 };
        players.push(newPlayer);
        send(ws, {
          type: "reg",
          data: { name, index: newPlayer.index, error: false, errorText: "" },
        });
        sendRoomList();
        updateWinners();
      }
      return;
    }

    // Если не авторизован, игнорируем все кроме reg
    if (!player) return;
    console.log(`Попытка создать комнату. Игрок: ${player.index}`);
console.log("Текущие комнаты:", JSON.stringify(rooms, null, 2));


    // --- СОЗДАНИЕ КОМНАТЫ ---
    if (type === "create_room") {
      // Проверяем, что игрок не в другой комнате
      if (rooms.find((r) => r.players.includes(player.index))) {
        // Игрок уже в комнате
        sendRoomList();
        return;
      }
      rooms.push({ roomId: nextRoomId++, players: [player.index], readyShips: {} });
      sendRoomList();
      return;
    }
    console.log("Комнаты после создания:", rooms);

    // --- ПРИСОЕДИНЕНИЕ К КОМНАТЕ ---
    if (type === "add_user_to_room") {
      const { indexRoom } = data;
      const room = rooms.find((r) => r.roomId === indexRoom);
      if (!room) return;

      // Игрок не должен быть в другой комнате
      if (rooms.find((r) => r.players.includes(player.index))) return;

      if (room.players.length < 2) {
        room.players.push(player.index);

        // Создаем игру
        const gameId = nextGameId++;
        const gamePlayers = [...room.players];
        games[gameId] = {
          idGame: gameId,
          roomId: room.roomId,
          players: gamePlayers,
          ships: {},
          hits: {
            [gamePlayers[0]]: new Set(),
            [gamePlayers[1]]: new Set(),
          },
          currentPlayer: gamePlayers[0],
          finished: false,
        };

        // Отправляем create_game каждому игроку с уникальным idPlayer
        gamePlayers.forEach((pi, idx) => {
          const p = players.find((pl) => pl.index === pi);
          if (p && p.ws.readyState === WebSocket.OPEN) {
            send(p.ws, {
              type: "create_game",
              data: {
                idGame: gameId,
                idPlayer: pi,
              },
            });
          }
        });

        // Убираем комнату из списка комнат
        const roomIndex = rooms.findIndex((r) => r.roomId === indexRoom);
        if (roomIndex !== -1) rooms.splice(roomIndex, 1);

        sendRoomList();
      }
      return;
    }

    // --- ДОБАВЛЕНИЕ КОРАБЛЕЙ ---
    if (type === "add_ships") {
      const { gameId, ships, indexPlayer } = data;
      const game = games[gameId];
      if (!game || game.finished) return;
      if (!game.players.includes(indexPlayer)) return;

      game.ships[indexPlayer] = ships;

      // Проверяем, выставили ли оба игрока корабли
      if (
        game.players.every((pi) => game.ships[pi] && game.ships[pi].length > 0)
      ) {
        // Оповестить игроков, что игра начинается
        broadcast(game.players, {
          type: "start_game",
          data: {
            currentPlayer: game.currentPlayer,
          },
        });
        sendTurn(game);
      }
      return;
    }

    // --- ХОД ИГРОКА ---
    if (type === "make_move") {
      const { gameId, indexPlayer, x, y } = data;
      const game = games[gameId];
      if (!game || game.finished) return;
      if (game.currentPlayer !== indexPlayer) return;

      // Обработка выстрела
      const result = processAttack(game, indexPlayer, x, y);

      // Сообщаем ход всем игрокам
      broadcast(game.players, {
        type: "player_move",
        data: {
          x,
          y,
          idPlayer: indexPlayer,
          shotStatus: result,
        },
      });

      if (result === "miss") {
        // Меняем ход
        const nextPlayer = game.players.find((pi) => pi !== game.currentPlayer);
        game.currentPlayer = nextPlayer;
        sendTurn(game);
      } else if (result === "killed") {
        // Проверяем победу
        if (checkWin(game)) {
          finishGame(game, indexPlayer);
        } else {
          // Игрок продолжает ходить (он убил корабль)
          sendTurn(game);
        }
      } else if (result === "shot") {
        // Игрок продолжает ходить
        sendTurn(game);
      }
      return;
    }

    // --- ОТВЯЗКА ОТ ИГРЫ ПРИ ОТКЛЮЧЕНИИ ---
    if (type === "leave_game") {
      const { gameId } = data;
      const game = games[gameId];
      if (!game) return;

      // Удаляем игру и комнату
      delete games[gameId];
      // Можно вернуть игроков в список игроков (или удалить комнаты с ними)

      sendRoomList();
      updateWinners();
      return;
    }
  });

  ws.on("close", () => {
    // При отключении можно очистить игрока из списка
    const idx = players.findIndex((p) => p.ws === ws);
    if (idx !== -1) {
      const disconnectedPlayer = players[idx];

      // Удаляем из комнат
      rooms.forEach((room) => {
        room.players = room.players.filter((pi) => pi !== disconnectedPlayer.index);
      });
      for (let i = rooms.length - 1; i >= 0; i--) {
        if (rooms[i].players.length === 0) rooms.splice(i, 1);
      }

      // Удаляем из игр (принудительное завершение)
      for (const gameId in games) {
        const game = games[gameId];
        if (game.players.includes(disconnectedPlayer.index)) {
          broadcast(
            game.players.filter((pi) => pi !== disconnectedPlayer.index),
            { type: "finish", data: { winPlayer: null, reason: "Opponent disconnected" } }
          );
          delete games[gameId];
        }
      }

      players.splice(idx, 1);

      sendRoomList();
      updateWinners();
    }

    console.log("Client disconnected");
  });
});

console.log("WebSocket server running on ws://localhost:8181");
