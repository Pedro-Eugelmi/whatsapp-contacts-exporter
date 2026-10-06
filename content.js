// Content script: roda dentro do WhatsApp Web e lê os dados que o próprio
// app já guarda no IndexedDB do navegador (banco "model-storage").
// Nada sai do seu computador.

(() => {
  if (window.__waExporterLoaded) return;
  window.__waExporterLoaded = true;

  const DB_NAME = 'model-storage';

  // ---------- Helpers de IndexedDB ----------

  async function dbExists() {
    // Evita criar um banco vazio por engano
    if (!indexedDB.databases) return true;
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === DB_NAME);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function readAll(db, storeName) {
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve([]);
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  function countStore(db, storeName) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(-1);
      } catch (e) {
        resolve(-1);
      }
    });
  }

  function firstRecordKeys(db, storeName) {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return resolve([]);
          const v = cursor.value;
          resolve(v && typeof v === 'object' ? Object.keys(v) : [typeof v]);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  // ---------- Diagnóstico ----------
  // Mostra apenas nomes de tabelas, quantidade de registros e nomes de campos
  // (nunca valores), para você ajustar o código caso o WhatsApp mude algo.

  async function diagnose() {
    if (!(await dbExists())) {
      throw new Error('Banco "model-storage" não encontrado. Confirme que o WhatsApp Web está logado.');
    }
    const db = await openDb();
    try {
      const out = [];
      for (const name of Array.from(db.objectStoreNames)) {
        const count = await countStore(db, name);
        const fields = ['contact', 'label', 'label-association', 'group-metadata'].includes(name)
          ? await firstRecordKeys(db, name)
          : null;
        out.push({ store: name, count, fields });
      }

      console.group('[WA Exporter] Diagnóstico do IndexedDB');
      console.log('Banco:', DB_NAME);
      console.table(out.map((item) => ({ store: item.store, count: item.count, fields: (item.fields || []).join(', ') })));

      for (const item of out) {
        if (!item.fields || item.fields.length === 0) continue;
        const rows = await readAll(db, item.store);
        if (!rows.length) continue;
        const first = rows[0];
        console.log(`[WA Exporter] store: ${item.store}`);
        console.log('keys:', Object.keys(first));
        console.log('sample:', first);
      }
      console.groupEnd();

      return out;
    } finally {
      db.close();
    }
  }

  // ---------- Coleta ----------

  function onlyDigits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function extractPhoneNumber(id, rec = {}) {
    const candidates = [
      rec.phoneNumber,
      rec.phone,
      rec.number,
      rec.jid,
      id,
    ];

    for (const value of candidates) {
      if (!value) continue;
      const text = String(value);
      const normalized = text.includes('@') ? text.split('@')[0] : text;
      const digits = onlyDigits(normalized);
      if (digits.length >= 8) return digits;
    }

    return '';
  }

  async function collect({ includeGroups = false, onlyLabeled = false, onlySavedContacts = false } = {}) {
    if (!(await dbExists())) {
      throw new Error('Banco "model-storage" não encontrado. Confirme que o WhatsApp Web está logado.');
    }

    const db = await openDb();
    function readAllStore(storeName) {
      return new Promise((resolve) => {
        if (!db.objectStoreNames.contains(storeName)) return resolve([]);
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }

    try {
      const [contacts, labels, assocs, chats] = await Promise.all([
        readAllStore('contact'),
        readAllStore('label'),
        readAllStore('label-association'),
        readAllStore('chat'),
      ]);

      const labelNames = new Map();
      for (const l of labels) {
        if (l.id != null && l.name && !l.deleted) {
          labelNames.set(String(l.id), String(l.name));
        }
      }

      const labelsByJid = new Map();
      for (const a of assocs) {
        if (a.type && a.type !== 'jid') continue;
        const labelId = a.labelId ?? a.label;
        const target = a.associationId ?? a.jid ?? a.chatId;
        if (!labelId || !target) continue;
        const name = labelNames.get(String(labelId));
        if (name) {
          const jid = String(target);
          if (!labelsByJid.has(jid)) labelsByJid.set(jid, new Set());
          labelsByJid.get(jid).add(name);
        }
      }

      const getDigits = (val) => String(val || '').replace(/\D/g, '');
      const chatIds = new Set();
      const chatPhones = new Set();
      const chatLastMessageAt = new Map();

      for (const chat of chats) {
        if (!chat || !chat.id) continue;
        const chatId = String(chat.id);
        chatIds.add(chatId);
        const chatPhone = getDigits(chatId.includes('@') ? chatId.split('@')[0] : chatId);
        if (chatPhone.length >= 8) chatPhones.add(chatPhone);

        const ts = Number(
          chat.lastMessageTimestamp ??
          chat.lastMsgTimestamp ??
          chat.t ??
          chat.timestamp ??
          chat.lastReceivedMessageTimestamp ??
          0
        );
        if (Number.isFinite(ts) && ts > 0) {
          chatLastMessageAt.set(chatId, ts);
          if (chatPhone.length >= 8) chatLastMessageAt.set(`${chatPhone}@c.us`, ts);
        }
      }

      const phoneMap = new Map();

      for (const c of contacts) {
        if (!c) continue;

        let rawPhone = '';
        if (c.phoneNumber) {
          rawPhone = c.phoneNumber;
        } else if (c.id && c.id.endsWith('@c.us')) {
          rawPhone = c.id;
        }

        const phone = getDigits(rawPhone);
        if (!phone || phone.length < 8) continue;

        const chatKey = c.id ? String(c.id) : '';
        const hasDirectChat =
          (chatKey && chatIds.has(chatKey)) ||
          (chatKey && chatIds.has(`${phone}@c.us`)) ||
          (c.phoneNumber && chatIds.has(String(c.phoneNumber))) ||
          chatPhones.has(phone);

        if (!hasDirectChat) continue;

        const tags = new Set([
          ...(labelsByJid.get(c.id) || []),
          ...(labelsByJid.get(`${phone}@c.us`) || []),
        ]);

        const nameCandidate =
          c.name ||
          c.formattedTitle ||
          c.shortName ||
          c.vcardFormattedName ||
          c.verifiedName ||
          c.pushname ||
          c.notifyName ||
          '';

        const lastSeenAt =
          (chatKey && chatLastMessageAt.get(chatKey)) ||
          chatLastMessageAt.get(`${phone}@c.us`) ||
          (c.phoneNumber ? chatLastMessageAt.get(String(c.phoneNumber)) : 0) ||
          0;

        if (!phoneMap.has(phone)) {
          phoneMap.set(phone, {
            telefone: phone,
            nome: nameCandidate,
            etiquetas: tags,
            ultimaMensagem: lastSeenAt,
          });
        } else {
          const existing = phoneMap.get(phone);
          if (!existing.nome && nameCandidate) {
            existing.nome = nameCandidate;
          }
          if ((existing.ultimaMensagem || 0) < lastSeenAt) {
            existing.ultimaMensagem = lastSeenAt;
          }
          tags.forEach((t) => existing.etiquetas.add(t));
        }
      }

      const listaSimples = [];
      for (const [phone, data] of phoneMap.entries()) {
        listaSimples.push({
          Telefone: data.telefone,
          Nome: data.nome,
          Etiqueta: Array.from(data.etiquetas).join(' | '),
          ultimaMensagem: data.ultimaMensagem || 0,
        });
      }

      listaSimples.sort((a, b) => {
        if ((b.ultimaMensagem || 0) !== (a.ultimaMensagem || 0)) {
          return (b.ultimaMensagem || 0) - (a.ultimaMensagem || 0);
        }
        return a.Telefone.localeCompare(b.Telefone);
      });
      console.table(listaSimples.map(({ Telefone, Nome, Etiqueta }) => ({ Telefone, Nome, Etiqueta })));

      let rows = listaSimples.map((item) => ({
        telefone: item.Telefone || '',
        nome: item.Nome || '',
        nome_perfil: '',
        tipo: 'contato',
        empresa: 'não',
        salvo_na_agenda: 'não',
        etiquetas: item.Etiqueta || '',
        id: item.Telefone || '',
      }));

      if (onlySavedContacts) {
        rows = rows.filter((row) => row.salvo_na_agenda === 'sim');
      }

      return {
        rows,
        stats: {
          contatosNoBanco: phoneMap.size,
          etiquetasEncontradas: labelNames.size,
          associacoesEtiqueta: assocs.length,
        },
      };
    } finally {
      db.close();
    }
  }

  // ---------- Comunicação com o popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'diagnose') {
          sendResponse({ ok: true, data: await diagnose() });
        } else if (msg.type === 'export') {
          sendResponse({ ok: true, data: await collect(msg.options || {}) });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // resposta assíncrona
  });
})();
