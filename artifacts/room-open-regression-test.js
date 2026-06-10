const fs = require("fs");
const crypto = require("crypto");

const html = fs.readFileSync("index.html", "utf8");
const functional = fs.readFileSync("public/arcaidron-functional.js", "utf8");

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
  html.includes("openInviteContactByUsername('${escapeHtml(item.username)}')"),
  "conversation rows must open by username instead of filtered index",
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
  functional.includes("openInviteContactByUsername(username)"),
  "functional overlay must open chats by username",
);

const ab = createRoomIdByIds("arc_a", "arc_b");
const ba = createRoomIdByIds("arc_b", "arc_a");
const ac = createRoomIdByIds("arc_a", "arc_c");

assert(ab === ba, "room id must be stable for the same pair of IDs");
assert(ab !== ac, "room id must not leak between different contacts");

console.log("room-open regression ok");
