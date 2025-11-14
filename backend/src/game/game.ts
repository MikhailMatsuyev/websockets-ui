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

    // addShips(playerId: string, shipsData: IShipData[]): void {
    //     const player = this.players.find(p => p.id === playerId);
    //     if (!player) {
    //         throw new Error('Player not found in game');
    //     }
    //
    //     this.validateShips(shipsData);
    //     player.addShips(shipsData);
    //     this.shipsPlaced.add(playerId);
    // }

    addShips(playerId: string, shipsData: IShipData[], fromBackend: boolean = false): void {
        const player = this.players.find(p => p.id === playerId);
        if (!player) {
            throw new Error('Player not found in game');
        }

        const expandedShips = shipsData.map(ship => {
            if (Array.isArray(ship.position)) {
                // Уже массив позиций - используем как есть
                return ship;
            }

            // Нужно сгенерировать позиции из начальной точки
            const startPos = ship.position as any;

            // НЕ вычитаем 1 - и frontend и backend используют 0-9!
            const x = startPos.x;
            const y = startPos.y;

            console.log(`Expanding ship: type=${ship.type}, start=(${x},${y}), length=${ship.length}, direction=${ship.direction}`);

            // Проверка границ ДО генерации
            if (ship.direction && x + ship.length > 10) {
                throw new Error(`Ship "${ship.type}" would go out of bounds`);
            }
            if (!ship.direction && y + ship.length > 10) {
                throw new Error(`Ship "${ship.type}" would go out of bounds`);
            }

            const positions = [];
            for (let i = 0; i < ship.length; i++) {
                if (ship.direction) {
                    positions.push({ x: x + i, y: y });
                } else {
                    positions.push({ x: x, y: y + i });
                }
            }

            console.log('Generated positions:', positions);

            return {
                ...ship,
                position: positions
            };
        });

        this.validateShips(expandedShips);
        player.addShips(expandedShips);
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

            console.log(`Validating ship ${ship.type}:`, ship.position);

            for (const pos of ship.position) {
                if (pos.x < 0 || pos.x >= 10 || pos.y < 0 || pos.y >= 10) {
                    const errorMsg = `Ship "${ship.type}" at position (${pos.x}, ${pos.y}) is out of bounds. Valid range: 0-9`;
                    console.error(errorMsg);
                    throw new Error(errorMsg);
                }

                const key = `${pos.x},${pos.y}`;
                if (occupied.has(key)) {
                    console.error(`Cell (${pos.x}, ${pos.y}) is already occupied! Ships overlap.`);
                    console.error('All occupied cells so far:', Array.from(occupied));
                    throw new Error('Ships overlap');
                }
                occupied.add(key);
            }
        }

        if (shipCounts.huge !== 1 || shipCounts.large !== 2 ||
            shipCounts.medium !== 3 || shipCounts.small !== 4) {
            console.error('Invalid ship counts:', shipCounts);
            throw new Error('Invalid ship configuration');
        }

        console.log('All ships validated successfully!');
    }

    isReady(): boolean {
        console.log('=== Checking if game is ready ===');
        console.log(`Total players: ${this.players.length}`);
        console.log(`Ships placed by players:`, Array.from(this.shipsPlaced));
        
        for (const player of this.players) {
            const hasPlaced = this.shipsPlaced.has(player.id);
            console.log(`Player ${player.id} (${player.name}): ships placed = ${hasPlaced}, ships count = ${player.ships.length}`);
        }
        
        const allReady = this.players.every(player => this.shipsPlaced.has(player.id));
        console.log(`All players ready: ${allReady}`);
        return allReady;
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

        console.log(`\n=== ATTACK ===`);
        console.log(`Attacker: ${attacker.name} (${attacker.id})`);
        console.log(`Defender: ${defender.name} (${defender.id})`);
        console.log(`Position: (${x}, ${y})`);

        // Добавляем атаку в список атак атакующего
        attacker.addAttack(x, y);

        const result: IAttackResult = {
            status: 'miss',
            gameOver: false
        };

        const hasShip = defender.hasShipAt(x, y);
        console.log(`Has ship at position: ${hasShip}`);

        if (hasShip) {
            result.status = 'shot';
            console.log(`✅ HIT! Status: shot`);

            const ship = defender.getShipAt(x, y);
            // Проверяем потоплен ли корабль (используем атаки АТАКУЮЩЕГО, а не защитника!)
            if (ship && this.isShipSunk(attacker, ship)) {
                result.status = 'killed';
                result.ship = ship;
                result.surroundingCells = this.getSurroundingCells(ship);
                console.log(`💀 SHIP KILLED! Type: ${ship.type}`);
            }

            // Проверяем все ли корабли защитника потоплены (используем атаки АТАКУЮЩЕГО!)
            if (this.areAllShipsSunk(attacker, defender)) {
                result.gameOver = true;
                console.log(`🏆 GAME OVER! ${attacker.name} wins!`);
            }
        } else {
            console.log(`❌ MISS!`);
        }

        console.log(`Final status: ${result.status}\n`);
        return result;
    }

    private isShipSunk(attacker: IPlayer, ship: IShipData): boolean {
        return ship.position.every(pos => {
            const key = `${pos.x},${pos.y}`;
            return attacker.attacks.has(key); // Проверяем атаки АТАКУЮЩЕГО
        });
    }

    private areAllShipsSunk(attacker: IPlayer, defender: IPlayer): boolean {
        console.log(`\n=== Checking if all ships sunk ===`);
        console.log(`Defender: ${defender.name} (${defender.id})`);
        console.log(`Defender has ${defender.ships.length} ships`);
        console.log(`Attacker: ${attacker.name} (${attacker.id})`);
        console.log(`Attacker has made ${attacker.attacks.size} attacks`);
        
        // Выводим все атаки атакующего
        console.log(`\nAll attacker's attacks:`);
        const attacksList = Array.from(attacker.attacks).sort();
        console.log(attacksList.join(', '));
        
        let allSunk = true;
        for (let i = 0; i < defender.ships.length; i++) {
            const ship = defender.ships[i];
            
            // Выводим позиции корабля
            console.log(`\nShip #${i + 1} (${ship.type}):`);
            console.log(`  Positions: ${ship.position.map(p => `(${p.x},${p.y})`).join(', ')}`);
            
            const sunkPositions = ship.position.filter(pos => {
                const key = `${pos.x},${pos.y}`;
                return attacker.attacks.has(key);
            });
            
            console.log(`  Hit positions: ${sunkPositions.map(p => `(${p.x},${p.y})`).join(', ')}`);
            
            const isSunk = sunkPositions.length === ship.position.length;
            console.log(`  Status: ${sunkPositions.length}/${ship.position.length} hit - ${isSunk ? 'SUNK ☠️' : 'ALIVE ❌'}`);
            
            if (!isSunk) {
                const missingPositions = ship.position.filter(pos => {
                    const key = `${pos.x},${pos.y}`;
                    return !attacker.attacks.has(key);
                });
                console.log(`  Missing hits: ${missingPositions.map(p => `(${p.x},${p.y})`).join(', ')}`);
                allSunk = false;
            }
        }
        
        console.log(`\n=== Result: All ships sunk = ${allSunk} ===\n`);
        return allSunk;
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
        const attacker = this.players.find(p => p.id === this.currentPlayer);
        if (!attacker) {
            throw new Error('Current player not found');
        }

        let x: number, y: number;
        let attempts = 0;
        const maxAttempts = 100;

        do {
            x = Math.floor(Math.random() * 10);
            y = Math.floor(Math.random() * 10);
            attempts++;

            const key = `${x},${y}`;
            // Проверяем, не атаковали ли уже эту клетку
            if (!attacker.attacks.has(key)) {
                return { x, y };
            }

            if (attempts >= maxAttempts) {
                throw new Error('Could not find valid move after 100 attempts');
            }
        } while (true);
    }
}