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
  html.includes("async function arcaHydrateContactFromServer"),
  "old Android/local contacts must be completed from /api/list-friends before opening",
);
assert(
  html.includes("function arcaAccountKey()") &&
    html.includes('"arcaidron_invite_contacts_" + arcaAccountKey()'),
  "local contacts must be scoped by unique userId, not by similar usernames",
);
assert(
  html.includes('"arcaidron_secure_vault_" + arcaAccountKey()') &&
    html.includes('"arcaidron_local_messages_" +\n          arcaAccountKey()'),
  "vault and local messages must be scoped by unique userId",
);
assert(
  html.includes("roomId: item.roomId || \"\"") &&
    html.includes("userId: item.userId || \"\""),
  "vault contacts must preserve roomId and userId when moved from normal contacts",
);
assert(
  html.includes("const canonicalIdentity = targetId || source.userId || stored.userId || target") &&
    html.includes("createInviteAutoKey(canonicalIdentity)"),
  "messages must use the same canonical encryption key on both ID-pair sides",
);
assert(
  html.includes("async function removeContactEverywhere") &&
    html.includes("vaultEntries = vaultEntries.filter"),
  "deleting a contact must remove it from chat list, hidden list, and vault cache",
);
assert(
  html.includes("#sendBtn::before") &&
    html.includes("content: none !important"),
  "conversation icons must suppress old pseudo-icons behind modern SVGs",
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
  server.includes('app.post("/api/accept-invite", auth, async') &&
    !server.includes('error: "Pedido de amizade'),
  "accepting/opening from the receiver side must not depend on a pending in-memory invite",
);
assert(
  server.includes("roomId: room.roomId"),
  "send-invite/open-chat responses must include the stable roomId",
);
assert(
  !html.includes('toast("Abra a Pasta Segura primeiro.")'),
  "accepting a friendship must not require unlocking the private vault",
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
