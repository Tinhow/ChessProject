// Connect to the server socket
const socket = io();

// Game State
let game = new Chess();
let roomId = null;
let playerName = '';
let myRole = 'spectator'; // 'player' | 'spectator'
let myColor = null;       // 'w' | 'b' | null
let selectedSquare = null;
let possibleMoves = [];
let boardFlipped = false;
let players = {};
let spectators = [];
let lastMoveSquares = []; // [from, to]

// Audio context (initialized on first interaction)
let audioCtx = null;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.log("Web Audio API initialized");
}

// Play synthesizer sound effects using Web Audio API
function playSound(type) {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const dest = audioCtx.destination;

    if (type === 'move') {
        // Wooden piece drop sound
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(450, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.08);
        
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
        
        osc.connect(gain);
        gain.connect(dest);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === 'capture') {
        // Sharper capturing impact sound
        const osc = audioCtx.createOscillator();
        const noise = audioCtx.createBufferSource();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.1);
        
        // Short white noise burst for the snap
        const bufferSize = audioCtx.sampleRate * 0.04;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        noise.buffer = buffer;

        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

        osc.connect(gain);
        noise.connect(gain);
        gain.connect(dest);

        osc.start();
        noise.start();
        osc.stop(audioCtx.currentTime + 0.1);
        noise.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'check') {
        // Dual chime warning
        const now = audioCtx.currentTime;
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(523.25, now); // C5
        
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now + 0.08); // E5

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.setValueAtTime(0.2, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(dest);

        osc1.start(now);
        osc2.start(now + 0.08);
        osc1.stop(now + 0.25);
        osc2.stop(now + 0.25);
    } else if (type === 'game-over') {
        // Melodic victory / defeat descending chord
        const now = audioCtx.currentTime;
        const notes = [392.00, 329.63, 261.63]; // G4, E4, C4
        
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + index * 0.1);
            
            gain.gain.setValueAtTime(0.15, now + index * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.1 + 0.3);
            
            osc.connect(gain);
            gain.connect(dest);
            
            osc.start(now + index * 0.1);
            osc.stop(now + index * 0.1 + 0.35);
        });
    }
}

// Fetch host network IP address to display in lobby
async function loadNetworkInfo() {
    try {
        const response = await fetch('/api/info');
        const data = await response.json();
        const lanIpDisplay = document.getElementById('lan-ip-display');
        lanIpDisplay.textContent = `http://${data.localIP}:${data.port}`;
    } catch (err) {
        console.error("Failed to load network info", err);
        document.getElementById('lan-ip-display').textContent = window.location.origin;
    }
}

// Initialize board rendering and UI bindings
document.addEventListener('DOMContentLoaded', () => {
    loadNetworkInfo();
    setupEventHandlers();
});

