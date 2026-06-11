// Connect to the server socket
const socket = io();

// Game State
let playerId = localStorage.getItem('chess_player_id');
if (!playerId) {
    playerId = 'p_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('chess_player_id', playerId);
}
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
let pendingPromotionMove = null;
let currentReplayIndex = null;

// Offline Bot State
let isSinglePlayerMode = false;
let botColor = null;
let botElo = 1200;

// Match Timer
let timerSeconds = 0;
let timerInterval = null;

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

// ============================================
// MATCH TIMER
// ============================================

function startMatchTimer(resumeSeconds = 0) {
    stopMatchTimer();
    timerSeconds = resumeSeconds;
    const timerEl = document.getElementById('match-timer');
    const displayEl = document.getElementById('timer-display');
    if (timerEl) timerEl.classList.add('running');

    const formatAndDisplay = () => {
        const mm = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
        const ss = String(timerSeconds % 60).padStart(2, '0');
        if (displayEl) displayEl.textContent = `${mm}:${ss}`;

        if (timerEl) {
            if (timerSeconds >= 3600) {
                timerEl.classList.add('urgent');
            } else {
                timerEl.classList.remove('urgent');
            }
        }
    };

    formatAndDisplay();

    // Roda o intervalo de 1s local apenas no modo Solo (computador)
    if (isSinglePlayerMode) {
        timerInterval = setInterval(() => {
            timerSeconds++;
            formatAndDisplay();
        }, 1000);
    }
}

function stopMatchTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    const timerEl = document.getElementById('match-timer');
    if (timerEl) timerEl.classList.remove('running');
}

function resetMatchTimer() {
    stopMatchTimer();
    timerSeconds = 0;
    const displayEl = document.getElementById('timer-display');
    if (displayEl) displayEl.textContent = '00:00';
    const timerEl = document.getElementById('match-timer');
    if (timerEl) timerEl.classList.remove('urgent');
}

// ============================================
// SAVE STATE (localStorage)
// ============================================

const SAVE_KEY = 'chessGameState';

function saveGameState() {
    try {
        const state = {
            isSinglePlayerMode,
            gameMode: game.constructor.name === 'Checkers' ? 'checkers' : 'chess',
            fen: game.fen(),
            moves: game.history({ verbose: true }),
            myColor,
            myRole,
            playerName,
            roomId,
            botColor,
            botElo,
            lastMoveSquares,
            timerSeconds,
            savedAt: Date.now()
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Falha ao salvar estado:', e);
    }
}

function clearGameState() {
    localStorage.removeItem(SAVE_KEY);
}

function loadGameState() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);

        // Ignore saves older than 12 hours
        if (Date.now() - state.savedAt > 12 * 60 * 60 * 1000) {
            clearGameState();
            return;
        }

        // Show resume banner in lobby
        const resumeBanner = document.getElementById('resume-banner');
        if (!resumeBanner) return;

        const gameMode = state.gameMode || 'chess';
        const modeLabel = state.isSinglePlayerMode
            ? `🤖 Solo vs MiniBot (${state.botElo} ELO) · ${gameMode === 'checkers' ? 'Damas' : 'Xadrez'}`
            : `🌐 Sala ${state.roomId} · ${gameMode === 'checkers' ? 'Damas' : 'Xadrez'}`;
        const colorLabel = state.myColor === 'w' ? '⚪ Brancas' : '⚫ Pretas';
        const movesCount = state.moves ? state.moves.length : 0;

        document.getElementById('resume-mode-label').textContent = modeLabel;
        document.getElementById('resume-moves-label').textContent = `${colorLabel} · ${movesCount} jogadas feitas`;
        resumeBanner.style.display = 'flex';

        document.getElementById('btn-resume-game').onclick = () => {
            resumeBanner.style.display = 'none';
            restoreGameState(state);
        };

        document.getElementById('btn-discard-game').onclick = () => {
            clearGameState();
            resumeBanner.style.display = 'none';
        };
    } catch (e) {
        console.warn('Falha ao carregar estado salvo:', e);
        clearGameState();
    }
}

function restoreGameState(state) {
    initAudio();
    document.getElementById('game-over-banner').classList.remove('active');

    isSinglePlayerMode = state.isSinglePlayerMode;
    myColor = state.myColor;
    myRole = state.myRole;
    playerName = state.playerName;
    roomId = state.roomId;
    botColor = state.botColor;
    botElo = state.botElo;
    lastMoveSquares = state.lastMoveSquares || [];

    const gameMode = state.gameMode || 'chess';

    if (isSinglePlayerMode) {
        // Restore solo game directly
        game = gameMode === 'checkers' ? new Checkers() : new Chess();
        if (state.moves && state.moves.length > 0) {
            state.moves.forEach(m => game.move(m));
        }

        players = {};
        players[playerId] = { id: playerId, name: playerName, color: myColor };
        players['bot'] = { id: 'bot', name: `MiniBot (${botElo} ELO)`, color: botColor };
        spectators = [];

        boardFlipped = (myColor === 'b');
        const boardWrapper = document.querySelector('.board-wrapper');
        if (boardFlipped) boardWrapper.classList.add('flipped');
        else boardWrapper.classList.remove('flipped');

        document.getElementById('btn-draw').style.display = 'inline-flex';
        document.getElementById('btn-resign').style.display = 'inline-flex';
        document.getElementById('btn-draw').disabled = false;
        document.getElementById('btn-resign').disabled = false;
        document.getElementById('room-code-display').textContent = 'SOLO 🤖';
        document.getElementById('moves-history-list').innerHTML = '';
        document.getElementById('chat-messages').innerHTML = '<div class="chat-system">♻️ Partida restaurada! Continuando de onde parou...</div>';

        if (state.moves) rebuildMovesHistory(state.moves);

        document.getElementById('lobby-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');

        updatePlayersHUD();
        updateTurnIndicator();
        renderBoard();

        // Resume timer from saved seconds
        startMatchTimer(state.timerSeconds || 0);

        // Disconnect socket - solo mode is fully offline
        socket.disconnect();

        // If it's bot's turn, trigger bot move
        if (game.turn() === botColor && !game.game_over()) {
            setTimeout(triggerBotMove, 1000);
        }
    } else {
        // Restore multiplayer: rejoin the room
        if (!socket.connected) socket.connect();
        document.getElementById('player-name').value = playerName;
        document.getElementById('room-code-input').value = roomId;
        addSystemMessage(`♻️ Reconectando à sala ${roomId}...`);
        socket.emit('joinRoom', { roomId, playerName, playerId });
    }
}

