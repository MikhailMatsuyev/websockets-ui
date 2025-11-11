import { IShip, IShipData, TShipType } from '../types';

export class Ship implements IShip {
    public position: { x: number; y: number }[];
    public direction: boolean;
    public length: number;
    public type: TShipType;

    constructor(position: { x: number; y: number }[], direction: boolean, length: number, type: TShipType) {
        this.position = position;
        this.direction = direction;
        this.length = length;
        this.type = type;
    }

    isSunk(attacks: Set<string>): boolean {
        return this.position.every(pos => {
            const key = `${pos.x},${pos.y}`;
            return attacks.has(key);
        });
    }
}