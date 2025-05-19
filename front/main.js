const ws = new WebSocket("ws://localhost:8181");

let playerIndex = null;
let gameId = null;
let currentPlayer = null;
let isMyTurn = false;

const loginDiv = document.getElementById("login");
const lobbyDiv = document.getElementById("lobby");
const gameDiv = document.getElementById("game");

const nameInput = document.getElementById("name");
const passwordInput = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const loginStatus = document.getElementById("loginStatus");

const btnCreateRoom = document.getElementById("btnCreateRoom");
const roomsList = document.getElementById("roomsList");

const statusDiv = document.getElementById("status");
const boardDiv = document.getElementById("board");

btnLogin.onclick = () => {
  const name = nameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!name || !password) {
    loginStatus.textContent = "Введите имя и пароль";
    return;
  }
  ws.send(JSON.stringify({
    type: "reg",
    data: { name, password }
  }));
};

btnCreateRoom.onclick = () => {
  ws.send(JSON.stringify({ type: "create_room" }));
};

function clearBoard() {
  boardDiv.innerHTML = "";
}

function createBoard() {
  clearBoard();
  for (let i = 0; i < 100; i++) {
    const cell = document.createElement("div");
    cell.classList.add("cell");
    cell.dataset.index = i;
    cell.addEventListener("click", onCellClick);
    boardDiv.appendChild(cell);
  }
}

function onCellClick(event) {
  if (!isMyTurn) {
    alert("Сейчас не ваш ход!");
    return;
  }
  const idx = +event.target.dataset.index;
  const x = idx % 10;
  const y = Math.floor(idx / 10);

  ws.send(JSON.stringify({
    type: "make_move",
    data: { gameId, indexPlayer: playerIndex, x, y }
  }));
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // console.log("Получено сообщение", msg);

  switch (msg.type) {
    case "reg":
      if (msg.data.error) {
        loginStatus.textContent = "Ошибка регистрации/входа: " + msg.data.error;
      } else {
        playerIndex = msg.data.index;
        loginStatus.textContent = "Успешно вошли! Ваш ID: " + playerIndex;
        loginDiv.style.display = "none";
        lobbyDiv.style.display = "block";
        ws.send(JSON.stringify({ type: "get_rooms", data: {} }));
      }
      break;

    case "rooms_update":
      // Обновляем список комнат
      roomsList.innerHTML = "";
      for (const room of msg.data) {
        const li = document.createElement("li");
        li.textContent = `Комната ${room.id}, игроков: ${room.players.length}`;
        li.style.cursor = "pointer";
        li.onclick = () => {
          ws.send(JSON.stringify({ type: "add_user_to_room", data: { idRoom: room.id } }));
        };
        roomsList.appendChild(li);
      }
      break;
  

    case "new_room":
      // Когда создаем комнату, обновляем список комнат
      ws.send(JSON.stringify({ type: "get_rooms", data: {} }));
      break;

    case "start_game":
      gameId = msg.data.idGame || null;
      currentPlayer = msg.data.currentPlayer;
      isMyTurn = (currentPlayer === playerIndex);
      lobbyDiv.style.display = "none";
      gameDiv.style.display = "block";
      statusDiv.textContent = isMyTurn ? "Ваш ход" : "Ход соперника";
      createBoard();
      break;

    case "player_move":
      {
        const { x, y, idPlayer, shotStatus } = msg.data;
        const idx = y * 10 + x;
        const cell = boardDiv.querySelector(`.cell[data-index="${idx}"]`);
        if (!cell) break;
        if (shotStatus === "miss") {
          cell.classList.add("miss");
          isMyTurn = (idPlayer !== playerIndex);
          statusDiv.textContent = isMyTurn ? "Ваш ход" : "Ход соперника";
        } else if (shotStatus === "shot" || shotStatus === "killed") {
          cell.classList.add("hit");
          isMyTurn = true; // Игрок продолжает ходить при попадании
          statusDiv.textContent = isMyTurn ? "Ваш ход (продолжайте)" : "Ход соперника";
        }
      }
      break;

    case "finish":
      const winner = msg.data.winPlayer;
      if (winner === playerIndex) {
        alert("Вы выиграли!");
      } else if (winner === null) {
        alert("Игра окончена. Противник отключился.");
      } else {
        alert("Вы проиграли.");
      }
      location.reload();
      break;

    default:
      // console.log("Необработанный тип сообщения:", msg.type);
      break;
  }
};

ws.onopen = () => {
  loginStatus.textContent = "Подключено к серверу. Войдите или зарегистрируйтесь.";
};

ws.onerror = (e) => {
  loginStatus.textContent = "Ошибка соединения с сервером";
};

ws.onclose = () => {
  loginStatus.textContent = "Соединение закрыто";
};
