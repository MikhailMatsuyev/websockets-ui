import * as WebSocket from 'ws';
import { Game } from '../game/Game';
import { Player } from '../game/Player';
import { Room } from '../game/Room';
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
    IGame
} from '../types';

interface User {
    login: string;
    password: string;
    wins: number;
}

export class BattleshipServer {
    private port: number;
    private wss: WebSocket.Server;
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
        this.wss = new WebSocket.Server({
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
        const authHandler = (data: WebSocket.Data) => {
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
        const { name, password } = message.data as IRegistrationData;

        if (!name || !password) {
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

        ws.on('message', (data: WebSocket.Data) => {
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

        switch (message.type) {
            case 'create_room':
                this.handleCreateRoom(player);
                break;
            case 'add_user_to_room':
                this.handleJoinRoom(player, (message.data as IAddUserToRoomData).indexRoom);
                break;
            case 'add_ships':
                this.handleAddShips(player, message.data as IAddShipsData);
                break;
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
            this.sendError(player.ws!, 'Room not found');
            return;
        }

        if (room.players.length >= 2) {
            this.sendError(player.ws!, 'Room is full');
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
        console.log(`Single play game created for player: ${player.id}`);
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
            this.sendError(player.ws!, 'Game not found');
            return;
        }

        try {
            game.addShips(player.id, ships);
            console.log(`Ships added for player: ${player.id} in game: ${gameId}`);

            if (game.isReady()) {
                this.startGame(game);
            }
        } catch (error: any) {
            this.sendError(player.ws!, error.message);
        }
    }

    private startGame(game: IGame): void {
        game.start();

        game.players.forEach((player) => {
            if (player.ws) {
                this.send(player.ws, {
                    type: 'start_game',
                    data: {
                        ships: player.ships,
                        currentPlayerIndex: player.id
                    },
                    id: 0
                });
            }
        });

        this.broadcastToGame(game, {
            type: 'turn',
            data: {
                currentPlayer: game.currentPlayer
            },
            id: 0
        });

        console.log(`Game started: ${game.id}`);
    }

    private handleAttack(player: IPlayer, data: IAttackData): void {
        const { gameId, x, y, indexPlayer } = data;
        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found');
            return;
        }

        if (game.currentPlayer !== player.id) {
            this.sendError(player.ws!, 'Not your turn');
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
            this.sendError(player.ws!, error.message);
        }
    }

    private handleRandomAttack(player: IPlayer, data: IRandomAttackData): void {
        const { gameId, indexPlayer } = data;
        const game = this.games.get(gameId);

        if (!game) {
            this.sendError(player.ws!, 'Game not found');
            return;
        }

        if (game.currentPlayer !== player.id) {
            this.sendError(player.ws!, 'Not your turn');
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
            this.sendError(player.ws!, error.message);
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
        } catch (error) {
            console.error('Bot move error:', error);
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
            const jsonString = JSON.stringify(message);
            ws.send(jsonString);
            console.log(`Sent: ${jsonString}`);
        }
    }

    private sendError(ws: WebSocket, errorText: string): void {
        this.send(ws, {
            type: 'reg',
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
}