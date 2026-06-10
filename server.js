const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 28 * 1024 * 1024,
  pingInterval: 10000,
  pingTimeout: 30000,
  transports: ["websocket", "polling"],
});

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const JWT_SECRET = process.env.JWT_SECRET || loadLocalSecret();

const users = new Map(); // username -> user
const usersById = new Map(); // userId -> username
const rooms = new Map(); // roomId -> room
const socketsByUser = new Map(); // username -> Set(socket.id)
const hiddenContacts = new Map(); // username -> Set(peerId)

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 240 }));
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function loadLocalSecret() {
  const file = path.join(__dirname, ".arcaidron_jwt_secret");
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
    const next = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, next, { mode: 0o600 });
    return next;
  } catch {
    return crypto.randomBytes(32).toString("hex");
  }
}

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 32);
}

function newUserId() {
  return "arc_" + crypto.randomBytes(10).toString("hex");
}

function getRoomId(id1, id2) {
  const pair = [String(id1 || ""), String(id2 || "")].sort().join("_");
  return crypto.createHash("sha256").update("ARCAIDRON_ROOM:" + pair).digest("hex");
}

function getPairHash(id1, id2) {
  const pair = [String(id1 || ""), String(id2 || "")].sort().join("_");
  return crypto.createHash("sha256").update("ARCAIDRON_PAIR:" + pair).digest("hex");
}

function sign(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "3650d" });
}

function verify(token) {
  try {
    const data = jwt.verify(token, JWT_SECRET);
    return data && users.has(data.username) ? data.username : "";
  } catch {
    return "";
  }
}

function publicUser(username) {
  const user = users.get(username);
  if (!user) return null;
  return {
    username: user.username,
    userId: user.userId,
    avatar: user.avatar || "",
    publicKey: user.publicKey || null,
    lastSeen: user.lastSeen || null,
    online: socketsByUser.has(username),
  };
}

function resolveUser(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (usersById.has(raw)) return usersById.get(raw);
  const username = cleanUsername(raw);
  return users.has(username) ? username : "";
}

function ensureSet(map, key) {
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function isHiddenFor(owner, peerId) {
  return (hiddenContacts.get(owner) || new Set()).has(peerId);
}

function createRoom(userA, userB) {
  const a = users.get(userA);
  const b = users.get(userB);
  if (!a || !b || a.username === b.username) return null;

  const roomId = getRoomId(a.userId, b.userId);
  const pairHash = getPairHash(a.userId, b.userId);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      roomId,
      pairHash,
      userA: a.username,
      userB: b.username,
      userAId: a.userId,
      userBId: b.userId,
      messages: [],
      createdAt: Date.now(),
    });
  }

  return rooms.get(roomId);
}

function roomHasUser(room, username) {
  return room && (room.userA === username || room.userB === username);
}

function peerOf(room, username) {
  return room.userA === username ? room.userB : room.userA;
}