// UI Event Handlers
function setupEventHandlers() {
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');
    const btnDraw = document.getElementById('btn-draw');
    const btnResign = document.getElementById('btn-resign');
    const btnLeave = document.getElementById('btn-leave');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const emojiBtns = document.querySelectorAll('.emoji-btn');
    
    // Modals buttons
    const btnAcceptDraw = document.getElementById('btn-accept-draw');
    const btnDeclineDraw = document.getElementById('btn-decline-draw');
    const btnRematch = document.getElementById('btn-rematch');
    const btnGoLobby = document.getElementById('btn-go-lobby');

    // Trigger audio context startup on first page click
    document.addEventListener('click', initAudio, { once: true });

    btnCreateRoom.addEventListener('click', () => {
        initAudio();
        const inputName = document.getElementById('player-name').value.trim();
        playerName = inputName || `Host_${Math.floor(1000 + Math.random() * 9000)}`;
        
        // Generate random room code
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        roomId = code;

        socket.emit('joinRoom', { roomId, playerName });
    });

    btnJoinRoom.addEventListener('click', () => {
        initAudio();
        const inputName = document.getElementById('player-name').value.trim();
        playerName = inputName || `Player_${Math.floor(1000 + Math.random() * 9000)}`;
        
        const codeInput = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (!codeInput) {
            alert('Por favor, digite o código da sala.');
            return;
        }
        roomId = codeInput;

        socket.emit('joinRoom', { roomId, playerName });
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
            socket.emit('chatMessage', text);
            chatInput.value = '';
        }
    });

    emojiBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            initAudio();
            const emoji = btn.getAttribute('data-emoji');
            socket.emit('chatMessage', `Reação: ${emoji}`);
        });
    });

    btnDraw.addEventListener('click', () => {
        if (myRole !== 'player') return;
        socket.emit('proposeDraw');
        addSystemMessage("Você propôs um empate ao oponente.");
    });

    btnResign.addEventListener('click', () => {
        if (myRole !== 'player') return;
        initAudio();
        showModal('resign-modal');
    });

    btnLeave.addEventListener('click', () => {
        initAudio();
        showModal('leave-modal');
    });

    document.getElementById('btn-confirm-leave').addEventListener('click', () => {
        returnToLobby();
    });

    document.getElementById('btn-cancel-leave').addEventListener('click', () => {
        hideModal('leave-modal');
    });

    document.getElementById('btn-confirm-resign').addEventListener('click', () => {
        socket.emit('resign');
        hideModal('resign-modal');
    });

    document.getElementById('btn-cancel-resign').addEventListener('click', () => {
        hideModal('resign-modal');
    });

    btnAcceptDraw.addEventListener('click', () => {
        socket.emit('drawResponse', { accepted: true });
        hideModal('draw-modal');
    });

    btnDeclineDraw.addEventListener('click', () => {
        socket.emit('drawResponse', { accepted: false });
        hideModal('draw-modal');
    });

    btnRematch.addEventListener('click', () => {
        socket.emit('requestRematch');
        btnRematch.disabled = true;
        btnRematch.textContent = "Aguardando oponente...";
    });

    btnGoLobby.addEventListener('click', () => {
        returnToLobby();
    });
}

// CSS Modal helper
function showModal(id) {
    document.getElementById(id).classList.add('active');
}

function hideModal(id) {
    document.getElementById(id).classList.remove('active');
}

function returnToLobby() {
    hideModal('leave-modal');
    hideModal('game-over-modal');
    
    socket.disconnect();
    
    roomId = null;
    myRole = 'spectator';
    myColor = null;
    selectedSquare = null;
    possibleMoves = [];
    lastMoveSquares = [];
    game = new Chess();
    
    document.getElementById('moves-history-list').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '<div class="chat-system">Bem-vindo à sala!</div>';
    document.getElementById('room-code-input').value = '';
    
    socket.connect();
    
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('lobby-screen').classList.add('active');
}

// ------------------------------------------
// BOARD RENDERING LOGIC
// ------------------------------------------

function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    // Flip variables indices if board is flipped
    const fileOrder = boardFlipped ? [...files].reverse() : files;
    const rankOrder = boardFlipped ? [...ranks].reverse() : ranks;

    const boardState = game.board();

    // Map board to visual squares
    for (let r = 0; r < 8; r++) {
        const rankIndex = boardFlipped ? 7 - r : r; // 0 is 8th rank (index 8), etc.
        const rankName = rankOrder[r];

        for (let f = 0; f < 8; f++) {
            const fileIndex = boardFlipped ? 7 - f : f;
            const fileName = fileOrder[f];
            const squareId = fileName + rankName;

            // Get piece from Chess.js board state
            // Chess.js boards are indexed by [row][col], where row 0 is 8th rank and col 0 is file a.
            const piece = boardState[rankIndex][fileIndex];

            // Create square div
            const squareEl = document.createElement('div');
            squareEl.className = `square ${(fileIndex + rankIndex) % 2 === 0 ? 'light' : 'dark'}`;
            squareEl.dataset.square = squareId;

            // Destaques (Highlights)
            if (selectedSquare === squareId) {
                squareEl.classList.add('selected');
            }
            if (lastMoveSquares.includes(squareId)) {
                squareEl.classList.add('last-move');
            }
            // Check highlight
            if (piece && piece.type === 'k' && piece.color === game.turn() && game.in_check()) {
                squareEl.classList.add('check');
            }

            // Draw Piece
            if (piece) {
                const pieceKey = piece.color + piece.type;
                const pieceEl = document.createElement('div');
                pieceEl.className = `piece ${piece.color}`;
                
                const imgEl = document.createElement('img');
                const pName = piece.color + piece.type.toUpperCase();
                imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
                imgEl.alt = pName;
                imgEl.style.width = '90%';
                imgEl.style.height = '90%';
                imgEl.style.pointerEvents = 'none';
                pieceEl.appendChild(imgEl);
                
                // Set drag properties
                if (myRole === 'player' && myColor === piece.color && game.turn() === myColor) {
                    pieceEl.setAttribute('draggable', 'true');
                    setupPieceDragEvents(pieceEl, squareId);
                }

                squareEl.appendChild(pieceEl);
            }

            // Highlight possible moves
            if (possibleMoves.includes(squareId)) {
                if (piece) {
                    // Attack ring
                    const ring = document.createElement('div');
                    ring.className = 'possible-move-ring';
                    squareEl.appendChild(ring);
                } else {
                    // Empty move dot
                    const dot = document.createElement('div');
                    dot.className = 'possible-move-dot';
                    squareEl.appendChild(dot);
                }
            }

            // Click listener
            squareEl.addEventListener('click', () => handleSquareClick(squareId));
            
            // Drag target listeners on square
            setupSquareDropEvents(squareEl, squareId);

            boardEl.appendChild(squareEl);
        }
    }

    updateCapturedPieces();
}

