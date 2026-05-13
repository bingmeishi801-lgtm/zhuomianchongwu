// Electron main process: creates a transparent, frameless, always-on-top window
// and provides a native right-click menu that talks to the renderer over IPC.

const { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

let petWindow = null;
let panelWindow = null;
let tray = null;
let currentActionName = '';
let currentPackName = 'default';

const MIN_SIZE = 80;
const MAX_SIZE = 800;
const USER_DATA_DIR = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json');
const BUNDLED_PETS_DIR = path.join(__dirname, 'assets', 'pets');
const USER_PETS_DIR = path.join(USER_DATA_DIR, 'pets');
const PETS_DIR = path.join(USER_PETS_DIR, 'default');
const DEBUG_LOG = path.join(USER_DATA_DIR, 'debug.log');

function debugLog(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(DEBUG_LOG, msg, 'utf8'); } catch {}
}

function ensureDefaultPackStorage() {
  fs.mkdirSync(PETS_DIR, { recursive: true });
  const configPath = path.join(PETS_DIR, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      name: '汤米',
      petNames: ['汤米'],
      defaultAction: '',
      actions: {},
      messages: []
    }, null, 2), 'utf8');
  }
}

function getConfigPath() {
  ensureDefaultPackStorage();
  return path.join(PETS_DIR, 'config.json');
}

function readDefaultPackConfig() {
  try {
    return normalizeDefaultPackConfig(JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')));
  } catch {
    return getDefaultPackConfig();
  }
}

function writeDefaultPackConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(normalizeDefaultPackConfig(config), null, 2), 'utf8');
}

function getDefaultPackConfig() {
  return {
    name: '汤米',
    petNames: ['汤米'],
    defaultAction: '',
    actions: {},
    messages: [],
    actionOrchestration: {
      enabled: false,
      interval: 3,
      sequence: []
    }
  };
}

function normalizePetNames(config = {}) {
  const rawNames = Array.isArray(config.petNames) ? config.petNames : [config.name || '汤米'];
  const seen = new Set();
  const petNames = rawNames
    .map(name => String(name || '').trim())
    .filter(Boolean)
    .filter(name => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });

  if (petNames.length === 0) {
    petNames.push('汤米');
  }

  return petNames;
}

function normalizeDefaultPackConfig(config = {}) {
  const normalized = {
    ...getDefaultPackConfig(),
    ...config
  };

  normalized.petNames = normalizePetNames(normalized);
  normalized.name = normalized.petNames[0];
  normalized.actions = normalized.actions && typeof normalized.actions === 'object' ? normalized.actions : {};
  normalized.messages = Array.isArray(normalized.messages) ? normalized.messages : [];

  const orch = normalized.actionOrchestration || {};
  normalized.actionOrchestration = {
    enabled: !!orch.enabled,
    interval: Math.max(0, parseFloat(orch.interval) || 3),
    sequence: Array.isArray(orch.sequence) ? orch.sequence.filter(s => typeof s === 'string') : []
  };

  return normalized;
}

function getPackRoots() {
  return [
    { root: BUNDLED_PETS_DIR, writable: false },
    { root: USER_PETS_DIR, writable: true }
  ];
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (path.isAbsolute(candidate)) {
        if (fileExists(candidate)) return candidate;
      } else {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function findExecutableUnder(rootDir, executableName) {
  if (!rootDir || !fileExists(rootDir)) return null;

  const queue = [rootDir];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }
  }

  return null;
}

function getFFmpegCommand() {
  const executableName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const resourceToolsDir = path.join(process.resourcesPath || '', 'tools');
  const localToolsDir = path.join(__dirname, 'tools');
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(resourceToolsDir, executableName),
    path.join(localToolsDir, executableName),
    findExecutableUnder(resourceToolsDir, executableName),
    findExecutableUnder(localToolsDir, executableName),
    executableName
  ];
  return resolveCommand(candidates);
}

function getPythonCommand() {
  const candidates = [
    process.env.PYTHON_PATH,
    process.platform === 'win32' ? 'py.exe' : null,
    process.platform === 'win32' ? 'python.exe' : 'python3',
    'python'
  ];
  return resolveCommand(candidates);
}

