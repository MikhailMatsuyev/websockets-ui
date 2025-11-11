import path from "node:path";
import * as http from "node:http";
import * as fs from "node:fs";

const FRONTEND_PORT = process.env.FRONTEND_PORT || 8080;
const FRONTEND_HOST = process.env.FRONTEND_HOST || 'localhost';
const BACKEND_PORT = process.env.BACKEND_PORT || 3000;
const BACKEND_HOST = process.env.BACKEND_HOST || 'localhost';

export const httpServer = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'front', req.url === '/' ? 'index.html' : req.url);

    const extname = path.extname(filePath);
    let contentType = 'text/html';

    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf8');
        }
    });
});

httpServer.listen(FRONTEND_PORT, FRONTEND_HOST, () => {
    console.log(`Frontend server running on http://${FRONTEND_HOST}:${FRONTEND_PORT}`);
    console.log(`Backend WebSocket server runs on ws://${BACKEND_HOST}:${BACKEND_PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
