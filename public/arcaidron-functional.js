(function () {
  if (window.__arcaidronFunctionalLoaded) return;
  window.__arcaidronFunctionalLoaded = true;

  const style = document.createElement("style");
  style.textContent = `
    .arcaSwitchRow{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;padding:14px;border:1px solid rgba(35,72,110,.78);border-radius:13px;background:linear-gradient(145deg,#071b33,#061224);color:#f7fbff;text-align:left}
    .arcaSwitchRow strong,.arcaChoice strong{display:block;color:#f7fbff}.arcaSwitchRow small,.arcaChoice small{color:#8fa7c1}
    .arcaToggle{width:50px;height:28px;border:1px solid rgba(74,119,160,.7);border-radius:999px;background:#07101e;position:relative}
    .arcaToggle:after{content:"";position:absolute;width:22px;height:22px;top:2px;left:3px;border-radius:50%;background:#8fa7c1;transition:.18s ease}
    .arcaToggle.active{background:linear-gradient(135deg,#4639ff,#087fff)}.arcaToggle.active:after{left:23px;background:white}
    .arcaChoiceGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .arcaChoice{min-height:74px;border:1px solid rgba(35,72,110,.78);border-radius:13px;background:linear-gradient(145deg,#071b33,#061224);color:#f7fbff;text-align:left;padding:12px}
    .arcaChoice.active{border-color:#008cff;box-shadow:0 0 24px rgba(0,140,255,.28)}
    body.arca-theme-orange{--arca-blue:#ff7a00;--arca-purple:#ff3d00}
    body.arca-theme-red{--arca-blue:#ff1744;--arca-purple:#9f1239}
    body.arca-theme-brazil{--arca-blue:#009b3a;--arca-purple:#ffdf00}
    body.arca-theme-flamengo{--arca-blue:#e30613;--arca-purple:#111}
    body.arca-theme-corinthians{--arca-blue:#f7fbff;--arca-purple:#111}
    body.arca-theme-palmeiras{--arca-blue:#006437;--arca-purple:#00a859}
    body.arca-theme-santos{--arca-blue:#f7fbff;--arca-purple:#111}
    body.arca-theme-light #authScreen,body.arca-theme-light #appScreen,body.arca-theme-light #arcaUtilityOverlay{background:linear-gradient(180deg,#f7fbff,#dfeeff)!important;color:#07111f!important}
    body.arca-theme-orange .logo,body.arca-theme-red .logo,body.arca-theme-brazil .logo,body.arca-theme-flamengo .logo,body.arca-theme-corinthians .logo,body.arca-theme-palmeiras .logo,body.arca-theme-santos .logo{background:linear-gradient(150deg,var(--arca-blue),#06132b 58%,var(--arca-purple))!important}
    .arca-modern-icon{display:grid!important;place-items:center!important}
    .arca-modern-icon:before,.arca-modern-icon:after{content:none!important}
    .arca-modern-icon svg{width:58%!important;height:58%!important;stroke:currentColor!important;fill:none!important;stroke-width:2.35!important;stroke-linecap:round!important;stroke-linejoin:round!important}
    #sendBtn.arca-modern-icon svg{width:64%!important;height:64%!important}
  `;
  document.head.appendChild(style);

  const S = {
    hideSeen: "arcaidron_hide_seen",
    hideOnline: "arcaidron_hide_online",
    tempMessages: "arcaidron_temp_messages",
    notifications: "arcaidron_notifications",
    sound: "arcaidron_sound",
    vibration: "arcaidron_vibration",
    theme: "arcaidron_theme",
    language: "arcaidron_language",
    blocked: "arcaidron_blocked_contacts",
    hiddenName: "arcaidron_hidden_name_contacts",
    hiddenPhoto: "arcaidron_hidden_photo_contacts",
    callLog: "arcaidron_call_log"
  };

  function $(id) { return document.getElementById(id); }
  function safe(text) {
    return String(text || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
  }
  function clean(name) {
    if (typeof cleanUsername === "function") return cleanUsername(name);
    return String(name || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 32);
  }
  function readList(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
  function writeList(key, list) { localStorage.setItem(key, JSON.stringify(list || [])); }
  function isOn(key, fallback) {
    const value = localStorage.getItem(key);
    if (value === null) return !!fallback;
    return value === "1";
  }
  function setOn(key, value) { localStorage.setItem(key, value ? "1" : "0"); }
  function contacts() { try { return loadInviteContacts(); } catch { return []; } }
  function vaultContacts() {
    try {
      return typeof window.arcaGetVaultContactsForChat === "function"
        ? window.arcaGetVaultContactsForChat()
        : [];
    } catch {
      return [];
    }
  }
  function vaultNeedsUnlock() {
    try {
      return typeof window.arcaVaultNeedsUnlockForChat === "function" && window.arcaVaultNeedsUnlockForChat();
    } catch {
      return false;
    }
  }
  function me() { return localStorage.getItem("arcaidron_username") || window.currentUser || "ARCAIDRON"; }
  function myId() { return localStorage.getItem("arcaidron_userid") || window.currentUserId || "gerando"; }
  function peer() {
    return window.peerUser ||
      document.querySelector("#chatTitle")?.textContent?.trim() ||
      document.querySelector(".chatUserName")?.textContent?.trim() ||
      "Contato";
  }
  const arcaIcons = {
    voiceBtn: '<svg viewBox="0 0 24 24"><path d="M7.2 4.3c1.1 4.9 4 8.4 8.6 10.5"/><path d="M6.8 4.2l2.7-1.1 2 4.4-1.9 1.2"/><path d="M15.7 14.7l1.1-2 4.2 2.2-1.2 2.7c-.5 1.1-1.7 1.7-2.8 1.3C10.5 17 6.6 13.1 4.9 7c-.3-1.1.3-2.3 1.4-2.8z"/></svg>',
    videoBtn: '<svg viewBox="0 0 24 24"><rect x="4" y="6.5" width="11" height="11" rx="3"/><path d="M15 10.2l5-2.7v9l-5-2.7"/><path d="M8 10h3"/><path d="M9.5 8.5v3"/></svg>',
    clearBtn: '<svg viewBox="0 0 24 24"><path d="M6.5 7.5h11"/><path d="M9 7.5V5.2h6v2.3"/><path d="M8 10l.7 8.2c.1 1 1 1.8 2 1.8h2.6c1 0 1.9-.8 2-1.8L16 10"/><path d="M10.5 12.4v4.3"/><path d="M13.5 12.4v4.3"/></svg>',
    clipBtn: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/><path d="M7.5 7.5l9 9"/><path d="M16.5 7.5l-9 9"/></svg>',
    sendBtn: '<svg viewBox="0 0 24 24"><path d="M4 12h12"/><path d="M13 6l6 6-6 6"/><path d="M5 5l14 7-14 7 3-7z"/></svg>'
  };
  function arcaApplyModernIcons() {
    Object.keys(arcaIcons).forEach((id) => {
      const button = $(id);
      if (!button || button.dataset.arcaIconReady === "1") return;
      button.dataset.arcaIconReady = "1";
      button.classList.add("arca-modern-icon");
      button.innerHTML = arcaIcons[id];
      if (id === "clipBtn") button.title = "Adicionar item seguro";
      if (id === "sendBtn") button.title = "Enviar pulso seguro";
      if (id === "clearBtn") button.title = "Apagar mensagens";
    });
  }
  function show(title, html) {
    const overlay = $("arcaUtilityOverlay");
    const titleEl = $("arcaUtilityTitle");
    const content = $("arcaUtilityContent");
    if (!overlay || !titleEl || !content) return;
    overlay.classList.remove("hidden");
    titleEl.textContent = title;
    content.innerHTML = html;
  }
  function row(icon, title, sub, extra) {
    return `<div class="arcaUtilityRow"><div class="arcaUtilityRowIcon">${icon}</div><div><strong>${safe(title)}</strong><small>${safe(sub)}</small></div><div class="small">${extra || ""}</div></div>`;
  }
  function switchRow(label, sub, key, fn) {
    return `<button class="arcaSwitchRow" type="button" onclick="${fn}"><span><strong>${safe(label)}</strong><small>${safe(sub)}</small></span><span class="arcaToggle ${isOn(key) ? "active" : ""}"></span></button>`;
  }
  function contactSwitch(key, fn) {
    const list = contacts();
    if (!list.length) return '<div class="safeItem">Nenhum contato salvo ainda.</div>';
    const selected = readList(key);
    return list.map((item) => {
      const user = clean(item.username);
      return `<button class="arcaSwitchRow" type="button" onclick="${fn}('${user}')"><span><strong>${safe(item.label || user)}</strong><small>@${safe(user)}</small></span><span class="arcaToggle ${selected.includes(user) ? "active" : ""}"></span></button>`;
    }).join("");
  }
  function toggleList(key, username) {
    const user = clean(username);
    const list = readList(key);
    writeList(key, list.includes(user) ? list.filter((item) => item !== user) : [...list, user]);
  }
  function blocked(username) { return readList(S.blocked).includes(clean(username)); }

  window.arcaIsBlocked = blocked;
  window.arcaToggleSetting = async function (key, refresh) {
    const next = !isOn(key);
    setOn(key, next);
    if (key === S.hideOnline && typeof api === "function") {
      try { await api("/api/privacy-online", { hidden: next }); } catch {}
    }
    if (refresh && window[refresh]) window[refresh]();
  };
  window.arcaToggleBlocked = function (user) { toggleList(S.blocked, user); arcaOpenPrivacySettings(); };
  window.arcaToggleHiddenName = function (user) { toggleList(S.hiddenName, user); arcaOpenPrivacySettings(); };
  window.arcaToggleHiddenPhoto = function (user) { toggleList(S.hiddenPhoto, user); arcaOpenPrivacySettings(); };

  window.arcaOpenAccountSettings = function () {
    show("Conta", `<div class="arcaUtilityCenter"><div class="arcaHeroShield"></div><h3>${safe(me())}</h3><p>ID seguro: ${safe(myId())}</p><p>O ARCAIDRON usa ID unico, salas privadas por par de IDs e criptografia no navegador para reduzir exposicao de dados.</p><button class="btn full" onclick="copyMyId()">Copiar meu ID</button><button class="btn full dark" onclick="$('profilePhotoInput').click()">Atualizar foto</button></div>`);
  };
  window.arcaOpenPrivacySettings = function () {
    show("Privacidade", `<div class="arcaUtilityList">
      ${switchRow("Ocultar online", "Seu status aparece como offline.", S.hideOnline, `arcaToggleSetting('${S.hideOnline}','arcaOpenPrivacySettings')`)}
      ${switchRow("Ocultar dois vistos", "Recebidas ficam sem confirmacao azul.", S.hideSeen, `arcaToggleSetting('${S.hideSeen}','arcaOpenPrivacySettings')`)}
      ${switchRow("Mensagens temporarias", "Autodestruicao local em 24 horas.", S.tempMessages, `arcaToggleSetting('${S.tempMessages}','arcaOpenPrivacySettings')`)}
      <div class="safeItem"><b>Bloqueios</b><br><span class="small">Bloqueados nao abrem conversa neste aparelho.</span></div>${contactSwitch(S.blocked, "arcaToggleBlocked")}
      <div class="safeItem"><b>Ocultar meu nome destes contatos</b></div>${contactSwitch(S.hiddenName, "arcaToggleHiddenName")}
      <div class="safeItem"><b>Ocultar minha foto destes contatos</b></div>${contactSwitch(S.hiddenPhoto, "arcaToggleHiddenPhoto")}
    </div>`);
  };
  window.arcaOpenNotificationSettings = function () {
    show("Notificacoes", `<div class="arcaUtilityList">
      ${switchRow("Alertas", "Aviso visual para mensagens.", S.notifications, `arcaToggleSetting('${S.notifications}','arcaOpenNotificationSettings')`)}
      ${switchRow("Som", "Sons locais para chamadas e mensagens.", S.sound, `arcaToggleSetting('${S.sound}','arcaOpenNotificationSettings')`)}
      ${switchRow("Vibracao", "Vibra quando o aparelho permitir.", S.vibration, `arcaToggleSetting('${S.vibration}','arcaOpenNotificationSettings')`)}
    </div>`);
  };
  window.arcaApplyTheme = function () {
    if (!document.body) return;
    const theme = localStorage.getItem(S.theme) || "dark";
    document.body.className = document.body.className.split(/\s+/).filter((name) => !name.startsWith("arca-theme-")).join(" ");
    document.body.classList.add("arca-theme-" + theme);
  };
  window.arcaSetTheme = function (theme) { localStorage.setItem(S.theme, theme); arcaApplyTheme(); arcaOpenAppearanceSettings(); };
  window.arcaOpenAppearanceSettings = function () {
    const theme = localStorage.getItem(S.theme) || "dark";
    const themes = [["dark", "Escuro", "Azul neon"], ["orange", "Laranja", "Energia quente"], ["light", "Branco", "Tema claro"], ["red", "Vermelho", "Alerta forte"], ["brazil", "Brasil", "Verde e amarelo"], ["flamengo", "Flamengo", "Rubro-negro"], ["corinthians", "Corinthians", "Preto e branco"], ["palmeiras", "Palmeiras", "Verde forte"], ["santos", "Santos", "Branco e preto"]];
    show("Aparencia", `<div class="arcaChoiceGrid">${themes.map((item) => `<button class="arcaChoice ${theme === item[0] ? "active" : ""}" onclick="arcaSetTheme('${item[0]}')"><strong>${item[1]}</strong><small>${item[2]}</small></button>`).join("")}</div>`);
  };
  window.arcaSetLanguage = function (lang) { localStorage.setItem(S.language, lang); arcaOpenLanguageSettings(); };
  window.arcaOpenLanguageSettings = function () {
    const lang = localStorage.getItem(S.language) || "pt";
    const langs = [["pt", "Portugues", "Brasil"], ["en", "English", "United States"], ["es", "Espanol", "Latinoamerica"], ["fr", "Francais", "France"], ["zh", "Chines", "China"]];
    show("Idioma", `<div class="arcaChoiceGrid">${langs.map((item) => `<button class="arcaChoice ${lang === item[0] ? "active" : ""}" onclick="arcaSetLanguage('${item[0]}')"><strong>${item[1]}</strong><small>${item[2]}</small></button>`).join("")}</div>`);
  };
  window.arcaOpenAbout = function () {
    show("Sobre o ARCAIDRON", '<div class="arcaUtilityCenter"><div class="arcaHeroShield"></div><h3>ARCAIDRON</h3><p>Rede privada segura para conversas por ID unico, salas exclusivas entre duas pessoas e mensagens protegidas por criptografia no navegador.</p><p>Objetivo: reduzir vazamento de dados, preservar historico local temporario e manter voz, video, arquivos e contatos dentro de uma experiencia privada.</p><p>Versao 1.0.0</p></div>');
  };
  function settingsMenu() {
    show("Configuracoes", `<div class="arcaUtilityList">
      <button class="arcaUtilityRow" onclick="arcaOpenAccountSettings()"><div class="arcaUtilityRowIcon">ID</div><div><strong>Conta</strong><small>Privacidade, seguranca e dados</small></div><div class="small">&gt;</div></button>
      <button class="arcaUtilityRow" onclick="arcaOpenPrivacySettings()"><div class="arcaUtilityRowIcon">PV</div><div><strong>Privacidade</strong><small>Bloqueios, vistos e mensagens temporarias</small></div><div class="small">&gt;</div></button>
      <button class="arcaUtilityRow" onclick="arcaOpenNotificationSettings()"><div class="arcaUtilityRowIcon">NT</div><div><strong>Notificacoes</strong><small>Sons, vibracoes e alertas</small></div><div class="small">&gt;</div></button>
      <button class="arcaUtilityRow" onclick="arcaOpenAppearanceSettings()"><div class="arcaUtilityRowIcon">TM</div><div><strong>Aparencia</strong><small>Tema, cores e papel de parede</small></div><div class="small">&gt;</div></button>
      <button class="arcaUtilityRow" onclick="arcaOpenLanguageSettings()"><div class="arcaUtilityRowIcon">LG</div><div><strong>Idioma</strong><small>Portugues, ingles, espanhol, frances e chines</small></div><div class="small">&gt;</div></button>
      <button class="arcaUtilityRow" onclick="arcaOpenAbout()"><div class="arcaUtilityRowIcon">?</div><div><strong>Sobre o ARCAIDRON</strong><small>Objetivo e versao</small></div><div class="small">&gt;</div></button>
    </div><button class="btn full dark" onclick="arcaLogoutFromMenu()" style="margin-top:16px">Entrar em outra conta</button>`);
  }
  async function conversations() {
    if (vaultNeedsUnlock()) {
      show("Bate-papo seguro", `<div class="arcaUtilityList">
        <div class="safeItem"><b>Cofre privado bloqueado</b><br><span class="small">Digite a senha mestra para mostrar tambem os contatos protegidos por ate 1 hora.</span></div>
        <input id="arcaVaultChatPass" class="input" type="password" placeholder="Senha mestra do cofre privado">
        <button class="btn full" onclick="arcaUnlockVaultFromChat()">Desbloquear e listar contatos</button>
        <button class="btn full dark" onclick="arcaShowChatListWithoutVault()">Ver apenas contatos comuns</button>
      </div>`);
      return;
    }

    return arcaShowChatListWithoutVault();
  }

  window.arcaUnlockVaultFromChat = async function () {
    const input = $("arcaVaultChatPass");
    const password = input ? input.value : "";

    if (!password) {
      toast("Digite a senha mestra.");
      return;
    }

    try {
      if (typeof window.arcaUnlockVaultForChat === "function") {
        await window.arcaUnlockVaultForChat(password);
      }
      toast("Cofre liberado por 1 hora.");
      arcaShowChatListWithoutVault();
    } catch {
      toast("Senha mestra incorreta.");
    }
  };

  window.arcaShowChatListWithoutVault = async function () {
    let online = [];
    try { online = ((await api("/api/online-users", {})).users || []); } catch {}
    const merged = [];
    const seen = new Set();
    [...online, ...contacts(), ...vaultContacts()].forEach((item) => {
      const user = clean(item.username);
      const identity = String(item.userId || user || "").trim();
      if (!identity || seen.has(identity)) return;
      seen.add(identity);
      merged.push({ ...item, username: user });
    });
    window.arcaUtilityChatItems = merged;
    show("Conversas", `<div class="arcaUtilityList">${merged.length ? merged.map((item, index) => `<button class="arcaUtilityRow" onclick="arcaOpenConversationByIndex(${index})"><div class="arcaUtilityRowIcon">${item.fromVault ? "CF" : "ON"}</div><div><strong>${safe(item.label || item.username)}</strong><small>${item.fromVault ? "Contato do cofre privado" : online.some((u) => clean(u.username) === item.username) ? "Online agora" : "Contato salvo"}</small></div><div class="small">Abrir</div></button>`).join("") : '<div class="safeItem">Nenhum contato online ou conversa salva agora.</div>'}</div>`);
  };
  window.arcaOpenConversationByIndex = async function (index) {
    const item = (window.arcaUtilityChatItems || [])[index];
    if (!item) return toast("Contato nao encontrado.");
    return window.arcaOpenConversationByName(item.userId || item.username, item.fromVault ? "vault" : "contact", item);
  };
  window.arcaOpenConversationByName = async function (username, source, contact) {
    const identity = String(username || "").trim();
    const cleanName = clean(contact?.username || username);
    if (cleanName && blocked(cleanName)) return toast("Contato bloqueado neste aparelho.");
    if (source === "vault" && cleanName && typeof window.arcaOpenVaultChatByUsername === "function") {
      const opened = await window.arcaOpenVaultChatByUsername(cleanName);
      if (opened) return;
    }
    if (!contacts().some((item) => String(item.userId || "") === identity || clean(item.username) === cleanName) && typeof saveInviteContactLocal === "function") {
      saveInviteContactLocal(contact || username);
    }
    $("arcaUtilityOverlay")?.classList.add("hidden");
    if (contact && typeof window.arcaOpenDirectChat === "function") {
      await window.arcaOpenDirectChat(contact);
      return;
    }
    if (identity.startsWith("arc_") && typeof openInviteContactByUserId === "function") {
      await openInviteContactByUserId(identity);
      return;
    }
    if (typeof openInviteContactByUsername === "function") {
      await openInviteContactByUsername(cleanName || username);
      return;
    }
    if (typeof window.arcaOpenDirectChat === "function") await window.arcaOpenDirectChat(username);
  };
  window.arcaOpenRequests = async function () {
    show("Solicitacoes", '<div class="safeItem">Carregando solicitacoes...</div>');
    try {
      const invites = ((await api("/api/list-invites", {})).invites || []);
      show("Solicitacoes", `<div class="arcaUtilityList">${invites.length ? invites.map((invite) => `<div class="arcaUtilityRow"><div class="arcaUtilityRowIcon">+</div><div><strong>${safe(invite.from)}</strong><small>Quer adicionar voce no ARCAIDRON</small></div><div><button class="btn dark" onclick="acceptInvite('${safe(invite.from)}'); arcaOpenRequests()">Aceitar</button></div></div>`).join("") : '<div class="safeItem">Nenhuma solicitacao pendente.</div>'}</div>`);
    } catch { show("Solicitacoes", '<div class="safeItem">Nao foi possivel carregar solicitacoes agora.</div>'); }
  };
  function callLog() { return readList(S.callLog); }
  function addCall(kind, username, video) {
    const log = callLog();
    log.unshift({ kind, username: username || window.peerUser || "Contato", video: !!video, at: Date.now() });
    writeList(S.callLog, log.slice(0, 80));
  }
  window.arcaRenderCalls = function (filter = "all") {
    const labels = { all: "Todas", missed: "Perdidas", received: "Recebidas", outgoing: "Realizadas" };
    let log = callLog();
    if (!log.length) log = contacts().map((item, i) => ({ kind: i % 2 ? "received" : "outgoing", username: item.username, video: i % 2 === 0, at: Date.now() - i * 86400000 }));
    const filtered = filter === "all" ? log : log.filter((item) => item.kind === filter);
    show("Chamadas", `<div class="tabs" style="margin-bottom:14px">${Object.keys(labels).map((key) => `<button class="${filter === key ? "active" : ""}" onclick="arcaRenderCalls('${key}')">${labels[key]}</button>`).join("")}</div><div class="arcaUtilityList">${filtered.length ? filtered.map((item) => row(item.video ? "VID" : "VOZ", item.username, item.video ? "Chamada de video" : "Chamada de voz", new Date(item.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))).join("") : '<div class="safeItem">Nenhuma chamada nesta categoria.</div>'}</div>`);
  };
  function picker(kind) {
    const input = $("fileInput");
    if (!input) return;
    input.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt";
    input.click();
  }
  window.arcaOpenFileLibrary = function (kind = "all") {
    const labels = { image: "Imagens", video: "Videos", audio: "Audios", doc: "Documentos" };
    show("Arquivos", `<div class="arcaUtilityGrid">${Object.keys(labels).map((key) => `<button class="arcaUtilityTile" onclick="arcaOpenFileLibrary('${key}')"><b>${labels[key]}</b><span>Abrir galeria</span></button>`).join("")}</div><p class="small">${labels[kind] || "Recentes"}</p><div class="arcaUtilityList"><button class="arcaUtilityRow" onclick="arcaPickFileType('${kind === "all" ? "image" : kind}')"><div class="arcaUtilityRowIcon">ARQ</div><div><strong>${kind === "video" ? "Selecionar video" : kind === "audio" ? "Selecionar audio" : kind === "doc" ? "Selecionar documento" : "Selecionar foto"}</strong><small>Abre somente este tipo de arquivo</small></div><div class="small">Abrir</div></button></div>`);
  };
  window.arcaPickFileType = function (kind) {
    if (typeof arcaCloseUtilityOverlay === "function") arcaCloseUtilityOverlay();
    picker(kind);
  };

  const oldUtility = window.arcaShowUtilityOverlay;
  window.arcaShowUtilityOverlay = function (section) {
    if (section === "settings") return settingsMenu();
    if (section === "calls") return arcaRenderCalls("all");
    if (section === "files") return arcaOpenFileLibrary("all");
    if (section === "chats") return conversations();
    if (oldUtility) return oldUtility(section);
  };

  const rawEmit = window.socket && window.socket.emit;
  function wire() {
    arcaApplyModernIcons();
    if (window.socket && window.socket.emit && window.socket.emit !== window.__arcaEmitWrapped) {
      const original = window.socket.emit.bind(window.socket);
      window.__arcaEmitWrapped = function (event, data, ack) {
        if (event === "message:seen" && isOn(S.hideSeen)) return;
        return original(event, data, ack);
      };
      window.socket.emit = window.__arcaEmitWrapped;
    }
    const req = $("arcaSolicTab");
    if (req) req.onclick = arcaOpenRequests;
    const voice = $("voiceBtn");
    if (voice && typeof startCall === "function") voice.onclick = () => { addCall("outgoing", peer(), false); startCall(false); };
    const video = $("videoBtn");
    if (video && typeof startCall === "function") video.onclick = () => { addCall("outgoing", peer(), true); startCall(true); };
    document.querySelectorAll(".arcaBottomNav button").forEach((button) => {
      if (button.dataset.arcaNav === "chats") button.onclick = conversations;
    });
  }
  arcaApplyTheme();
  arcaApplyModernIcons();
  setOn(S.notifications, isOn(S.notifications, true));
  setOn(S.sound, isOn(S.sound, true));
  setOn(S.vibration, isOn(S.vibration, true));
  setOn(S.tempMessages, isOn(S.tempMessages, true));
  document.addEventListener("DOMContentLoaded", wire);
  setInterval(wire, 1200);
})();
 