async function extractFrames(videoPath, rawDir, ext) {
  const ffmpeg = getFFmpegCommand();
  if (!ffmpeg) {
    throw new Error('未找到 ffmpeg。请安装 ffmpeg，或将 ffmpeg 放到 tools 目录并重新打包。');
  }

  const outputPattern = path.join(rawDir, 'frame_%04d.png');
  const args = ext === '.gif'
    ? ['-y', '-i', videoPath, outputPattern]
    : ['-y', '-i', videoPath, '-vf', "fps=12,scale='min(480,iw)':-1", outputPattern];

  await execFileAsync(ffmpeg, args);
}

async function removeBackgroundOrCopy(inputPath, outputPath, bgColor) {
  // 优先用 Python + rembg
  const python = getPythonCommand();
  if (python) {
    const script = [
      'import sys',
      'from PIL import Image',
      'from rembg import remove',
      'src, dst = sys.argv[1], sys.argv[2]',
      'img = Image.open(src)',
      'result = remove(img)',
      'result.save(dst)'
    ].join('\n');

    try {
      const args = python.toLowerCase().includes('py.exe')
        ? ['-3', '-c', script, inputPath, outputPath]
        : ['-c', script, inputPath, outputPath];
      await execFileAsync(python, args);
      return { backgroundRemoved: true };
    } catch {}
  }

  // Python 不可用，用 ffmpeg colorkey 滤镜
  if (bgColor) {
    const ffmpeg = getFFmpegCommand();
    if (ffmpeg) {
      try {
        await execFileAsync(ffmpeg, [
          '-y', '-i', inputPath,
          '-vf', `colorkey=${bgColor}:0.22:0.08`,
          '-frames:v', '1',
          outputPath
        ]);
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          return { backgroundRemoved: true, method: 'ffmpeg-colorkey' };
        }
      } catch {}
    }
  }

  fs.copyFileSync(inputPath, outputPath);
  return { backgroundRemoved: false, reason: python ? 'rembg-unavailable' : 'python-not-found' };
}

function detectBackgroundColor(framesDir) {
  const ffmpeg = getFFmpegCommand();
  if (!ffmpeg) return null;
  const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
  if (frames.length === 0) return null;
  const firstFrame = path.join(framesDir, frames[0]);
  const efs = require('child_process').execFileSync;

  // 用 ffprobe 获取图片尺寸
  let imgW = 0, imgH = 0;
  try {
    const probe = efs(ffmpeg, [
      '-y', '-i', firstFrame,
      '-f', 'null', '-'
    ], { timeout: 10000, encoding: 'utf8' });
  } catch (e) {
    // 从 stderr 提取尺寸信息
    const m = (e.stderr || '').match(/(\d+)x(\d+)/);
    if (m) { imgW = parseInt(m[1]); imgH = parseInt(m[2]); }
  }
  if (imgW < 16 || imgH < 16) return null;

  // 分别裁剪四个角 8x8 区域，取平均色
  const s = 8;
  const crops = [
    `crop=${s}:${s}:0:0`,                                        // 左上
    `crop=${s}:${s}:${imgW - s}:0`,                              // 右上
    `crop=${s}:${s}:0:${imgH - s}`,                              // 左下
    `crop=${s}:${s}:${imgW - s}:${imgH - s}`                     // 右下
  ];
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  const tmpPath = path.join(framesDir, '_corner.png');
  for (const crop of crops) {
    try {
      efs(ffmpeg, ['-y', '-i', firstFrame, '-vf', crop, '-frames:v', '1', tmpPath], { timeout: 10000 });
      if (!fs.existsSync(tmpPath)) continue;
      const raw = efs(ffmpeg, ['-y', '-i', tmpPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 10000, encoding: null, maxBuffer: 2048 });
      try { fs.unlinkSync(tmpPath); } catch {}
      if (!raw || raw.length < 3) continue;
      // 取该区域的平均色（采样几个像素）
      const step = Math.max(1, Math.floor(raw.length / 4 / 3)) * 3;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i + 2 < raw.length; i += step) {
        r += raw[i]; g += raw[i + 1]; b += raw[i + 2]; n++;
      }
      if (n > 0) {
        totalR += r / n; totalG += g / n; totalB += b / n; count++;
      }
    } catch { try { fs.unlinkSync(tmpPath); } catch {} }
  }
  if (count === 0) return null;
  const avgR = Math.round(totalR / count);
  const avgG = Math.round(totalG / count);
  const avgB = Math.round(totalB / count);
  return '0x' + [avgR, avgG, avgB].map(c => c.toString(16).padStart(2, '0')).join('');
}

