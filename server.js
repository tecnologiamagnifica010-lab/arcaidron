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
    .replace(/^@/, '')
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 32);
}

function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function hashPhone(phone) {
  const clean = cleanPhone(phone);
  if (!clean) return '';
  return crypto.createHash('sha256').update(clean).digest('hex');
}

function createToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token);
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

function formatLastSeen(username) {
  const user = users.get(username);
  if (!user || !user.lastSeen) return null;
  return user.lastSeen;
}

function publicUser(username) {
  const user = users.get(username);
  if (!user) return null;

  return {
    username: user.username,
    avatar: user.avatar,
    status: userStatus(username),
    lastSeen: formatLastSeen(username)
  };
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

function emitPresence(username) {
  io.emit('presence:update', {
    username,
    status: userStatus(username),
    lastSeen: formatLastSeen(username)
  });
}

function createRecoveryKey() {
  const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part4 = crypto.randomBytes(2).toString('hex').toUpperCase();

  return `ARCA-${part1}-${part2}-${part3}-${part4}`;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const password = String(req.body.password || '');
  const avatar = String(req.body.avatar || '🛡️');
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = cleanPhone(req.body.phone || '');

  if (username.length < 3) {
    return res.json({ error: 'Nome muito curto' });
  }

  if (password.length < 6) {
    return res.json({ error: 'Senha muito curta' });
  }

  if (users.has(username)) {
    return res.json({ error: 'Esse usuário já existe' });
  }

  for (const user of users.values()) {
    if (email && user.email === email) {
      return res.json({ error: 'Esse e-mail já está cadastrado' });
    }

    if (phone && user.phoneHash === hashPhone(phone)) {
      return res.json({ error: 'Esse telefone já está cadastrado' });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const recoveryKey = createRecoveryKey();
  const recoveryHash = await bcrypt.hash(recoveryKey, 10);

  users.set(username, {
    username,
    avatar,
    email,
    phoneHash: hashPhone(phone),
    passwordHash,
    recoveryHash,
    createdAt: Date.now(),
    lastSeen: null,
    contactsPrivacy: 'contacts',
    showLastSeen: true
  });

  res.json({
    ok: true,
    token: createToken(username),
    username,
    avatar,
    recoveryKey
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

app.post('/api/recover-password', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const recoveryKey = String(req.body.recoveryKey || '').trim();
  const newPassword = String(req.body.newPassword || '');
  const user = users.get(username);

  if (!user) {
    return res.json({ error: 'Usuário não encontrado' });
  }

  if (newPassword.length < 6) {
    return res.json({ error: 'Nova senha muito curta' });
  }

  const validRecovery = await bcrypt.compare(recoveryKey, user.recoveryHash);

  if (!validRecovery) {
    return res.json({ error: 'Recovery Key inválida' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);

  res.json({
    ok: true,
    message: 'Senha recuperada com sucesso'
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
    status: userStatus(target),
    lastSeen: formatLastSeen(target)
  });
});

app.post('/api/contacts/lookup', auth, (req, res) => {
  const me = req.user;
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];

  const results = contacts.slice(0, 1000).map(contact => {
    const name = String(contact.name || '').trim();
    const phone = cleanPhone(contact.phone || '');
    const phoneHash = hashPhone(phone);
    const possibleUsername = cleanUsername(name);

    let found = null;

    for (const user of users.values()) {
      if (user.username === me) continue;

      if (phoneHash && user.phoneHash && user.phoneHash === phoneHash) {
        found = user;
        break;
      }

      if (possibleUsername && user.username === possibleUsername) {
        found = user;
        break;
      }
    }

    if (!found) {
      return {
        name,
        phone,
        registered: false,
        invite: true
      };
    }

    return {
      name,
      phone,
      registered: true,
      username: found.username,
      avatar: found.avatar,
      status: userStatus(found.username),
      lastSeen: found.showLastSeen ? found.lastSeen : null
    };
  });

  res.json({
    ok: true,
    contacts: results
  });
});

app.post('/api/search-user', auth, (req, res) => {
  const query = cleanUsername(req.body.query);

  if (!query || query.length < 3) {
    return res.json({ ok: true, users: [] });
  }

  const found = [];

  for (const user of users.values()) {
    if (user.username === req.user) continue;

    if (user.username.includes(query)) {
      found.push({
        username: user.username,
        avatar: user.avatar,
        status: userStatus(user.username),
        lastSeen: user.showLastSeen ? user.lastSeen : null
      });
    }

    if (found.length >= 20) break;
  }

  res.json({
    ok: true,
    users: found
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

setInterval(() => {
  for (const chat of chats.values()) {
    chat.messages = chat.messages.filter(msg => {
      return Date.now() - msg.createdAt < MESSAGE_TTL;
    });
  }
}, 60000);

io.on('connection', socket => {
  const username = socket.username;
  const user = users.get(username);

  if (user) {
    user.lastSeen = Date.now();
  }

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

    for (const msg of chat.messages) {
      if (msg.from !== username && !msg.deliveredBy.includes(username)) {
        msg.deliveredBy.push(username);
        io.to(roomId).emit('message:delivered', {
          id: msg.id,
          deliveredBy: msg.deliveredBy
        });
      }
    }

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

  socket.on('recording', data => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    socket.to(data.roomId).emit('recording', {
      username,
      recording: !!data.recording
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
      deliveredBy: [username],
      seenBy: [],
      createdAt: Date.now()
    };

    chat.messages.push(message);
    io.to(data.roomId).emit('message:new', message);

    for (const member of chat.members) {
      if (member !== username && onlineUsers.has(member)) {
        message.deliveredBy.push(member);
        io.to(data.roomId).emit('message:delivered', {
          id: message.id,
          deliveredBy: message.deliveredBy
        });
      }
    }
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

    if (
      data.type === 'answer' ||
      data.type === 'ice' ||
      data.type === 'decline' ||
      data.type === 'busy' ||
      data.type === 'hang'
    ) {
      sendToUser(other, 'call:signal', payload);
    }
  });

  socket.on('disconnect', () => {
    const current = users.get(username);

    if (current) {
      current.lastSeen = Date.now();
    }

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