// Initialize board rendering and UI bindings
document.addEventListener('DOMContentLoaded', () => {
    loadNetworkInfo();
    setupEventHandlers();
    loadGameState();
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

    // Bot setup elements
    const btnPlayBotLobby = document.getElementById('btn-play-bot-lobby');
    const btnCancelBotSetup = document.getElementById('btn-cancel-bot-setup');
    const btnStartBotGame = document.getElementById('btn-start-bot-game');
    const colorLabels = document.querySelectorAll('.color-select-label');

    // Trigger audio context startup on first page click
    document.addEventListener('click', initAudio, { once: true });

    // Bot Lobby Button Setup
    btnPlayBotLobby.addEventListener('click', () => {
        initAudio();
        showModal('bot-setup-modal');
    });

    btnCancelBotSetup.addEventListener('click', () => {
        hideModal('bot-setup-modal');
    });

    colorLabels.forEach(label => {
        label.addEventListener('click', () => {
            colorLabels.forEach(l => l.classList.remove('active'));
            label.classList.add('active');
            const radio = label.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    const lobbyModeLabels = document.querySelectorAll('.game-mode-select-label');
    lobbyModeLabels.forEach(label => {
        label.addEventListener('click', () => {
            lobbyModeLabels.forEach(l => l.classList.remove('active'));
            label.classList.add('active');
            const radio = label.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    const botModeLabels = document.querySelectorAll('.bot-game-mode-select-label');
    botModeLabels.forEach(label => {
        label.addEventListener('click', () => {
            botModeLabels.forEach(l => l.classList.remove('active'));
            label.classList.add('active');
            const radio = label.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    btnStartBotGame.addEventListener('click', () => {
        initAudio();
        document.getElementById('game-over-banner').classList.remove('active');
        const inputName = document.getElementById('player-name').value.trim();
        playerName = inputName || `Jogador_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('chess_player_name', playerName);
        
        let selectedColor = 'w';
        const checkedRadio = document.querySelector('input[name="bot-player-color"]:checked');
        if (checkedRadio) {
            selectedColor = checkedRadio.value;
        }
        if (selectedColor === 'random') {
            selectedColor = Math.random() < 0.5 ? 'w' : 'b';
        }

        const selectedElo = parseInt(document.getElementById('bot-elo-select').value);
        
        const botCheckedModeRadio = document.querySelector('input[name="bot-game-mode"]:checked');
        const soloGameMode = botCheckedModeRadio ? botCheckedModeRadio.value : 'chess';

        hideModal('bot-setup-modal');

        // Solo game parameters initialization
        isSinglePlayerMode = true;
        myRole = 'player';
        myColor = selectedColor;
        botColor = myColor === 'w' ? 'b' : 'w';
        botElo = selectedElo;
        roomId = "SOLO";
        lastMoveSquares = [];
        selectedSquare = null;
        possibleMoves = [];

        players = {};
        players[playerId] = { id: playerId, name: playerName, color: myColor };
        players['bot'] = { id: 'bot', name: `MiniBot (${botElo} ELO)`, color: botColor };
        spectators = [];

        game = soloGameMode === 'checkers' ? new Checkers() : new Chess();

        document.getElementById('moves-history-list').innerHTML = '';
        document.getElementById('chat-messages').innerHTML = `<div class="chat-system">Partida Solo de ${soloGameMode === 'checkers' ? 'Damas' : 'Xadrez'} Iniciada!</div>`;
        
        document.getElementById('btn-draw').style.display = 'inline-flex';
        document.getElementById('btn-resign').style.display = 'inline-flex';
        document.getElementById('btn-draw').disabled = false;
        document.getElementById('btn-resign').disabled = false;

        boardFlipped = (myColor === 'b');
        const boardWrapper = document.querySelector('.board-wrapper');
        if (boardFlipped) {
            boardWrapper.classList.add('flipped');
        } else {
            boardWrapper.classList.remove('flipped');
        }

        document.getElementById('room-code-display').textContent = "SOLO 🤖";

        document.getElementById('lobby-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');

        updatePlayersHUD();
        updateTurnIndicator();
        renderBoard();

        setTimeout(() => {
            addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', `Olá, ${playerName}! Boa sorte na partida! Eu jogo de ${botColor === 'w' ? 'Brancas' : 'Pretas'}.`);
        }, 600);

        if (myColor === 'b') {
            setTimeout(triggerBotMove, 1200);
        }

        // Start match timer
        startMatchTimer();

        // Disconnect socket - solo mode is fully offline, no server needed
        socket.disconnect();
    });

    btnCreateRoom.addEventListener('click', () => {
        initAudio();
        const inputName = document.getElementById('player-name').value.trim();
        playerName = inputName || `Host_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('chess_player_name', playerName);
        
        // Generate random room code
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        roomId = code;

        const checkedRadio = document.querySelector('input[name="lobby-game-mode"]:checked');
        const gameMode = checkedRadio ? checkedRadio.value : 'chess';

        socket.emit('joinRoom', { roomId, playerName, playerId, gameMode });
    });

    btnJoinRoom.addEventListener('click', () => {
        initAudio();
        const inputName = document.getElementById('player-name').value.trim();
        playerName = inputName || `Player_${Math.floor(1000 + Math.random() * 9000)}`;
        localStorage.setItem('chess_player_name', playerName);
        
        const codeInput = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (!codeInput) {
            alert('Por favor, digite o código da sala.');
            return;
        }
        roomId = codeInput;

        const spectateMode = document.getElementById('spectate-mode-checkbox').checked;
        socket.emit('joinRoom', { roomId, playerName, playerId, spectateMode });
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
            if (isSinglePlayerMode) {
                addChatMessage(playerName, socket.id, text);
                chatInput.value = '';
                
                // Bot interactive chat reply
                setTimeout(() => {
                    const replies = [
                        "Interessante...",
                        "Estou focado no tabuleiro!",
                        "Que belo dia para uma partida de xadrez.",
                        "Você joga bem!",
                        "Estou calculando minhas próximas jogadas...",
                        "Será que você consegue me vencer?"
                    ];
                    const reply = replies[Math.floor(Math.random() * replies.length)];
                    addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', reply);
                }, 1000);
            } else {
                socket.emit('chatMessage', text);
                chatInput.value = '';
            }
        }
    });

    emojiBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            initAudio();
            const emoji = btn.getAttribute('data-emoji');
            if (isSinglePlayerMode) {
                addChatMessage(playerName, socket.id, `Reação: ${emoji}`);
                // Bot reacts back via chat
                setTimeout(() => {
                    const botEmojis = ["👏", "😮", "🤔", "👑", "👍", "💥"];
                    const botEmoji = botEmojis[Math.floor(Math.random() * botEmojis.length)];
                    addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', `Reação: ${botEmoji}`);
                }, 800);
            } else {
                socket.emit('chatMessage', `Reação: ${emoji}`);
            }
        });
    });

    btnDraw.addEventListener('click', () => {
        if (myRole !== 'player') return;
        if (isSinglePlayerMode) {
            addSystemMessage("Você propôs um empate ao computador.");
            setTimeout(() => {
                const evalScore = evaluateBoard(game.board());
                const materialCount = game.history().length;
                const isDrawish = Math.abs(evalScore) < 120;
                
                if (isDrawish && materialCount > 15) {
                    addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', "Aceito o empate. Boa partida!");
                    showGameOverModal("🤝 Empate", "Partida empatada por comum acordo.");
                } else {
                    const comments = [
                        "Recuso o empate. Vamos continuar jogando!",
                        "Não aceito. A posição ainda está muito ativa.",
                        "Ainda quero lutar pela vitória!",
                        "Prefiro jogar mais um pouco."
                    ];
                    const comment = comments[Math.floor(Math.random() * comments.length)];
                    addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', comment);
                    addSystemMessage("Proposta de empate recusada pelo computador.");
                }
            }, 1000);
        } else {
            socket.emit('proposeDraw');
            addSystemMessage("Você propôs um empate ao oponente.");
        }
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
        if (isSinglePlayerMode) {
            hideModal('resign-modal');
            showGameOverModal("🏳️ Desistência", `Você desistiu. Vitória do MiniBot (${botElo} ELO)!`);
            playSound('game-over');
        } else {
            socket.emit('resign');
            hideModal('resign-modal');
        }
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
        if (isSinglePlayerMode) {
            const nextColor = myColor === 'w' ? 'b' : 'w';
            hideModal('game-over-modal');
            document.getElementById('game-over-banner').classList.remove('active');
            
            myColor = nextColor;
            botColor = myColor === 'w' ? 'b' : 'w';
            boardFlipped = (myColor === 'b');
            
            const boardWrapper = document.querySelector('.board-wrapper');
            if (boardFlipped) {
                boardWrapper.classList.add('flipped');
            } else {
                boardWrapper.classList.remove('flipped');
            }
            
            players = {};
            players[playerId] = { id: playerId, name: playerName, color: myColor };
            players['bot'] = { id: 'bot', name: `MiniBot (${botElo} ELO)`, color: botColor };
            
            game = (game.constructor.name === 'Checkers') ? new Checkers() : new Chess();
            lastMoveSquares = [];
            selectedSquare = null;
            possibleMoves = [];
            
            document.getElementById('moves-history-list').innerHTML = '';
            document.getElementById('chat-messages').innerHTML = '<div class="chat-system">Nova Partida Iniciada! Cores Invertidas.</div>';
            document.getElementById('btn-draw').disabled = false;
            document.getElementById('btn-resign').disabled = false;
            
            updatePlayersHUD();
            updateTurnIndicator();
            renderBoard();
            
            setTimeout(() => {
                addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', `Nova partida iniciada! Agora eu jogo de ${botColor === 'w' ? 'Brancas' : 'Pretas'}. Bom jogo!`);
            }, 600);
            
            // Start match timer and save state
            startMatchTimer(0);
            saveGameState();

            if (myColor === 'b') {
                setTimeout(triggerBotMove, 1200);
            }
        } else {
            socket.emit('requestRematch');
            btnRematch.disabled = true;
            btnRematch.textContent = "Aguardando oponente...";
        }
    });

    btnGoLobby.addEventListener('click', () => {
        returnToLobby();
    });

    const btnViewBoard = document.getElementById('btn-view-board');
    btnViewBoard.addEventListener('click', () => {
        hideModal('game-over-modal');
        document.getElementById('game-over-banner').classList.add('active');
    });

    const btnShowOptions = document.getElementById('btn-show-options');
    btnShowOptions.addEventListener('click', () => {
        document.getElementById('game-over-banner').classList.remove('active');
        showModal('game-over-modal');
    });

    // Promotion choices wiring
    const promotionChoiceBtns = document.querySelectorAll('.promotion-choice-btn');
    promotionChoiceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const piece = btn.getAttribute('data-piece');
            if (pendingPromotionMove) {
                const { from, to } = pendingPromotionMove;
                pendingPromotionMove = null;
                hideModal('promotion-modal');
                makeMove(from, to, piece);
            }
        });
    });

    const btnCancelPromotion = document.getElementById('btn-cancel-promotion');
    if (btnCancelPromotion) {
        btnCancelPromotion.addEventListener('click', () => {
            pendingPromotionMove = null;
            hideModal('promotion-modal');
            renderBoard();
        });
    }

    // Replay navigation wiring
    const btnFirst = document.getElementById('btn-replay-first');
    const btnPrev = document.getElementById('btn-replay-prev');
    const btnNext = document.getElementById('btn-replay-next');
    const btnLast = document.getElementById('btn-replay-last');

    if (btnFirst) {
        btnFirst.addEventListener('click', () => {
            goToReplayIndex(0);
        });
    }
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            const historyLength = game.history().length;
            let prevIndex = currentReplayIndex === null ? historyLength - 2 : currentReplayIndex - 1;
            goToReplayIndex(prevIndex);
        });
    }
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (currentReplayIndex === null) return;
            goToReplayIndex(currentReplayIndex + 1);
        });
    }
    if (btnLast) {
        btnLast.addEventListener('click', () => {
            goToReplayIndex(null);
        });
    }

    const movesHistoryList = document.getElementById('moves-history-list');
    if (movesHistoryList) {
        movesHistoryList.addEventListener('click', (e) => {
            if (!game.game_over()) return; // Replay is only available in the end game
            const clickable = e.target.closest('.move-clickable');
            if (clickable) {
                const index = parseInt(clickable.getAttribute('data-index'));
                goToReplayIndex(index);
            }
        });
    }
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
    document.getElementById('game-over-banner').classList.remove('active');
    
    clearGameState();
    resetMatchTimer();
    
    // Ensure socket is connected when returning to lobby
    if (!socket.connected) {
        socket.connect();
    }
    socket.disconnect();
    
    isSinglePlayerMode = false;
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

    const isReplaying = currentReplayIndex !== null && currentReplayIndex < game.history().length - 1;
    let boardState = game.board();
    let activeGameInstance = game;
    let displayLastMoveSquares = lastMoveSquares;

    if (isReplaying) {
        const tempGame = game.constructor.name === 'Checkers' ? new Checkers() : new Chess();
        const moves = game.history({ verbose: true });
        for (let i = 0; i <= currentReplayIndex; i++) {
            tempGame.move(moves[i]);
        }
        boardState = tempGame.board();
        activeGameInstance = tempGame;
        
        // Find last move of the historical state
        const lastMove = moves[currentReplayIndex];
        if (lastMove) {
            displayLastMoveSquares = [lastMove.from, lastMove.to];
        } else {
            displayLastMoveSquares = [];
        }
    }

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
            if (displayLastMoveSquares.includes(squareId)) {
                squareEl.classList.add('last-move');
            }
            // Check highlight
            if (piece && piece.type === 'k' && piece.color === activeGameInstance.turn() && activeGameInstance.in_check()) {
                squareEl.classList.add('check');
            }

            // Draw Piece
            if (piece) {
                const pieceEl = document.createElement('div');
                if (game.constructor.name === 'Checkers') {
                    pieceEl.className = `checker-piece ${piece.color === 'w' ? 'white' : 'black'}`;
                    if (piece.type === 'k') {
                        pieceEl.classList.add('king');
                    }
                } else {
                    pieceEl.className = `piece ${piece.color}`;
                    const imgEl = document.createElement('img');
                    const pName = piece.color + piece.type.toUpperCase();
                    imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
                    imgEl.alt = pName;
                    imgEl.style.width = '90%';
                    imgEl.style.height = '90%';
                    imgEl.style.pointerEvents = 'none';
                    pieceEl.appendChild(imgEl);
                }
                
                // Set drag properties (disabled during replay)
                if (!isReplaying && myRole === 'player' && myColor === piece.color && activeGameInstance.turn() === myColor) {
                    pieceEl.setAttribute('draggable', 'true');
                    setupPieceDragEvents(pieceEl, squareId);
                }

                squareEl.appendChild(pieceEl);
            }

            // Highlight possible moves (disabled during replay)
            if (!isReplaying && possibleMoves.includes(squareId)) {
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
    highlightActiveMoveInHistory();
    updateNavigationButtonsState();
}

