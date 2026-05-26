const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e8
});

app.use(express.static("public"));

const db = new sqlite3.Database("./arcaidron.db");

const onlineUsers = {};
const userLastSeen = {};
const userSockets = {};

function horaBrasil() {
  return new Date().toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dataHoraBrasil() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
}

function safeText(value) {
  return (value || "").toString().trim();
}

function normalize(value) {
  return safeText(value).toLowerCase();
}

function addColumn(table, column, definition) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, () => {});
}

function emitError(socket, message) {
  socket.emit("error_msg", message);
}

function criarChatId(userA, userB, key) {
  return [normalize(userA), normalize(userB)].sort().join("__") + "__" + key;
}

function marcarOnline(socket, username, avatar) {
  const key = normalize(username);

  socket.username = username;
  socket.avatar = avatar || "👤";

  onlineUsers[key] = true;
  userLastSeen[key] = Date.now();
  userSockets[key] = socket.id;

  atualizarUsuarios();
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT DEFAULT '👤',
      bio TEXT DEFAULT '',
      status TEXT DEFAULT 'Disponível',
      createdAt TEXT DEFAULT ''
    )
  `);

  addColumn("users", "avatar", "TEXT DEFAULT '👤'");
  addColumn("users", "bio", "TEXT DEFAULT ''");
  addColumn("users", "status", "TEXT DEFAULT 'Disponível'");
  addColumn("users", "createdAt", "TEXT DEFAULT ''");

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chatId TEXT,
      username TEXT,
      avatar TEXT,
      type TEXT,
      text TEXT,
      media TEXT,
      time TEXT,
      seenBy TEXT DEFAULT '',
      replyTo TEXT DEFAULT '',
      deleted TEXT DEFAULT 'false'
    )
  `);

  addColumn("messages", "seenBy", "TEXT DEFAULT ''");
  addColumn("messages", "replyTo", "TEXT DEFAULT ''");
  addColumn("messages", "deleted", "TEXT DEFAULT 'false'");

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

  db.run(`
    CREATE TABLE IF NOT EXISTS likes (
      postId TEXT,
      username TEXT
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
  res.sendFile(__dirname + "/public/index.html");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "ARCAIDRON",
    time: dataHoraBrasil()
  });
});

function atualizarUsuarios() {
  db.all(
    "SELECT username, avatar, bio, status FROM users ORDER BY username ASC",
    [],
    (err, rows) => {
      if (err) return;

      const lista = (rows || []).map(user => ({
        name: user.username,
        avatar: user.avatar || "👤",
        bio: user.bio || "",
        status: user.status || "Disponível",
        online: !!onlineUsers[normalize(user.username)]
      }));

      io.emit("users_list", lista);
    }
  );
}

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
    const ultimo = userLastSeen[username];

    if (Date.now() - ultimo > 60000) {
      delete onlineUsers[username];
      delete userSockets[username];
    }
  });

  atualizarUsuarios();
}, 10000);

io.on("connection", socket => {
  socket.emit("server_ready", {
    ok: true,
    message: "ARCAIDRON conectado"
  });

  socket.on("heartbeat", () => {
    if (!socket.username) return;

    const key = normalize(socket.username);

    onlineUsers[key] = true;
    userLastSeen[key] = Date.now();
    userSockets[key] = socket.id;

    atualizarUsuarios();
  });

  socket.on("create_account", ({ username, password, avatar }) => {
    username = safeText(username);
    password = safeText(password);
    avatar = avatar || "👤";

    if (!username || !password) {
      emitError(socket, "Digite nome e senha.");
      return;
    }

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?)",
      [username],
      (err, row) => {
        if (err) {
          emitError(socket, "Erro no banco de dados.");
          return;
        }

        if (row) {
          emitError(socket, "Usuário já existe. Use Entrar.");
          return;
        }

        db.run(
          `
          INSERT INTO users
          (username,password,avatar,bio,status,createdAt)
          VALUES (?,?,?,?,?,?)
          `,
          [
            username,
            password,
            avatar,
            "",
            "Disponível",
            dataHoraBrasil()
          ],
          err2 => {
            if (err2) {
              emitError(socket, "Erro ao criar conta.");
              return;
            }

            marcarOnline(socket, username, avatar);

            socket.emit("login_ok", {
              username,
              avatar,
              bio: "",
              status: "Disponível"
            });

            atualizarUsuarios();
            enviarFeed(socket);
          }
        );
      }
    );
  });

  socket.on("login", ({ username, password }) => {
    username = safeText(username);
    password = safeText(password);

    if (!username || !password) {
      emitError(socket, "Digite nome e senha.");
      return;
    }

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND password=?",
      [username, password],
      (err, row) => {
        if (err) {
          emitError(socket, "Erro no banco de dados.");
          return;
        }

        if (!row) {
          emitError(socket, "Login inválido. Se for novo, clique em Criar conta.");
          return;
        }

        marcarOnline(socket, row.username, row.avatar || "👤");

        socket.emit("login_ok", {
          username: row.username,
          avatar: row.avatar || "👤",
          bio: row.bio || "",
          status: row.status || "Disponível"
        });

        atualizarUsuarios();
        enviarFeed(socket);
      }
    );
  });

  socket.on("get_users", () => {
    atualizarUsuarios();
  });

  socket.on("update_profile", ({ bio, status }) => {
    if (!socket.username) return;

    db.run(
      "UPDATE users SET bio=?, status=? WHERE username=?",
      [
        safeText(bio),
        safeText(status) || "Disponível",
        socket.username
      ],
      () => {
        socket.emit("profile_updated", {
          bio: safeText(bio),
          status: safeText(status) || "Disponível"
        });

        atualizarUsuarios();
      }
    );
  });

  socket.on("open_private_chat", ({ otherUser, key }) => {
    if (!socket.username) {
      emitError(socket, "Você precisa entrar primeiro.");
      return;
    }

    otherUser = safeText(otherUser);
    key = safeText(key);

    if (!otherUser || !key) {
      emitError(socket, "Digite usuário e chave.");
      return;
    }

    if (normalize(otherUser) === normalize(socket.username)) {
      emitError(socket, "Digite o nome da outra pessoa, não o seu.");
      return;
    }

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?)",
      [otherUser],
      (err, row) => {
        if (err || !row) {
          emitError(socket, "Usuário não encontrado.");
          return;
        }

        const chatId = criarChatId(socket.username, row.username, key);

        socket.join(chatId);
        socket.currentChat = chatId;
        socket.currentOtherUser = row.username;

        db.all(
          "SELECT * FROM messages WHERE chatId=? AND deleted!='true'",
          [chatId],
          (err2, rows) => {
            socket.emit("chat_opened", {
              chatId,
              otherUser: row.username,
              messages: rows || []
            });
          }
        );
      }
    );
  });

  socket.on("send_message", data => {
    if (!socket.currentChat) {
      emitError(socket, "Abra conversa primeiro.");
      return;
    }

    const msg = {
      id: uuidv4(),
      chatId: socket.currentChat,
      username: socket.username,
      avatar: socket.avatar || "👤",
      type: data.type || "text",
      text: data.text || "",
      media: data.media || "",
      time: horaBrasil(),
      seenBy: "",
      replyTo: data.replyTo || "",
      deleted: "false"
    };

    db.run(
      `
      INSERT INTO messages
      (id,chatId,username,avatar,type,text,media,time,seenBy,replyTo,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `,
      [
        msg.id,
        msg.chatId,
        msg.username,
        msg.avatar,
        msg.type,
        msg.text,
        msg.media,
        msg.time,
        msg.seenBy,
        msg.replyTo,
        msg.deleted
      ],
      () => {
        io.to(socket.currentChat).emit("new_message", msg);

        if (msg.replyTo) {
          db.run(
            "UPDATE messages SET deleted='true' WHERE id=? AND chatId=?",
            [msg.replyTo, socket.currentChat],
            () => {
              io.to(socket.currentChat).emit("remove_message", msg.replyTo);
            }
          );
        }

        if (socket.currentOtherUser) {
          criarNotificacao(
            socket.currentOtherUser,
            socket.username + " enviou uma mensagem."
          );
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

    db.run(
      "UPDATE messages SET deleted='true' WHERE chatId=?",
      [socket.currentChat],
      () => {
        io.to(socket.currentChat).emit("chat_cleared");
      }
    );
  });

  socket.on("mark_seen", ({ id }) => {
    if (!socket.currentChat || !socket.username) return;

    db.get(
      "SELECT * FROM messages WHERE id=? AND chatId=?",
      [id, socket.currentChat],
      (err, msg) => {
        if (!msg) return;
        if (msg.username === socket.username) return;

        db.run(
          "UPDATE messages SET seenBy=? WHERE id=?",
          [socket.username, id],
          () => {
            io.to(socket.currentChat).emit("message_seen", {
              id,
              seenBy: socket.username
            });
          }
        );
      }
    );
  });

  socket.on("typing", () => {
    if (!socket.currentChat) return;

    socket.to(socket.currentChat).emit(
      "typing",
      socket.username + " está digitando..."
    );
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
      `
      INSERT INTO posts
      (id,username,avatar,text,media,mediaType,time)
      VALUES (?,?,?,?,?,?,?)
      `,
      [
        post.id,
        post.username,
        post.avatar,
        post.text,
        post.media,
        post.mediaType,
        post.time
      ],
      () => {
        enviarFeed(io);
      }
    );
  });

  socket.on("like_post", ({ postId }) => {
    if (!socket.username) return;

    db.get(
      "SELECT * FROM likes WHERE postId=? AND username=?",
      [postId, socket.username],
      (err, row) => {
        if (row) {
          db.run(
            "DELETE FROM likes WHERE postId=? AND username=?",
            [postId, socket.username],
            () => {
              enviarFeed(io);
            }
          );
        } else {
          db.run(
            "INSERT INTO likes (postId,username) VALUES (?,?)",
            [postId, socket.username],
            () => {
              enviarFeed(io);
            }
          );
        }
      }
    );
  });

  socket.on("comment_post", ({ postId, text }) => {
    if (!socket.username || !safeText(text)) return;

    const comment = {
      id: uuidv4(),
      postId,
      username: socket.username,
      avatar: socket.avatar || "👤",
      text: safeText(text),
      time: horaBrasil()
    };

    db.run(
      `
      INSERT INTO comments
      (id,postId,username,avatar,text,time)
      VALUES (?,?,?,?,?,?)
      `,
      [
        comment.id,
        comment.postId,
        comment.username,
        comment.avatar,
        comment.text,
        comment.time
      ],
      () => {
        enviarFeed(io);
      }
    );
  });

  socket.on("get_feed", () => {
    enviarFeed(socket);
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
        const ultimo = userLastSeen[key];

        if (Date.now() - ultimo > 60000) {
          delete onlineUsers[key];
          delete userSockets[key];
          atualizarUsuarios();
        }
      }, 60000);
    }
  });
});

server.listen(3000, () => {
  console.log("ARCAIDRON 2.0 rodando na porta 3000");
});