const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e8,
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

const db = new sqlite3.Database("./arcaidron.db");

const onlineUsers = {};
const userLastSeen = {};
const userSockets = {};
const tokenToUser = {};

function hashPassword(password) {
  return crypto.createHash("sha256").update("ARCAIDRON_SALT_" + password).digest("hex");
}

function generateToken(username) {
  return crypto.createHash("sha256").update(username + "_" + Date.now() + "_" + uuidv4()).digest("hex");
}

function horaBrasil() {
  return new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dataHoraBrasil() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function safeText(value) {
  return (value || "").toString().trim();
}

function normalize(value) {
  return safeText(value).toLowerCase();
}

function addColumnSafe(table, column, definition) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, () => {});
}

function emitError(socket, message) {
  socket.emit("error_msg", message);
}

function criarChatId(userA, userB, key) {
  const keyHash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return [normalize(userA), normalize(userB)].sort().join("__") + "__" + keyHash;
}

function marcarOnline(socket, username, avatarUrl) {
  const key = normalize(username);
  socket.username = username;
  socket.avatarUrl = avatarUrl || null;
  onlineUsers[key] = true;
  userLastSeen[key] = Date.now();
  userSockets[key] = socket.id;
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT DEFAULT '👤',
      avatarUrl TEXT DEFAULT NULL,
      displayName TEXT DEFAULT NULL,
      bio TEXT DEFAULT '',
      status TEXT DEFAULT 'Disponível',
      createdAt TEXT DEFAULT ''
    )
  `);

  addColumnSafe("users", "avatar", "TEXT DEFAULT '👤'");
  addColumnSafe("users", "avatarUrl", "TEXT DEFAULT NULL");
  addColumnSafe("users", "displayName", "TEXT DEFAULT NULL");
  addColumnSafe("users", "bio", "TEXT DEFAULT ''");
  addColumnSafe("users", "status", "TEXT DEFAULT 'Disponível'");
  addColumnSafe("users", "createdAt", "TEXT DEFAULT ''");

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chatId TEXT,
      username TEXT,
      avatar TEXT,
      avatarUrl TEXT DEFAULT NULL,
      type TEXT,
      text TEXT,
      media TEXT,
      time TEXT,
      seenBy TEXT DEFAULT '',
      replyTo TEXT DEFAULT '',
      deleted TEXT DEFAULT 'false'
    )
  `);

  addColumnSafe("messages", "avatarUrl", "TEXT DEFAULT NULL");

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      username TEXT,
      avatar TEXT,
      text TEXT,
      media TEXT,
      mediaType TEXT,
      time TEXT
    )
  `);

  db.run(`CREATE TABLE IF NOT EXISTS likes (postId TEXT, username TEXT)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS unread_counts (
      username TEXT,
      chatId TEXT,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (username, chatId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      postId TEXT,
      username TEXT,
      avatar TEXT,
      text TEXT,
      time TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      username TEXT,
      text TEXT,
      time TEXT,
      readed TEXT DEFAULT 'false'
    )
  `);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "ARCAIDRON", time: dataHoraBrasil() });
});

app.post("/api/upload-avatar", (req, res) => {
  const { token, imageData } = req.body;
  const username = tokenToUser[token];
  if (!username || !imageData) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  db.run(
    "UPDATE users SET avatarUrl=? WHERE LOWER(username)=LOWER(?)",
    [imageData, username],
    (err) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ avatarUrl: imageData });
    }
  );
});

app.get("/api/me", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const username = tokenToUser[token];
  if (!username) return res.status(401).json({ error: "Not authenticated" });
  db.get("SELECT * FROM users WHERE LOWER(username)=LOWER(?)", [username], (err, row) => {
    if (!row) return res.status(404).json({ error: "User not found" });
    res.json({
      username: row.username,
      displayName: row.displayName || row.username,
      avatarUrl: row.avatarUrl || null,
      bio: row.bio || "",
      status: row.status || "Disponível"
    });
  });
});

function enviarFeed(target) {
  db.all("SELECT * FROM posts ORDER BY rowid DESC", [], (err, posts) => {
    if (err) return;
    db.all("SELECT * FROM likes", [], (err2, likes) => {
      if (err2) return;
      db.all("SELECT * FROM comments", [], (err3, comments) => {
        if (err3) return;
        const feed = (posts || []).map(post => ({
          ...post,
          likes: (likes || []).filter(l => l.postId === post.id).length,
          comments: (comments || []).filter(c => c.postId === post.id)
        }));
        target.emit("feed_update", feed);
      });
    });
  });
}

function criarNotificacao(username, text) {
  if (!username || !text) return;
  db.run(
    "INSERT INTO notifications (id,username,text,time,readed) VALUES (?,?,?,?,?)",
    [uuidv4(), username, text, dataHoraBrasil(), "false"]
  );
}

setInterval(() => {
  Object.keys(userLastSeen).forEach(username => {
    if (Date.now() - userLastSeen[username] > 60000) {
      delete onlineUsers[username];
      delete userSockets[username];
    }
  });
}, 10000);

io.on("connection", socket => {
  socket.emit("server_ready", { ok: true, message: "ARCAIDRON conectado" });

  socket.on("auth_token", ({ token }) => {
    const username = tokenToUser[token];
    if (!username) {
      socket.emit("token_invalid");
      return;
    }
    db.get("SELECT * FROM users WHERE LOWER(username)=LOWER(?)", [username], (err, row) => {
      if (!row) { socket.emit("token_invalid"); return; }
      marcarOnline(socket, row.username, row.avatarUrl || null);
      socket.emit("login_ok", {
        username: row.username,
        displayName: row.displayName || row.username,
        avatarUrl: row.avatarUrl || null,
        bio: row.bio || "",
        status: row.status || "Disponível",
        token
      });
      enviarFeed(socket);
    });
  });

  socket.on("heartbeat", () => {
    if (!socket.username) return;
    const key = normalize(socket.username);
    onlineUsers[key] = true;
    userLastSeen[key] = Date.now();
    userSockets[key] = socket.id;
  });

  socket.on("create_account", ({ username, password, avatar, avatarUrl }) => {
    username = safeText(username);
    password = safeText(password);
    avatar = avatar || "👤";
    if (!username || !password) { emitError(socket, "Digite nome e senha."); return; }

    db.get("SELECT * FROM users WHERE LOWER(username)=LOWER(?)", [username], (err, row) => {
      if (err) { emitError(socket, "Erro no banco de dados."); return; }
      if (row) { emitError(socket, "Usuário já existe. Use Entrar."); return; }

      const hashedPw = hashPassword(password);
      db.run(
        "INSERT INTO users (username,password,avatar,avatarUrl,displayName,bio,status,createdAt) VALUES (?,?,?,?,?,?,?,?)",
        [username, hashedPw, avatar, avatarUrl || null, username, "", "Disponível", dataHoraBrasil()],
        (err2) => {
          if (err2) {
            const legacyPw = password;
            db.run(
              "INSERT INTO users (username,password,avatar,avatarUrl,displayName,bio,status,createdAt) VALUES (?,?,?,?,?,?,?,?)",
              [username, legacyPw, avatar, avatarUrl || null, username, "", "Disponível", dataHoraBrasil()],
              (err3) => {
                if (err3) { emitError(socket, "Erro ao criar conta."); return; }
                loginSuccess(socket, username, avatar, avatarUrl, "");
              }
            );
            return;
          }
          loginSuccess(socket, username, avatar, avatarUrl, "");
        }
      );
    });
  });

  socket.on("login", ({ username, password }) => {
    username = safeText(username);
    password = safeText(password);
    if (!username || !password) { emitError(socket, "Digite nome e senha."); return; }

    const hashedPw = hashPassword(password);
    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND (password=? OR password=?)",
      [username, hashedPw, password],
      (err, row) => {
        if (err) { emitError(socket, "Erro no banco de dados."); return; }
        if (!row) { emitError(socket, "Login inválido. Verifique nome e senha."); return; }

        if (row.password === password && row.password !== hashedPw) {
          db.run("UPDATE users SET password=? WHERE username=?", [hashedPw, row.username]);
        }

        loginSuccess(socket, row.username, row.avatar || "👤", row.avatarUrl || null, row.bio || "");
      }
    );
  });

  function loginSuccess(socket, username, avatar, avatarUrl, bio) {
    marcarOnline(socket, username, avatarUrl);
    const token = generateToken(username);
    tokenToUser[token] = username;
    socket.emit("login_ok", {
      username,
      displayName: username,
      avatarUrl,
      avatar,
      bio,
      status: "Disponível",
      token
    });
    enviarFeed(socket);
  }

  socket.on("update_profile", ({ bio, status, displayName, avatarUrl }) => {
    if (!socket.username) return;
    db.run(
      "UPDATE users SET bio=?, status=?, displayName=?, avatarUrl=? WHERE username=?",
      [safeText(bio), safeText(status) || "Disponível", safeText(displayName) || socket.username, avatarUrl || null, socket.username],
      () => {
        socket.avatarUrl = avatarUrl || null;
        socket.emit("profile_updated", {
          bio: safeText(bio),
          status: safeText(status) || "Disponível",
          displayName: safeText(displayName) || socket.username,
          avatarUrl: avatarUrl || null
        });
      }
    );
  });

  socket.on("open_private_chat", ({ otherUser, key }) => {
    if (!socket.username) { emitError(socket, "Você precisa entrar primeiro."); return; }
    otherUser = safeText(otherUser);
    key = safeText(key);
    if (!otherUser || !key) { emitError(socket, "Digite usuário e chave."); return; }
    if (normalize(otherUser) === normalize(socket.username)) {
      emitError(socket, "Digite o nome da outra pessoa, não o seu.");
      return;
    }

    const chatId = criarChatId(socket.username, otherUser, key);
    socket.join(chatId);
    socket.currentChat = chatId;
    socket.currentOtherUser = otherUser;

    // Reset unread count for this user when they open the chat
    db.run(
      "DELETE FROM unread_counts WHERE username=? AND chatId=?",
      [normalize(socket.username), chatId],
      () => { socket.emit("unread_update", { chatId, count: 0 }); }
    );

    db.all(
      "SELECT m.*, u.avatarUrl as senderAvatarUrl FROM messages m LEFT JOIN users u ON LOWER(m.username)=LOWER(u.username) WHERE m.chatId=? AND m.deleted!='true' ORDER BY m.rowid ASC",
      [chatId],
      (err, rows) => {
        socket.emit("chat_opened", {
          chatId,
          otherUser,
          messages: rows || []
        });
      }
    );
  });

  socket.on("send_message", data => {
    if (!socket.currentChat) { emitError(socket, "Abra conversa primeiro."); return; }
    const msg = {
      id: uuidv4(),
      chatId: socket.currentChat,
      username: socket.username,
      avatar: socket.avatar || "👤",
      avatarUrl: socket.avatarUrl || null,
      type: data.type || "text",
      text: data.text || "",
      media: data.media || "",
      time: horaBrasil(),
      seenBy: "",
      replyTo: data.replyTo || "",
      deleted: "false"
    };

    db.run(
      "INSERT INTO messages (id,chatId,username,avatar,avatarUrl,type,text,media,time,seenBy,replyTo,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [msg.id, msg.chatId, msg.username, msg.avatar, msg.avatarUrl, msg.type, msg.text, msg.media, msg.time, msg.seenBy, msg.replyTo, msg.deleted],
      () => {
        io.to(socket.currentChat).emit("new_message", msg);

        // Increment unread count for the other user if they're not in this chat right now
        const otherUser = socket.currentOtherUser;
        if (otherUser) {
          const otherKey = normalize(otherUser);
          const otherSocketId = userSockets[otherKey];
          const otherSock = otherSocketId ? io.sockets.sockets.get(otherSocketId) : null;
          const otherIsHere = otherSock && otherSock.currentChat === socket.currentChat;

          if (!otherIsHere) {
            db.run(
              `INSERT INTO unread_counts (username, chatId, count) VALUES (?, ?, 1)
               ON CONFLICT(username, chatId) DO UPDATE SET count = count + 1`,
              [otherKey, socket.currentChat],
              () => {
                if (otherSock) {
                  db.get(
                    "SELECT count FROM unread_counts WHERE username=? AND chatId=?",
                    [otherKey, socket.currentChat],
                    (err, row) => {
                      if (row) otherSock.emit("unread_update", { chatId: socket.currentChat, count: row.count });
                    }
                  );
                }
              }
            );
            criarNotificacao(otherUser, socket.username + " enviou uma mensagem.");
          }
        }
      }
    );
  });

  socket.on("delete_message", ({ id }) => {
    if (!id) return;
    db.get("SELECT * FROM messages WHERE id=?", [id], (err, msg) => {
      if (err || !msg) return;
      db.run("UPDATE messages SET deleted='true' WHERE id=?", [id], () => {
        io.to(msg.chatId).emit("remove_message", id);
      });
    });
  });

  socket.on("clear_chat", () => {
    if (!socket.currentChat) return;
    db.run("UPDATE messages SET deleted='true' WHERE chatId=?", [socket.currentChat], () => {
      io.to(socket.currentChat).emit("chat_cleared");
    });
  });

  socket.on("mark_seen", ({ id }) => {
    if (!socket.currentChat || !socket.username) return;
    db.get("SELECT * FROM messages WHERE id=? AND chatId=?", [id, socket.currentChat], (err, msg) => {
      if (!msg || msg.username === socket.username) return;
      db.run("UPDATE messages SET seenBy=? WHERE id=?", [socket.username, id], () => {
        io.to(socket.currentChat).emit("message_seen", { id, seenBy: socket.username });
      });
    });
  });

  socket.on("typing", () => {
    if (!socket.currentChat) return;
    socket.to(socket.currentChat).emit("typing", socket.username + " está digitando...");
  });

  socket.on("create_post", ({ text, media, mediaType }) => {
    if (!socket.username) return;
    const post = {
      id: uuidv4(),
      username: socket.username,
      avatar: socket.avatar || "👤",
      text: safeText(text),
      media: media || "",
      mediaType: mediaType || "text",
      time: dataHoraBrasil()
    };
    db.run(
      "INSERT INTO posts (id,username,avatar,text,media,mediaType,time) VALUES (?,?,?,?,?,?,?)",
      [post.id, post.username, post.avatar, post.text, post.media, post.mediaType, post.time],
      () => { enviarFeed(io); }
    );
  });

  socket.on("like_post", ({ postId }) => {
    if (!socket.username) return;
    db.get("SELECT * FROM likes WHERE postId=? AND username=?", [postId, socket.username], (err, row) => {
      if (row) {
        db.run("DELETE FROM likes WHERE postId=? AND username=?", [postId, socket.username], () => { enviarFeed(io); });
      } else {
        db.run("INSERT INTO likes (postId,username) VALUES (?,?)", [postId, socket.username], () => { enviarFeed(io); });
      }
    });
  });

  socket.on("comment_post", ({ postId, text }) => {
    if (!socket.username || !safeText(text)) return;
    const comment = {
      id: uuidv4(), postId,
      username: socket.username, avatar: socket.avatar || "👤",
      text: safeText(text), time: horaBrasil()
    };
    db.run(
      "INSERT INTO comments (id,postId,username,avatar,text,time) VALUES (?,?,?,?,?,?)",
      [comment.id, comment.postId, comment.username, comment.avatar, comment.text, comment.time],
      () => { enviarFeed(io); }
    );
  });

  socket.on("get_feed", () => { enviarFeed(socket); });

  socket.on("get_unread_counts", () => {
    if (!socket.username) return;
    db.all(
      "SELECT chatId, count FROM unread_counts WHERE username=?",
      [normalize(socket.username)],
      (err, rows) => {
        const counts = {};
        (rows || []).forEach(r => { counts[r.chatId] = r.count; });
        socket.emit("unread_counts", counts);
      }
    );
  });

  socket.on("call-user", data => {
    if (!socket.currentChat) return;
    socket.to(socket.currentChat).emit("call-made", data);
  });

  socket.on("make-answer", data => {
    if (!socket.currentChat) return;
    socket.to(socket.currentChat).emit("answer-made", data);
  });

  socket.on("ice-candidate", data => {
    if (!socket.currentChat) return;
    socket.to(socket.currentChat).emit("ice-candidate", data.candidate);
  });

  socket.on("end-call", () => {
    if (!socket.currentChat) return;
    socket.to(socket.currentChat).emit("call-ended");
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      const key = normalize(socket.username);
      userLastSeen[key] = Date.now();
      setTimeout(() => {
        if (Date.now() - userLastSeen[key] > 60000) {
          delete onlineUsers[key];
          delete userSockets[key];
        }
      }, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("ARCAIDRON rodando na porta " + PORT);
});
