const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const rooms = new Map();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function removeFromRoom(socket) {
  if (!socket.room) return;
  const room = rooms.get(socket.room);
  if (!room) return;
  room.delete(socket);
  room.forEach((peer) => send(peer, { type: 'peer-left', peerId: socket.id }));
  if (room.size === 0) rooms.delete(socket.room);
}

const server = http.createServer((request, response) => {
  const requestedPath = decodeURIComponent(request.url.split('?')[0]);
  const fileName = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
  const filePath = path.resolve(ROOT, fileName);

  if (!filePath.startsWith(ROOT + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on('connection', (socket, request) => {
  const params = new URL(request.url, 'http://localhost').searchParams;
  socket.id = Math.random().toString(36).slice(2, 10);
  socket.room = (params.get('room') || 'lobby').slice(0, 80);
  socket.name = (params.get('name') || 'Sandbox learner').slice(0, 40);
  socket.role = params.get('role') === 'Teacher' ? 'Teacher' : 'Student';
  let room = rooms.get(socket.room);
  if (!room) {
    room = new Set();
    rooms.set(socket.room, room);
  }

  const peers = [...room].map((peer) => ({ id: peer.id, name: peer.name, role: peer.role }));
  room.add(socket);
  send(socket, { type: 'ready', id: socket.id, name: socket.name, role: socket.role, room: socket.room, peers });
  room.forEach((peer) => {
    if (peer !== socket) send(peer, { type: 'peer-joined', peerId: socket.id, name: socket.name, role: socket.role });
  });

  socket.on('message', (rawMessage) => {
    let message;
    try { message = JSON.parse(rawMessage); } catch { return; }
    const target = [...room].find((peer) => peer.id === message.target);
    if (target && ['offer', 'answer', 'candidate'].includes(message.type)) {
      send(target, { ...message, sender: socket.id });
    }
    if (message.type === 'chat' && typeof message.text === 'string') {
      room.forEach((peer) => send(peer, { type: 'chat', sender: socket.id, name: socket.name, role: socket.role, text: message.text.slice(0, 500) }));
    }
  });

  socket.on('close', () => removeFromRoom(socket));
});

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/signal')) {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    webSocketServer.emit('connection', client, request);
  });
});

server.listen(PORT, () => {
  console.log(`Lumen Sandbox Academy is running at http://localhost:${PORT}`);
  console.log('Open the same Live Session in two browser windows to test a room.');
});