async function detectGlobalCrop(framesDir) {
  const ffmpeg = getFFmpegCommand();
  if (!ffmpeg) return null;

  const framePattern = path.join(framesDir, 'frame_%04d.png');
  const args = [
    '-hide_banner',
    '-i', framePattern,
    '-vf', 'cropdetect=0:1:0',
    '-f', 'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null'
  ];

  try {
    const { stderr = '' } = await execFileAsync(ffmpeg, args);
    const matches = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (matches.length === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxRight = 0;
    let maxBottom = 0;

    for (const match of matches) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      const x = Number(match[3]);
      const y = Number(match[4]);
      if (![width, height, x, y].every(Number.isFinite)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxRight = Math.max(maxRight, x + width);
      maxBottom = Math.max(maxBottom, y + height);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxRight <= minX || maxBottom <= minY) {
      return null;
    }

    const width = maxRight - minX;
    const height = maxBottom - minY;
    if (width <= 0 || height <= 0) return null;

    return { width, height, x: minX, y: minY };
  } catch {
    return null;
  }
}

async function cropFramesInDir(framesDir, crop) {
  if (!crop) return false;

  const ffmpeg = getFFmpegCommand();
  if (!ffmpeg) return false;

  const framePattern = path.join(framesDir, 'frame_%04d.png');
  const croppedDir = path.join(framesDir, '_cropped');
  fs.rmSync(croppedDir, { recursive: true, force: true });
  fs.mkdirSync(croppedDir, { recursive: true });

  const outputPattern = path.join(croppedDir, 'frame_%04d.png');
  const filter = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`;

  try {
    await execFileAsync(ffmpeg, ['-y', '-i', framePattern, '-vf', filter, outputPattern]);

    const croppedFrames = fs.readdirSync(croppedDir).filter(name => name.endsWith('.png')).sort();
    if (croppedFrames.length === 0) {
      fs.rmSync(croppedDir, { recursive: true, force: true });
      return false;
    }

    for (const name of fs.readdirSync(framesDir)) {
      if (name.endsWith('.png')) {
        fs.rmSync(path.join(framesDir, name), { force: true });
      }
    }

    for (const frame of croppedFrames) {
      fs.renameSync(path.join(croppedDir, frame), path.join(framesDir, frame));
    }

    fs.rmSync(croppedDir, { recursive: true, force: true });
    return true;
  } catch {
    fs.rmSync(croppedDir, { recursive: true, force: true });
    return false;
  }
}

function actionHasRenderableFrames(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'sequence') {
    return Array.isArray(action.frames) && action.frames.length > 0;
  }
  if (action.type === 'gif' || action.type === 'lottie') {
    return !!action.src;
  }
  if (action.type === 'rig') {
    return !!action.rig;
  }
  return false;
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return { size: 240 };
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Discover pet packs under assets/pets/<name>/config.json
function loadPetPacks() {
  ensureDefaultPackStorage();
  const packs = new Map();

  for (const { root } of getPackRoots()) {
    if (!fs.existsSync(root)) continue;

    fs.readdirSync(root)
      .map(name => {
        const packDir = path.join(root, name);
        const configPath = path.join(packDir, 'config.json');
        if (!fs.existsSync(configPath)) return null;
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          return { name, config, basePath: packDir };
        } catch (e) {
          console.error(`Failed to parse ${configPath}:`, e);
          return null;
        }
      })
      .filter(Boolean)
      .forEach(pack => packs.set(pack.name, pack));
  }

  return Array.from(packs.values());
}

function createPetWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const settings = loadSettings();
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, settings.size || 240));

  petWindow = new BrowserWindow({
    width: size,
    height: size,
    x: screenW - size - 40,
    y: screenH - size - 40,
    minWidth: MIN_SIZE,
    minHeight: MIN_SIZE,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  petWindow.hide();

  petWindow.on('closed', () => { petWindow = null; });
}

function hasDisplayablePet() {
  try {
    const config = readDefaultPackConfig();
    return !!(config && config.actions && Object.values(config.actions).some(actionHasRenderableFrames));
  } catch {
    return false;
  }
}

function showPetWindow() {
  if (!petWindow || !hasDisplayablePet()) return false;
  petWindow.show();
  petWindow.focus();
  return true;
}

function createPanelWindow() {
  if (panelWindow) {
    panelWindow.focus();
    return;
  }

  panelWindow = new BrowserWindow({
    width: 900,
    height: 680,
    title: '桌面宠物 - 管理面板',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel.html'));

  panelWindow.on('closed', () => { panelWindow = null; });
}

function setPetSize(newSize) {
  if (!petWindow) return;
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(newSize)));
  console.log(`[setPetSize] requested=${newSize} clamped=${size}`);
  const [x, y] = petWindow.getPosition();
  const [oldW, oldH] = petWindow.getSize();
  // Keep the pet centered on the same point while resizing
  const cx = x + oldW / 2;
  const cy = y + oldH / 2;
  // Make sure we can go small: Electron on Windows enforces minimum size
  petWindow.setMinimumSize(MIN_SIZE, MIN_SIZE);
  petWindow.setSize(size, size);
  petWindow.setPosition(Math.round(cx - size / 2), Math.round(cy - size / 2));
  const [actualW, actualH] = petWindow.getSize();
  console.log(`[setPetSize] actual window size after set: ${actualW}x${actualH}`);

  const settings = loadSettings();
  settings.size = size;
  saveSettings(settings);

  petWindow.webContents.send('pet:size-changed', size);
  return size;
}

function buildContextMenu() {
  const packs = loadPetPacks();
  const firstPack = packs[0];
  const actions = firstPack ? Object.keys(firstPack.config.actions || {}) : [];
  const currentSize = petWindow ? petWindow.getSize()[0] : 240;
  const orch = firstPack?.config?.actionOrchestration || {};
  const orchEnabled = !!orch.enabled && Array.isArray(orch.sequence) && orch.sequence.length > 0;

  const actionItems = actions.map(actionName => ({
    label: actionName,
    type: 'radio',
    checked: !orchEnabled && actionName === currentActionName,
    click: () => {
      // 手动选动作时停止编排
      const config = readDefaultPackConfig();
      if (config.actionOrchestration?.enabled) {
        config.actionOrchestration.enabled = false;
        writeDefaultPackConfig(config);
      }
      currentActionName = actionName;
      petWindow && petWindow.webContents.send('pet:set-action', actionName);
    }
  }));

  // 从配置中读取猫咪名称，同时保留 pack 目录中的猫咪
  const config = readDefaultPackConfig();
  const configPetNames = config.petNames || [];
  const packNames = new Set(packs.map(p => p.config?.name || p.config?.petNames?.[0] || p.name));
  const allPetNames = [...new Set([...configPetNames, ...packNames])];

  const petItems = allPetNames.map(name => {
    const pack = packs.find(p => (p.config?.name || p.config?.petNames?.[0] || p.name) === name);
    const packName = pack ? pack.name : 'default';
    return {
      label: name,
      type: 'radio',
      checked: name === currentPackName || (!currentPackName && name === configPetNames[0]),
      click: () => {
        currentPackName = packName;
        petWindow && petWindow.webContents.send('pet:load-pack', packName);
      }
    };
  });

  const sizes = [
    { label: '极小 (120)', value: 120 },
    { label: '小 (180)', value: 180 },
    { label: '中 (240)', value: 240 },
    { label: '大 (360)', value: 360 },
    { label: '特大 (480)', value: 480 },
    { label: '巨大 (640)', value: 640 }
  ];
  const sizeItems = sizes.map(s => ({
    label: s.label,
    type: 'radio',
    checked: Math.abs(currentSize - s.value) < 20,
    click: () => setPetSize(s.value)
  }));

  const orchMenuItem = {
    label: '动作编排',
    type: 'radio',
    checked: orchEnabled,
    enabled: actions.length > 0,
    click: () => {
      const config = readDefaultPackConfig();
      if (!config.actionOrchestration) {
        config.actionOrchestration = { enabled: false, interval: 3, sequence: [] };
      }
      if (!config.actionOrchestration.sequence || config.actionOrchestration.sequence.length === 0) {
        config.actionOrchestration.sequence = Object.keys(config.actions || {});
      }
      config.actionOrchestration.enabled = true;
      writeDefaultPackConfig(config);
      currentActionName = '';
      if (petWindow) petWindow.webContents.send('pet:reload-config');
    }
  };

  const actionSubmenu = actionItems.length
    ? [...actionItems, orchMenuItem]
    : [{ label: '(无)', enabled: false }];

  return Menu.buildFromTemplate([
    { label: '动作', submenu: actionSubmenu },
    { label: '宠物', submenu: petItems.length ? petItems : [{ label: '(无)', enabled: false }] },
    { label: '大小', submenu: sizeItems },
    { type: 'separator' },
    { label: '打开面板', click: () => createPanelWindow() },
    { type: 'separator' },
    { label: '隐藏', click: () => petWindow && petWindow.hide() },
    { label: '显示', enabled: hasDisplayablePet(), click: () => showPetWindow() },
    { type: 'separator' },
    { label: '退出', role: 'quit' }
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet');
  tray.setContextMenu(buildContextMenu());
  tray.on('click', () => {
    createPanelWindow();
  });
}

// ---------- IPC ----------

ipcMain.handle('pet:get-packs', () => loadPetPacks());

ipcMain.on('pet:report-action', (_e, name) => {
  currentActionName = name || '';
});

ipcMain.on('pet:report-pack', (_e, name) => {
  currentPackName = name || 'default';
});

ipcMain.handle('pet:get-screen-size', () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width, height };
});

ipcMain.handle('pet:pick-image-file', async () => {
  if (!petWindow) return null;
  const result = await dialog.showOpenDialog(petWindow, {
    title: '选择角色图片',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
    ]
  });
  if (result.canceled || !result.filePaths?.length) return null;

  const selectedPath = result.filePaths[0];
  const ext = path.extname(selectedPath).toLowerCase();
  const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  };
  const mime = mimeByExt[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(selectedPath);

  return {
    path: selectedPath,
    name: path.basename(selectedPath),
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`
  };
});

