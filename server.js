const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 25 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const MESSAGE_TTL = 60 * 60 * 1000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30mb' }));
app.use(rateLimit({ windowMs: 60000, max: 180 }));
app.use(express.static(__dirname));

const users = new Map();
const chats = new Map();
const onlineUsers = new Map();

function cleanUsername(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 32);
}

function createToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function createRoomId(a, b, key) {
  const pair = [a, b].sort().join('::');
  return crypto.createHash('sha256').update(pair + '::' + key).digest('hex');
}

function userStatus(username) {
  return onlineUsers.has(username) ? 'online' : 'offline';
}

function publicUser(username) {
  const user = users.get(username);
  if (!user) return null;
  return { username: user.username, avatar: user.avatar };
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return res.status(401).json({ error: 'Sessão inválida' });
  }

  req.user = data.username;
  next();
}

function sendToUser(username, event, payload) {
  const sockets = onlineUsers.get(username);
  if (!sockets) return false;

  for (const socketId of sockets) {
    io.to(socketId).emit(event, payload);
  }

  return true;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const avatar = String(req.body.avatar || '🛡️');

  if (username.length < 3) {
    return res.json({ error: 'Nome muito curto' });
  }

  if (password.length < 6) {
    return res.json({ error: 'Senha muito curta' });
  }

  if (users.has(username)) {
    return res.json({ error: 'Esse usuário já existe' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  users.set(username, {
    username,
    avatar,
    passwordHash,
    createdAt: Date.now()
  });

  res.json({
    ok: true,
    token: createToken(username),
    username,
    avatar
  });
});

app.post('/api/login', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = users.get(username);

  if (!user) {
    return res.json({ error: 'Login inválido' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return res.json({ error: 'Senha inválida' });
  }

  res.json({
    ok: true,
    token: createToken(username),
    username,
    avatar: user.avatar
  });
});

app.post('/api/open-chat', auth, (req, res) => {
  const me = req.user;
  const target = cleanUsername(req.body.target);
  const sharedKeyHash = String(req.body.sharedKeyHash || '');

  if (!target || !sharedKeyHash) {
    return res.json({ error: 'Informe usuário e chave' });
  }

  if (target === me) {
    return res.json({ error: 'Você não pode conversar consigo mesmo' });
  }

  const user = users.get(target);

  if (!user) {
    return res.json({ error: 'Usuário ou chave inválidos' });
  }

  const roomId = createRoomId(me, target, sharedKeyHash);

  if (!chats.has(roomId)) {
    chats.set(roomId, {
      roomId,
      members: [me, target],
      messages: [],
      createdAt: Date.now()
    });
  }

  res.json({
    ok: true,
    roomId,
    peer: publicUser(target),
    status: userStatus(target)
  });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return next(new Error('Não autorizado'));
  }

  socket.username = data.username;
  next();
});

function emitPresence(username) {
  io.emit('presence:update', {
    username,
    status: userStatus(username)
  });
}

setInterval(() => {
  for (const chat of chats.values()) {
    chat.messages = chat.messages.filter(msg => {
      return Date.now() - msg.createdAt < MESSAGE_TTL;
    });
  }
}, 60000);

io.on('connection', socket => {
  const username = socket.username;

  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socket.id);
  emitPresence(username);

  socket.on('room:join', data => {
    const roomId = data.roomId;
    const chat = chats.get(roomId);

    if (!chat) return;
    if (!chat.members.includes(username)) return;

    socket.join(roomId);
    socket.emit('room:history', chat.messages);
  });

  socket.on('typing', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    socket.to(data.roomId).emit('typing', {
      username,
      typing: !!data.typing
    });
  });

  socket.on('message:send', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    const message = {
      id: crypto.randomUUID(),
      roomId: data.roomId,
      from: username,
      avatar: users.get(username)?.avatar || '🛡️',
      type: data.type || 'text',
      cipher: data.cipher || '',
      iv: data.iv || '',
      fileName: data.fileName || '',
      fileMime: data.fileMime || '',
      replyTo: data.replyTo || '',
      edited: false,
      deleted: false,
      seenBy: [],
      createdAt: Date.now()
    };

    chat.messages.push(message);
    io.to(data.roomId).emit('message:new', message);
  });

  socket.on('message:edit', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(m => m.id === data.id && m.from === username);
    if (!msg || msg.deleted) return;

    msg.cipher = data.cipher || '';
    msg.iv = data.iv || '';
    msg.edited = true;

    io.to(data.roomId).emit('message:edited', {
      id: msg.id,
      cipher: msg.cipher,
      iv: msg.iv
    });
  });

  socket.on('message:delete', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(m => m.id === data.id && m.from === username);
    if (!msg) return;

    msg.deleted = true;
    msg.cipher = '';
    msg.iv = '';
    msg.fileName = '';
    msg.fileMime = '';

    io.to(data.roomId).emit('message:deleted', {
      id: msg.id
    });
  });

  socket.on('message:seen', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(m => m.id === data.id);
    if (!msg) return;

    if (!msg.seenBy.includes(username)) {
      msg.seenBy.push(username);
    }

    io.to(data.roomId).emit('message:seen', {
      id: msg.id,
      seenBy: msg.seenBy
    });
  });

  socket.on('call:signal', data => {
    const roomId = data.roomId;
    const chat = chats.get(roomId);

    if (!chat || !chat.members.includes(username)) return;

    const other = chat.members.find(member => member !== username);

    const payload = {
      ...data,
      roomId,
      from: username,
      fromAvatar: users.get(username)?.avatar || '👤',
      to: other
    };

    if (data.type === 'offer') {
      const delivered = sendToUser(other, 'call:signal', payload);

      if (!delivered) {
        socket.emit('call:signal', {
          roomId,
          type: 'offline',
          from: other
        });
      }

      return;
    }

    if (data.type === 'answer' || data.type === 'ice' || data.type === 'decline' || data.type === 'busy' || data.type === 'hang') {
      sendToUser(other, 'call:signal', payload);
    }
  });

  socket.on('disconnect', () => {
    const set = onlineUsers.get(username);

    if (set) {
      set.delete(socket.id);

      if (set.size === 0) {
        onlineUsers.delete(username);
      }
    }

    emitPresence(username);
  });
});

server.listen(PORT, () => {
  console.log('ARCAIDRON ativo na porta ' + PORT);
});