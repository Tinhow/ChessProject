const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3080;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store room states
const rooms = {};

// Redis integration for persistent multiplayer rooms
const Redis = require('ioredis');
let redisClient = null;

if (process.env.REDIS_URL) {
    console.log('[Redis] Conectando ao Redis utilizando a variável REDIS_URL...');
    redisClient = new Redis(process.env.REDIS_URL);
    redisClient.on('error', (err) => {
        console.error('[Redis] Erro na conexão do Redis:', err);
    });
    redisClient.on('connect', () => {
        console.log('[Redis] Conectado com sucesso ao Redis/Valkey!');
    });
} else {
    console.log('[Redis] REDIS_URL não detectada. Armazenamento em memória local apenas.');
}

const ROOM_TTL = 24 * 60 * 60; // 24 hours in seconds

async function saveRoomToRedis(roomId) {
    const room = rooms[roomId];
    if (!room || !redisClient) return;
    try {
        const serialized = JSON.stringify({
            id: room.id,
            players: room.players,
            spectators: room.spectators,
            fen: room.fen,
            moves: room.moves,
            rematchVotes: Array.from(room.rematchVotes || [])
        });
        await redisClient.set(`room:${roomId}`, serialized, 'EX', ROOM_TTL);
    } catch (err) {
        console.error(`[Redis] Erro ao salvar sala ${roomId}:`, err);
    }
}

async function loadRoomFromRedis(roomId) {
    // If room already exists in memory, use it
    if (rooms[roomId]) return rooms[roomId];
    if (!redisClient) return null;
    try {
        const data = await redisClient.get(`room:${roomId}`);
        if (!data) return null;
        
        const parsed = JSON.parse(data);
        rooms[roomId] = {
            id: parsed.id,
            players: parsed.players || {},
            spectators: parsed.spectators || [],
            fen: parsed.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            moves: parsed.moves || [],
            rematchVotes: new Set(parsed.rematchVotes || [])
        };
        console.log(`[Redis] Sala ${roomId} restaurada com sucesso do Redis.`);
        return rooms[roomId];
    } catch (err) {
        console.error(`[Redis] Erro ao carregar sala ${roomId}:`, err);
        return null;
    }
}

async function deleteRoomFromRedis(roomId) {
    if (!redisClient) return;
    try {
        await redisClient.del(`room:${roomId}`);
        console.log(`[Redis] Sala ${roomId} deletada do Redis.`);
    } catch (err) {
        console.error(`[Redis] Erro ao deletar sala ${roomId}:`, err);
    }
}


// Helper to get local IP address
function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Check for IPv4 and non-loopback
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }
    return addresses.length > 0 ? addresses[0] : 'localhost';
}

const localIP = getLocalIPAddress();