ipcMain.on('pet:show-context-menu', () => {
  buildContextMenu().popup({ window: petWindow });
});

ipcMain.on('pet:move', (_e, { x, y }) => {
  if (petWindow) petWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('pet:get-position', () => {
  if (!petWindow) return { x: 0, y: 0 };
  const [x, y] = petWindow.getPosition();
  return { x, y };
});

ipcMain.handle('pet:get-size', () => {
  if (!petWindow) return 240;
  return petWindow.getSize()[0];
});

ipcMain.handle('pet:set-size', (_e, size) => {
  return setPetSize(size);
});

ipcMain.handle('pet:can-show', () => hasDisplayablePet());

ipcMain.handle('pet:show', () => showPetWindow());

ipcMain.on('pet:set-ignore-mouse', (_e, { ignore, opts }) => {
  if (petWindow) {
    petWindow.setIgnoreMouseEvents(ignore, opts || {});
  }
});

ipcMain.handle('panel:get-assets', () => {
  ensureDefaultPackStorage();
  const assets = [];
  if (!fs.existsSync(PETS_DIR)) return assets;

  const dirs = fs.readdirSync(PETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'walk')
    .map(d => d.name);

  dirs.forEach(dirName => {
    const dirPath = path.join(PETS_DIR, dirName);
    const frames = fs.readdirSync(dirPath).filter(f => f.endsWith('.png'));
    if (frames.length > 0) {
      const sourceVideo = fs.readdirSync(dirPath).find(f => /^source\.(mp4|webm|mov|m4v|gif)$/i.test(f));
      assets.push({
        name: dirName,
        frames: frames.length,
        preview: path.join(dirPath, frames[0]),
        video: sourceVideo ? path.join(dirPath, sourceVideo) : null
      });
    }
  });

  return assets;
});

ipcMain.handle('panel:can-show-pet', () => hasDisplayablePet());

ipcMain.handle('panel:show-pet', () => showPetWindow());

ipcMain.handle('panel:delete-asset', (_e, name) => {
  ensureDefaultPackStorage();

  const dirPath = path.join(PETS_DIR, name);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }

  let config = { actions: {} };
  try {
    config = readDefaultPackConfig();
    Object.keys(config.actions || {}).forEach(actionName => {
      const action = config.actions[actionName];
      if (action.src?.startsWith(name + '/') || action.frames?.[0]?.startsWith(name + '/')) {
        delete config.actions[actionName];
      }
    });
    if (config.defaultAction === name) {
      config.defaultAction = Object.keys(config.actions)[0] || '';
    }
    writeDefaultPackConfig(config);
  } catch {}

  if (petWindow) petWindow.webContents.send('pet:reload-config');
  if (!hasDisplayablePet() && petWindow) petWindow.hide();
  if (tray) tray.setContextMenu(buildContextMenu());
  return { success: true };
});

ipcMain.handle('panel:upload-video', async (event, filePath) => {
  ensureDefaultPackStorage();

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('未找到要上传的视频文件。');
  }

  const videoPath = filePath;
  const assetName = path.basename(filePath, path.extname(filePath)).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const outputDir = path.join(PETS_DIR, assetName);
  const sourceVideoName = `source${path.extname(filePath).toLowerCase()}`;
  const sourceVideoPath = path.join(outputDir, sourceVideoName);

  // 同名素材重复上传时，先清掉旧帧，避免新旧帧混在一起导致播放抖动/跳帧
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(videoPath, sourceVideoPath);

  const rawDir = path.join(outputDir, '_raw');
  fs.mkdirSync(rawDir, { recursive: true });

  try {
    event.sender.send('panel:upload-progress', 10);

    const ext = path.extname(filePath).toLowerCase();
    await extractFrames(videoPath, rawDir, ext);

    event.sender.send('panel:upload-progress', 40);

    const frames = fs.readdirSync(rawDir).filter(f => f.endsWith('.png')).sort();
    const total = frames.length;

    if (total === 0) {
      throw new Error('视频未能成功抽帧，请换一个 MP4/GIF 文件后重试。');
    }

    let fallbackCount = 0;
    const bgColor = detectBackgroundColor(rawDir);

    for (let i = 0; i < total; i++) {
      const frame = frames[i];
      const inputPath = path.join(rawDir, frame);
      const outputPath = path.join(outputDir, frame);

      const removeResult = await removeBackgroundOrCopy(inputPath, outputPath, bgColor);
      if (!removeResult.backgroundRemoved) {
        fallbackCount += 1;
      }

      const progress = 40 + Math.floor((i + 1) / total * 40);
      event.sender.send('panel:upload-progress', progress);
    }

    const crop = await detectGlobalCrop(outputDir);
    await cropFramesInDir(outputDir, crop);
    event.sender.send('panel:upload-progress', 90);

    fs.rmSync(rawDir, { recursive: true, force: true });

    let config;
    try {
      config = readDefaultPackConfig();
    } catch {
      config = { name: '汤米', defaultAction: '', actions: {}, messages: [] };
    }

    const processedFrames = fs.readdirSync(outputDir).filter(f => f.endsWith('.png')).sort();

    if (processedFrames.length === 0) {
      throw new Error('抽帧后没有生成可用图片，请换一个视频文件后重试。');
    }

    writeDefaultPackConfig(config);

    if (petWindow) petWindow.webContents.send('pet:reload-config');
    if (tray) tray.setContextMenu(buildContextMenu());
    event.sender.send('panel:upload-progress', 100);

    return {
      success: true,
      name: assetName,
      frames: total,
      backgroundRemoved: fallbackCount === 0,
      warning: fallbackCount === total
        ? '未检测到 Python/rembg 环境，已保留原始背景。如需抠图请安装 Python 并运行: pip install rembg'
        : fallbackCount > 0
        ? '部分帧背景去除失败，已保留原始背景。'
        : ''
    };
  } catch (error) {
    if (fs.existsSync(rawDir)) {
      fs.rmSync(rawDir, { recursive: true, force: true });
    }
    if (fs.existsSync(outputDir)) {
      const remaining = fs.readdirSync(outputDir).filter(name => name !== '_raw');
      if (remaining.length === 0) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }
    throw new Error('视频处理失败: ' + error.message);
  }
});

