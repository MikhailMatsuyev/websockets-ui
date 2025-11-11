import { IRoom, IPlayer } from '../types';

export class Room implements IRoom {
    public id: string;
    public players: IPlayer[];

    constructor(id: string) {
        this.id = id;
        this.players = [];
    }

    addPlayer(player: IPlayer): boolean {
        if (this.players.length < 2) {
            this.players.push(player);
            return true;
        }
        return false;
    }

    removePlayer(playerId: string): void {
        this.players = this.players.filter(player => player.id !== playerId);
    }

    getOtherPlayer(playerId: string): IPlayer | undefined {
        return this.players.find(player => player.id !== playerId);
    }
}