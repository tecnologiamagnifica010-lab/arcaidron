const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 25 * 1024 * 1024,
  pingInterval: 10000,
  pingTimeout: 30000,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  perMessageDeflate: false,
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET_FILE = path.join(__dirname, ".arcaidron_jwt_secret");
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const saved = fs.readFileSync(JWT_SECRET_FILE, "utf8").trim();
      if (saved) return saved;
    }

    const secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(JWT_SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  } catch (err) {
    console.warn("JWT_SECRET temporario; configure JWT_SECRET para sessao definitiva.", err.message);
    return crypto.randomBytes(32).toString("hex");
  }
}
const JWT_SECRET = loadJwtSecret();
const MESSAGE_TTL = 24 * 60 * 60 * 1000;
const DATABASE_URL = process.env.DATABASE_URL || "";

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30mb" }));
app.use(rateLimit({ windowMs: 60000, max: 180 }));
function injectClientExtensions(html) {
  const extension = '<script src="/public/arcaidron-functional.js"></script>';
  const seenEmit = 'socket.emit("message:seen", { roomId: currentRoom, id: message.id });';
  const guardedSeenEmit = `if (localStorage.getItem("arcaidron_hide_seen") !== "1") {
          ${seenEmit}
        }`;
  let nextHtml = html;

  if (nextHtml.includes(seenEmit) && !nextHtml.includes("arcaidron_hide_seen")) {
    nextHtml = nextHtml.replace(seenEmit, guardedSeenEmit);
  }

  if (nextHtml.includes(extension)) return nextHtml;
  return nextHtml.replace("</body>", extension + "\n</body>");
}

app.get("/", (req, res) => {
  fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, html) => {
    if (err) return res.status(500).send("Erro ao carregar ARCAIDRON");
    res.send(injectClientExtensions(html));
  });
});

app.use(express.static(__dirname));

const users = new Map();
const chats = new Map();
const onlineUsers = new Map();
const hiddenOnlineUsers = new Set();

const invites = new Map();

/*
  amizades aceitas
  chave = username
  valor = array de amigos
*/
const friends = new Map();
const friendRooms = new Map();

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });
}