// Click to move logic
function handleSquareClick(squareId) {
    if (myRole !== 'player' || game.turn() !== myColor) return;

    const piece = game.get(squareId);

    // If a piece of player's color is clicked, select it
    if (piece && piece.color === myColor) {
        selectedSquare = squareId;
        // Fetch possible moves from chess.js
        const moves = game.moves({ square: squareId, verbose: true });
        possibleMoves = moves.map(m => m.to);
        renderBoard();
        return;
    }

    // If a possible move is clicked, execute it
    if (selectedSquare && possibleMoves.includes(squareId)) {
        makeMove(selectedSquare, squareId);
        selectedSquare = null;
        possibleMoves = [];
        return;
    }

    // Clicked elsewhere, clear selection
    selectedSquare = null;
    possibleMoves = [];
    renderBoard();
}

// Piece drag handlers
function setupPieceDragEvents(pieceEl, sourceSquare) {
    pieceEl.addEventListener('dragstart', (e) => {
        selectedSquare = sourceSquare;
        const moves = game.moves({ square: sourceSquare, verbose: true });
        possibleMoves = moves.map(m => m.to);
        
        pieceEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', sourceSquare);
        e.dataTransfer.effectAllowed = 'move';
        
        // Delay rendering dot markers so drag image doesn't capture them
        setTimeout(() => {
            renderBoard();
        }, 10);
    });

    pieceEl.addEventListener('dragend', () => {
        pieceEl.classList.remove('dragging');
        selectedSquare = null;
        possibleMoves = [];
        renderBoard();
    });
}

// Square drop handlers
function setupSquareDropEvents(squareEl, targetSquare) {
    squareEl.addEventListener('dragover', (e) => {
        if (possibleMoves.includes(targetSquare)) {
            e.preventDefault();
            squareEl.classList.add('drag-over');
        }
    });

    squareEl.addEventListener('dragleave', () => {
        squareEl.classList.remove('drag-over');
    });

    squareEl.addEventListener('drop', (e) => {
        e.preventDefault();
        squareEl.classList.remove('drag-over');
        
        const sourceSquare = e.dataTransfer.getData('text/plain');
        if (sourceSquare === selectedSquare && possibleMoves.includes(targetSquare)) {
            makeMove(sourceSquare, targetSquare);
        }
    });
}

// Execute move locally and sync with server
function makeMove(from, to) {
    // Clear selection state immediately
    selectedSquare = null;
    possibleMoves = [];

    // Automatically promote to Queen for simplicity
    const move = game.move({
        from: from,
        to: to,
        promotion: 'q'
    });

    if (move) {
        lastMoveSquares = [from, to];
        
        // Play audio locally
        if (move.captured) {
            playSound('capture');
        } else {
            playSound('move');
        }

        if (game.in_check()) {
            setTimeout(() => playSound('check'), 100);
        }

        // Sync with server
        socket.emit('makeMove', {
            roomId,
            move: move,
            fen: game.fen()
        });

        // Add to history
        addMoveToHistoryList(move);

        renderBoard();
        updateTurnIndicator();
        checkGameStatus();
    }
}