ipcMain.handle('panel:get-config', () => {
  try {
    return readDefaultPackConfig();
  } catch {
    return getDefaultPackConfig();
  }
});

ipcMain.handle('panel:get-pet-name', () => {
  try {
    const config = readDefaultPackConfig();
    return config.petNames[0] || config.name || '汤米';
  } catch {
    return '汤米';
  }
});

ipcMain.handle('panel:get-pet-names', () => {
  try {
    const config = readDefaultPackConfig();
    return config.petNames || [config.name || '汤米'];
  } catch {
    return ['汤米'];
  }
});

ipcMain.handle('panel:delete-pet-name', (_e, petName) => {
  const targetName = String(petName || '').trim();
  debugLog('DELETE start:', targetName);

  if (!targetName) {
    throw new Error('猫咪名称不能为空');
  }

  // 直接读取和修改配置文件，不经过 normalize
  const configPath = getConfigPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('读取配置失败');
  }

  const petNames = Array.isArray(raw.petNames) ? [...raw.petNames] : [raw.name || '汤米'];
  debugLog('DELETE raw petNames:', JSON.stringify(petNames));
  const targetIndex = petNames.indexOf(targetName);

  if (targetIndex === -1) {
    throw new Error('猫咪名称不存在');
  }

  if (petNames.length <= 1) {
    throw new Error('至少需要保留一个猫咪名称');
  }

  petNames.splice(targetIndex, 1);
  raw.petNames = petNames;
  raw.name = petNames[0];

  // 更新 action 中的 petName 引用
  if (raw.actions && typeof raw.actions === 'object') {
    Object.values(raw.actions).forEach(action => {
      if (action && action.petName === targetName) {
        action.petName = petNames[0];
      }
    });
  }

  // 直接写入，不经 normalize
  try {
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  } catch (e) {
    debugLog('DELETE write error:', e.message);
    throw new Error('保存配置失败');
  }
  debugLog('DELETE done, wrote petNames:', JSON.stringify(petNames));

  try { if (petWindow) petWindow.webContents.send('pet:reload-config'); } catch {}
  try { if (tray) tray.setContextMenu(buildContextMenu()); } catch (e) { debugLog('DELETE menu error:', e.message); }

  return normalizeDefaultPackConfig(raw);
});

