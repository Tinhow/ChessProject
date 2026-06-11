// Brazilian Checkers (Damas) Game Engine (8x8 board)
// API compatible with Chess.js for seamless UI integration.

function getSquareName(r, c) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    return files[c] + ranks[r];
}

function getCoords(squareName) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const c = files.indexOf(squareName.charAt(0));
    const r = ranks.indexOf(squareName.charAt(1));
    return { r, c };
}

class Checkers {
    constructor() {
        this._turn = 'w';
        this._board = Array(8).fill(null).map(() => Array(8).fill(null));
        this._history = [];
        this._activeCapturePiece = null; // { r, c }
        this.reset();
    }

    reset() {
        this._turn = 'w';
        this._activeCapturePiece = null;
        this._history = [];
        this._board = Array(8).fill(null).map(() => Array(8).fill(null));
        
        // Place black pieces (top)
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) {
                    this._board[r][c] = { type: 'p', color: 'b' };
                }
            }
        }
        
        // Place white pieces (bottom)
        for (let r = 5; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if ((r + c) % 2 === 1) {
                    this._board[r][c] = { type: 'p', color: 'w' };
                }
            }
        }
    }

    board() {
        return this._board;
    }

    turn() {
        return this._turn;
    }

    game_over() {
        return this.moves().length === 0;
    }

    in_check() {
        return false;
    }

    fen() {
        let rows = [];
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            let rowStr = '';
            for (let c = 0; c < 8; c++) {
                const piece = this._board[r][c];
                if (piece) {
                    if (empty > 0) {
                        rowStr += empty;
                        empty = 0;
                    }
                    const char = piece.type === 'k' ? 'k' : 'p';
                    rowStr += piece.color === 'w' ? char.toUpperCase() : char;
                } else {
                    empty++;
                }
            }
            if (empty > 0) rowStr += empty;
            rows.push(rowStr);
        }
        return rows.join('/') + ' ' + this._turn + ' ' + (this._activeCapturePiece ? `${this._activeCapturePiece.r},${this._activeCapturePiece.c}` : '-');
    }

    load(fen) {
        const parts = fen.split(' ');
        const grid = parts[0].split('/');
        this._turn = parts[1] || 'w';
        this._board = Array(8).fill(null).map(() => Array(8).fill(null));
        
        for (let r = 0; r < 8; r++) {
            let c = 0;
            const rowStr = grid[r];
            for (let i = 0; i < rowStr.length; i++) {
                const char = rowStr[i];
                if (isNaN(char)) {
                    const color = char === char.toUpperCase() ? 'w' : 'b';
                    const type = char.toLowerCase() === 'k' ? 'k' : 'p';
                    this._board[r][c] = { type, color };
                    c++;
                } else {
                    c += parseInt(char);
                }
            }
        }

        const activePiecePart = parts[2];
        if (activePiecePart && activePiecePart !== '-') {
            const coords = activePiecePart.split(',');
            this._activeCapturePiece = { r: parseInt(coords[0]), c: parseInt(coords[1]) };
        } else {
            this._activeCapturePiece = null;
        }
    }

    get(squareName) {
        const coords = getCoords(squareName);
        return this._board[coords.r][coords.c];
    }

    history(options = {}) {
        if (options.verbose) {
            return this._history.map(h => h.moveDetails).filter(Boolean);
        }
        return this._history.map(h => h.san).filter(Boolean);
    }

    undo() {
        const prev = this._history.pop();
        if (prev) {
            this._board = prev.board;
            this._turn = prev.turn;
            this._activeCapturePiece = prev.activeCapturePiece;
            return true;
        }
        return false;
    }

    moves(options = {}) {
        let squareFilter = null;
        if (options.square) {
            squareFilter = getCoords(options.square);
        }

        let allMoves = [];

        // If there's an active capture piece (mid-combo), we can ONLY move that piece
        if (this._activeCapturePiece) {
            if (squareFilter && (squareFilter.r !== this._activeCapturePiece.r || squareFilter.c !== this._activeCapturePiece.c)) {
                return [];
            }
            allMoves = this.getCapturesForPiece(this._activeCapturePiece.r, this._activeCapturePiece.c);
            return allMoves;
        }

        // 1. Gather all capture moves for the player (mandatory)
        let captureMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this._board[r][c];
                if (piece && piece.color === this._turn) {
                    if (squareFilter && (squareFilter.r !== r || squareFilter.c !== c)) {
                        continue;
                    }
                    captureMoves = captureMoves.concat(this.getCapturesForPiece(r, c));
                }
            }
        }

        if (captureMoves.length > 0) {
            return captureMoves;
        }

        // 2. Gather normal moves if no captures are available
        let normalMoves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this._board[r][c];
                if (piece && piece.color === this._turn) {
                    if (squareFilter && (squareFilter.r !== r || squareFilter.c !== c)) {
                        continue;
                    }
                    normalMoves = normalMoves.concat(this.getNormalMovesForPiece(r, c));
                }
            }
        }

        return normalMoves;
    }

    getNormalMovesForPiece(r, c) {
        const piece = this._board[r][c];
        if (!piece) return [];
        const moves = [];

        if (piece.type === 'p') {
            // Normal pieces move 1 step diagonally forward
            const dr = piece.color === 'w' ? -1 : 1;
            const directions = [[dr, -1], [dr, 1]];
            for (const [rowOffset, colOffset] of directions) {
                const nr = r + rowOffset;
                const nc = c + colOffset;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    if (this._board[nr][nc] === null) {
                        moves.push(this.makeMoveObject(r, c, nr, nc, false));
                    }
                }
            }
        } else {
            // Kings (Damas) move any number of squares diagonally in 4 directions
            const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of directions) {
                let nr = r + dr;
                let nc = c + dc;
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    if (this._board[nr][nc] === null) {
                        moves.push(this.makeMoveObject(r, c, nr, nc, false));
                    } else {
                        break; // blocked
                    }
                    nr += dr;
                    nc += dc;
                }
            }
        }
        return moves;
    }

    getCapturesForPiece(r, c) {
        const piece = this._board[r][c];
        if (!piece) return [];
        const moves = [];
        const opponentColor = piece.color === 'w' ? 'b' : 'w';

        if (piece.type === 'p') {
            // Normal pieces can jump in all 4 directions to capture
            const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of directions) {
                const targetR = r + dr;
                const targetC = c + dc;
                const landingR = r + 2 * dr;
                const landingC = c + 2 * dc;

                if (landingR >= 0 && landingR < 8 && landingC >= 0 && landingC < 8) {
                    const enemyPiece = this._board[targetR][targetC];
                    const landingSpace = this._board[landingR][landingC];
                    if (enemyPiece && enemyPiece.color === opponentColor && landingSpace === null) {
                        moves.push(this.makeMoveObject(r, c, landingR, landingC, true, { r: targetR, c: targetC }));
                    }
                }
            }
        } else {
            // Kings (Damas) capture diagonally by passing any number of empty squares,
            // jumping exactly one opponent piece, and landing on any empty square behind it.
            const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
            for (const [dr, dc] of directions) {
                let nr = r + dr;
                let nc = c + dc;
                let enemyCoords = null;
                let enemyCount = 0;
                
                while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    const cell = this._board[nr][nc];
                    if (cell) {
                        if (cell.color === opponentColor) {
                            enemyCount++;
                            enemyCoords = { r: nr, c: nc };
                            if (enemyCount > 1) {
                                break; // can't jump multiple pieces in one step
                            }
                        } else {
                            break; // teammate
                        }
                    } else {
                        if (enemyCount === 1) {
                            moves.push(this.makeMoveObject(r, c, nr, nc, true, enemyCoords));
                        }
                    }
                    nr += dr;
                    nc += dc;
                }
            }
        }
        return moves;
    }

    makeMoveObject(fromR, fromC, toR, toC, isCapture, capturedCoords = null) {
        const piece = this._board[fromR][fromC];
        const fromName = getSquareName(fromR, fromC);
        const toName = getSquareName(toR, toC);
        
        let san = `${fromName}-${toName}`;
        if (isCapture) {
            san = `${fromName}x${toName}`;
        }
        
        return {
            from: fromName,
            to: toName,
            fromCoords: { r: fromR, c: fromC },
            toCoords: { r: toR, c: toC },
            piece: piece.type,
            color: piece.color,
            captured: isCapture ? 'p' : null,
            capturedCoords: capturedCoords,
            san: san
        };
    }

    move(moveInput) {
        let fromSquare, toSquare;
        if (typeof moveInput === 'string') {
            return null; // SAN parser not implemented, we only use objects
        } else {
            fromSquare = moveInput.from;
            toSquare = moveInput.to;
        }

        const validMoves = this.moves();
        const executeMove = validMoves.find(m => m.from === fromSquare && m.to === toSquare);
        if (!executeMove) {
            return null; // invalid move
        }

        // Save history state for undo
        this._history.push({
            board: JSON.parse(JSON.stringify(this._board)),
            turn: this._turn,
            activeCapturePiece: this._activeCapturePiece ? { ...this._activeCapturePiece } : null,
            moveDetails: executeMove,
            san: executeMove.san
        });

        const { fromCoords, toCoords, capturedCoords } = executeMove;
        const piece = this._board[fromCoords.r][fromCoords.c];
        
        // Move the piece
        this._board[toCoords.r][toCoords.c] = piece;
        this._board[fromCoords.r][fromCoords.c] = null;

        // Perform capture if any
        if (capturedCoords) {
            this._board[capturedCoords.r][capturedCoords.c] = null;
        }

        // Check for promotion to Dama (King)
        let promoted = false;
        if (piece.type === 'p') {
            if ((piece.color === 'w' && toCoords.r === 0) || (piece.color === 'b' && toCoords.r === 7)) {
                piece.type = 'k';
                promoted = true;
            }
        }

        // Check if there are further captures for this piece
        let hasCombo = false;
        if (capturedCoords) {
            const extraCaptures = this.getCapturesForPiece(toCoords.r, toCoords.c);
            if (extraCaptures.length > 0) {
                this._activeCapturePiece = { r: toCoords.r, c: toCoords.c };
                hasCombo = true;
            }
        }

        if (!hasCombo) {
            this._activeCapturePiece = null;
            this._turn = this._turn === 'w' ? 'b' : 'w';
        }

        return {
            from: fromSquare,
            to: toSquare,
            color: piece.color,
            flags: capturedCoords ? 'c' : 'n',
            san: executeMove.san,
            captured: capturedCoords ? { color: piece.color === 'w' ? 'b' : 'w', type: 'p' } : null,
            promoted: promoted
        };
    }
}
window.Checkers = Checkers;