// ------------------------------------------
// CHAT & SOCIAL HELPERS
// ------------------------------------------

function addChatMessage(senderName, senderId, text) {
    const chatMsgs = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    
    const senderSpan = document.createElement('span');
    senderSpan.className = `chat-msg-sender ${senderId === socket.id ? 'self' : 'opponent'}`;
    senderSpan.textContent = senderName + ':';

    const textSpan = document.createElement('span');
    textSpan.className = 'chat-msg-text';
    textSpan.textContent = text;

    msgEl.appendChild(senderSpan);
    msgEl.appendChild(textSpan);
    chatMsgs.appendChild(msgEl);
    
    // Auto-scroll
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function addSystemMessage(text) {
    const chatMsgs = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-system';
    msgEl.textContent = text;
    chatMsgs.appendChild(msgEl);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

// Turn indicator update
function updateTurnIndicator() {
    const turnText = document.getElementById('turn-text');
    const indicator = document.getElementById('turn-indicator');
    
    if (Object.keys(players).length < 2) {
        turnText.textContent = "Aguardando Oponente...";
        indicator.className = "turn-indicator";
        return;
    }

    const currentTurnColor = game.turn();
    const currentTurnName = Object.values(players).find(p => p.color === currentTurnColor)?.name || 'Oponente';
    
    if (myRole === 'spectator') {
        turnText.textContent = `Vez das ${currentTurnColor === 'w' ? 'Brancas' : 'Pretas'} (${currentTurnName})`;
        indicator.className = "turn-indicator opponent-turn";
    } else if (currentTurnColor === myColor) {
        turnText.textContent = "Sua Vez!";
        indicator.className = "turn-indicator your-turn";
    } else {
        turnText.textContent = `Vez de ${currentTurnName}`;
        indicator.className = "turn-indicator opponent-turn";
    }
}

// Compute captured pieces from initial count
function updateCapturedPieces() {
    const startCount = {
        w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
        b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };
    
    const currentCount = {
        w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
        b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };

    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && piece.type !== 'k') {
                currentCount[piece.color][piece.type]++;
            }
        }
    }

    const whiteCaptured = [];
    const blackCaptured = [];

    // Missing white pieces were captured by Black
    for (const type of ['p', 'n', 'b', 'r', 'q']) {
        const diff = startCount.w[type] - currentCount.w[type];
        for (let i = 0; i < diff; i++) {
            whiteCaptured.push({ color: 'w', type });
        }
    }

    // Missing black pieces were captured by White
    for (const type of ['p', 'n', 'b', 'r', 'q']) {
        const diff = startCount.b[type] - currentCount.b[type];
        for (let i = 0; i < diff; i++) {
            blackCaptured.push({ color: 'b', type });
        }
    }

    const selfCapturedEl = document.getElementById('self-captured');
    const oppCapturedEl = document.getElementById('opponent-captured');

    if (!selfCapturedEl || !oppCapturedEl) return;

    selfCapturedEl.innerHTML = '';
    oppCapturedEl.innerHTML = '';

    // If I play white, I capture black pieces. So my HUD (self-captured) shows black.
    // If I play black, I capture white.
    // Spectators see white captures at bottom and black at top (arbitrary, let's treat white as self).
    const isWhiteSelf = (myRole === 'spectator' || myColor === 'w');
    const myCapturedList = isWhiteSelf ? blackCaptured : whiteCaptured;
    const oppCapturedList = isWhiteSelf ? whiteCaptured : blackCaptured;

    myCapturedList.forEach(p => {
        const el = document.createElement('div');
        el.className = 'captured-icon';
        const imgEl = document.createElement('img');
        const pName = p.color + p.type.toUpperCase();
        imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
        imgEl.alt = pName;
        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        el.appendChild(imgEl);
        selfCapturedEl.appendChild(el);
    });

    oppCapturedList.forEach(p => {
        const el = document.createElement('div');
        el.className = 'captured-icon';
        const imgEl = document.createElement('img');
        const pName = p.color + p.type.toUpperCase();
        imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
        imgEl.alt = pName;
        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        el.appendChild(imgEl);
        oppCapturedEl.appendChild(el);
    });
}

