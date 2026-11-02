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

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/info', timeout: 700 }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b).app === 'projetista'); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startBackend() {
  if (await ping()) return; // já existe um Projetista rodando (ex.: iniciado pelo Claude)
  fs.mkdirSync(HOME, { recursive: true });
  // heap do processo principal do kernel: 1/4 da RAM, até 16 GB
  const heap = Math.min(16384, Math.floor(os.totalmem() / 2 ** 20 / 4));
  backend = spawn(process.execPath, [`--max-old-space-size=${heap}`, path.join(ROOT, 'src', 'cli.js'), 'app'], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJETISTA_HOME: HOME, PROJETISTA_PORT: String(PORT), PROJETISTA_EXE: process.execPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const log = fs.createWriteStream(path.join(HOME, 'projetista.log'), { flags: 'a' });
  backend.stdout.pipe(log); backend.stderr.pipe(log);
  backend.on('exit', (code) => { if (code && win) dialog.showErrorBox('Projetista', `O kernel encerrou (código ${code}). Veja ${path.join(HOME, 'projetista.log')}`); });
  for (let i = 0; i < 150; i++) { if (await ping()) return; await new Promise((r) => setTimeout(r, 100)); }
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
    await win.loadURL(`http://localhost:${PORT}/`);
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
ipcMain.handle('save-file', async (_e, { defaultName, exts } = {}) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(HOME, defaultName || 'modelo'), filters: [{ name: (exts || []).join(', ').toUpperCase(), extensions: exts || ['*'] }] });
  return r.canceled ? null : r.filePath;
});
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
