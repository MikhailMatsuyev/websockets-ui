import { IGame, IPlayer, IShipData, TShipType, TAttackStatus, IAttackResult } from '../types';

export class Game implements IGame {
    public id: string;
    public players: IPlayer[];
    public currentPlayer: string;
    public started: boolean;
    public shipsPlaced: Set<string>;

    constructor(id: string, players: IPlayer[]) {
        this.id = id;
        this.players = players;
        this.currentPlayer = players[0].id;
        this.started = false;
        this.shipsPlaced = new Set();
    }

    addShips(playerId: string, shipsData: IShipData[]): void {
        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            throw new Error('Player not found in game');
        }

        this.validateShips(shipsData);
        player.addShips(shipsData);
        this.shipsPlaced.add(playerId);
    }

    validateShips(ships: IShipData[]): void {
        const occupied = new Set();
        const shipCounts: Record<TShipType, number> = {
            small: 0,
            medium: 0,
            large: 0,
            huge: 0
        };

        for (const ship of ships) {
            shipCounts[ship.type] = (shipCounts[ship.type] || 0) + 1;

            for (const pos of ship.position) {
                if (pos.x < 0 || pos.x >= 10 || pos.y < 0 || pos.y >= 10) {
                    throw new Error('Ship position out of bounds');
                }

                const key = `${pos.x},${pos.y}`;
                if (occupied.has(key)) {
                    throw new Error('Ships overlap');
                }
                occupied.add(key);
            }
        }

        if (shipCounts.huge !== 1 || shipCounts.large !== 2 ||
            shipCounts.medium !== 3 || shipCounts.small !== 4) {
            throw new Error('Invalid ship configuration');
        }
    }

    isReady(): boolean {
        return this.players.every(player => this.shipsPlaced.has(player.id));
    }

    start(): void {
        if (!this.isReady()) {
            throw new Error('Not all players have placed ships');
        }
        this.started = true;
    }

    processAttack(attackerId: string, x: number, y: number): IAttackResult {
        if (!this.started) {
            throw new Error('Game not started');
        }

        if (this.currentPlayer !== attackerId) {
            throw new Error('Not your turn');
        }

        const attacker = this.players.find(p => p.id === attackerId);
        const defender = this.players.find(p => p.id !== attackerId);

        if (!attacker || !defender) {
            throw new Error('Players not found');
        }

        attacker.addAttack(x, y);

        const result: IAttackResult = {
            status: 'miss',
            gameOver: false
        };

        if (defender.hasShipAt(x, y)) {
            result.status = 'shot';

            const ship = defender.getShipAt(x, y);
            if (ship && this.isShipSunk(defender, ship)) {
                result.status = 'killed';
                result.ship = ship;
                result.surroundingCells = this.getSurroundingCells(ship);
            }

            if (defender.isAllShipsSunk()) {
                result.gameOver = true;
            }
        }

        return result;
    }

    private isShipSunk(player: IPlayer, ship: IShipData): boolean {
        return ship.position.every(pos => {
            const key = `${pos.x},${pos.y}`;
            return player.attacks.has(key);
        });
    }

    private getSurroundingCells(ship: IShipData): { x: number; y: number }[] {
        const surrounding = new Set<string>();

        for (const pos of ship.position) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const x = pos.x + dx;
                    const y = pos.y + dy;

                    if (x >= 0 && x < 10 && y >= 0 && y < 10) {
                        const isShipCell = ship.position.some(p => p.x === x && p.y === y);
                        if (!isShipCell) {
                            surrounding.add(`${x},${y}`);
                        }
                    }
                }
            }
        }

        return Array.from(surrounding).map(coord => {
            const [x, y] = coord.split(',').map(Number);
            return { x, y };
        });
    }

    switchTurn(): void {
        const currentIndex = this.players.findIndex(p => p.id === this.currentPlayer);
        this.currentPlayer = this.players[(currentIndex + 1) % this.players.length].id;
    }

    generateRandomMove(): { x: number; y: number } {
        let x: number, y: number;
        let attempts = 0;

        do {
            x = Math.floor(Math.random() * 10);
            y = Math.floor(Math.random() * 10);
            attempts++;
        } while (attempts < 100);

        return { x, y };
    }
}