ipcMain.handle('panel:save-pet-name', (_e, payload = {}) => {
  const name = String(payload.name || '').trim();
  const originalName = String(payload.originalName || '').trim();
  debugLog('SAVE start:', name, 'original:', originalName);

  if (!name) {
    throw new Error('猫咪名称不能为空');
  }

  // 直接读取配置文件，不经过 normalize
  const configPath = getConfigPath();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    raw = getDefaultPackConfig();
  }

  const petNames = Array.isArray(raw.petNames) ? [...raw.petNames] : [raw.name || '汤米'];
  debugLog('SAVE raw petNames:', JSON.stringify(petNames));
  const existingIndex = petNames.indexOf(name);
  const originalIndex = originalName ? petNames.indexOf(originalName) : -1;

  if (originalName) {
    if (originalIndex === -1) {
      throw new Error('原猫咪名称不存在');
    }
    if (existingIndex !== -1 && existingIndex !== originalIndex) {
      throw new Error('猫咪名称已存在');
    }
    petNames[originalIndex] = name;
  } else {
    if (existingIndex !== -1) {
      throw new Error('猫咪名称已存在');
    }
    petNames.push(name);
  }

  raw.petNames = petNames;
  raw.name = petNames[0];

  // 更新 action 中的 petName 引用
  if (raw.actions && typeof raw.actions === 'object') {
    Object.values(raw.actions).forEach(action => {
      if (action && action.petName === originalName) {
        action.petName = name;
      }
    });
  }

  // 直接写入，不经 normalize
  try {
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  } catch (e) {
    debugLog('SAVE write error:', e.message);
    throw new Error('保存配置失败');
  }
  debugLog('SAVE done, wrote petNames:', JSON.stringify(petNames));

  try { if (petWindow) petWindow.webContents.send('pet:reload-config'); } catch {}
  try { if (tray) tray.setContextMenu(buildContextMenu()); } catch (e) { debugLog('SAVE menu error:', e.message); }

  return normalizeDefaultPackConfig(raw);
});

