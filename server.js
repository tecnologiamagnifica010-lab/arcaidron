const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024,
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const MESSAGE_TTL_MS = 60 * 60 * 1000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 160 }));
app.use(express.static(__dirname));

const users = new Map();
const socketsByUser = new Map();
const chats = new Map();

function cleanUsername(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 32);
}

function makeToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function privateChatId(a, b, sharedKeyHash) {
  const pair = [a, b].sort().join('::');
  return crypto
    .createHash('sha256')
    .update(pair + '::' + sharedKeyHash)
    .digest('hex');
}

function getStatus(username) {
  return socketsByUser.has(username) ? 'online' : 'offline';
}

function publicUser(username) {
  const user = users.get(username);
  return user ? { username: user.username, avatar: user.avatar } : null;
}

function authHttp(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return res.status(401).json({ error: 'Sessão inválida.' });
  }

  req.user = data.username;
  next();
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const avatar = String(req.body.avatar || '🛡️').slice(0, 4);

  if (username.length < 3) {
    return res.json({ error: 'Nome precisa ter pelo menos 3 caracteres.' });
  }

  if (password.length < 6) {
    return res.json({ error: 'Senha precisa ter pelo menos 6 caracteres.' });
  }

  if (users.has(username)) {
    return res.json({ error: 'Esse nome já existe.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  users.set(username, {
    username,
    avatar,
    passwordHash,
    createdAt: Date.now()
  });

  res.json({
    ok: true,
    token: makeToken(username),
    username,
    avatar
  });
});

app.post('/api/login', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const user = users.get(username);

  if (!user) {
    return res.json({ error: 'Login ou senha incorretos.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);

  if (!ok) {
    return res.json({ error: 'Login ou senha incorretos.' });
  }

  res.json({
    ok: true,
    token: makeToken(username),
    username,
    avatar: user.avatar
  });
});

app.post('/api/open-chat', authHttp, (req, res) => {
  const me = req.user;
  const target = cleanUsername(req.body.target);
  const sharedKeyHash = String(req.body.sharedKeyHash || '');

  if (!target || !sharedKeyHash) {
    return res.json({ error: 'Informe usuário e chave.' });
  }

  if (target === me) {
    return res.json({ error: 'Você não pode abrir conversa com você mesmo.' });
  }

  const targetUser = users.get(target);

  if (!targetUser) {
    return res.json({ error: 'Usuário ou chave inválidos.' });
  }

  const roomId = privateChatId(me, target, sharedKeyHash);

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
    status: getStatus(target)
  });
});

function requireSocketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return next(new Error('Não autorizado'));
  }

  socket.username = data.username;
  next();
}

io.use(requireSocketAuth);

function emitPresence(username) {
  io.emit('presence:update', {
    username,
    status: getStatus(username)
  });
}

function removeExpiredMessages(roomId) {
  const chat = chats.get(roomId);

  if (!chat) return;

  const now = Date.now();
  const before = chat.messages.length;

  chat.messages = chat.messages.filter(msg => {
    return now - msg.createdAt < MESSAGE_TTL_MS;
  });

  if (chat.messages.length !== before) {
    io.to(roomId).emit('message:expired');
  }
}

setInterval(() => {
  for (const roomId of chats.keys()) {
    removeExpiredMessages(roomId);
  }
}, 60 * 1000);

io.on('connection', socket => {
  const username = socket.username;

  if (!socketsByUser.has(username)) {
    socketsByUser.set(username, new Set());
  }

  socketsByUser.get(username).add(socket.id);
  emitPresence(username);

  socket.on('room:join', ({ roomId }) => {
    const chat = chats.get(roomId);

    if (!chat || !chat.members.includes(username)) return;

    socket.join(roomId);
    removeExpiredMessages(roomId);

    socket.emit('room:history', chats.get(roomId).messages);
  });

  socket.on('typing', ({ roomId, typing }) => {
    const chat = chats.get(roomId);

    if (!chat || !chat.members.includes(username)) return;

    socket.to(roomId).emit('typing', {
      username,
      typing: !!typing
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
      cipher: String(data.cipher || ''),
      iv: String(data.iv || ''),
      fileName: String(data.fileName || ''),
      fileMime: String(data.fileMime || ''),
      replyTo: String(data.replyTo || ''),
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

    const msg = chat.messages.find(m => {
      return m.id === data.id && m.from === username;
    });

    if (!msg || msg.deleted) return;

    msg.cipher = String(data.cipher || '');
    msg.iv = String(data.iv || '');
    msg.edited = true;
    msg.editedAt = Date.now();

    io.to(data.roomId).emit('message:edited', {
      id: msg.id,
      cipher: msg.cipher,
      iv: msg.iv,
      editedAt: msg.editedAt
    });
  });

  socket.on('message:delete', data => {
    const chat = chats.get(data.roomId);

    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(m => {
      return m.id === data.id && m.from === username;
    });

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

    if (!msg || msg.from === username) return;

    if (!msg.seenBy.includes(username)) {
      msg.seenBy.push(username);
    }

    io.to(data.roomId).emit('message:seen', {
      id: msg.id,
      seenBy: msg.seenBy
    });
  });

  socket.on('call:signal', data => {
    const chat = chats.get(data.roomId);

    if (!chat || !chat.members.includes(username)) return;

    socket.to(data.roomId).emit('call:signal', {
      ...data,
      from: username
    });
  });

  socket.on('disconnect', () => {
    const set = socketsByUser.get(username);

    if (set) {
      set.delete(socket.id);

      if (set.size === 0) {
        socketsByUser.delete(username);
      }
    }

    emitPresence(username);
  });
});

server.listen(PORT, () => {
  console.log('ARCAIDRON ativo na porta ' + PORT);
});