async function initDatabase() {
  if (!pool) {
    console.log("DATABASE_URL não configurada. Usando memória temporária.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_users (
      username TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      created_at BIGINT NOT NULL,
      last_seen BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      avatar TEXT,
      type TEXT NOT NULL,
      cipher TEXT,
      iv TEXT,
      file_name TEXT,
      file_mime TEXT,
      reply_to TEXT,
      reply_text TEXT,
      edited BOOLEAN NOT NULL DEFAULT false,
      deleted BOOLEAN NOT NULL DEFAULT false,
      delivered_by JSONB NOT NULL DEFAULT '[]',
      seen_by JSONB NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_arcaidron_messages_room_created
    ON arcaidron_messages (room_id, created_at)
  `);

  await pool.query(`
    ALTER TABLE arcaidron_users
    ADD COLUMN IF NOT EXISTS user_id TEXT
  `);

  await pool.query(`
    UPDATE arcaidron_users
    SET user_id = 'arc_' || substring(md5(random()::text || clock_timestamp()::text), 1, 12)
    WHERE user_id IS NULL
  `);

  const result = await pool.query(`
    SELECT username, user_id, avatar, password_hash, created_at, last_seen
    FROM arcaidron_users
  `);

  users.clear();

  for (const row of result.rows) {
    users.set(row.username, {
      userId: row.user_id,
      username: row.username,
      avatar: row.avatar || "",
      passwordHash: row.password_hash,
      createdAt: Number(row.created_at),
      lastSeen: row.last_seen ? Number(row.last_seen) : null,
    });
  }

  console.log("Usuários carregados do banco:", users.size);
}

async function loadFriendships() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcaidron_friendships (
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      room_id TEXT NOT NULL,
      user_a_id TEXT,
      user_b_id TEXT,
      pair_hash TEXT,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_a, user_b)
    )
  `);

  await pool.query(`
    ALTER TABLE arcaidron_friendships
    ADD COLUMN IF NOT EXISTS user_a_id TEXT
  `);

  await pool.query(`
    ALTER TABLE arcaidron_friendships
    ADD COLUMN IF NOT EXISTS user_b_id TEXT
  `);

  await pool.query(`
    ALTER TABLE arcaidron_friendships
    ADD COLUMN IF NOT EXISTS pair_hash TEXT
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcaidron_friendships_pair_hash
    ON arcaidron_friendships (pair_hash)
    WHERE pair_hash IS NOT NULL
  `);

  const result = await pool.query(`
    SELECT user_a, user_b, user_a_id, user_b_id, room_id, pair_hash
    FROM arcaidron_friendships
  `);

  friends.clear();
  friendRooms.clear();

  for (const row of result.rows) {
    const a = cleanUsername(row.user_a);
    const b = cleanUsername(row.user_b);
    if (!a || !b || !users.has(a) || !users.has(b)) continue;

    const idA = row.user_a_id || users.get(a)?.userId || "";
    const idB = row.user_b_id || users.get(b)?.userId || "";
    const roomId = row.room_id || createRoomIdByUserIds(idA, idB);
    const pairHash = row.pair_hash || createFriendPairHash(idA, idB);

    addFriendInMemory(a, b, roomId, pairHash);
    ensureChatInMemory(roomId, a, b, idA, idB);
  }
}

async function saveUser(user) {
  users.set(user.username, user);

  if (!pool) return;

  if (!user.userId) {
    user.userId = "arc_" + crypto.randomBytes(8).toString("hex");
  }

  await pool.query(
    `
    INSERT INTO arcaidron_users
      (username, user_id, avatar, password_hash, created_at, last_seen)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (username)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      avatar = EXCLUDED.avatar,
      password_hash = EXCLUDED.password_hash,
      last_seen = EXCLUDED.last_seen
    `,
    [
      user.username,
      user.userId,
      user.avatar || "",
      user.passwordHash,
      user.createdAt || Date.now(),
      user.lastSeen || null,
    ],
  );
}
async function saveMessage(message) {
  if (!pool) return;

  await pool.query(
    `
    INSERT INTO arcaidron_messages
      (
        id, room_id, sender, avatar, type, cipher, iv,
        file_name, file_mime, reply_to, reply_text,
        edited, deleted, delivered_by, seen_by, created_at
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)
    ON CONFLICT (id)
    DO UPDATE SET
      delivered_by = EXCLUDED.delivered_by,
      seen_by = EXCLUDED.seen_by,
      edited = EXCLUDED.edited,
      deleted = EXCLUDED.deleted
    `,
    [
      message.id,
      message.roomId,
      message.from,
      message.avatar || "",
      message.type || "text",
      message.cipher || "",
      message.iv || "",
      message.fileName || "",
      message.fileMime || "",
      message.replyTo || "",
      message.replyText || "",
      !!message.edited,
      !!message.deleted,
      JSON.stringify(message.deliveredBy || []),
      JSON.stringify(message.seenBy || []),
      message.createdAt || Date.now(),
    ],
  );
}

async function updateUserLastSeen(username, lastSeen) {
  const user = users.get(username);

  if (user) {
    user.lastSeen = lastSeen;
  }

  if (!pool) return;

  await pool.query(
    `
    UPDATE arcaidron_users
    SET last_seen = $1
    WHERE username = $2
    `,
    [lastSeen, username],
  );
}

function cleanUsername(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 32);
}

