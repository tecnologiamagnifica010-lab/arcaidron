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

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT
    )
  `);

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
      seenBy TEXT DEFAULT ''
    )
  `);

  db.run("ALTER TABLE messages ADD COLUMN seenBy TEXT DEFAULT ''", () => {});

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
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

function atualizarUsuarios() {
  db.all("SELECT username, avatar FROM users", [], (err, rows) => {
    const lista = (rows || []).map(user => ({
      name: user.username,
      avatar: user.avatar || "👤",
      online: !!onlineUsers[user.username.toLowerCase()]
    }));

    io.emit("users_list", lista);
  });
}

function enviarFeed(target) {
  db.all("SELECT * FROM posts ORDER BY rowid DESC", [], (err, posts) => {
    db.all("SELECT * FROM likes", [], (err2, likes) => {
      db.all("SELECT * FROM comments", [], (err3, comments) => {
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

io.on("connection", socket => {
  socket.on("create_account", ({ username, password, avatar }) => {
    username = (username || "").trim();

    if (!username || !password) {
      socket.emit("error_msg", "Digite nome e senha.");
      return;
    }

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?)",
      [username],
      (err, row) => {
        if (row) {
          socket.emit("error_msg", "Usuário já existe.");
          return;
        }

        db.run(
          "INSERT INTO users (username,password,avatar) VALUES (?,?,?)",
          [username, password, avatar || "👤"],
          () => {
            socket.username = username;
            socket.avatar = avatar || "👤";
            onlineUsers[username.toLowerCase()] = true;

            socket.emit("login_ok", {
              username,
              avatar: socket.avatar
            });

            atualizarUsuarios();
            enviarFeed(socket);
          }
        );
      }
    );
  });

  socket.on("login", ({ username, password }) => {
    username = (username || "").trim();

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND password=?",
      [username, password],
      (err, row) => {
        if (!row) {
          socket.emit("error_msg", "Login inválido.");
          return;
        }

        socket.username = row.username;
        socket.avatar = row.avatar || "👤";
        onlineUsers[row.username.toLowerCase()] = true;

        socket.emit("login_ok", {
          username: row.username,
          avatar: socket.avatar
        });

        atualizarUsuarios();
        enviarFeed(socket);
      }
    );
  });

  socket.on("get_users", () => {
    atualizarUsuarios();
  });

  socket.on("open_private_chat", ({ otherUser, key }) => {
    if (!socket.username) return;

    otherUser = (otherUser || "").trim();
    key = (key || "").trim();

    if (!otherUser || !key) {
      socket.emit("error_msg", "Digite usuário e chave.");
      return;
    }

    db.get(
      "SELECT * FROM users WHERE LOWER(username)=LOWER(?)",
      [otherUser],
      (err, row) => {
        if (!row) {
          socket.emit("error_msg", "Usuário não encontrado.");
          return;
        }

        const chatId =
          [socket.username.toLowerCase(), row.username.toLowerCase()]
            .sort()
            .join("__") + "__" + key;

        socket.join(chatId);
        socket.currentChat = chatId;

        db.all(
          "SELECT * FROM messages WHERE chatId=?",
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
      socket.emit("error_msg", "Abra conversa primeiro.");
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
      seenBy: ""
    };

    db.run(
      `
      INSERT INTO messages
      (id,chatId,username,avatar,type,text,media,time,seenBy)
      VALUES (?,?,?,?,?,?,?,?,?)
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
        msg.seenBy
      ],
      () => {
        io.to(socket.currentChat).emit("new_message", msg);
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

  socket.on("view_message", ({ id }) => {
    if (!socket.currentChat) return;

    db.run(
      "DELETE FROM messages WHERE id=? AND chatId=?",
      [id, socket.currentChat],
      () => {
        io.to(socket.currentChat).emit("remove_message", id);
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
      text: text || "",
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
      () => enviarFeed(io)
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
            () => enviarFeed(io)
          );
        } else {
          db.run(
            "INSERT INTO likes (postId,username) VALUES (?,?)",
            [postId, socket.username],
            () => enviarFeed(io)
          );
        }
      }
    );
  });

  socket.on("comment_post", ({ postId, text }) => {
    if (!socket.username || !text) return;

    const comment = {
      id: uuidv4(),
      postId,
      username: socket.username,
      avatar: socket.avatar || "👤",
      text,
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
      () => enviarFeed(io)
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
      delete onlineUsers[socket.username.toLowerCase()];
      atualizarUsuarios();
    }
  });
});

server.listen(3000, () => {
  console.log("ARCAIDRON rodando na porta 3000");
});