// Check validation states and end logic
function checkGameStatus() {
    if (game.game_over()) {
        let title = "Fim de Jogo";
        let reason = "A partida terminou.";
        
        if (game.in_checkmate()) {
            const loserColor = game.turn();
            const winnerColor = loserColor === 'w' ? 'b' : 'w';
            
            let winnerName = "Oponente";
            if (myRole === 'player' && myColor === winnerColor) {
                winnerName = playerName;
            } else {
                const opp = Object.values(players).find(p => p.color === winnerColor);
                if (opp) winnerName = opp.name;
            }
            
            title = "🏆 Xeque-mate!";
            reason = `Vitória de ${winnerName} (${winnerColor === 'w' ? 'Brancas' : 'Pretas'}).`;
        } else if (game.in_stalemate()) {
            title = "🤝 Empate";
            reason = "Rei afogado (Stalemate).";
        } else if (game.insufficient_material()) {
            title = "🤝 Empate";
            reason = "Material insuficiente.";
        } else if (game.in_threefold_repetition()) {
            title = "🤝 Empate";
            reason = "Repetição tripla de jogadas.";
        } else if (game.in_draw()) {
            title = "🤝 Empate";
            reason = "Regra dos 50 movimentos ou acordo.";
        }

        showGameOverModal(title, reason);
    }
}

function showGameOverModal(title, reason) {
    document.getElementById('game-over-title').textContent = title;
    document.getElementById('game-over-reason').textContent = reason;
    
    // Reset rematch button state
    const btnRematch = document.getElementById('btn-rematch');
    btnRematch.disabled = false;
    btnRematch.textContent = "🔄 Propor Revanche";
    if (myRole === 'spectator') {
        btnRematch.style.display = 'none';
    } else {
        btnRematch.style.display = 'inline-flex';
    }
    
    document.getElementById('rematch-status').textContent = '';
    
    showModal('game-over-modal');
    playSound('game-over');
}

// Populate moves history list
function rebuildMovesHistory(movesArray) {
    const listEl = document.getElementById('moves-history-list');
    listEl.innerHTML = '';
    
    for (let i = 0; i < movesArray.length; i += 2) {
        const pairEl = document.createElement('div');
        pairEl.className = 'history-move-pair';
        
        const numSpan = document.createElement('span');
        numSpan.className = 'move-num';
        numSpan.textContent = `${Math.floor(i / 2) + 1}.`;
        
        const whiteSpan = document.createElement('span');
        whiteSpan.className = 'move-white';
        whiteSpan.textContent = movesArray[i].san;
        
        const blackSpan = document.createElement('span');
        blackSpan.className = 'move-black';
        blackSpan.textContent = movesArray[i + 1] ? movesArray[i + 1].san : '';

        pairEl.appendChild(numSpan);
        pairEl.appendChild(whiteSpan);
        pairEl.appendChild(blackSpan);
        listEl.appendChild(pairEl);
    }
    listEl.scrollTop = listEl.scrollHeight;
}

function addMoveToHistoryList(move) {
    const listEl = document.getElementById('moves-history-list');
    const moveNum = Math.floor(game.history().length / 2) + (game.history().length % 2 === 1 ? 1 : 0);
    
    if (game.history().length % 2 === 1) {
        // White move (creates new row)
        const pairEl = document.createElement('div');
        pairEl.className = 'history-move-pair';
        
        const numSpan = document.createElement('span');
        numSpan.className = 'move-num';
        numSpan.textContent = `${moveNum}.`;
        
        const whiteSpan = document.createElement('span');
        whiteSpan.className = 'move-white';
        whiteSpan.textContent = move.san;
        
        const blackSpan = document.createElement('span');
        blackSpan.className = 'move-black';
        blackSpan.textContent = '';

        pairEl.appendChild(numSpan);
        pairEl.appendChild(whiteSpan);
        pairEl.appendChild(blackSpan);
        listEl.appendChild(pairEl);
    } else {
        // Black move (fills last row)
        const lastPair = listEl.lastElementChild;
        if (lastPair) {
            const blackSpan = lastPair.querySelector('.move-black');
            if (blackSpan) blackSpan.textContent = move.san;
        }
    }
    listEl.scrollTop = listEl.scrollHeight;
}