// Click to move logic
function handleSquareClick(squareId) {
    const isReplaying = currentReplayIndex !== null && currentReplayIndex < game.history().length - 1;
    if (isReplaying) return;
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
        const isReplaying = currentReplayIndex !== null && currentReplayIndex < game.history().length - 1;
        if (isReplaying) return;
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

// Trigger move computation and execution for Bot
function triggerBotMove() {
    if (!isSinglePlayerMode || game.game_over() || game.turn() !== botColor) return;
    
    const turnText = document.getElementById('turn-text');
    turnText.textContent = "Computador pensando...";
    const indicator = document.getElementById('turn-indicator');
    indicator.className = "turn-indicator opponent-turn";
    
    setTimeout(() => {
        const botMove = getBotMove(game, botElo, botColor);
        if (botMove) {
            currentReplayIndex = null; // Reset replay index
            const moveResult = game.move(botMove);
            if (moveResult) {
                lastMoveSquares = [botMove.from, botMove.to];
                
                if (moveResult.captured) {
                    playSound('capture');
                } else {
                    playSound('move');
                }
                
                if (game.in_check()) {
                    setTimeout(() => playSound('check'), 100);
                    
                    if (Math.random() < 0.6) {
                        setTimeout(() => {
                            const comments = [
                                "Xeque! Fique atento.",
                                "Cuidado com o seu Rei!",
                                "Xeque! Para onde você vai agora?",
                                "Oops, xeque!"
                            ];
                            const comment = comments[Math.floor(Math.random() * comments.length)];
                            addChatMessage(`MiniBot (${botElo} ELO)`, 'bot', comment);
                        }, 300);
                    }
                }
                
                addMoveToHistoryList(moveResult);
                saveGameState();
                renderBoard();
                updateTurnIndicator();
                if (game.game_over()) {
                    clearGameState();
                }
                checkGameStatus();
                
                // If it is still botColor, trigger another move for checkers combo
                if (game.turn() === botColor && !game.game_over()) {
                    setTimeout(triggerBotMove, 600);
                }
            }
        }
    }, 150);
}

// Execute move locally and sync with server
function makeMove(from, to, promotion = null) {
    // Reset replay view
    currentReplayIndex = null;

    // Clear selection state immediately
    selectedSquare = null;
    possibleMoves = [];

    // Check if this move is a promotion
    const moves = game.moves({ square: from, verbose: true });
    const isPromotion = moves.some(m => m.to === to && m.promotion);

    if (isPromotion && !promotion) {
        pendingPromotionMove = { from, to };
        showModal('promotion-modal');
        return;
    }

    const moveOptions = {
        from: from,
        to: to
    };
    if (promotion) {
        moveOptions.promotion = promotion;
    } else if (isPromotion) {
        moveOptions.promotion = 'q';
    }

    const move = game.move(moveOptions);

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

        // Add to history
        addMoveToHistoryList(move);

        renderBoard();
        updateTurnIndicator();
        
        if (isSinglePlayerMode) {
            saveGameState();
            const gameOver = game.game_over();
            if (!gameOver) {
                setTimeout(triggerBotMove, 600);
            } else {
                clearGameState();
                checkGameStatus();
            }
        } else {
            // Sync with server
            socket.emit('makeMove', {
                roomId,
                move: move,
                fen: game.fen()
            });
            checkGameStatus();
        }
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
    
    const isReplaying = currentReplayIndex !== null && currentReplayIndex < game.history().length - 1;
    if (isReplaying) {
        const moveNumber = Math.floor(currentReplayIndex / 2) + 1;
        const colorName = currentReplayIndex % 2 === 0 ? 'Brancas' : 'Pretas';
        turnText.textContent = `Replay: Lance ${moveNumber} (${colorName})`;
        indicator.className = "turn-indicator";
        return;
    }

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

// ------------------------------------------
// REPLAY HELPERS
// ------------------------------------------

function goToReplayIndex(index) {
    const historyLength = game.history().length;
    if (historyLength === 0) return;

    if (index < 0) index = 0;
    if (index >= historyLength) index = null;

    currentReplayIndex = index;
    renderBoard();
    updateTurnIndicator();
}

function highlightActiveMoveInHistory() {
    const clickableSpans = document.querySelectorAll('.move-clickable');
    clickableSpans.forEach(span => span.classList.remove('active-move'));

    const historyLength = game.history().length;
    let targetIndex = currentReplayIndex;

    if (targetIndex === null && historyLength > 0) {
        targetIndex = historyLength - 1;
    }

    if (targetIndex !== null && targetIndex >= 0) {
        const activeSpan = document.querySelector(`.move-clickable[data-index="${targetIndex}"]`);
        if (activeSpan) {
            activeSpan.classList.add('active-move');
            activeSpan.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

function updateNavigationButtonsState() {
    const btnFirst = document.getElementById('btn-replay-first');
    const btnPrev = document.getElementById('btn-replay-prev');
    const btnNext = document.getElementById('btn-replay-next');
    const btnLast = document.getElementById('btn-replay-last');
    const listEl = document.getElementById('moves-history-list');

    if (!btnFirst || !btnPrev || !btnNext || !btnLast) return;

    const historyLength = game.history().length;
    const isGameOver = game.game_over();

    // Replay is only enabled in the end game
    if (!isGameOver) {
        btnFirst.disabled = true;
        btnPrev.disabled = true;
        btnNext.disabled = true;
        btnLast.disabled = true;
        if (listEl) listEl.classList.remove('replay-enabled');
        return;
    }

    if (listEl) listEl.classList.add('replay-enabled');

    if (historyLength === 0) {
        btnFirst.disabled = true;
        btnPrev.disabled = true;
        btnNext.disabled = true;
        btnLast.disabled = true;
        return;
    }

    const isAtStart = currentReplayIndex === 0;
    const isAtEnd = currentReplayIndex === null || currentReplayIndex === historyLength - 1;

    btnFirst.disabled = isAtStart;
    btnPrev.disabled = isAtStart;
    btnNext.disabled = isAtEnd;
    btnLast.disabled = isAtEnd;
}

// Compute captured pieces from initial count
function updateCapturedPieces() {
    const isCheckers = game.constructor.name === 'Checkers';
    const startCount = isCheckers ? {
        w: { p: 12 },
        b: { p: 12 }
    } : {
        w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
        b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
    };
    
    const currentCount = isCheckers ? {
        w: { p: 0 },
        b: { p: 0 }
    } : {
        w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
        b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
    };

    const board = game.board();
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece) {
                if (isCheckers) {
                    currentCount[piece.color].p++;
                } else {
                    if (piece.type !== 'k') {
                        currentCount[piece.color][piece.type]++;
                    }
                }
            }
        }
    }

    const whiteCaptured = [];
    const blackCaptured = [];
    const pieceTypes = isCheckers ? ['p'] : ['p', 'n', 'b', 'r', 'q'];

    // Missing white pieces were captured by Black
    for (const type of pieceTypes) {
        const diff = startCount.w[type] - currentCount.w[type];
        for (let i = 0; i < diff; i++) {
            whiteCaptured.push({ color: 'w', type });
        }
    }

    // Missing black pieces were captured by White
    for (const type of pieceTypes) {
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
        if (isCheckers) {
            const pieceDisc = document.createElement('div');
            pieceDisc.className = `checker-piece ${p.color === 'w' ? 'white' : 'black'}`;
            pieceDisc.style.width = '100%';
            pieceDisc.style.height = '100%';
            pieceDisc.style.margin = '0';
            pieceDisc.style.borderWidth = '1.5px';
            pieceDisc.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
            el.appendChild(pieceDisc);
        } else {
            const imgEl = document.createElement('img');
            const pName = p.color + p.type.toUpperCase();
            imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
            imgEl.alt = pName;
            imgEl.style.width = '100%';
            imgEl.style.height = '100%';
            el.appendChild(imgEl);
        }
        selfCapturedEl.appendChild(el);
    });

    oppCapturedList.forEach(p => {
        const el = document.createElement('div');
        el.className = 'captured-icon';
        if (isCheckers) {
            const pieceDisc = document.createElement('div');
            pieceDisc.className = `checker-piece ${p.color === 'w' ? 'white' : 'black'}`;
            pieceDisc.style.width = '100%';
            pieceDisc.style.height = '100%';
            pieceDisc.style.margin = '0';
            pieceDisc.style.borderWidth = '1.5px';
            pieceDisc.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
            el.appendChild(pieceDisc);
        } else {
            const imgEl = document.createElement('img');
            const pName = p.color + p.type.toUpperCase();
            imgEl.src = `https://lichess1.org/assets/piece/cburnett/${pName}.svg`;
            imgEl.alt = pName;
            imgEl.style.width = '100%';
            imgEl.style.height = '100%';
            el.appendChild(imgEl);
        }
        oppCapturedEl.appendChild(el);
    });
}

// Check validation states and end logic
function checkGameStatus() {
    if (game.game_over()) {
        let title = "Fim de Jogo";
        let reason = "A partida terminou.";
        
        if (game.constructor.name === 'Checkers') {
            const loserColor = game.turn();
            const winnerColor = loserColor === 'w' ? 'b' : 'w';
            
            let winnerName = "Oponente";
            if (myRole === 'player' && myColor === winnerColor) {
                winnerName = playerName;
            } else {
                const opp = Object.values(players).find(p => p.color === winnerColor);
                if (opp) winnerName = opp.name;
            }
            
            title = "🏆 Fim de Jogo!";
            reason = `Vitória de ${winnerName} (${winnerColor === 'w' ? 'Brancas' : 'Pretas'}) por falta de movimentos válidos do oponente.`;
        } else {
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
        }

        showGameOverModal(title, reason);

        // Notifica o servidor para parar o cronômetro no modo multiplayer
        if (!isSinglePlayerMode && myRole === 'player') {
            socket.emit('gameFinished');
        }
    }
}

function showGameOverModal(title, reason) {
    stopMatchTimer();
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
    
    // Disable game action buttons when game is over (analyzing mode)
    const btnDraw = document.getElementById('btn-draw');
    const btnResign = document.getElementById('btn-resign');
    if (btnDraw) btnDraw.disabled = true;
    if (btnResign) btnResign.disabled = true;
    
    showModal('game-over-modal');
    playSound('game-over');
}

// Translate English SAN notation to Portuguese algebraic notation
function translateSanToPt(san) {
    if (!san) return '';
    let result = san;
    const firstChar = san.charAt(0);
    if (firstChar === 'N') {
        result = 'C' + san.substring(1);
    } else if (firstChar === 'K') {
        result = 'R' + san.substring(1);
    } else if (firstChar === 'Q') {
        result = 'D' + san.substring(1);
    } else if (firstChar === 'R') {
        result = 'T' + san.substring(1);
    } else if (firstChar === 'B') {
        result = 'B' + san.substring(1);
    }
    
    // Replace promotion if any
    result = result.replace('=N', '=C')
                   .replace('=K', '=R')
                   .replace('=Q', '=D')
                   .replace('=R', '=T')
                   .replace('=B', '=B');
                   
    return result;
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
        whiteSpan.className = 'move-white move-clickable';
        whiteSpan.setAttribute('data-index', i);
        whiteSpan.textContent = translateSanToPt(movesArray[i].san);
        
        const blackSpan = document.createElement('span');
        blackSpan.className = 'move-black move-clickable';
        if (movesArray[i + 1]) {
            blackSpan.setAttribute('data-index', i + 1);
            blackSpan.textContent = translateSanToPt(movesArray[i + 1].san);
        } else {
            blackSpan.textContent = '';
        }

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
    const moveIndex = game.history().length - 1;
    
    if (game.history().length % 2 === 1) {
        // White move (creates new row)
        const pairEl = document.createElement('div');
        pairEl.className = 'history-move-pair';
        
        const numSpan = document.createElement('span');
        numSpan.className = 'move-num';
        numSpan.textContent = `${moveNum}.`;
        
        const whiteSpan = document.createElement('span');
        whiteSpan.className = 'move-white move-clickable';
        whiteSpan.setAttribute('data-index', moveIndex);
        whiteSpan.textContent = translateSanToPt(move.san);
        
        const blackSpan = document.createElement('span');
        blackSpan.className = 'move-black move-clickable';
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
            if (blackSpan) {
                blackSpan.setAttribute('data-index', moveIndex);
                blackSpan.textContent = translateSanToPt(move.san);
            }
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

    const isCheckers = game.constructor.name === 'Checkers';
    const whiteSymbol = isCheckers ? "⚪" : "♔";
    const blackSymbol = isCheckers ? "🔴" : "♚";

    // Find opponent player object
    const opponent = Object.values(players).find(p => p.id !== playerId);

    // Render profiles based on role
    if (myRole === 'spectator') {
        // For spectators, show player 1 at bottom, player 2 at top
        const playerList = Object.values(players);
        
        if (playerList.length > 0) {
            const p1 = playerList[0];
            selfNameEl.textContent = p1.name;
            selfRoleEl.textContent = p1.color === 'w' ? "Jogador (Brancas)" : "Jogador (Pretas)";
            selfBadge.textContent = p1.color === 'w' ? whiteSymbol : blackSymbol;
            selfBadge.className = `avatar-circle self-color-badge ${p1.color === 'w' ? 'white' : 'black'}`;

            const p2 = playerList[1];
            if (p2) {
                oppNameEl.textContent = p2.name;
                oppStatusEl.textContent = "On-line";
                oppStatusEl.className = "player-status connected";
                oppBadge.textContent = p2.color === 'w' ? whiteSymbol : blackSymbol;
                oppBadge.className = `avatar-circle opponent-color-badge ${p2.color === 'w' ? 'white' : 'black'}`;
            } else {
                oppNameEl.textContent = "Aguardando jogador...";
                oppStatusEl.textContent = "Off-line";
                oppStatusEl.className = "player-status disconnected";
                oppBadge.textContent = "?";
                oppBadge.className = "avatar-circle opponent-color-badge";
            }
        } else {
            selfNameEl.textContent = playerName;
            selfRoleEl.textContent = "Espectador";
            selfBadge.textContent = "👁️";
            selfBadge.className = "avatar-circle self-color-badge";

            oppNameEl.textContent = "Aguardando jogadores...";
            oppStatusEl.textContent = "Off-line";
            oppStatusEl.className = "player-status disconnected";
            oppBadge.textContent = "?";
            oppBadge.className = "avatar-circle opponent-color-badge";
        }
    } else {
        // For actual players
        selfNameEl.textContent = playerName;
        selfRoleEl.textContent = myColor === 'w' ? "Jogador (Brancas)" : "Jogador (Pretas)";
        selfBadge.textContent = myColor === 'w' ? whiteSymbol : blackSymbol;
        selfBadge.className = `avatar-circle self-color-badge ${myColor === 'w' ? 'white' : 'black'}`;

        if (opponent) {
            oppNameEl.textContent = opponent.name;
            oppStatusEl.textContent = "On-line";
            oppStatusEl.className = "player-status connected";
            oppBadge.textContent = opponent.color === 'w' ? whiteSymbol : blackSymbol;
            oppBadge.className = `avatar-circle opponent-color-badge ${opponent.color === 'w' ? 'white' : 'black'}`;
        } else {
            oppNameEl.textContent = "Aguardando oponente...";
            oppStatusEl.textContent = "Pendente";
            oppStatusEl.className = "player-status disconnected";
            oppBadge.textContent = "?";
            oppBadge.className = "avatar-circle opponent-color-badge";
        }
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

    // Show/hide draw and resign buttons for spectators
    if (myRole === 'spectator') {
        document.getElementById('btn-draw').style.display = 'none';
        document.getElementById('btn-resign').style.display = 'none';
    } else {
        document.getElementById('btn-draw').style.display = 'inline-flex';
        document.getElementById('btn-resign').style.display = 'inline-flex';
        document.getElementById('btn-draw').disabled = false;
        document.getElementById('btn-resign').disabled = false;
    }

    // Hide game-over banner on new/rejoined room
    document.getElementById('game-over-banner').classList.remove('active');

    // Load board state and history by replaying moves from initial board state
    const gameMode = data.gameMode || 'chess';
    if (gameMode === 'checkers') {
        game = new Checkers();
        if (data.moves && data.moves.length > 0) {
            data.moves.forEach(m => game.move(m));
        } else if (data.fen) {
            game.load(data.fen);
        }
    } else {
        game = data.fen ? new Chess(data.fen) : new Chess();
        if (data.moves && data.moves.length > 0) {
            data.moves.forEach(m => game.move(m));
        }
    }
    
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
    
    // Inicia o cronômetro com o valor oficial do servidor
    startMatchTimer(data.timerSeconds || 0);
    saveGameState();
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
    // Reset replay view
    currentReplayIndex = null;

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
        if (game.constructor.name === 'Checkers') {
            game.load(moveData.fen);
        } else {
            game = new Chess(moveData.fen);
        }
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
    if (!isSinglePlayerMode) saveGameState();
    if (game.game_over()) clearGameState();
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
    document.getElementById('game-over-banner').classList.remove('active');

    // Reset game engine
    const gameMode = data.gameMode || (game.constructor.name === 'Checkers' ? 'checkers' : 'chess');
    if (gameMode === 'checkers') {
        game = new Checkers();
        if (data.fen) game.load(data.fen);
    } else {
        game = new Chess(data.fen);
    }
    players = data.players;
    lastMoveSquares = [];

    // Re-verify my color (since they were swapped)
    if (myRole === 'player') {
        myColor = players[playerId].color;
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
    if (myRole === 'player') {
        document.getElementById('btn-draw').disabled = false;
        document.getElementById('btn-resign').disabled = false;
    }
    
    addSystemMessage("Nova partida iniciada! Cores invertidas.");
    
    updatePlayersHUD();
    updateTurnIndicator();
    renderBoard();
});

socket.on('timerUpdate', (data) => {
    if (isSinglePlayerMode) return;
    timerSeconds = data.timerSeconds;
    const mm = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const ss = String(timerSeconds % 60).padStart(2, '0');
    const displayEl = document.getElementById('timer-display');
    if (displayEl) displayEl.textContent = `${mm}:${ss}`;
    
    const timerEl = document.getElementById('match-timer');
    if (timerEl) {
        timerEl.classList.add('running');
        if (timerSeconds >= 3600) {
            timerEl.classList.add('urgent');
        } else {
            timerEl.classList.remove('urgent');
        }
    }
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

// ------------------------------------------
// CONNECTION HEALTH (Render keep-alive & disconnect overlay)
// ------------------------------------------

// Show/hide reconnecting overlay
function showReconnectingOverlay(visible) {
    let overlay = document.getElementById('reconnect-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reconnect-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999',
            'background:rgba(9,10,15,0.88)',
            'backdrop-filter:blur(6px)',
            'display:flex', 'flex-direction:column',
            'align-items:center', 'justify-content:center',
            'gap:14px', 'color:#fff', 'font-family:Outfit,sans-serif'
        ].join(';');
        overlay.innerHTML = `
            <span style="font-size:2.5rem">⚡</span>
            <p style="font-size:1.1rem;font-weight:700;margin:0">Reconectando ao servidor...</p>
            <p style="font-size:0.85rem;color:#94a3b8;margin:0">O servidor pode ter hibernado. Aguarde um momento.</p>
            <div style="width:36px;height:36px;border:3px solid rgba(139,92,246,0.3);border-top-color:#8b5cf6;border-radius:50%;animation:spin 0.8s linear infinite"></div>
            <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.display = visible ? 'flex' : 'none';
}

socket.on('disconnect', (reason) => {
    // Don't show overlay if we intentionally disconnected or in solo mode
    if (isSinglePlayerMode) return;
    if (reason === 'io client disconnect') return;
    console.warn('Socket disconnected:', reason);
    if (document.getElementById('game-screen')?.classList.contains('active')) {
        showReconnectingOverlay(true);
    }
});

socket.on('connect', () => {
    showReconnectingOverlay(false);
    console.log('Socket connected:', socket.id);
    
    // If we were in an active multiplayer room, rejoin automatically to sync state
    if (!isSinglePlayerMode && roomId && roomId !== 'SOLO') {
        console.log(`[Socket] Re-joining active room ${roomId} after connection restore...`);
        addSystemMessage('♻️ Conexão restabelecida! Sincronizando estado da partida...');
        socket.emit('joinRoom', { roomId, playerName, playerId });
    }
});

socket.on('connect_error', (err) => {
    console.warn('Socket connection error:', err.message);
});

socket.on('reconnect_error', () => {
    console.warn('Reconnect attempt failed.');
});

// Keep-alive ping every 8 minutes to prevent Render free-tier sleep during active multiplayer
setInterval(() => {
    if (!isSinglePlayerMode && socket.connected && roomId && roomId !== 'SOLO') {
        fetch('/api/info').catch(() => {}); // lightweight GET to keep server awake
    }
}, 8 * 60 * 1000);
