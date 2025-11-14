import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { Game } from '../game/game';
import { Player } from '../game/player';
import { Room } from '../game/room';
import {
    IWebSocketMessage,
    IRegistrationData,
    IAddUserToRoomData,
    IAddShipsData,
    IAttackData,
    IRandomAttackData,
    IUpdateRoomData,
    IUpdateWinnersData,
    IWinner,
    IPlayer,
    IRoom,
    IGame, IShipData, TShipType
} from '../types';

interface User {
    login: string;
    password: string;
    wins: number;
}

export class BattleshipServer {
    private port: number;
    private wss: WebSocketServer;
    private players: Map<WebSocket, IPlayer>;
    private rooms: Map<string, IRoom>;
    private games: Map<string, IGame>;
    private users: Map<string, User>;

    private readonly MAX_PLAYERS_PER_ROOM = parseInt(process.env.MAX_PLAYERS_PER_ROOM || '2');
    private readonly BOT_MOVE_DELAY = parseInt(process.env.BOT_MOVE_DELAY || '1000');
    private readonly MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '100');
    private readonly LOG_LEVEL = process.env.LOG_LEVEL || 'info';

    constructor(port: number = 3000) {
        this.port = port;
        this.wss = new WebSocketServer({
            port,
            maxPayload: parseInt(process.env.WS_MAX_PAYLOAD || '1048576')
        });
        this.players = new Map();
        this.rooms = new Map();
        this.games = new Map();
        this.users = new Map();

        this.setupWebSocket();
        this.setupGracefulShutdown();

        console.log(`Battleship WebSocket server started on port ${port}`);
        console.log(`Configuration: ${this.MAX_PLAYERS_PER_ROOM} players per room, ${this.MAX_ROOMS} max rooms`);
    }

    private generateId(): string {
        return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private setupWebSocket(): void {
        console.log('setupWebSocket');
        this.wss.on('connection', (ws: WebSocket) => {
            if (this.LOG_LEVEL === 'debug') {
                console.log('New client connected');
            }
            this.handleConnection(ws);
        });

        this.wss.on('error', (error: Error) => {
            console.error('WebSocket server error:', error);
        });
    }

    private setupGracefulShutdown(): void {
        const gracefulShutdown = (signal: string) => {
            console.log(`Received ${signal}, closing server gracefully...`);

            this.wss.clients.forEach(client => {
                client.close();
            });

            this.wss.close(() => {
                console.log('WebSocket server closed successfully');
                process.exit(0);
            });

            setTimeout(() => {
                console.log('Forcing shutdown...');
                process.exit(1);
            }, 5000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    }

    private handleConnection(ws: WebSocket): void {
        console.log('=== NEW CONNECTION ===');
        const authHandler = (data: RawData) => {
            console.log('Raw data received:', data.toString());
            try {
                const message = JSON.parse(data.toString()) as IWebSocketMessage;
                if (message.type === 'reg') {
                    this.handleRegistration(ws, message);
                    ws.off('message', authHandler);
                } else {
                    this.sendError(ws, 'First message must be registration (reg)');
                }
            } catch (error) {
                console.error('Error parsing message:', error);
                this.sendError(ws, 'Invalid JSON format');
            }
        };

        ws.on('message', authHandler);

        ws.on('close', (code, reason) => {
            if (this.LOG_LEVEL === 'debug') {
                console.log(`Client disconnected: ${code} - ${reason}`);
            }
        });

        ws.on('error', (error: Error) => {
            console.error('WebSocket client error:', error);
        });
    }

    private handleRegistration(ws: WebSocket, message: IWebSocketMessage): void {
        console.log('=== REGISTRATION START ===');

        // Исправление: если data пришел как строка, распарсим его
        let data = message.data;
        if (typeof data === 'string') {
            console.log('Data is string, parsing...');
            try {
                data = JSON.parse(data);
            } catch (e) {
                console.error('Failed to parse data string:', e);
                this.sendError(ws, 'Invalid data format');
                return;
            }
        }

        const { name, password } = data as IRegistrationData;
        console.log(`Registration attempt: name=${name}, password=${password}`);

        if (!name || !password) {
            console.log('ERROR: Missing name or password');
            this.sendError(ws, 'Login and password are required');
            return;
        }

        let user = this.users.get(name);
        if (!user) {
            user = { login: name, password, wins: 0 };
            this.users.set(name, user);
            console.log(`New user registered: ${name}`);
        } else if (user.password !== password) {
            this.sendError(ws, 'Invalid password');
            return;
        }

        const playerId = this.generateId();
        const player = new Player(playerId, ws);
        player.name = name;
        this.players.set(ws, player);

        ws.on('message', (data: RawData) => {
            try {
                const message = JSON.parse(data.toString()) as IWebSocketMessage;
                this.handleMessage(ws, message);
            } catch (error) {
                console.error('Error parsing message:', error);
                this.sendError(ws, 'Invalid JSON format');
            }
        });

        ws.on('close', () => {
            console.log(`Client disconnected: ${playerId}`);
            this.handleDisconnection(ws);
        });

        ws.on('error', (error: Error) => {
            console.error('WebSocket error:', error);
            this.handleDisconnection(ws);
        });

        this.send(ws, {
            type: 'reg',
            data: {
                name: player.name,
                index: playerId,
                error: false,
                errorText: ''
            },
            id: 0
        });

        this.updateRoomList();
        this.updateWinnersList();

        console.log(`Player registered: ${name} (${playerId})`);
    }

    private handleMessage(ws: WebSocket, message: IWebSocketMessage): void {
        const player = this.players.get(ws);
        if (!player) return;

        console.log(`Received message: ${message.type}`, message);

        // ВАЖНО: Парсим ДО switch!
        if (typeof message.data === 'string' && message.data !== '') {
            try {
                message.data = JSON.parse(message.data);
                console.log('Parsed data:', message.data); // Добавьте этот лог
            } catch (e) {
                console.error('Failed to parse message data:', e);
                this.sendError(ws, 'Invalid data format');
                return;
            }
        } else if (message.data === '') {
            message.data = {};
        }

        console.log('Data after parsing:', message.data); // И этот лог

        switch (message.type) {
            case 'create_room':
                this.handleCreateRoom(player);
                break;
            case 'add_user_to_room':
                this.handleJoinRoom(player, (message.data as IAddUserToRoomData).indexRoom);
                break;
            case 'add_ships':
                const shipsData = message.data as IAddShipsData;
                console.log('Ships data type:', typeof shipsData);
                console.log('Ships data:', shipsData);
                this.handleAddShips(player, shipsData);
                break;
            case 'auto_place_ships':  // ← ДОБАВЬТЕ ЭТУ СТРОКУ
                this.handleAutoPlaceShips(player, message.data);  // ← И ЭТУ
                break;  // ← И ЭТУ
            case 'attack':
                this.handleAttack(player, message.data as IAttackData);
                break;
            case 'randomAttack':
                this.handleRandomAttack(player, message.data as IRandomAttackData);
                break;
            case 'single_play':
                this.handleSinglePlay(player);
                break;
            default:
                this.sendError(ws, `Unknown message type: ${message.type}`);
        }
    }

    private handleCreateRoom(player: IPlayer): void {
        const roomId = this.generateId();
        const room = new Room(roomId);

        room.addPlayer(player);
        this.rooms.set(roomId, room);
        player.roomId = roomId;

        this.send(player.ws!, {
            type: 'create_room',
            data: {
                id: roomId,
                idGame: roomId
            },
            id: 0
        });

        this.updateRoomList();
        console.log(`Room created: ${roomId} by player: ${player.id}`);
    }

    private handleJoinRoom(player: IPlayer, roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) {
            this.sendError(player.ws!, 'Room not found', 'add_user_to_room');
            return;
        }

        if (room.players.length >= 2) {
            this.sendError(player.ws!, 'Room is full', 'add_user_to_room');
            return;
        }

        room.addPlayer(player);
        player.roomId = roomId;

        if (room.players.length === 2) {
            this.createGame(room);
        }

        this.updateRoomList();
        console.log(`Player ${player.id} joined room: ${roomId}`);
    }

    private handleSinglePlay(player: IPlayer): void {
        const roomId = this.generateId();
        const room = new Room(roomId);

        room.addPlayer(player);
        this.rooms.set(roomId, room);
        player.roomId = roomId;

        const botPlayer = new Player(this.generateId(), null, true);
        botPlayer.name = 'Bot';
        room.addPlayer(botPlayer);

        this.createGame(room);
        
        // Автоматически размещаем корабли для бота
        const game = this.games.get(roomId);
        if (game) {
            try {
                const botShips = this.generateRandomShips();
                game.addShips(botPlayer.id, botShips, true);
                console.log(`✅ Bot ships auto-placed successfully`);
            } catch (error: any) {
                console.error('❌ Failed to auto-place bot ships:', error);
            }
        }
        
        console.log(`Single play game created for player: ${player.id} vs Bot: ${botPlayer.id}`);
        console.log(`💡 TIP: Player should use "Random" button or valid ship placement to avoid errors`);
    }

    private createGame(room: IRoom): void {
        const game = new Game(room.id, room.players);
        this.games.set(room.id, game);

        room.players.forEach((player) => {
            if (player.ws) {
                this.send(player.ws, {
                    type: 'create_game',
                    data: {
                        idGame: room.id,
                        idPlayer: player.id
                    },
                    id: 0
                });
            }
        });

        console.log(`Game created: ${room.id} with ${room.players.length} players`);
    }

    private handleAddShips(player: IPlayer, data: IAddShipsData): void {
        const { gameId, ships, indexPlayer } = data;
        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found', 'add_ships');
            return;
        }

        try {
            game.addShips(player.id, ships, false); //  // false = от frontend
            console.log(`Ships added for player: ${player.id} in game: ${gameId}`);

            console.log(`Checking if game is ready... game.isReady() = ${game.isReady()}`);
            console.log(`Players in game: ${game.players.map(p => `${p.id} (ships: ${p.ships?.length || 0})`).join(', ')}`);
            
            if (game.isReady()) {
                console.log(`✅ Game is ready! Starting game: ${gameId}`);
                this.startGame(game);
            } else {
                console.log(`⏳ Game not ready yet. Waiting for other players to place ships.`);
            }
        } catch (error: any) {
            console.error('Error adding ships from frontend:', error.message);
            
            // Предлагаем автоматическое размещение
            console.log('💡 Attempting automatic ship placement as fallback...');
            try {
                const autoShips = this.generateRandomShips();
                game.addShips(player.id, autoShips, true);
                console.log(`✅ Ships auto-placed successfully for player: ${player.id}`);
                
                // Отправляем сгенерированные корабли обратно
                this.send(player.ws!, {
                    type: 'add_ships',
                    data: {
                        gameId: gameId,
                        ships: autoShips.map(ship => ({
                            position: ship.position[0],
                            direction: ship.direction,
                            type: ship.type,
                            length: ship.length
                        })),
                        indexPlayer: player.id
                    },
                    id: 0
                });
                
                if (game.isReady()) {
                    console.log(`✅ Game is ready! Starting game: ${gameId}`);
                    this.startGame(game);
                }
            } catch (autoError: any) {
                console.error('Failed to auto-place ships:', autoError);
                this.sendError(player.ws!, error.message, 'add_ships');
            }
        }
    }

    private startGame(game: IGame): void {
        console.log('=== STARTING GAME ===');
        console.log(`Game ID: ${game.id}`);
        console.log(`Players: ${game.players.map(p => `${p.id} (${p.name})`).join(', ')}`);
        
        try {
            game.start();
            console.log('Game.start() called successfully');
        } catch (error) {
            console.error('Error calling game.start():', error);
            throw error;
        }

        game.players.forEach((player) => {
            if (player.ws) {
                console.log(`Sending start_game to player: ${player.id}`);
                console.log(`Player ships count: ${player.ships.length}`);
                console.log(`First ship format:`, JSON.stringify(player.ships[0], null, 2));
                
                this.send(player.ws, {
                    type: 'start_game',
                    data: {
                        ships: player.ships,
                        currentPlayerIndex: player.id
                    },
                    id: 0
                });
            } else {
                console.warn(`Player ${player.id} has no WebSocket connection!`);
            }
        });

        console.log(`Broadcasting turn to all players. Current player: ${game.currentPlayer}`);
        this.broadcastToGame(game, {
            type: 'turn',
            data: {
                currentPlayer: game.currentPlayer
            },
            id: 0
        });

        console.log(`✅ Game started successfully: ${game.id}`);
    }

    private handleAttack(player: IPlayer, data: IAttackData): void {
        const { gameId, x, y, indexPlayer } = data;
        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found', 'attack');
            return;
        }

        if (game.currentPlayer !== player.id) {
            this.sendError(player.ws!, 'Not your turn', 'attack');
            return;
        }

        try {
            const result = game.processAttack(player.id, x, y);

            this.broadcastToGame(game, {
                type: 'attack',
                data: {
                    position: { x, y },
                    currentPlayer: player.id,
                    status: result.status
                },
                id: 0
            });

            if (result.status === 'killed' && result.surroundingCells) {
                for (const cell of result.surroundingCells) {
                    this.broadcastToGame(game, {
                        type: 'attack',
                        data: {
                            position: { x: cell.x, y: cell.y },
                            currentPlayer: player.id,
                            status: 'miss'
                        },
                        id: 0
                    });
                }
            }

            if (result.gameOver) {
                this.handleGameOver(game, player.id);
            } else {
                if (result.status === 'shot' || result.status === 'killed') {
                    this.broadcastToGame(game, {
                        type: 'turn',
                        data: {
                            currentPlayer: game.currentPlayer
                        },
                        id: 0
                    });
                } else {
                    game.switchTurn();
                    this.broadcastToGame(game, {
                        type: 'turn',
                        data: {
                            currentPlayer: game.currentPlayer
                        },
                        id: 0
                    });

                    const nextPlayer = game.players.find(p => p.id === game.currentPlayer);
                    if (nextPlayer && nextPlayer.isBot) {
                        setTimeout(() => this.makeBotMove(game), this.BOT_MOVE_DELAY);
                    }
                }
            }
        } catch (error: any) {
            // Если это повторная атака - просто игнорируем
            if (error.message === 'Already attacked this position') {
                console.log(`⚠️ Player ${player.id} tried to attack already attacked position (${x}, ${y}). Ignoring.`);
                return;
            }
            // Для других ошибок логируем
            console.error('Attack error:', error.message);
            this.sendError(player.ws!, error.message, 'attack');
        }
    }

    private handleRandomAttack(player: IPlayer, data: IRandomAttackData): void {
        const { gameId, indexPlayer } = data;
        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found', 'randomAttack');
            return;
        }

        if (game.currentPlayer !== player.id) {
            this.sendError(player.ws!, 'Not your turn', 'randomAttack');
            return;
        }

        try {
            const randomMove = game.generateRandomMove();
            this.handleAttack(player, {
                gameId,
                x: randomMove.x,
                y: randomMove.y,
                indexPlayer: player.id
            });
        } catch (error: any) {
            this.sendError(player.ws!, error.message, 'randomAttack');
        }
    }

    private makeBotMove(game: IGame): void {
        const botPlayer = game.players.find(p => p.isBot);
        if (!botPlayer || game.currentPlayer !== botPlayer.id) return;

        try {
            const randomMove = game.generateRandomMove();
            const result = game.processAttack(botPlayer.id, randomMove.x, randomMove.y);

            this.broadcastToGame(game, {
                type: 'attack',
                data: {
                    position: { x: randomMove.x, y: randomMove.y },
                    currentPlayer: botPlayer.id,
                    status: result.status
                },
                id: 0
            });

            if (result.status === 'killed' && result.surroundingCells) {
                for (const cell of result.surroundingCells) {
                    this.broadcastToGame(game, {
                        type: 'attack',
                        data: {
                            position: { x: cell.x, y: cell.y },
                            currentPlayer: botPlayer.id,
                            status: 'miss'
                        },
                        id: 0
                    });
                }
            }

            if (result.gameOver) {
                this.handleGameOver(game, botPlayer.id);
            } else {
                if (result.status === 'shot' || result.status === 'killed') {
                    setTimeout(() => this.makeBotMove(game), this.BOT_MOVE_DELAY);
                } else {
                    game.switchTurn();
                    this.broadcastToGame(game, {
                        type: 'turn',
                        data: {
                            currentPlayer: game.currentPlayer
                        },
                        id: 0
                    });
                }
            }
        } catch (error: any) {
            console.error('Bot move error:', error);
            // Если бот не может сделать ход, переключаем ход на игрока
            console.log('Switching turn to player due to bot error');
            game.switchTurn();
            this.broadcastToGame(game, {
                type: 'turn',
                data: {
                    currentPlayer: game.currentPlayer
                },
                id: 0
            });
        }
    }

    private handleGameOver(game: IGame, winnerId: string): void {
        const winner = game.players.find(p => p.id === winnerId);
        if (winner && !winner.isBot) {
            const user = this.users.get(winner.name);
            if (user) {
                user.wins += 1;
            }
        }

        this.broadcastToGame(game, {
            type: 'finish',
            data: {
                winPlayer: winnerId
            },
            id: 0
        });

        this.updateWinnersList();

        this.games.delete(game.id);
        this.rooms.delete(game.id);

        console.log(`Game over: ${game.id}, winner: ${winnerId}`);
    }

    private handleDisconnection(ws: WebSocket): void {
        const player = this.players.get(ws);
        if (!player) return;

        if (player.roomId) {
            const room = this.rooms.get(player.roomId);
            if (room) {
                room.removePlayer(player.id);
                if (room.players.length === 0) {
                    this.rooms.delete(player.roomId);
                } else {
                    this.updateRoomList();
                }
            }
        }

        if (player.roomId) {
            const game = this.games.get(player.roomId);
            if (game) {
                const otherPlayer = game.players.find(p => p.id !== player.id);
                if (otherPlayer && otherPlayer.ws) {
                    this.send(otherPlayer.ws, {
                        type: 'finish',
                        data: {
                            winPlayer: otherPlayer.id
                        },
                        id: 0
                    });
                }
                this.games.delete(player.roomId);
            }
        }

        this.players.delete(ws);
        this.updateRoomList();
        this.updateWinnersList();
    }

    private updateRoomList(): void {
        const roomData: IUpdateRoomData[] = Array.from(this.rooms.values())
            .filter(room => room.players.length === 1)
            .map(room => ({
                roomId: room.id,
                roomUsers: room.players.map(player => ({
                    name: player.name,
                    index: player.id
                }))
            }));

        this.broadcastToAll({
            type: 'update_room',
            data: roomData,
            id: 0
        });
    }

    private updateWinnersList(): void {
        const winnersData: IWinner[] = Array.from(this.users.values())
            .filter(user => user.wins > 0)
            .map(user => ({
                name: user.login,
                wins: user.wins
            }))
            .sort((a, b) => b.wins - a.wins);

        this.broadcastToAll({
            type: 'update_winners',
            data: winnersData,
            id: 0
        });
    }

    private send(ws: WebSocket, message: IWebSocketMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            // Frontend ожидает data как строку!
            const messageToSend = {
                type: message.type,
                data: JSON.stringify(message.data),  // ✅ Всегда stringify data!
                id: message.id
            };

            const jsonString = JSON.stringify(messageToSend);
            console.log('Sending:', jsonString);
            ws.send(jsonString);
        }
    }

    private sendError(ws: WebSocket, errorText: string, messageType: string = 'reg'): void {
        this.send(ws, {
            type: messageType,
            data: {
                name: '',
                index: '',
                error: true,
                errorText
            },
            id: 0
        });
    }

    private broadcastToGame(game: IGame, message: IWebSocketMessage): void {
        game.players.forEach(player => {
            if (player.ws) {
                this.send(player.ws, message);
            }
        });
    }

    private broadcastToAll(message: IWebSocketMessage): void {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                const player = this.players.get(client);
                if (player) {
                    this.send(client, message);
                }
            }
        });
    }

    private handleAutoPlaceShips(player: IPlayer, data: any): void {
        let gameId = data?.gameId;

        // Если gameId не передан, берем из roomId игрока
        if (!gameId) {
            gameId = player.roomId;
        }

        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found', 'auto_place_ships');
            return;
        }

        try {
            // Генерируем корабли автоматически
            const ships = this.generateRandomShips();

            console.log(`Auto-placing ships for player: ${player.id}`);
            console.log('Generated ships:', JSON.stringify(ships, null, 2));

            game.addShips(player.id, ships, true); // true = от backend

            // Отправляем сгенерированные корабли обратно на frontend
            this.send(player.ws!, {
                type: 'add_ships',
                data: {
                    gameId: gameId,
                    ships: ships.map(ship => ({
                        position: ship.position[0], // Отправляем только первую позицию
                        direction: ship.direction,
                        type: ship.type,
                        length: ship.length
                    })),
                    indexPlayer: player.id
                },
                id: 0
            });

            console.log(`Ships auto-placed successfully for player: ${player.id}`);

            console.log(`Checking if game is ready after auto-place... game.isReady() = ${game.isReady()}`);
            console.log(`Players in game: ${game.players.map(p => `${p.id} (ships: ${p.ships?.length || 0})`).join(', ')}`);
            
            if (game.isReady()) {
                console.log(`✅ Game is ready! Starting game: ${gameId}`);
                this.startGame(game);
            } else {
                console.log(`⏳ Game not ready yet. Waiting for other players to place ships.`);
            }
        } catch (error: any) {
            console.error('Auto-place ships error:', error);
            this.sendError(player.ws!, error.message, 'auto_place_ships');
        }
    }

    private generateRandomShips(): IShipData[] {
        const shipTypes: { type: TShipType; length: number; count: number }[] = [
            { type: 'huge', length: 4, count: 1 },
            { type: 'large', length: 3, count: 2 },
            { type: 'medium', length: 2, count: 3 },
            { type: 'small', length: 1, count: 4 }
        ];

        const ships: IShipData[] = [];
        const occupied = new Set<string>();

        for (const { type, length, count } of shipTypes) {
            for (let i = 0; i < count; i++) {
                let placed = false;
                let attempts = 0;

                while (!placed && attempts < 1000) {
                    const direction = Math.random() > 0.5;
                    const x = Math.floor(Math.random() * 10);
                    const y = Math.floor(Math.random() * 10);

                    // Проверяем что корабль поместится
                    if (direction && x + length > 10) {
                        attempts++;
                        continue;
                    }
                    if (!direction && y + length > 10) {
                        attempts++;
                        continue;
                    }

                    // Генерируем позиции
                    const positions: { x: number; y: number }[] = [];
                    let collision = false;

                    for (let j = 0; j < length; j++) {
                        const px = direction ? x + j : x;
                        const py = direction ? y : y + j;
                        const key = `${px},${py}`;

                        if (occupied.has(key)) {
                            collision = true;
                            break;
                        }
                        positions.push({ x: px, y: py });
                    }

                    if (!collision) {
                        // Помечаем занятые клетки
                        positions.forEach(pos => {
                            occupied.add(`${pos.x},${pos.y}`);
                        });

                        ships.push({
                            type,
                            length,
                            direction,
                            position: positions
                        } as IShipData);

                        placed = true;
                    }

                    attempts++;
                }

                if (!placed) {
                    throw new Error('Failed to generate random ships placement after 1000 attempts');
                }
            }
        }

        console.log(`Successfully generated ${ships.length} ships`);
        return ships;
    }
}