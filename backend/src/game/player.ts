import { WebSocket } from 'ws';
import { IPlayer, IShipData } from '../types';

export class Player implements IPlayer {
    public id: string;
    public ws: WebSocket | null;
    public isBot: boolean;
    public name: string;
    public roomId: string | null;
    public ships: IShipData[];
    public attacks: Set<string>;

    constructor(id: string, ws: WebSocket | null, isBot: boolean = false) {
        this.id = id;
        this.ws = ws;
        this.isBot = isBot;
        this.name = `Player${Math.floor(Math.random() * 10000)}`;
        this.roomId = null;
        this.ships = [];
        this.attacks = new Set();
    }

    addShips(ships: IShipData[]): void {
        this.ships = ships;
    }

    addAttack(x: number, y: number): string {
        const key = `${x},${y}`;
        if (this.attacks.has(key)) {
            throw new Error('Already attacked this position');
        }
        this.attacks.add(key);
        return key;
    }

    hasShipAt(x: number, y: number): boolean {
        return this.ships.some(ship =>
            ship.position.some(pos => pos.x === x && pos.y === y)
        );
    }

    getShipAt(x: number, y: number): IShipData | undefined {
        return this.ships.find(ship =>
            ship.position.some(pos => pos.x === x && pos.y === y)
        );
    }
}