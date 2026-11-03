// Projetista — aplicativo desktop.
// O processo principal sobe o backend (kernel exato + pool de workers) como processo
// Node separado e abre a interface numa janela com aceleração de GPU dedicada.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');

// ---------- GPU: usa a placa dedicada e ignora listas de bloqueio de driver
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${Math.min(8192, Math.floor(os.totalmem() / 2 ** 20 / 8))}`);

const PORT = Number(process.env.PROJETISTA_PORT) || 7777;
let port = PORT; // pode mudar se a porta padrão estiver presa por um kernel antigo
const ROOT = path.join(__dirname, '..');
const HOME = process.env.PROJETISTA_HOME || path.join(app.getPath('documents'), 'Projetista');
let backend = null;
let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const file = argv.find((a) => a.endsWith('.projetista') || a.endsWith('.projetista.json'));
  if (file) win?.webContents.send('menu', { action: 'open-path', file });
});

function request(method, pathname, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, timeout }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}
async function info() { const r = await request('GET', '/api/info', 700); return r?.body?.app === 'projetista' ? r.body : null; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort(start) {
  return new Promise((resolve) => {
    const srv = require('node:net').createServer();
    srv.once('error', () => resolve(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => srv.close(() => resolve(start)));
  });
}

async function startBackend() {
  fs.mkdirSync(HOME, { recursive: true });
  const existing = await info();
  if (existing?.owner === 'app') return; // outro backend do próprio app (ex.: modo desenvolvimento)
  if (existing) {
    // Um kernel iniciado pelo Claude (MCP) ocupa a porta: o app assume. O documento aberto
    // nele é preservado e o MCP passa a operar como ponte para este app.
    const r = await request('POST', '/api/handover', 15000);
    if (r?.status === 200 && r.body?.document) {
      fs.writeFileSync(path.join(HOME, 'autosave.projetista.json'), JSON.stringify(r.body.document));
      for (let i = 0; i < 50 && (await info()); i++) await sleep(100);
    } else {
      // kernel de versão antiga (sem passagem de controle): o app usa o próprio kernel noutra porta
      port = await freePort(PORT + 1);
    }
  }
  // heap do processo principal do kernel: 1/4 da RAM, até 16 GB
  const heap = Math.min(16384, Math.floor(os.totalmem() / 2 ** 20 / 4));
  backend = spawn(process.execPath, [`--max-old-space-size=${heap}`, path.join(ROOT, 'src', 'cli.js'), 'app'], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJETISTA_HOME: HOME, PROJETISTA_PORT: String(port), PROJETISTA_EXE: process.execPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const log = fs.createWriteStream(path.join(HOME, 'projetista.log'), { flags: 'a' });
  backend.stdout.pipe(log); backend.stderr.pipe(log);
  backend.on('exit', (code) => { if (code && win) dialog.showErrorBox('Projetista', `O kernel encerrou (código ${code}). Veja ${path.join(HOME, 'projetista.log')}`); });
  for (let i = 0; i < 150; i++) { if ((await info())?.owner === 'app') return; await sleep(100); }
  throw new Error('O kernel não respondeu em 15 s');
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 950, show: false, backgroundColor: '#e6e8eb', title: 'Projetista',
    icon: path.join(ROOT, 'build', 'icon.png'),
    // barra de título integrada: a barra de acesso rápido fica na própria barra da janela
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#e6e8eb', symbolColor: '#1e2228', height: 34 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'r') win.webContents.reload();
  });
  win.loadFile(path.join(__dirname, 'splash.html'));
  win.setTitle('Projetista');
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  try {
    await startBackend();
    await win.loadURL(`http://localhost:${port}/`);
    const file = process.argv.find((a) => a.endsWith('.projetista') || a.endsWith('.projetista.json'));
    if (file) win.webContents.once('did-finish-load', () => win.webContents.send('menu', { action: 'open-path', file }));
  } catch (e) {
    dialog.showErrorBox('Projetista', e.message);
    app.quit();
  }
}

ipcMain.handle('show-file', (_e, f) => shell.showItemInFolder(f));
ipcMain.handle('pick-file', async (_e, { exts } = {}) => {
  const r = await dialog.showOpenDialog(win, { defaultPath: HOME, properties: ['openFile'], filters: [{ name: (exts || []).join(', ').toUpperCase(), extensions: exts || ['*'] }, { name: 'Todos', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('save-file', async (_e, { defaultName, defaultPath, exts, filters } = {}) => {
  const list = filters?.length ? filters : [{ name: (exts || []).join(', ').toUpperCase(), extensions: exts || ['*'] }];
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultPath || path.join(HOME, defaultName || 'modelo'), filters: list });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('pick-folder', async (_e, { defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(win, { defaultPath: defaultPath || HOME, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('home-dir', () => HOME);
ipcMain.handle('title-bar', (_e, theme) => {
  const dark = theme === 'dark';
  try { win.setTitleBarOverlay({ color: dark ? '#22262c' : '#e6e8eb', symbolColor: dark ? '#dfe3e8' : '#1e2228' }); } catch { /* sem overlay */ }
  win.setBackgroundColor(dark ? '#22262c' : '#e6e8eb');
});
ipcMain.handle('open-external', (_e, f) => shell.openPath(f));
ipcMain.handle('gpu-info', () => app.getGPUInfo('basic'));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => { if (backend) backend.kill(); });
