import 'dotenv/config';
import { BattleshipServer } from './server/battleship-server';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || 'localhost';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log(`Starting Battleship Server`);
console.log(`Environment: ${NODE_ENV}`);
console.log(`Host: ${HOST}`);
console.log(`Port: ${PORT}`);

new BattleshipServer(PORT);
console.log('Battleship server instance created and running');