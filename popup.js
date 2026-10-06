const $ = (id) => document.getElementById(id);
const statusEl = $('status');

const COLUMNS = [
  ['telefone', 'Telefone'],
  ['nome', 'Nome'],
  ['nome_perfil', 'Nome do perfil'],
  ['tipo', 'Tipo'],
  ['empresa', 'Empresa'],
  ['salvo_na_agenda', 'Salvo na agenda'],
  ['etiquetas', 'Etiquetas'],
];

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
}

function setBusy(busy) {
  $('export').disabled = busy;
  $('diagnose').disabled = busy;
}

async function getWhatsAppTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.startsWith('https://web.whatsapp.com')) {
    throw new Error('Abra o WhatsApp Web na aba ativa e tente de novo.');
  }
  return tab;
}

async function ask(type, payload = {}) {
  const tab = await getWhatsAppTab();
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type, ...payload });
  } catch (e) {
    throw new Error('Não consegui falar com a página. Recarregue o WhatsApp Web (F5) e tente de novo.');
  }
  if (!res || !res.ok) throw new Error((res && res.error) || 'Erro desconhecido.');
  return res.data;
}

// Escapa célula de CSV e neutraliza fórmulas (=, +, -, @) para evitar injeção no Excel
function csvCell(value, sep) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes('"') || s.includes(sep) || /[\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function normalizeRowsForCsv(rows, { onlySavedContacts = false } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (!row) return null;
      const normalized = { ...row };
      const saved = String(normalized.salvo_na_agenda ?? '').trim().toLowerCase() === 'sim';
      if (onlySavedContacts && !saved) return null;
      normalized.salvo_na_agenda = saved ? 'sim' : '';
      delete normalized.id;
      return normalized;
    })
    .filter(Boolean);
}

function buildCsv(rows, sep) {
  const header = COLUMNS.map(([, title]) => csvCell(title, sep)).join(sep);
  const lines = rows.map((r) => COLUMNS.map(([key]) => csvCell(r[key], sep)).join(sep));
  // BOM UTF-8 para o Excel abrir acentos corretamente
  return '\ufeff' + [header, ...lines].join('\r\n');
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportRows() {
  setBusy(true);
  setStatus('Lendo dados do WhatsApp Web...');
  try {
    const response = await ask('export', { options: {} });
    const rawRows = Array.isArray(response && response.rows) ? response.rows : [];
    const rows = normalizeRowsForCsv(rawRows, { onlySavedContacts: false });
    const stats = response && response.stats ? response.stats : { etiquetasEncontradas: 0, associacoesEtiqueta: 0 };

    if (rows.length === 0) {
      setStatus(
        'Nenhuma linha encontrada.\nClique em "Diagnóstico" para ver o que existe no banco do WhatsApp Web.',
        true
      );
      return;
    }

    const sep = $('separator').value;
    const date = new Date().toISOString().slice(0, 10);
    download(`whatsapp-contatos-${date}.csv`, buildCsv(rows, sep));

    let msg = `Pronto! ${rows.length} linhas exportadas.\n` +
      `Etiquetas encontradas: ${stats.etiquetasEncontradas} | Associações: ${stats.associacoesEtiqueta}`;
    if (stats.etiquetasEncontradas === 0) {
      msg += '\n\nNenhuma etiqueta encontrada. Etiquetas só existem em contas do WhatsApp Business.';
    }
    setStatus(msg);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

$('export').addEventListener('click', async () => {
  await exportRows();
});

$('diagnose').addEventListener('click', async () => {
  setBusy(true);
  setStatus('Analisando...');
  try {
    const stores = await ask('diagnose');
    const text = stores
      .map((s) => `${s.store}: ${s.count} registros` + (s.fields ? `\n   campos: ${s.fields.join(', ')}` : ''))
      .join('\n');
    setStatus(text);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
});