function createToken(username) {
  return jwt.sign({ username }, JWT_SECRET);
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function createRoomIdByUserIds(idA, idB) {
  const pair = [idA, idB].sort().join("::");

  return crypto
    .createHash("sha256")
    .update("ARCAIDRON-ROOM::" + pair)
    .digest("hex");
}

function createFriendPairHash(idA, idB) {
  const pair = [String(idA || ""), String(idB || "")].sort().join("_");
  return crypto
    .createHash("sha256")
    .update("ARCAIDRON-FRIEND-PAIR::" + pair)
    .digest("hex");
}

function createRoomIdByUsers(userA, userB) {
  const idA = users.get(userA)?.userId || userA;
  const idB = users.get(userB)?.userId || userB;
  return createRoomIdByUserIds(idA, idB);
}

function addFriendInMemory(userA, userB, roomId = "", pairHash = "") {
  const a = cleanUsername(userA);
  const b = cleanUsername(userB);
  if (!a || !b || a === b) return;

  if (!friends.has(a)) friends.set(a, []);
  if (!friends.has(b)) friends.set(b, []);
  if (!friends.get(a).includes(b)) friends.get(a).push(b);
  if (!friends.get(b).includes(a)) friends.get(b).push(a);

  const key = [a, b].sort().join("::");
  if (roomId) friendRooms.set(key, { roomId, pairHash });
}

function ensureUserId(username) {
  const user = users.get(cleanUsername(username));
  if (!user) return "";

  if (!user.userId) {
    user.userId = "arc_" + crypto.randomBytes(8).toString("hex");
    saveUser(user).catch((err) => {
      console.error("Erro ao persistir ID do usuario:", err);
    });
  }

  return user.userId;
}

function ensureChatInMemory(roomId, userA, userB, idA = "", idB = "") {
  const a = cleanUsername(userA);
  const b = cleanUsername(userB);
  if (!roomId || !a || !b || !users.has(a) || !users.has(b)) return null;

  let chat = chats.get(roomId);
  if (!chat) {
    chat = {
      roomId,
      members: [a, b],
      memberIds: [idA || ensureUserId(a), idB || ensureUserId(b)],
      messages: [],
      createdAt: Date.now(),
    };
    chats.set(roomId, chat);
    return chat;
  }

  chat.members = [a, b];
  chat.memberIds = [idA || ensureUserId(a), idB || ensureUserId(b)];
  return chat;
}

async function saveFriendship(userA, userB) {
  return ensureFriendshipRoom(userA, userB);
}

async function ensureFriendshipRoom(userA, userB) {
  const a = cleanUsername(userA);
  const b = cleanUsername(userB);
  if (!a || !b || a === b || !users.has(a) || !users.has(b)) {
    return null;
  }

  const idA = ensureUserId(a);
  const idB = ensureUserId(b);
  if (!idA || !idB) return null;

  const sortedIds = [idA, idB].sort();
  const pairHash = createFriendPairHash(idA, idB);
  const roomId = createRoomIdByUserIds(idA, idB);
  const userById = new Map([
    [idA, a],
    [idB, b],
  ]);
  const leftUser = userById.get(sortedIds[0]);
  const rightUser = userById.get(sortedIds[1]);

  addFriendInMemory(a, b, roomId, pairHash);
  ensureChatInMemory(roomId, a, b, idA, idB);

  if (pool) {
    const updated = await pool.query(
      `
      UPDATE arcaidron_friendships
      SET
        user_a = $1,
        user_b = $2,
        room_id = $3,
        user_a_id = $4,
        user_b_id = $5,
        pair_hash = $6
      WHERE room_id = $3
        OR pair_hash = $6
        OR (user_a = $1 AND user_b = $2)
        OR (user_a = $2 AND user_b = $1)
      `,
      [
        leftUser,
        rightUser,
        roomId,
        sortedIds[0],
        sortedIds[1],
        pairHash,
      ],
    );

    if (updated.rowCount === 0) {
      await pool.query(
      `
      INSERT INTO arcaidron_friendships
        (user_a, user_b, room_id, user_a_id, user_b_id, pair_hash, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_a, user_b)
      DO UPDATE SET
        room_id = EXCLUDED.room_id,
        user_a_id = EXCLUDED.user_a_id,
        user_b_id = EXCLUDED.user_b_id,
        pair_hash = EXCLUDED.pair_hash
      `,
      [
        leftUser,
        rightUser,
        roomId,
        sortedIds[0],
        sortedIds[1],
        pairHash,
        Date.now(),
      ],
      );
    }
  }

  return {
    roomId,
    pairHash,
    members: [a, b],
    memberIds: [idA, idB],
  };
}

async function rebuildChatFromRoomId(roomId) {
  if (chats.has(roomId)) return chats.get(roomId);
  if (!pool || !roomId) return null;

  const result = await pool.query(
    `
    SELECT user_a, user_b, user_a_id, user_b_id, pair_hash
    FROM arcaidron_friendships
    WHERE room_id = $1
    LIMIT 1
    `,
    [roomId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const a = cleanUsername(row.user_a);
  const b = cleanUsername(row.user_b);
  if (!a || !b || !users.has(a) || !users.has(b)) return null;

  addFriendInMemory(a, b, roomId, row.pair_hash || "");
  return ensureChatInMemory(roomId, a, b, row.user_a_id, row.user_b_id);
}

function userStatus(username) {
  return onlineUsers.has(username) && !hiddenOnlineUsers.has(username) ? "online" : "offline";
}

function publicUser(username) {
  const user = users.get(username);
  if (!user) return null;

  return {
    username: user.username,
    userId: user.userId,
    avatar: user.avatar,
    lastSeen: user.lastSeen || null,
  };
}
function findUsernameByUserId(userId) {
  const cleanId = String(userId || "").trim();

  for (const [username, user] of users.entries()) {
    if (user.userId === cleanId) {
      return username;
    }
  }

  return "";
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return res.status(401).json({ error: "Sessão inválida" });
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
  const user = users.get(username);

  io.emit("presence:update", {
    username,
    status: userStatus(username),
    lastSeen: user?.lastSeen || null,
  });
}

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const avatar = String(req.body.avatar || "");

    if (username.length < 3) {
      return res.json({ error: "Nome muito curto" });
    }

    if (password.length < 6) {
      return res.json({ error: "Senha muito curta" });
    }

    if (users.has(username)) {
      return res.json({ error: "Esse usuário já existe" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = {
      userId: "arc_" + crypto.randomBytes(8).toString("hex"),
      username,
      avatar,
      passwordHash,
      createdAt: Date.now(),
      lastSeen: null,
    };

    await saveUser(user);

    res.json({
      ok: true,
      token: createToken(username),
      userId: user.userId,
      username,
      avatar,
    });
  } catch (err) {
    console.error("Erro no cadastro:", err);
    res.json({ error: "Erro ao criar conta" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");
    const user = users.get(username);

    if (!user) {
      return res.json({ error: "Login inválido" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      return res.json({ error: "Senha inválida" });
    }

    if (!user.userId) {
      user.userId = "arc_" + crypto.randomBytes(8).toString("hex");
      await saveUser(user);
    }

    res.json({
      ok: true,
      token: createToken(username),
      userId: user.userId,
      username,
      avatar: user.avatar,
    });
  } catch (err) {
    console.error("Erro no login:", err);
    res.json({ error: "Erro ao entrar" });
  }
});


app.post("/api/online-users", auth, (req, res) => {
  const list = [];

  for (const username of onlineUsers.keys()) {
    if (hiddenOnlineUsers.has(username)) continue;
    if (username === req.user) continue;

    const user = users.get(username);
    if (!user) continue;

    list.push({
      username,
      userId: user.userId,
      avatar: user.avatar || "",
      status: "online",
    });
  }

  res.json({ users: list });
});

app.post("/api/update-avatar", auth, (req, res) => {
  const avatar = String(req.body.avatar || "");

  if (!avatar.startsWith("data:image/")) {
    return res.json({ error: "Imagem inválida" });
  }

  if (avatar.length > 1400000) {
    return res.json({ error: "Imagem muito grande" });
  }

  const user = users.get(req.user);
  if (!user) return res.json({ error: "Usuário não encontrado" });

  user.avatar = avatar;
  saveUser(user).catch((err) => {
    console.error("Erro ao salvar avatar:", err);
  });
  emitPresence(req.user);

  res.json({ ok: true, avatar });
});

app.post("/api/privacy-online", auth, (req, res) => {
  const hidden = !!req.body.hidden;

  if (hidden) hiddenOnlineUsers.add(req.user);
  else hiddenOnlineUsers.delete(req.user);

  emitPresence(req.user);

  res.json({ ok: true, hidden });
});

app.post("/api/open-chat", auth, async (req, res) => {
  const me = req.user;
  const targetIdRaw = String(req.body.targetId || "").trim();
  const targetRaw = String(req.body.target || "").trim();
  const target =
    findUsernameByUserId(targetIdRaw) ||
    findUsernameByUserId(targetRaw) ||
    cleanUsername(targetRaw);
  const sharedKeyHash = String(req.body.sharedKeyHash || "");

  if (!target) {
    return res.json({ error: "Informe usuario e chave" });
  }

  if (target === me) {
    return res.json({ error: "Voce nao pode conversar consigo mesmo" });
  }

  const user = users.get(target);

  if (!user) {
    return res.json({ error: "Usuario ou chave invalidos" });
  }

  let room;
  try {
    room = await ensureFriendshipRoom(me, target);
  } catch (err) {
    console.error("Erro ao abrir sala por IDs:", err);
    return res.json({ error: "Nao foi possivel abrir a conversa" });
  }

  if (!room) {
    return res.json({ error: "Nao foi possivel abrir a conversa" });
  }

  res.json({
    ok: true,
    roomId: room.roomId,
    pairHash: room.pairHash,
    targetId: user.userId,
    sharedKeyHash,
    peer: publicUser(target),
    status: userStatus(target),
    lastSeen: user.lastSeen || null,
  });
});

app.post("/api/send-invite", auth, async (req, res) => {
  const from = req.user;
  const targetId = String(req.body.targetId || "").trim();

  if (!targetId) {
    return res.json({ error: "Informe o ID do amigo" });
  }

  const target = findUsernameByUserId(targetId);

  if (!target) {
    return res.json({ error: "ID nao encontrado" });
  }

  if (target === from) {
    return res.json({ error: "Voce nao pode adicionar a si mesmo" });
  }

  const alreadyFriends =
    (friends.get(from) || []).includes(target) ||
    (friends.get(target) || []).includes(from);

  let room;
  try {
    room = await ensureFriendshipRoom(from, target);
  } catch (err) {
    console.error("Erro ao criar sala por convite:", err);
    return res.json({ error: "Nao foi possivel criar a sala do contato" });
  }

  if (!room) {
    return res.json({ error: "Nao foi possivel criar a sala do contato" });
  }

  if (!alreadyFriends) {
    if (!invites.has(target)) invites.set(target, []);

    const pending =
      invites.get(target).some((invite) => invite.from === from) ||
      (invites.get(from) || []).some((invite) => invite.from === target);

    if (!pending) {
      invites.get(target).push({
        from,
        fromId: users.get(from)?.userId || "",
        roomId: room.roomId,
        pairHash: room.pairHash,
        createdAt: Date.now(),
      });
    }
  }

  res.json({
    ok: true,
    message: alreadyFriends
      ? "Contato ja estava salvo"
      : "Contato salvo e pedido de amizade enviado",
    target,
    targetId: users.get(target)?.userId || targetId,
    roomId: room.roomId,
    pairHash: room.pairHash,
    peer: publicUser(target),
  });
});

app.post("/api/list-invites", auth, (req, res) => {
  const username = req.user;

  const received = invites.get(username) || [];

  res.json({
    ok: true,
    invites: received,
  });
});

app.post("/api/list-friends", auth, (req, res) => {
  const username = req.user;

  const myFriends = friends.get(username) || [];

  res.json({
    ok: true,
    friends: myFriends
      .map((friend) => {
        const item = publicUser(friend);
        if (!item) return null;

        const key = [cleanUsername(username), cleanUsername(friend)]
          .sort()
          .join("::");
        const room = friendRooms.get(key) || {};

        return {
          ...item,
          roomId: room.roomId || createRoomIdByUsers(username, friend),
          pairHash:
            room.pairHash ||
            createFriendPairHash(ensureUserId(username), ensureUserId(friend)),
        };
      })
      .filter(Boolean),
  });
});

app.post("/api/accept-invite", auth, async (req, res) => {
  const username = req.user;
  const from = cleanUsername(req.body.from);

  const received = invites.get(username) || [];

  const invite = received.find((i) => i.from === from);

  if (!invite) {
    return res.json({
      error: "Pedido de amizade não encontrado",
    });
  }

  invites.set(
    username,
    received.filter((i) => i.from !== from),
  );

  let room;
  try {
    room = await saveFriendship(username, from);
  } catch (err) {
    console.error("Erro ao salvar amizade:", err);
    return res.json({
      error: "Erro ao salvar amizade",
    });
  }

  res.json({
    ok: true,
    message: "Amizade aceita",
    from,
    roomId: room?.roomId || createRoomIdByUsers(username, from),
    pairHash:
      room?.pairHash ||
      createFriendPairHash(ensureUserId(username), ensureUserId(from)),
    peer: publicUser(from),
  });
});

app.post("/api/reject-invite", auth, (req, res) => {
  const username = req.user;
  const from = cleanUsername(req.body.from);

  const received = invites.get(username) || [];

  invites.set(
    username,
    received.filter((i) => i.from !== from),
  );

  res.json({
    ok: true,
    message: "Convite recusado",
  });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const data = verifyToken(token);

  if (!data || !users.has(data.username)) {
    return next(new Error("Não autorizado"));
  }

  socket.username = data.username;
  next();
});

setInterval(() => {
  for (const chat of chats.values()) {
    chat.messages = chat.messages.filter((msg) => {
      return Date.now() - msg.createdAt < MESSAGE_TTL;
    });
  }
}, 60000);

io.on("connection", async (socket) => {
  const username = socket.username;
  let activeRoom = "";

  await updateUserLastSeen(username, Date.now());

  if (!onlineUsers.has(username)) {
    onlineUsers.set(username, new Set());
  }

  onlineUsers.get(username).add(socket.id);
  emitPresence(username);

  socket.on("room:join", async (data) => {
    const roomId = data.roomId;
    const chat = chats.get(roomId) || (await rebuildChatFromRoomId(roomId));

    if (!chat) return;
    if (!chat.members.includes(username)) return;

    if (activeRoom && activeRoom !== roomId) {
      socket.leave(activeRoom);
    }

    activeRoom = roomId;
    socket.join(roomId);

    if (pool) {
      try {
        const result = await pool.query(
          `
          SELECT *
          FROM arcaidron_messages
          WHERE room_id = $1
            AND created_at > $2
          ORDER BY created_at ASC
          `,
          [roomId, Date.now() - MESSAGE_TTL],
        );

        chat.messages = result.rows.map((row) => ({
          id: row.id,
          roomId: row.room_id,
          from: row.sender,
          avatar: row.avatar || "",
          type: row.type || "text",
          cipher: row.cipher || "",
          iv: row.iv || "",
          fileName: row.file_name || "",
          fileMime: row.file_mime || "",
          replyTo: row.reply_to || "",
          replyText: row.reply_text || "",
          edited: !!row.edited,
          deleted: !!row.deleted,
          deliveredBy: Array.isArray(row.delivered_by) ? row.delivered_by : [],
          seenBy: Array.isArray(row.seen_by) ? row.seen_by : [],
          createdAt: Number(row.created_at),
        }));
      } catch (err) {
        console.error("Erro ao carregar histórico:", err);
      }
    }

    let changedDelivered = [];

    for (const msg of chat.messages) {
      if (msg.from !== username) {
        if (!msg.deliveredBy) msg.deliveredBy = [];

        if (!msg.deliveredBy.includes(username)) {
          msg.deliveredBy.push(username);
          changedDelivered.push({
            id: msg.id,
            deliveredBy: msg.deliveredBy,
          });

          saveMessage(msg).catch((err) => {
            console.error("Erro ao atualizar entrega:", err);
          });
        }
      }
    }

    socket.emit("room:history", chat.messages);

    for (const item of changedDelivered) {
      io.to(roomId).emit("message:delivered", item);
    }
  });

  socket.on("typing", (data) => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    socket.to(data.roomId).emit("typing", {
      username,
      typing: !!data.typing,
    });
  });

  socket.on("recording", (data) => {
    const chat = chats.get(data.roomId);
    if (!chat || !chat.members.includes(username)) return;

    socket.to(data.roomId).emit("recording", {
      username,
      recording: !!data.recording,
    });
  });

  socket.on("message:send", async (data, ack) => {
    const chat = chats.get(data.roomId) || (await rebuildChatFromRoomId(data.roomId));

    if (!chat || !chat.members.includes(username)) {
      if (typeof ack === "function") ack({ error: "Sala inválida" });
      return;
    }

    const safeClientId =
      typeof data.id === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(data.id)
        ? data.id
        : crypto.randomUUID();

    const message = {
      id: safeClientId,
      roomId: data.roomId,
      from: username,
      avatar: users.get(username)?.avatar || "",
      type: data.type || "text",
      cipher: data.cipher || "",
      iv: data.iv || "",
      fileName: data.fileName || "",
      fileMime: data.fileMime || "",
      replyTo: data.replyTo || "",
      replyText: data.replyText || "",
      edited: false,
      deleted: false,
      deliveredBy: [username],
      seenBy: [],
      createdAt: Number(data.createdAt || Date.now()),
    };

    const exists = chat.messages.some((m) => m.id === message.id);
    if (!exists) {
      chat.messages.push(message);
      saveMessage(message).catch((err) => {
        console.error("Erro ao salvar mensagem:", err);
      });
    }

    for (const member of chat.members) {
      if (member !== username && onlineUsers.has(member)) {
        if (!message.deliveredBy.includes(member)) {
          message.deliveredBy.push(member);
        }
      }
    }

    saveMessage(message).catch((err) => {
      console.error("Erro ao atualizar entrega da mensagem:", err);
    });

    io.to(data.roomId).emit("message:new", message);

    for (const member of chat.members) {
      sendToUser(member, "message:new", message);
    }

    io.to(data.roomId).emit("message:delivered", {
      id: message.id,
      deliveredBy: message.deliveredBy,
    });

    if (typeof ack === "function") ack({ ok: true, id: message.id });
  });

  socket.on("message:edit", async (data) => {
    const chat = chats.get(data.roomId) || (await rebuildChatFromRoomId(data.roomId));
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(
      (m) => m.id === data.id && m.from === username,
    );
    if (!msg || msg.deleted) return;

    msg.cipher = data.cipher || "";
    msg.iv = data.iv || "";
    msg.edited = true;

    saveMessage(msg).catch((err) => {
      console.error("Erro ao salvar edicao:", err);
    });

    io.to(data.roomId).emit("message:edited", {
      id: msg.id,
      cipher: msg.cipher,
      iv: msg.iv,
    });
  });

  socket.on("message:delete", async (data) => {
    const chat = chats.get(data.roomId) || (await rebuildChatFromRoomId(data.roomId));
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find(
      (m) => m.id === data.id && m.from === username,
    );
    if (!msg) return;

    msg.deleted = true;
    msg.cipher = "";
    msg.iv = "";
    msg.fileName = "";
    msg.fileMime = "";

    saveMessage(msg).catch((err) => {
      console.error("Erro ao salvar exclusao:", err);
    });

    io.to(data.roomId).emit("message:deleted", {
      id: msg.id,
    });
  });

  socket.on("message:seen", async (data) => {
    const chat = chats.get(data.roomId) || (await rebuildChatFromRoomId(data.roomId));
    if (!chat || !chat.members.includes(username)) return;

    const msg = chat.messages.find((m) => m.id === data.id);
    if (!msg) return;

    if (msg.from === username) return;

    if (!msg.deliveredBy) msg.deliveredBy = [];
    if (!msg.seenBy) msg.seenBy = [];

    if (!msg.deliveredBy.includes(username)) {
      msg.deliveredBy.push(username);
    }

    if (!msg.seenBy.includes(username)) {
      msg.seenBy.push(username);
    }

    saveMessage(msg).catch((err) => {
      console.error("Erro ao salvar leitura:", err);
    });

    io.to(data.roomId).emit("message:delivered", {
      id: msg.id,
      deliveredBy: msg.deliveredBy,
    });

    io.to(data.roomId).emit("message:seen", {
      id: msg.id,
      seenBy: msg.seenBy,
    });
  });

  socket.on("call:signal", async (data) => {
    const roomId = data.roomId;
    const chat = chats.get(roomId) || (await rebuildChatFromRoomId(roomId));

    if (!chat || !chat.members.includes(username)) return;

    const other = chat.members.find((member) => member !== username);

    const payload = {
      ...data,
      roomId,
      from: username,
      fromAvatar: users.get(username)?.avatar || "",
      to: other,
    };

    if (data.type === "offer") {
      const delivered = sendToUser(other, "call:signal", payload);

      if (!delivered) {
        socket.emit("call:signal", {
          roomId,
          type: "offline",
          from: other,
        });
      }

      return;
    }

    if (
      data.type === "answer" ||
      data.type === "ice" ||
      data.type === "decline" ||
      data.type === "busy" ||
      data.type === "hang"
    ) {
      sendToUser(other, "call:signal", payload);
    }
  });

  socket.on("disconnect", async () => {
    const set = onlineUsers.get(username);

    if (set) {
      set.delete(socket.id);

      if (set.size === 0) {
        onlineUsers.delete(username);
        await updateUserLastSeen(username, Date.now());
      }
    } else {
      await updateUserLastSeen(username, Date.now());
    }

    emitPresence(username);
  });
});

initDatabase()
  .then(async () => {
    await loadFriendships();
    server.listen(PORT, () => {
      console.log("ARCAIDRON ativo na porta " + PORT);
    });
  })
  .catch((err) => {
    console.error("Erro ao iniciar banco de dados:", err);
    process.exit(1);
  });