function roomPayload(room, username) {
  const peer = peerOf(room, username);
  return {
    roomId: room.roomId,
    pairHash: room.pairHash,
    peer: publicUser(peer),
  };
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_users (
      username TEXT PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      public_key JSONB,
      created_at BIGINT NOT NULL,
      last_seen BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_rooms (
      room_id TEXT PRIMARY KEY,
      pair_hash TEXT NOT NULL,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      type TEXT NOT NULL,
      cipher TEXT NOT NULL,
      iv TEXT NOT NULL,
      file_name TEXT,
      file_mime TEXT,
      reply_to TEXT,
      created_at BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT false,
      delivered_by JSONB NOT NULL DEFAULT '[]',
      seen_by JSONB NOT NULL DEFAULT '[]'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_hidden_contacts (
      owner TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY(owner, peer_id)
    )
  `);

  const userRows = await pool.query("SELECT * FROM arcaidron_users");
  for (const row of userRows.rows) {
    users.set(row.username, {
      username: row.username,
      userId: row.user_id,
      passwordHash: row.password_hash,
      avatar: row.avatar || "",
      publicKey: row.public_key || null,
      createdAt: Number(row.created_at),
      lastSeen: row.last_seen ? Number(row.last_seen) : null,
    });
    usersById.set(row.user_id, row.username);
  }

  const roomRows = await pool.query("SELECT * FROM arcaidron_rooms");
  for (const row of roomRows.rows) {
    rooms.set(row.room_id, {
      roomId: row.room_id,
      pairHash: row.pair_hash,
      userA: row.user_a,
      userB: row.user_b,
      userAId: row.user_a_id,
      userBId: row.user_b_id,
      messages: [],
      createdAt: Number(row.created_at),
    });
  }

  const hiddenRows = await pool.query("SELECT * FROM arcaidron_hidden_contacts");
  for (const row of hiddenRows.rows) {
    ensureSet(hiddenContacts, row.owner).add(row.peer_id);
  }
}

async function persistUser(user) {
  users.set(user.username, user);
  usersById.set(user.userId, user.username);
  if (!pool) return;
  await pool.query(
    `
    INSERT INTO arcaidron_users
      (username, user_id, password_hash, avatar, public_key, created_at, last_seen)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(username)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      password_hash = EXCLUDED.password_hash,
      avatar = EXCLUDED.avatar,
      public_key = EXCLUDED.public_key,
      last_seen = EXCLUDED.last_seen
    `,
    [
      user.username,
      user.userId,
      user.passwordHash,
      user.avatar || "",
      user.publicKey || null,
      user.createdAt,
      user.lastSeen || null,
    ],
  );
}

async function persistRoom(room) {
  if (!pool || !room) return;
  await pool.query(
    `
    INSERT INTO arcaidron_rooms
      (room_id, pair_hash, user_a, user_b, user_a_id, user_b_id, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(room_id) DO NOTHING
    `,
    [
      room.roomId,
      room.pairHash,
      room.userA,
      room.userB,
      room.userAId,
      room.userBId,
      room.createdAt,
    ],
  );
}

async function loadHistory(room) {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  if (pool) {
    const rows = await pool.query(
      "SELECT * FROM arcaidron_messages WHERE room_id = $1 AND created_at > $2 ORDER BY created_at ASC",
      [room.roomId, cutoff],
    );
    room.messages = rows.rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      from: row.sender,
      type: row.type,
      cipher: row.cipher,
      iv: row.iv,
      fileName: row.file_name || "",
      fileMime: row.file_mime || "",
      replyTo: row.reply_to || "",
      createdAt: Number(row.created_at),
      deleted: !!row.deleted,
      deliveredBy: Array.isArray(row.delivered_by) ? row.delivered_by : [],
      seenBy: Array.isArray(row.seen_by) ? row.seen_by : [],
    }));
  } else {
    room.messages = room.messages.filter((msg) => msg.createdAt > cutoff);
  }
  return room.messages;
}

async function persistMessage(message) {
  if (!pool) return;
  await pool.query(
    `
    INSERT INTO arcaidron_messages
      (id, room_id, sender, type, cipher, iv, file_name, file_mime, reply_to,
       created_at, deleted, delivered_by, seen_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(id)
    DO UPDATE SET
      deleted = EXCLUDED.deleted,
      delivered_by = EXCLUDED.delivered_by,
      seen_by = EXCLUDED.seen_by
    `,
    [
      message.id,
      message.roomId,
      message.from,
      message.type,
      message.cipher,
      message.iv,
      message.fileName || "",
      message.fileMime || "",
      message.replyTo || "",
      message.createdAt,
      !!message.deleted,
      JSON.stringify(message.deliveredBy || []),
      JSON.stringify(message.seenBy || []),
    ],
  );
}

function auth(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const username = verify(token);
  if (!username) return res.status(401).json({ error: "Sessao invalida" });
  req.username = username;
  next();
}

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    if (username.length < 3) return res.json({ error: "Nome muito curto" });
    if (password.length < 6) return res.json({ error: "Senha muito curta" });
    if (users.has(username)) return res.json({ error: "Nome ja existe" });

    const user = {
      username,
      userId: newUserId(),
      passwordHash: await bcrypt.hash(password, 10),
      avatar: String(req.body.avatar || ""),
      publicKey: req.body.publicKey || null,
      createdAt: Date.now(),
      lastSeen: null,
    };

    await persistUser(user);
    res.json({ ok: true, token: sign(username), user: publicUser(username) });
  } catch (err) {
    console.error("register", err);
    res.json({ error: "Erro ao criar conta" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const user = users.get(username);
    if (!user) return res.json({ error: "Conta nao encontrada" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.json({ error: "Senha invalida" });

    if (req.body.publicKey) user.publicKey = req.body.publicKey;
    if (req.body.avatar && String(req.body.avatar).startsWith("data:image/")) {
      user.avatar = String(req.body.avatar);
    }
    await persistUser(user);
    res.json({ ok: true, token: sign(username), user: publicUser(username) });
  } catch (err) {
    console.error("login", err);
    res.json({ error: "Erro ao entrar" });
  }
});

app.post("/api/me", auth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.username) });
});

app.post("/api/update-profile", auth, async (req, res) => {
  const user = users.get(req.username);
  if (!user) return res.json({ error: "Conta nao encontrada" });
  if (req.body.avatar && String(req.body.avatar).startsWith("data:image/")) {
    user.avatar = String(req.body.avatar).slice(0, 2_500_000);
  }
  if (req.body.publicKey) user.publicKey = req.body.publicKey;
  await persistUser(user);
  emitPresence(req.username);
  res.json({ ok: true, user: publicUser(req.username) });
});

app.post("/api/add-friend", auth, async (req, res) => {
  const me = req.username;
  const peer = resolveUser(req.body.userId || req.body.username);
  if (!peer) return res.json({ error: "ID nao encontrado" });
  if (peer === me) return res.json({ error: "Voce nao pode adicionar a si mesmo" });

  const room = createRoom(me, peer);
  await persistRoom(room);
  if ((hiddenContacts.get(me) || new Set()).has(users.get(peer).userId)) {
    hiddenContacts.get(me).delete(users.get(peer).userId);
    if (pool) {
      await pool.query(
        "DELETE FROM arcaidron_hidden_contacts WHERE owner = $1 AND peer_id = $2",
        [me, users.get(peer).userId],
      );
    }
  }
  res.json({ ok: true, room: roomPayload(room, me) });
});

app.post("/api/rooms", auth, async (req, res) => {
  const username = req.username;
  const user = users.get(username);
  const list = [];
  for (const room of rooms.values()) {
    if (!roomHasUser(room, username)) continue;
    const peer = publicUser(peerOf(room, username));
    if (!peer || isHiddenFor(username, peer.userId)) continue;
    list.push({
      ...roomPayload(room, username),
      lastMessageAt: room.messages[room.messages.length - 1]?.createdAt || room.createdAt,
    });
  }
  list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  res.json({ ok: true, user: publicUser(username), myId: user.userId, rooms: list });
});

app.post("/api/hide-contact", auth, async (req, res) => {
  const peer = resolveUser(req.body.userId || req.body.username);
  if (!peer) return res.json({ error: "Contato nao encontrado" });
  const peerId = users.get(peer).userId;
  ensureSet(hiddenContacts, req.username).add(peerId);
  if (pool) {
    await pool.query(
      `
      INSERT INTO arcaidron_hidden_contacts (owner, peer_id, created_at)
      VALUES ($1,$2,$3)
      ON CONFLICT(owner, peer_id) DO NOTHING
      `,
      [req.username, peerId, Date.now()],
    );
  }
  res.json({ ok: true });
});

app.post("/api/history", auth, async (req, res) => {
  const room = rooms.get(String(req.body.roomId || ""));
  if (!roomHasUser(room, req.username)) return res.json({ error: "Sala invalida" });
  const messages = await loadHistory(room);
  res.json({ ok: true, messages });
});

io.use((socket, next) => {
  const username = verify(socket.handshake.auth?.token || "");
  if (!username) return next(new Error("Nao autorizado"));
  socket.username = username;
  next();
});

io.on("connection", async (socket) => {
  const username = socket.username;
  ensureSet(socketsByUser, username).add(socket.id);
  emitPresence(username);

  socket.on("room:join", async ({ roomId }, ack) => {
    const room = rooms.get(String(roomId || ""));
    if (!roomHasUser(room, username)) {
      if (typeof ack === "function") ack({ error: "Sala invalida" });
      return;
    }
    socket.join(room.roomId);
    const messages = await loadHistory(room);
    socket.emit("room:history", { roomId: room.roomId, messages });
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("message:send", async (data, ack) => {
    const room = rooms.get(String(data.roomId || ""));
    if (!roomHasUser(room, username)) {
      if (typeof ack === "function") ack({ error: "Sala invalida" });
      return;
    }

    const message = {
      id: /^[a-zA-Z0-9_-]{8,120}$/.test(String(data.id || "")) ? data.id : crypto.randomUUID(),
      roomId: room.roomId,
      from: username,
      type: String(data.type || "text").slice(0, 20),
      cipher: String(data.cipher || ""),
      iv: String(data.iv || ""),
      fileName: String(data.fileName || "").slice(0, 160),
      fileMime: String(data.fileMime || "").slice(0, 120),
      replyTo: String(data.replyTo || "").slice(0, 120),
      createdAt: Number(data.createdAt || Date.now()),
      deleted: false,
      deliveredBy: [username],
      seenBy: [],
    };

    if (!message.cipher || !message.iv) {
      if (typeof ack === "function") ack({ error: "Mensagem sem cifra" });
      return;
    }

    if (!room.messages.some((item) => item.id === message.id)) {
      room.messages.push(message);
      await persistMessage(message);
    }

    io.to(room.roomId).emit("message:new", message);
    if (typeof ack === "function") ack({ ok: true, id: message.id });
  });

  socket.on("message:seen", async ({ roomId, id }) => {
    const room = rooms.get(String(roomId || ""));
    if (!roomHasUser(room, username)) return;
    const message = room.messages.find((item) => item.id === id);
    if (!message || message.from === username) return;
    if (!message.deliveredBy.includes(username)) message.deliveredBy.push(username);
    if (!message.seenBy.includes(username)) message.seenBy.push(username);
    await persistMessage(message);
    io.to(room.roomId).emit("message:seen", {
      id: message.id,
      deliveredBy: message.deliveredBy,
      seenBy: message.seenBy,
    });
  });

  socket.on("message:delete", async ({ roomId, id }) => {
    const room = rooms.get(String(roomId || ""));
    if (!roomHasUser(room, username)) return;
    const message = room.messages.find((item) => item.id === id);
    if (!message || message.from !== username) return;
    message.deleted = true;
    message.cipher = "";
    message.iv = "";
    await persistMessage(message);
    io.to(room.roomId).emit("message:deleted", { id });
  });

  socket.on("typing", ({ roomId, typing }) => {
    const room = rooms.get(String(roomId || ""));
    if (!roomHasUser(room, username)) return;
    socket.to(room.roomId).emit("typing", { roomId: room.roomId, username, typing: !!typing });
  });

  socket.on("call:signal", (data) => {
    const room = rooms.get(String(data.roomId || ""));
    if (!roomHasUser(room, username)) return;
    socket.to(room.roomId).emit("call:signal", {
      ...data,
      roomId: room.roomId,
      from: username,
      fromUser: publicUser(username),
    });
  });

  socket.on("disconnect", async () => {
    const set = socketsByUser.get(username);
    if (set) {
      set.delete(socket.id);
      if (!set.size) socketsByUser.delete(username);
    }
    const user = users.get(username);
    if (user) {
      user.lastSeen = Date.now();
      await persistUser(user);
    }
    emitPresence(username);
  });
});

function emitPresence(username) {
  io.emit("presence:update", { user: publicUser(username) });
}

setInterval(() => {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  for (const room of rooms.values()) {
    room.messages = room.messages.filter((message) => message.createdAt > cutoff);
  }
}, 60 * 1000);

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`ARCAIDRON rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Falha ao iniciar ARCAIDRON:", err);
    process.exit(1);
  });