ipcMain.handle('panel:save-action', (_e, name, { petName, asset, loop, originalName }) => {
  let config;
  try {
    config = readDefaultPackConfig();
  } catch {
    config = getDefaultPackConfig();
  }

  const selectedPet = String(petName || '').trim();
  if (!selectedPet) {
    throw new Error('请选择猫咪');
  }
  if (!Array.isArray(config.petNames) || !config.petNames.includes(selectedPet)) {
    throw new Error('所选猫咪不存在');
  }

  const assetDir = path.join(PETS_DIR, asset);
  const frames = fs.existsSync(assetDir)
    ? fs.readdirSync(assetDir).filter(f => f.endsWith('.png')).sort()
    : [];

  if (originalName && originalName !== name && config.actions[originalName]) {
    delete config.actions[originalName];
    if (config.defaultAction === originalName) {
      config.defaultAction = name;
    }
  }

  if (frames.length > 0) {
    config.actions[name] = {
      type: 'sequence',
      petName: selectedPet,
      frames: frames.map(f => `${asset}/${f}`),
      fps: 12,
      loop: loop
    };

    if (!config.defaultAction) {
      config.defaultAction = name;
    }
  }

  writeDefaultPackConfig(config);
  if (petWindow) petWindow.webContents.send('pet:reload-config');
  if (tray) tray.setContextMenu(buildContextMenu());
  return config;
});

