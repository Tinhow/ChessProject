// Piece values for positional valuation
const PIECE_VALUES = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
};

// PST (Piece-Square Tables) for positional cues (from White's perspective)
const PAWN_PST = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,  5, 10, 25, 25, 10,  5,  5],
    [0,  0,  0, 20, 20,  0,  0,  0],
    [5, -5,-10,  0,  0,-10, -5,  5],
    [5, 10, 10,-20,-20, 10, 10,  5],
    [0,  0,  0,  0,  0,  0,  0,  0]
];

const KNIGHT_PST = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
];

const BISHOP_PST = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
];

const ROOK_PST = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  5,  5,  0,  0,  0]
];

const QUEEN_PST = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,  0,  5,  5,  5,  5,  0, -5],
    [0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  5,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
];

const KING_PST = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20, 20,  0,  0,  0,  0, 20, 20],
    [20, 30, 10,  0,  0, 10, 30, 20]
];

const PST = {
    p: PAWN_PST,
    n: KNIGHT_PST,
    b: BISHOP_PST,
    r: ROOK_PST,
    q: QUEEN_PST,
    k: KING_PST
};

// Evaluate the board state
function evaluateBoard(boardState, isCheckers = null) {
    if (isCheckers === null) {
        isCheckers = (typeof game !== 'undefined' && game && game.constructor.name === 'Checkers');
    }

    if (isCheckers) {
        let score = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = boardState[r][c];
                if (piece) {
                    const value = piece.type === 'k' ? 300 : 100;
                    let positionalBonus = 0;
                    if (piece.type === 'p') {
                        // Encourage pawns to advance towards promotion
                        positionalBonus = piece.color === 'w' ? (7 - r) * 10 : r * 10;
                    } else {
                        // Encourage kings to control the center diagonals
                        const distFromCenter = Math.abs(3.5 - r) + Math.abs(3.5 - c);
                        positionalBonus = (8 - distFromCenter) * 5;
                    }
                    
                    const pieceScore = value + positionalBonus;
                    if (piece.color === 'w') {
                        score += pieceScore;
                    } else {
                        score -= pieceScore;
                    }
                }
            }
        }
        return score;
    }

    let score = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = boardState[r][c];
            if (piece) {
                const value = PIECE_VALUES[piece.type];
                const pstTable = PST[piece.type];
                
                // For Black, mirror the PST vertically
                const pstRow = piece.color === 'w' ? r : 7 - r;
                const pstValue = pstTable ? pstTable[pstRow][c] : 0;
                
                const pieceScore = value + pstValue;
                
                if (piece.color === 'w') {
                    score += pieceScore;
                } else {
                    score -= pieceScore;
                }
            }
        }
    }
    return score;
}

// Simple move sorting for alpha-beta pruning optimization
function sortMoves(moves, isCheckers = false) {
    const values = isCheckers ? { p: 100, k: 300 } : PIECE_VALUES;
    return moves.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;
        
        if (a.captured) {
            const capType = typeof a.captured === 'object' ? a.captured.type : a.captured;
            scoreA = 10 * (values[capType] || 100) - (values[a.piece] || 100);
        }
        if (b.captured) {
            const capType = typeof b.captured === 'object' ? b.captured.type : b.captured;
            scoreB = 10 * (values[capType] || 100) - (values[b.piece] || 100);
        }
        
        if (!isCheckers) {
            if (a.san && a.san.includes('=')) scoreA += 900;
            if (b.san && b.san.includes('=')) scoreB += 900;
            
            if (a.san && a.san.includes('+')) scoreA += 50;
            if (b.san && b.san.includes('+')) scoreB += 50;
        }
        
        return scoreB - scoreA;
    });
}

// Minimax algorithm with Alpha-Beta Pruning
function minimax(chessGame, depth, alpha, beta, isMaximizing) {
    const isCheckers = chessGame.constructor.name === 'Checkers';
    if (depth === 0 || chessGame.game_over()) {
        return evaluateBoard(chessGame.board(), isCheckers);
    }
    
    const rawMoves = chessGame.moves({ verbose: true });
    const moves = sortMoves(rawMoves, isCheckers);
    
    if (isMaximizing) {
        let maxEval = -Infinity;
        for (let i = 0; i < moves.length; i++) {
            chessGame.move(moves[i]);
            const evaluation = minimax(chessGame, depth - 1, alpha, beta, chessGame.turn() === 'w');
            chessGame.undo();
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) {
                break;
            }
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (let i = 0; i < moves.length; i++) {
            chessGame.move(moves[i]);
            const evaluation = minimax(chessGame, depth - 1, alpha, beta, chessGame.turn() === 'w');
            chessGame.undo();
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) {
                break;
            }
        }
        return minEval;
    }
}

// Primary entrypoint to compute a bot move
function getBotMove(chessGame, elo, botColor) {
    const rawMoves = chessGame.moves({ verbose: true });
    if (rawMoves.length === 0) return null;
    
    let blunderChance = 0;
    let searchDepth = 1;
    
    if (elo === 200) {
        blunderChance = 0.60;
        searchDepth = 1;
    } else if (elo === 600) {
        blunderChance = 0.25;
        searchDepth = 1;
    } else if (elo === 1200) {
        blunderChance = 0.05;
        searchDepth = 2;
    } else if (elo === 1800) {
        blunderChance = 0.00;
        searchDepth = 3;
    }
    
    // Blunder execution
    if (Math.random() < blunderChance) {
        console.log(`Bot (Elo ${elo}) committed a random blunder.`);
        const randIndex = Math.floor(Math.random() * rawMoves.length);
        return rawMoves[randIndex];
    }
    
    const isCheckers = chessGame.constructor.name === 'Checkers';
    const moves = sortMoves(rawMoves, isCheckers);
    let bestMove = null;
    const isBotWhite = (botColor === 'w');
    
    if (isBotWhite) {
        let bestValue = -Infinity;
        for (let i = 0; i < moves.length; i++) {
            chessGame.move(moves[i]);
            const boardValue = minimax(chessGame, searchDepth - 1, -Infinity, Infinity, chessGame.turn() === 'w');
            chessGame.undo();
            
            if (boardValue > bestValue) {
                bestValue = boardValue;
                bestMove = moves[i];
            }
        }
    } else {
        let bestValue = Infinity;
        for (let i = 0; i < moves.length; i++) {
            chessGame.move(moves[i]);
            const boardValue = minimax(chessGame, searchDepth - 1, -Infinity, Infinity, chessGame.turn() === 'w');
            chessGame.undo();
            
            if (boardValue < bestValue) {
                bestValue = boardValue;
                bestMove = moves[i];
            }
        }
    }
    
    return bestMove;
}
