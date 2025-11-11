import { WebSocket } from 'ws';
import { IShipData, TShipType, TAttackStatus } from './messages';

export interface IPlayer {
    id: string;
    ws: WebSocket | null;
    isBot: boolean;
    name: string;
    roomId: string | null;
    ships: IShipData[];
    attacks: Set<string>;

    addShips(ships: IShipData[]): void;
    addAttack(x: number, y: number): string;
    hasShipAt(x: number, y: number): boolean;
    getShipAt(x: number, y: number): IShipData | undefined;
    isAllShipsSunk(): boolean;
}

export interface IRoom {
    id: string;
    players: IPlayer[];

    addPlayer(player: IPlayer): boolean;
    removePlayer(playerId: string): void;
    getOtherPlayer(playerId: string): IPlayer | undefined;
}

export interface IGame {
    id: string;
    players: IPlayer[];
    currentPlayer: string;
    started: boolean;
    shipsPlaced: Set<string>;

    addShips(playerId: string, shipsData: IShipData[]): void;
    isReady(): boolean;
    start(): void;
    processAttack(attackerId: string, x: number, y: number): IAttackResult;
    switchTurn(): void;
    generateRandomMove(): { x: number; y: number };
}

export interface IAttackResult {
    status: TAttackStatus;
    gameOver: boolean;
    ship?: IShipData;
    surroundingCells?: { x: number; y: number }[];
}

export interface IShip {
    position: { x: number; y: number }[];
    direction: boolean;
    length: number;
    type: TShipType;

    isSunk(attacks: Set<string>): boolean;
}

export * from './messages';