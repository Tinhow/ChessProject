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

    socket.on('joinRoom', ({ roomId, playerName, spectateMode }) => {
        roomId = roomId.trim().toUpperCase();
        playerName = playerName ? playerName.trim() : `Jogador_${socket.id.substring(0, 4)}`;

        // Leave previous room if any
        if (currentRoomId) {
            socket.leave(currentRoomId);
        }

        socket.join(roomId);
        currentRoomId = roomId;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: {},
                spectators: [],
                fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                moves: [],
                rematchVotes: new Set()
            };
        }

        const room = rooms[roomId];
        let role = 'spectator';
        let color = null;

        const playerIds = Object.keys(room.players);

        if (!spectateMode && playerIds.length < 2) {
            role = 'player';
            // First player gets White, second gets Black
            color = playerIds.length === 0 ? 'w' : (room.players[playerIds[0]].color === 'w' ? 'b' : 'w');
            room.players[socket.id] = {
                id: socket.id,
                name: playerName,
                color: color
            };
        } else {
            room.spectators.push({
                id: socket.id,
                name: playerName
            });
        }

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

    socket.on('makeMove', (moveData) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        // Save move and update FEN
        room.fen = moveData.fen;
        room.moves.push(moveData.move);
        
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

    socket.on('drawResponse', ({ accepted }) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        if (accepted) {
            io.to(currentRoomId).emit('gameOver', {
                type: 'draw-agreement'
            });
        } else {
            socket.to(currentRoomId).emit('drawDeclined');
        }
    });

    socket.on('requestRematch', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        
        if (!room.players[socket.id]) return; // Only players can request rematch
        
        room.rematchVotes.add(socket.id);
        
        // Notify others
        socket.to(currentRoomId).emit('rematchRequested', {
            voterId: socket.id,
            voterName: room.players[socket.id].name
        });

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

            io.to(currentRoomId).emit('gameRestarted', {
                fen: room.fen,
                players: room.players
            });
        }
    });

    socket.on('disconnect', () => {
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

            // If room is completely empty, delete it after a small delay
            if (Object.keys(room.players).length === 0 && room.spectators.length === 0) {
                setTimeout(() => {
                    if (rooms[currentRoomId] && Object.keys(rooms[currentRoomId].players).length === 0 && rooms[currentRoomId].spectators.length === 0) {
                        delete rooms[currentRoomId];
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
});