// Expose API endpoint to let frontend know the LAN IP
app.get('/api/info', (req, res) => {
    res.json({ localIP, port: PORT });
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    let currentRoomId = null;

    socket.on('joinRoom', async ({ roomId, playerName, spectateMode }) => {
        roomId = roomId.trim().toUpperCase();
        playerName = playerName ? playerName.trim() : `Jogador_${socket.id.substring(0, 4)}`;

        // Leave previous room if any
        if (currentRoomId) {
            socket.leave(currentRoomId);
        }

        socket.join(roomId);
        currentRoomId = roomId;

        // Try to load the room from Redis first
        let room = await loadRoomFromRedis(roomId);

        if (!room) {
            rooms[roomId] = {
                id: roomId,
                players: {},
                spectators: [],
                fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                moves: [],
                rematchVotes: new Set()
            };
            room = rooms[roomId];
        }

        let role = 'spectator';
        let color = null;

        const normalizedJoinName = playerName.trim().toLowerCase();
        console.log(`[joinRoom] Usuário "${playerName}" tentando entrar na sala "${roomId}". Modo Espectador: ${!!spectateMode}`);

        // Clean up any old spectator entry with the same name to prevent duplicates
        room.spectators = room.spectators.filter(s => s.name.trim().toLowerCase() !== normalizedJoinName);

        // Check if a player with this name already exists in the room (reconnection/refresh case)
        let existingPlayerKey = null;
        console.log(`[joinRoom] Lista atual de jogadores em memória na sala ${roomId}:`, JSON.stringify(room.players));

        for (const [sid, p] of Object.entries(room.players)) {
            const normalizedExistingName = p.name ? p.name.trim().toLowerCase() : '';
            console.log(`[joinRoom] Comparando "${normalizedJoinName}" com "${normalizedExistingName}" (socket: ${sid})`);
            if (normalizedExistingName === normalizedJoinName) {
                existingPlayerKey = sid;
                break;
            }
        }

        if (existingPlayerKey) {
            // Reconnection: reclaim slot and keep the color
            role = 'player';
            color = room.players[existingPlayerKey].color;
            
            // Remove the old connection entry
            delete room.players[existingPlayerKey];
            
            // Register under the new connection ID
            room.players[socket.id] = {
                id: socket.id,
                name: playerName,
                color: color
            };
            console.log(`[Reconnection SUCCESS] Player "${playerName}" reassumiu sua vaga como "${color}" (novo socket: ${socket.id})`);
        } else if (!spectateMode) {
            const playerIds = Object.keys(room.players);
            console.log(`[joinRoom] Sala não cheia e sem modo espectador. Jogadores atuais: ${playerIds.length}`);
            if (playerIds.length < 2) {
                role = 'player';
                // First player gets White, second gets Black
                color = playerIds.length === 0 ? 'w' : (room.players[playerIds[0]].color === 'w' ? 'b' : 'w');
                room.players[socket.id] = {
                    id: socket.id,
                    name: playerName,
                    color: color
                };
                console.log(`[joinRoom] Nova vaga atribuída para "${playerName}" como "${color}"`);
            } else {
                // Room is full, join as spectator
                room.spectators.push({
                    id: socket.id,
                    name: playerName
                });
                console.log(`[joinRoom] Sala cheia (2 jogadores ativos). "${playerName}" entrou como Espectador.`);
            }
        } else {
            room.spectators.push({
                id: socket.id,
                name: playerName
            });
            console.log(`[joinRoom] Entrada forçada em modo Espectador para "${playerName}".`);
        }

        // Save updated state to Redis
        await saveRoomToRedis(roomId);

        // Send current room state to the joining socket
        socket.emit('roomJoined', {
            roomId,
            role,
            color,
            players: room.players,
            spectators: room.spectators,
            fen: room.fen,
            moves: room.moves
        });

        // Broadcast to other players in the room
        socket.to(roomId).emit('playerJoined', {
            role,
            player: role === 'player' ? room.players[socket.id] : { id: socket.id, name: playerName },
            players: room.players,
            spectators: room.spectators
        });

        console.log(`User ${playerName} (${socket.id}) joined room ${roomId} as ${role} (${color})`);
    });

    socket.on('makeMove', async (moveData) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        // Save move and update FEN
        room.fen = moveData.fen;
        room.moves.push(moveData.move);
        
        // Save state to Redis
        await saveRoomToRedis(currentRoomId);
        
        // Broadcast the move to everyone else in the room
        socket.to(currentRoomId).emit('moveMade', moveData);
    });

    socket.on('chatMessage', (messageText) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        let senderName = 'Espectador';
        
        if (room.players[socket.id]) {
            senderName = room.players[socket.id].name;
        } else {
            const spec = room.spectators.find(s => s.id === socket.id);
            if (spec) senderName = spec.name;
        }

        io.to(currentRoomId).emit('chatMessage', {
            senderId: socket.id,
            senderName,
            text: messageText,
            timestamp: Date.now()
        });
    });

    socket.on('resign', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        if (room.players[socket.id]) {
            const resigningPlayer = room.players[socket.id];
            io.to(currentRoomId).emit('gameOver', {
                type: 'resign',
                winnerColor: resigningPlayer.color === 'w' ? 'b' : 'w',
                winnerName: Object.values(room.players).find(p => p.id !== socket.id)?.name || 'Oponente'
            });
        }
    });

    socket.on('proposeDraw', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        socket.to(currentRoomId).emit('drawProposed', {
            proposerId: socket.id
        });
    });

    socket.on('drawResponse', async ({ accepted }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        if (accepted) {
            io.to(currentRoomId).emit('gameOver', {
                type: 'draw-agreement'
            });
            // Delete game from Redis as it is completed
            await deleteRoomFromRedis(currentRoomId);
        } else {
            socket.to(currentRoomId).emit('drawDeclined');
        }
    });

    socket.on('requestRematch', async () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        if (!room.players[socket.id]) return; // Only players can request rematch
        
        room.rematchVotes.add(socket.id);
        
        // Notify others
        socket.to(currentRoomId).emit('rematchRequested', {
            voterId: socket.id,
            voterName: room.players[socket.id].name
        });

        // Save votes to Redis
        await saveRoomToRedis(currentRoomId);
 
        // Check if both players agreed
        const activePlayerIds = Object.keys(room.players);
        if (activePlayerIds.every(id => room.rematchVotes.has(id))) {
            // Reset game state
            room.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
            room.moves = [];
            room.rematchVotes.clear();
            
            // Swap colors for a fresh game
            if (activePlayerIds.length === 2) {
                const p1 = room.players[activePlayerIds[0]];
                const p2 = room.players[activePlayerIds[1]];
                const tempColor = p1.color;
                p1.color = p2.color;
                p2.color = tempColor;
            }

            await saveRoomToRedis(currentRoomId);
 
            io.to(currentRoomId).emit('gameRestarted', {
                fen: room.fen,
                players: room.players
            });
        }
    });

    socket.on('disconnect', async () => {
        console.log(`User disconnected: ${socket.id}`);
        if (currentRoomId && rooms[currentRoomId]) {
            const room = rooms[currentRoomId];
            
            if (room.players[socket.id]) {
                const playerName = room.players[socket.id].name;
                delete room.players[socket.id];
                
                // Notify room
                io.to(currentRoomId).emit('playerLeft', {
                    role: 'player',
                    id: socket.id,
                    name: playerName,
                    players: room.players
                });
                
                // Clear rematch vote
                room.rematchVotes.delete(socket.id);
            } else {
                const index = room.spectators.findIndex(s => s.id === socket.id);
                if (index !== -1) {
                    const spectatorName = room.spectators[index].name;
                    room.spectators.splice(index, 1);
                    io.to(currentRoomId).emit('playerLeft', {
                        role: 'spectator',
                        id: socket.id,
                        name: spectatorName,
                        spectators: room.spectators
                    });
                }
            }

            // Save updated state after someone disconnected (e.g. spectator left, or player disconnected but can rejoin)
            await saveRoomToRedis(currentRoomId);
 
            // If room is completely empty, delete it after a small delay
            if (Object.keys(room.players).length === 0 && room.spectators.length === 0) {
                setTimeout(async () => {
                    if (rooms[currentRoomId] && Object.keys(rooms[currentRoomId].players).length === 0 && rooms[currentRoomId].spectators.length === 0) {
                        delete rooms[currentRoomId];
                        await deleteRoomFromRedis(currentRoomId);
                        console.log(`Room ${currentRoomId} deleted due to inactivity.`);
                    }
                }, 5000);
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`===================================================`);
    console.log(`  Chess LAN Server is running!`);
    console.log(`  Local access: http://localhost:${PORT}`);
    console.log(`  LAN access:   http://${localIP}:${PORT}`);
    console.log(`===================================================`);

    // Self-ping keep-alive: prevents Render free-tier from hibernating
    // Only runs in production (Render sets NODE_ENV=production automatically)
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
        const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes

        setInterval(() => {
            const url = `${SELF_URL}/api/info`;
            http.get(url, (res) => {
                console.log(`[keep-alive] Self-ping OK (${res.statusCode}) → ${url}`);
            }).on('error', (err) => {
                console.warn(`[keep-alive] Self-ping failed: ${err.message}`);
            });
        }, PING_INTERVAL);

        console.log(`[keep-alive] Self-ping ativo a cada 10 minutos → ${SELF_URL}`);
    }
});

