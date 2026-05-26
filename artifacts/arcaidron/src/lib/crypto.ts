function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createCryptoKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("ARCAIDRON"), iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(text: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await createCryptoKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text));
  return "ARCAIDRON_ENC:" + JSON.stringify({
    iv: bufferToBase64(iv),
    data: bufferToBase64(encrypted)
  });
}

export async function decryptText(payload: string, password: string): Promise<string> {
  try {
    if (!payload.startsWith("ARCAIDRON_ENC:")) return payload;
    const raw = payload.replace("ARCAIDRON_ENC:", "");
    const obj = JSON.parse(raw);
    const key = await createCryptoKey(password);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuffer(obj.iv) },
      key,
      base64ToBuffer(obj.data)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return "🔒 Mensagem protegida";
  }
}
