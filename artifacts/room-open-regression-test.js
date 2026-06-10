const fs = require("fs");
const crypto = require("crypto");

const html = fs.readFileSync("index.html", "utf8");
const functional = fs.readFileSync("public/arcaidron-functional.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createRoomIdByIds(id1, id2) {
  return crypto
    .createHash("sha256")
    .update("ARCAIDRON-ROOM::" + [id1, id2].sort().join("::"))
    .digest("hex");
}

assert(
  html.includes("async function arcaOpenDirectChat"),
  "index.html must expose the single direct chat opener",
);
assert(
  !html.includes("ARCAIDRON ABRIR SALA ROBUSTO"),
  "old open-chat button override must not replace the direct opener",
);
assert(
  html.includes("const cachedRoomId = source.roomId || stored.roomId || \"\""),
  "saved contacts with roomId must open the conversation view immediately",
);
assert(
  html.includes('onclick="openInviteContact(${index})"'),
  "conversation rows must open the saved contact object, not a username-only path",
);
assert(
  html.includes("return arcaOpenDirectChat(item);"),
  "legacy openInviteContact must delegate to the direct opener",
);
assert(
  html.includes("await arcaOpenDirectChat({"),
  "vault/manual open paths must use the direct opener",
);
assert(
  html.includes("async function openInviteContactByUserId"),
  "index.html must expose opening a contact by unique userId",
);
assert(
  functional.includes("arcaOpenConversationByIndex"),
  "functional overlay must open the saved contact object by index",
);
assert(
  server.includes("async function ensureFriendshipRoom"),
  "server must persist and rebuild rooms from the stable userId pair",
);
assert(
  server.includes('app.post("/api/send-invite", auth, async'),
  "adding a friend by ID must create the room before returning to the client",
);
assert(
  server.includes("roomId: room.roomId"),
  "send-invite/open-chat responses must include the stable roomId",
);
assert(
  server.includes("findUsernameByUserId(targetIdRaw)"),
  "open-chat must resolve the target by unique ID before username fallback",
);
assert(
  server.includes("await rebuildChatFromRoomId"),
  "socket events must rebuild missing in-memory rooms from persisted roomId",
);

const ab = createRoomIdByIds("arc_a", "arc_b");
const ba = createRoomIdByIds("arc_b", "arc_a");
const ac = createRoomIdByIds("arc_a", "arc_c");

assert(ab === ba, "room id must be stable for the same pair of IDs");
assert(ab !== ac, "room id must not leak between different contacts");

console.log("room-open regression ok");