// Update player HUD badges and titles
function updatePlayersHUD() {
    const oppNameEl = document.getElementById('opponent-name');
    const oppStatusEl = document.getElementById('opponent-status');
    const selfNameEl = document.getElementById('self-name');
    const selfRoleEl = document.getElementById('self-role');
    
    const selfBadge = document.querySelector('.self-color-badge');
    const oppBadge = document.querySelector('.opponent-color-badge');

    // Find opponent player object
    const opponent = Object.values(players).find(p => p.id !== socket.id);

    // Render self player profile
    if (myRole === 'spectator') {
        selfNameEl.textContent = playerName;
        selfRoleEl.textContent = "Espectador";
        selfBadge.textContent = "👁️";
        selfBadge.className = "avatar-circle self-color-badge";
    } else {
        selfNameEl.textContent = playerName;
        selfRoleEl.textContent = myColor === 'w' ? "Jogador (Brancas)" : "Jogador (Pretas)";
        selfBadge.textContent = myColor === 'w' ? "♔" : "♚";
        selfBadge.className = `avatar-circle self-color-badge ${myColor === 'w' ? 'white' : 'black'}`;
    }

    // Render opponent player profile
    if (opponent) {
        oppNameEl.textContent = opponent.name;
        oppStatusEl.textContent = "On-line";
        oppStatusEl.className = "player-status connected";
        oppBadge.textContent = opponent.color === 'w' ? "♔" : "♚";
        oppBadge.className = `avatar-circle opponent-color-badge ${opponent.color === 'w' ? 'white' : 'black'}`;
    } else if (myRole === 'spectator') {
        // If spectator, find both players
        const playerList = Object.values(players);
        if (playerList.length > 0) {
            // Display player 1 as self, player 2 as opponent
            const p1 = playerList[0];
            selfNameEl.textContent = p1.name;
            selfRoleEl.textContent = p1.color === 'w' ? "Jogador (Brancas)" : "Jogador (Pretas)";
            selfBadge.textContent = p1.color === 'w' ? "♔" : "♚";
            selfBadge.className = `avatar-circle self-color-badge ${p1.color === 'w' ? 'white' : 'black'}`;

            const p2 = playerList[1];
            if (p2) {
                oppNameEl.textContent = p2.name;
                oppStatusEl.textContent = "On-line";
                oppStatusEl.className = "player-status connected";
                oppBadge.textContent = p2.color === 'w' ? "♔" : "♚";
                oppBadge.className = `avatar-circle opponent-color-badge ${p2.color === 'w' ? 'white' : 'black'}`;
            } else {
                oppNameEl.textContent = "Aguardando jogador...";
                oppStatusEl.textContent = "Off-line";
                oppStatusEl.className = "player-status disconnected";
                oppBadge.textContent = "?";
                oppBadge.className = "avatar-circle opponent-color-badge";
            }
        } else {
            oppNameEl.textContent = "Aguardando jogadores...";
            oppStatusEl.textContent = "Off-line";
            oppStatusEl.className = "player-status disconnected";
            oppBadge.textContent = "?";
            oppBadge.className = "avatar-circle opponent-color-badge";
        }
    } else {
        oppNameEl.textContent = "Aguardando oponente...";
        oppStatusEl.textContent = "Pendente";
        oppStatusEl.className = "player-status disconnected";
        oppBadge.textContent = "?";
        oppBadge.className = "avatar-circle opponent-color-badge";
    }
}

// ------------------------------------------
// SOCKET LISTENERS
// ------------------------------------------

socket.on('roomJoined', (data) => {
    roomId = data.roomId;
    myRole = data.role;
    myColor = data.color;
    players = data.players;
    spectators = data.spectators;

    // Load board state
    game = new Chess(data.fen);
    
    // Automatically flip the board if playing Black
    boardFlipped = (myColor === 'b');
    
    // Adjust layout for board orientation
    const boardWrapper = document.querySelector('.board-wrapper');
    if (boardFlipped) {
        boardWrapper.classList.add('flipped');
    } else {
        boardWrapper.classList.remove('flipped');
    }

    // Load moves
    rebuildMovesHistory(data.moves);

    // Update Room Badge Display
    document.getElementById('room-code-display').textContent = roomId;

    // Update UI panels
    updatePlayersHUD();
    updateTurnIndicator();
    renderBoard();

    // Toggle Screen views
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    addSystemMessage(`Você entrou na sala ${roomId} como ${myRole === 'player' ? (myColor === 'w' ? 'Brancas' : 'Pretas') : 'Espectador'}.`);
});