ipcMain.handle('panel:delete-action', (_e, name) => {
  let config = { actions: {} };
  try {
    config = readDefaultPackConfig();
    delete config.actions[name];
    if (config.defaultAction === name) {
      config.defaultAction = Object.keys(config.actions)[0] || '';
    }
    // Also remove from orchestration sequence
    if (config.actionOrchestration && Array.isArray(config.actionOrchestration.sequence)) {
      config.actionOrchestration.sequence = config.actionOrchestration.sequence.filter(s => s !== name);
    }
    writeDefaultPackConfig(config);
  } catch {}
  if (petWindow) petWindow.webContents.send('pet:reload-config');
  if (!hasDisplayablePet() && petWindow) petWindow.hide();
  if (tray) tray.setContextMenu(buildContextMenu());
  return config;
});

ipcMain.handle('panel:save-orchestration', (_e, data) => {
  let config;
  try {
    config = readDefaultPackConfig();
  } catch {
    config = getDefaultPackConfig();
  }

  const actionNames = Object.keys(config.actions || {});
  config.actionOrchestration = {
    enabled: !!data.enabled,
    interval: Math.max(0, parseFloat(data.interval) || 3),
    sequence: Array.isArray(data.sequence)
      ? data.sequence.filter(s => actionNames.includes(s))
      : []
  };

  writeDefaultPackConfig(config);
  if (petWindow) petWindow.webContents.send('pet:reload-config');
  return config.actionOrchestration;
});

ipcMain.handle('panel:get-messages', () => {
  try {
    const config = readDefaultPackConfig();
    return config.messages || [];
  } catch {
    return [];
  }
});

ipcMain.handle('panel:save-message', (_e, index, text) => {
  let config;
  try {
    config = readDefaultPackConfig();
  } catch {
    config = getDefaultPackConfig();
  }

  const defaultMessages = [
    '喵~', '你好呀！', '摸摸我~', '加油哦！', '想我了？', '嘿嘿~',
    '好困…', '要小鱼干！', '干嘛呀？', '陪我玩~', '喵呜~ ♡',
    '天气真好~', '喜欢你！', '别戳啦~', '嗯？', '开心！'
  ];

  if (!config.messages || config.messages.length === 0) {
    config.messages = [...defaultMessages];
  }

  if (index === null || index === undefined) {
    config.messages.push(text);
  } else {
    config.messages[index] = text;
  }

  writeDefaultPackConfig(config);
  if (petWindow) petWindow.webContents.send('pet:reload-config');
  return config.messages;
});

ipcMain.handle('panel:delete-message', (_e, index) => {
  let config = getDefaultPackConfig();
  try {
    config = readDefaultPackConfig();
    if (config.messages) {
      config.messages.splice(index, 1);
      writeDefaultPackConfig(config);
    }
  } catch {}
  if (petWindow) petWindow.webContents.send('pet:reload-config');
  return config.messages || [];
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createPetWindow();
  createPanelWindow();
  createTray();

  app.on('activate', () => {
    if (!panelWindow) createPanelWindow();
    if (!petWindow) createPetWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep app alive; tray controls lifecycle
});
