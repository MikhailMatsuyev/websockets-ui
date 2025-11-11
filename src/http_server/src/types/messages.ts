export interface IWebSocketMessage {
    type: string;
    data: any;
    id: number;
}

export interface IRegistrationData {
    name: string;
    password: string;
}

export interface IRegistrationResponse {
    name: string;
    index: string;
    error: boolean;
    errorText: string;
}

export interface ICreateRoomData {}

export interface ICreateRoomResponse {
    id: string;
    idGame: string;
}

export interface IAddUserToRoomData {
    indexRoom: string;
}

export interface IRoomUser {
    name: string;
    index: string;
}

export interface IUpdateRoomData {
    roomId: string;
    roomUsers: IRoomUser[];
}

export interface IAddShipsData {
    gameId: string;
    ships: IShipData[];
    indexPlayer: string;
}

export interface IShipData {
    position: { x: number; y: number }[];
    direction: boolean;
    length: number;
    type: TShipType;
}

export type TShipType = 'small' | 'medium' | 'large' | 'huge';

export interface ICreateGameData {
    idGame: string;
    idPlayer: string;
}

export interface IStartGameData {
    currentPlayerIndex: string;
    ships: IShipData[];
}

export interface ITurnData {
    currentPlayer: string;
}

export interface IAttackData {
    gameId: string;
    x: number;
    y: number;
    indexPlayer: string;
}

export interface IRandomAttackData {
    gameId: string;
    indexPlayer: string;
}

export interface IAttackResultData {
    position: { x: number; y: number };
    currentPlayer: string;
    status: TAttackStatus;
}

export type TAttackStatus = 'miss' | 'shot' | 'killed';

export interface IFinishData {
    winPlayer: string;
}

export interface IUpdateWinnersData {
    winners: IWinner[];
}

export interface IWinner {
    name: string;
    wins: number;
}