socket.on('playerJoined', (data) => {
    players = data.players;
    spectators = data.spectators;

    const joiningPlayer = data.player;
    const roleString = data.role === 'player' ? 'Jogador' : 'Espectador';
    addSystemMessage(`${roleString} "${joiningPlayer.name}" entrou na sala.`);

    updatePlayersHUD();
    updateTurnIndicator();
    renderBoard();
});

socket.on('moveMade', (moveData) => {
    // Clear local selection if any to prevent visual glitches on opponent turn
    selectedSquare = null;
    possibleMoves = [];

    const move = game.move({
        from: moveData.move.from,
        to: moveData.move.to,
        promotion: moveData.move.promotion || 'q'
    });

    if (!move) {
        console.warn("Incremental move failed. Hard-syncing board state with FEN.");
        game = new Chess(moveData.fen);
    }

    lastMoveSquares = [moveData.move.from, moveData.move.to];
    
    // Play sound
    if (move && move.captured) {
        playSound('capture');
    } else {
        playSound('move');
    }

    if (game.in_check()) {
        setTimeout(() => playSound('check'), 100);
    }

    if (move) {
        addMoveToHistoryList(move);
    } else {
        // Rebuild history list on hard-sync to keep it fully accurate
        rebuildMovesHistory(game.history({ verbose: true }));
    }

    renderBoard();
    updateTurnIndicator();
    checkGameStatus();
});

socket.on('chatMessage', (data) => {
    addChatMessage(data.senderName, data.senderId, data.text);
});

socket.on('gameOver', (data) => {
    let title = "Fim de Jogo";
    let reason = "A partida terminou.";

    if (data.type === 'resign') {
        title = "🏳️ Desistência";
        reason = `Oponente desistiu. Vitória de ${data.winnerName}!`;
    } else if (data.type === 'draw-agreement') {
        title = "🤝 Empate";
        reason = "A partida terminou em empate por acordo mútuo.";
    }

    showGameOverModal(title, reason);
});

socket.on('drawProposed', () => {
    if (myRole !== 'player') return;
    showModal('draw-modal');
});

socket.on('drawDeclined', () => {
    addSystemMessage("Proposta de empate recusada pelo oponente.");
});

socket.on('rematchRequested', (data) => {
    addSystemMessage(`${data.voterName} solicitou uma revanche.`);
    if (myRole === 'player') {
        document.getElementById('rematch-status').textContent = "Oponente quer jogar novamente!";
    }
});

socket.on('gameRestarted', (data) => {
    // Hide game over screen
    hideModal('game-over-modal');

    // Reset game engine
    game = new Chess(data.fen);
    players = data.players;
    lastMoveSquares = [];

    // Re-verify my color (since they were swapped)
    if (myRole === 'player') {
        myColor = players[socket.id].color;
        boardFlipped = (myColor === 'b');
        
        const boardWrapper = document.querySelector('.board-wrapper');
        if (boardFlipped) {
            boardWrapper.classList.add('flipped');
        } else {
            boardWrapper.classList.remove('flipped');
        }
    }

    // Reset UI
    document.getElementById('moves-history-list').innerHTML = '';
    
    addSystemMessage("Nova partida iniciada! Cores invertidas.");
    
    updatePlayersHUD();
    updateTurnIndicator();
    renderBoard();
});

socket.on('playerLeft', (data) => {
    const roleString = data.role === 'player' ? 'Jogador' : 'Espectador';
    addSystemMessage(`${roleString} "${data.name}" desconectou-se.`);

    if (data.role === 'player') {
        players = data.players;
    } else {
        spectators = data.spectators;
    }

    updatePlayersHUD();
    updateTurnIndicator();
    renderBoard();
});
