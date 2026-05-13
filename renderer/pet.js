// Renderer: animation engine + drag + action state machine.
// A "pack" describes the pet. A pack has multiple "actions"; each action has a
// "type" (gif | sequence | lottie | rig) and type-specific parameters.

const petEl = document.getElementById('pet');
const gifEl = document.getElementById('pet-gif');
const seqEl = document.getElementById('pet-sequence');
const lottieEl = document.getElementById('pet-lottie');
const rigEl = document.getElementById('pet-rig');
const bubbleEl = document.getElementById('bubble');
const statusEl = null;
const actionButtons = [];
const seqCtx = seqEl.getContext('2d');
const rigCtx = rigEl.getContext('2d');

let currentPack = null;
let currentAction = null;
let currentActionName = null;
let lottieAnim = null;
let generatedRigPack = null;
let userRigState = null;
let userRigEnabled = false;

// 动作编排状态
let orchestrationState = null; // { sequence, interval, index }
let orchestrationTimer = null;
let preloadedOrchImages = null; // 预加载的下一动作帧

const DEFAULT_RIG_SIZE = 1024;
const BLINK_INTERVAL_MIN = 2200;
const BLINK_INTERVAL_RANGE = 2400;

const RIG_PRESETS = {
  idle: {
    duration: 2.8,
    loop: true,
    tracks: []
  },
  blink: {
    duration: 0.22,
    loop: false,
    tracks: []
  },
  wave: {
    duration: 1.2,
    loop: false,
    tracks: []
  },
  jump: {
    duration: 0.95,
    loop: false,
    tracks: []
  },
  sleep: {
    duration: 3.2,
    loop: true,
    tracks: []
  },
  angry: {
    duration: 0.7,
    loop: false,
    tracks: []
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createGeneratedRigPack(rigConfig) {
  return {
    name: '__generated_rig__',
    config: {
      name: '方案A生成宠物',
      defaultAction: 'idle',
      actions: Object.fromEntries(
        Object.entries(RIG_PRESETS).map(([name, preset]) => [
          name,
          {
            type: 'rig',
            rig: rigConfig,
            ...clone(preset)
          }
        ])
      )
    }
  };
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function getActivePack() {
  return userRigEnabled && generatedRigPack ? generatedRigPack : currentPack;
}

function getRigBasePose() {
  return {
    rootY: 0,
    rootX: 0,
    rootScaleX: 1,
    rootScaleY: 1,
    torsoY: 0,
    torsoX: 0,
    torsoRotation: 0,
    headY: 0,
    headRotation: 0,
    armLeftRotation: -6,
    armRightRotation: 6,
    armLeftY: 0,
    armRightY: 0,
    legLeftRotation: 0,
    legRightRotation: 0,
    blink: 0,
    sleepEyes: 0,
    angryShake: 0,
    accessorySwing: 0
  };
}

function averageCornerColor(data, width, height) {
  const sampleSize = Math.max(2, Math.floor(Math.min(width, height) * 0.08));
  const samplePoints = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize]
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  samplePoints.forEach(([startX, startY]) => {
    for (let y = Math.max(0, startY); y < Math.min(height, startY + sampleSize); y += 1) {
      for (let x = Math.max(0, startX); x < Math.min(width, startX + sampleSize); x += 1) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        if (alpha < 32) continue;
        r += data[idx];
        g += data[idx + 1];
        b += data[idx + 2];
        count += 1;
      }
    }
  });

  if (!count) return { r: 255, g: 255, b: 255 };
  return { r: r / count, g: g / count, b: b / count };
}

function createMaskedImageCanvas(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const bg = averageCornerColor(data, width, height);
  const tolerance = 52;
  const feather = 24;

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg.r;
    const dg = data[i + 1] - bg.g;
    const db = data[i + 2] - bg.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);

    if (distance < tolerance) {
      data[i + 3] = 0;
    } else if (distance < tolerance + feather) {
      const keep = (distance - tolerance) / feather;
      data[i + 3] = Math.round(data[i + 3] * keep);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function buildRigFromImage(img) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvasSize = DEFAULT_RIG_SIZE;
  const processedImage = createMaskedImageCanvas(img);
  const scale = Math.min(canvasSize / width, canvasSize / height) * 0.78;
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const x = (canvasSize - scaledWidth) / 2;
  const y = canvasSize - scaledHeight - canvasSize * 0.06;

  return {
    canvasSize,
    image: processedImage,
    source: {
      width,
      height,
      x,
      y,
      scaledWidth,
      scaledHeight
    },
    guides: {
      headTop: 0.02,
      headBottom: 0.28,
      torsoTop: 0.22,
      torsoBottom: 0.64,
      armTop: 0.25,
      armBottom: 0.68,
      legTop: 0.64,
      legBottom: 0.98,
      leftArmOuter: 0.02,
      leftArmInner: 0.34,
      rightArmInner: 0.66,
      rightArmOuter: 0.98,
      legInnerGap: 0.08
    }
  };
}

function clipPart(ctx, rig, partName) {
  const { x, y, scaledWidth, scaledHeight } = rig.source;
  const g = rig.guides;
  const left = x;
  const right = x + scaledWidth;
  const top = y;
  const bottom = y + scaledHeight;
  const cx = x + scaledWidth / 2;

  ctx.beginPath();
  switch (partName) {
    case 'head':
      ctx.rect(left, top, scaledWidth, scaledHeight * (g.headBottom - g.headTop));
      break;
    case 'torso':
      ctx.rect(
        x + scaledWidth * 0.18,
        y + scaledHeight * g.torsoTop,
        scaledWidth * 0.64,
        scaledHeight * (g.torsoBottom - g.torsoTop)
      );
      break;
    case 'armLeft':
      ctx.rect(
        left,
        y + scaledHeight * g.armTop,
        scaledWidth * g.leftArmInner,
        scaledHeight * (g.armBottom - g.armTop)
      );
      break;
    case 'armRight':
      ctx.rect(
        x + scaledWidth * g.rightArmInner,
        y + scaledHeight * g.armTop,
        scaledWidth * (g.rightArmOuter - g.rightArmInner),
        scaledHeight * (g.armBottom - g.armTop)
      );
      break;
    case 'legLeft':
      ctx.rect(
        x + scaledWidth * 0.2,
        y + scaledHeight * g.legTop,
        scaledWidth * (0.3 - g.legInnerGap / 2),
        scaledHeight * (g.legBottom - g.legTop)
      );
      break;
    case 'legRight':
      ctx.rect(
        cx + scaledWidth * (g.legInnerGap / 2),
        y + scaledHeight * g.legTop,
        scaledWidth * (0.3 - g.legInnerGap / 2),
        scaledHeight * (g.legBottom - g.legTop)
      );
      break;
    case 'accessory':
      ctx.rect(left, top, scaledWidth, scaledHeight * 0.22);
      break;
    default:
      ctx.rect(left, top, right - left, bottom - top);
      break;
  }
  ctx.clip();
}

function drawPart(ctx, rig, partName, opts = {}) {
  const { image, source } = rig;
  const {
    pivotX = source.x + source.scaledWidth / 2,
    pivotY = source.y + source.scaledHeight / 2,
    translateX = 0,
    translateY = 0,
    rotation = 0,
    scaleX = 1,
    scaleY = 1,
    alpha = 1
  } = opts;

  ctx.save();
  ctx.translate(pivotX + translateX, pivotY + translateY);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-pivotX, -pivotY);
  ctx.globalAlpha = alpha;
  clipPart(ctx, rig, partName);
  ctx.drawImage(image, source.x, source.y, source.scaledWidth, source.scaledHeight);
  ctx.restore();
}

function drawFaceOverlay(ctx, rig, pose) {
  const shouldDrawEyes = pose.blink > 0.08 || pose.sleepEyes > 0.8 || Math.abs(pose.angryShake) > 1;
  if (!shouldDrawEyes) return;

  const { x, y, scaledWidth, scaledHeight } = rig.source;
  const eyeY = y + scaledHeight * 0.18 + pose.headY * 0.22 + pose.rootY * 0.1;
  const leftEyeX = x + scaledWidth * 0.39 + pose.rootX * 0.05;
  const rightEyeX = x + scaledWidth * 0.61 + pose.rootX * 0.05;
  const eyeWidth = scaledWidth * 0.06;
  const openHeight = scaledHeight * 0.014;
  const closedHeight = Math.max(1.5, scaledHeight * 0.0035);
  const blinkMix = Math.max(pose.blink, pose.sleepEyes);
  const eyeHeight = openHeight * (1 - blinkMix) + closedHeight * blinkMix;
  const eyeColor = pose.sleepEyes > 0.8 ? 'rgba(55,55,60,0.82)' : 'rgba(30,30,36,0.72)';

  ctx.save();
  ctx.fillStyle = eyeColor;
  [leftEyeX, rightEyeX].forEach((cx) => {
    ctx.beginPath();
    ctx.ellipse(cx, eyeY, eyeWidth, eyeHeight, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  if (Math.abs(pose.angryShake) > 1) {
    ctx.strokeStyle = 'rgba(180,40,40,0.75)';
    ctx.lineWidth = Math.max(1.5, scaledWidth * 0.005);
    ctx.beginPath();
    ctx.moveTo(leftEyeX - eyeWidth * 1.05, eyeY - eyeHeight * 2.1);
    ctx.lineTo(leftEyeX + eyeWidth * 0.5, eyeY - eyeHeight * 1.1);
    ctx.moveTo(rightEyeX - eyeWidth * 0.5, eyeY - eyeHeight * 1.1);
    ctx.lineTo(rightEyeX + eyeWidth * 1.05, eyeY - eyeHeight * 2.1);
    ctx.stroke();
  }

  if (pose.sleepEyes > 0.8) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `${Math.round(scaledWidth * 0.065)}px sans-serif`;
    ctx.fillText('Zz', x + scaledWidth * 0.69, y + scaledHeight * 0.115);
  }
  ctx.restore();
}

function renderRigFrame(rig, pose) {
  if (!rig || !rigCtx) return;
  const canvas = rigEl;
  const size = rig.canvasSize;
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }

  const { source, guides } = rig;
  const centerX = source.x + source.scaledWidth / 2;
  const centerY = source.y + source.scaledHeight / 2;
  const rotation = (
    pose.headRotation * 0.2 +
    pose.torsoRotation * 0.35 +
    pose.accessorySwing * 0.08 +
    pose.angryShake * 0.04
  );
  const scaleX = pose.rootScaleX;
  const scaleY = pose.rootScaleY;
  const shoulderY = source.y + source.scaledHeight * guides.armTop;
  const hipY = source.y + source.scaledHeight * guides.legTop;
  const leftShoulderX = source.x + source.scaledWidth * 0.3;
  const rightShoulderX = source.x + source.scaledWidth * 0.7;
  const leftHipX = source.x + source.scaledWidth * 0.4;
  const rightHipX = source.x + source.scaledWidth * 0.6;

  rigCtx.clearRect(0, 0, canvas.width, canvas.height);
  rigCtx.save();
  rigCtx.translate(centerX + pose.rootX + pose.torsoX * 0.4 + pose.angryShake, centerY + pose.rootY + pose.torsoY * 0.35);
  rigCtx.rotate((rotation * Math.PI) / 180);
  rigCtx.scale(scaleX, scaleY);
  rigCtx.translate(-centerX, -centerY);

  drawPart(rigCtx, rig, 'legLeft', {
    pivotX: leftHipX,
    pivotY: hipY,
    rotation: pose.legLeftRotation,
    translateY: pose.rootY * 0.08
  });
  drawPart(rigCtx, rig, 'legRight', {
    pivotX: rightHipX,
    pivotY: hipY,
    rotation: pose.legRightRotation,
    translateY: pose.rootY * 0.08
  });
  drawPart(rigCtx, rig, 'armLeft', {
    pivotX: leftShoulderX,
    pivotY: shoulderY,
    rotation: pose.armLeftRotation,
    translateY: pose.armLeftY
  });
  drawPart(rigCtx, rig, 'torso', {
    pivotX: centerX,
    pivotY: source.y + source.scaledHeight * 0.45,
    rotation: pose.torsoRotation,
    translateX: pose.torsoX,
    translateY: pose.torsoY
  });
  drawPart(rigCtx, rig, 'armRight', {
    pivotX: rightShoulderX,
    pivotY: shoulderY,
    rotation: pose.armRightRotation,
    translateY: pose.armRightY
  });
  drawPart(rigCtx, rig, 'head', {
    pivotX: centerX,
    pivotY: source.y + source.scaledHeight * 0.2,
    rotation: pose.headRotation,
    translateY: pose.headY
  });
  if (Math.abs(pose.accessorySwing) > 0.1) {
    drawPart(rigCtx, rig, 'accessory', {
      pivotX: centerX,
      pivotY: source.y + source.scaledHeight * 0.08,
      rotation: pose.accessorySwing
    });
  }
  drawFaceOverlay(rigCtx, rig, pose);
  rigCtx.restore();
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function computeRigPose(actionName, elapsedSeconds) {
  const pose = getRigBasePose();
  const t = elapsedSeconds;

  switch (actionName) {
    case 'idle': {
      const loop = (t / 3.6) * Math.PI * 2;
      pose.rootY = Math.sin(loop) * 4;
      pose.headRotation = Math.sin(loop + 0.4) * 1.1;
      pose.headY = Math.sin(loop + 0.7) * 1.8;
      pose.torsoY = Math.sin(loop) * 1.2;
      pose.accessorySwing = Math.sin(loop + 1) * 1.6;
      break;
    }
    case 'blink': {
      const p = Math.min(t / 0.18, 1);
      pose.blink = p < 0.5 ? p * 2 : (1 - p) * 2;
      pose.headY = Math.sin(p * Math.PI) * 0.8;
      break;
    }
    case 'wave': {
      const p = Math.min(t / 1.35, 1);
      const wave = Math.sin(p * Math.PI * 3) * 8;
      pose.armRightRotation = 20 + wave;
      pose.armRightY = -3;
      pose.headRotation = -1.5;
      pose.torsoRotation = -0.8;
      pose.rootY = Math.sin(p * Math.PI) * -2;
      pose.armLeftRotation = -8;
      break;
    }
    case 'jump': {
      const p = Math.min(t / 0.9, 1);
      if (p < 0.45) {
        const local = easeInOutSine(p / 0.45);
        pose.rootY = -24 * local;
      } else {
        const local = easeInOutSine((p - 0.45) / 0.55);
        pose.rootY = -24 * (1 - local);
      }
      if (p > 0.82) {
        const squash = (p - 0.82) / 0.18;
        pose.rootScaleY = 1 - squash * 0.025;
        pose.rootScaleX = 1 + squash * 0.02;
      }
      pose.headRotation = Math.sin(p * Math.PI * 2) * 1.2;
      pose.accessorySwing = Math.sin(p * Math.PI * 2) * 2.5;
      break;
    }
    case 'sleep': {
      const loop = (t / 4) * Math.PI * 2;
      pose.rootY = Math.sin(loop) * 2.5;
      pose.headRotation = 4 + Math.sin(loop + 0.5) * 0.8;
      pose.headY = 5 + Math.sin(loop) * 1.4;
      pose.torsoRotation = 1;
      pose.armLeftRotation = -10;
      pose.armRightRotation = 10;
      pose.sleepEyes = 1;
      pose.accessorySwing = Math.sin(loop) * 0.9;
      break;
    }
    case 'angry': {
      const p = Math.min(t / 0.55, 1);
      const shake = Math.sin(p * Math.PI * 8) * 6 * (1 - p * 0.35);
      pose.angryShake = shake;
      pose.headRotation = shake * 0.04;
      pose.torsoRotation = -shake * 0.025;
      pose.armLeftRotation = -9;
      pose.armRightRotation = 9;
      break;
    }
    default:
      break;
  }

  const blinkSeed = (Math.sin(t * 0.22) + 1) / 2;
  if (actionName === 'idle' && blinkSeed > 0.992) {
    pose.blink = Math.max(pose.blink, (blinkSeed - 0.992) / 0.008);
  }
  return pose;
}

function hideAllLayers() {
  [gifEl, seqEl, lottieEl, rigEl].forEach((el) => el.classList.remove('active'));
  if (lottieAnim) {
    lottieAnim.destroy();
    lottieAnim = null;
  }
  if (seqEl._raf) {
    cancelAnimationFrame(seqEl._raf);
    seqEl._raf = null;
  }
  if (rigEl._raf) {
    cancelAnimationFrame(rigEl._raf);
    rigEl._raf = null;
  }
  if (userRigState?.blinkTimer) {
    clearTimeout(userRigState.blinkTimer);
    userRigState.blinkTimer = null;
  }
}

function playGif(packName, action) {
  hideAllLayers();
  const pack = getActivePack();
  if (!pack) return;
  const src = action.src.startsWith('file://') ? action.src : `file://${encodeURI(pathJoinForFileUrl(pack.basePath, action.src))}`;
  gifEl.src = `${src}?t=${Date.now()}`;
  gifEl.classList.add('active');
}

function pathJoinForFileUrl(basePath, relativePath) {
  const normalizedBase = String(basePath || '').replace(/\\/g, '/');
  const normalizedRelative = String(relativePath || '').replace(/\\/g, '/');
  const joined = `${normalizedBase}/${normalizedRelative}`.replace(/\/+/g, '/');
  return /^[a-zA-Z]:\//.test(joined) ? `/${joined}` : joined;
}

async function playSequence(packName, action, preloadedImagesPromise) {
  const pack = getActivePack();
  if (!pack) return;
  const { frames, fps = 12, loop = true } = action;
  const images = preloadedImagesPromise
    ? await preloadedImagesPromise
    : await Promise.all(frames.map((f) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `file://${encodeURI(pathJoinForFileUrl(pack.basePath, f))}`;
      })));
  if (!images.length) return;

  if (preloadedImagesPromise) {
    // 编排模式：先画新帧再停旧动画，无缝切换
    if (seqEl._raf) { cancelAnimationFrame(seqEl._raf); seqEl._raf = null; }
    seqEl.width = images[0].naturalWidth;
    seqEl.height = images[0].naturalHeight;
    seqCtx.clearRect(0, 0, seqEl.width, seqEl.height);
    seqCtx.drawImage(images[0], 0, 0);
    seqEl.classList.add('active');
  } else {
    hideAllLayers();
    seqEl.width = images[0].naturalWidth;
    seqEl.height = images[0].naturalHeight;
    seqEl.classList.add('active');
  }

  const frameDuration = 1000 / fps;
  let i = preloadedImagesPromise ? 1 : 0;
  let last = performance.now();

  const tick = (now) => {
    if (now - last >= frameDuration) {
      seqCtx.clearRect(0, 0, seqEl.width, seqEl.height);
      seqCtx.drawImage(images[i], 0, 0);
      i += 1;
      if (i >= images.length) {
        if (isRandomMode()) {
          seqEl._raf = null;
          playRandomAction();
          return;
        }
        if (!loop) {
          seqEl._raf = null;
          return;
        }
        i = 0;
      }
      last = now;
    }
    seqEl._raf = requestAnimationFrame(tick);
  };
  seqEl._raf = requestAnimationFrame(tick);
}

function playLottie(packName, action) {
  hideAllLayers();
  const pack = getActivePack();
  if (!pack) return;
  lottieEl.classList.add('active');
  lottieAnim = window.lottie.loadAnimation({
    container: lottieEl,
    renderer: 'svg',
    loop: action.loop !== false,
    autoplay: true,
    path: `file://${encodeURI(pathJoinForFileUrl(pack.basePath, action.src))}`
  });
}

function scheduleIdleBlink() {
  if (!userRigState || !userRigEnabled) return;
  const delay = BLINK_INTERVAL_MIN + Math.random() * BLINK_INTERVAL_RANGE;
  userRigState.blinkTimer = setTimeout(() => {
    if (!userRigEnabled || currentActionName !== 'idle') return;
    playAction('blink');
  }, delay);
}

function playRig(actionName, action) {
  hideAllLayers();
  rigEl.classList.add('active');
  userRigState = {
    rig: action.rig,
    actionName,
    startedAt: performance.now(),
    duration: action.duration || 1,
    loop: action.loop !== false,
    blinkTimer: null
  };

  const tick = (now) => {
    if (!userRigState || currentActionName !== actionName || !userRigEnabled) return;
    const elapsed = (now - userRigState.startedAt) / 1000;
    const duration = userRigState.duration;
    const finished = !userRigState.loop && elapsed >= duration;
    const phase = userRigState.loop ? (elapsed % duration) : Math.min(elapsed, duration);
    const pose = computeRigPose(actionName, phase);
    renderRigFrame(userRigState.rig, pose);

    if (finished) {
      rigEl._raf = null;
      if (actionName !== 'idle' && userRigEnabled) {
        playAction('idle');
      } else if (actionName === 'idle') {
        scheduleIdleBlink();
      }
      return;
    }
    rigEl._raf = requestAnimationFrame(tick);
  };

  rigEl._raf = requestAnimationFrame(tick);
}

function playAction(actionName) {
  const pack = getActivePack();
  if (!pack) return;
  const action = pack.config.actions[actionName];
  if (!action) {
    console.warn(`Action not found: ${actionName}`);
    return;
  }
  currentAction = action;
  currentActionName = actionName;
  window.petAPI.reportAction(actionName);

  switch (action.type) {
    case 'gif':
      playGif(pack.name, action);
      break;
    case 'sequence':
      playSequence(pack.name, action, preloadedOrchImages);
      preloadedOrchImages = null;
      break;
    case 'lottie':
      playLottie(pack.name, action);
      break;
    case 'rig':
      playRig(actionName, action);
      break;
    default:
      console.warn(`Unknown action type: ${action.type}`);
  }

  if (isOrchestrationMode()) {
    startOrchestrationTimer(action);
  } else {
    startBehaviorForAction(action);
  }
}

let behaviorTimer = null;
let walkAnimTimer = null;

function isRandomMode() {
  return !userRigEnabled && currentPack && currentPack.config.defaultAction === '__random__';
}

function playRandomAction() {
  if (!currentPack) return;
  const actionNames = Object.keys(currentPack.config.actions);
  if (actionNames.length === 0) return;
  let pool = actionNames.filter((n) => n !== currentActionName);
  if (pool.length === 0) pool = actionNames;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  playAction(pick);
}

function stopBehaviors() {
  if (behaviorTimer) {
    clearTimeout(behaviorTimer);
    behaviorTimer = null;
  }
  if (walkAnimTimer) {
    cancelAnimationFrame(walkAnimTimer);
    walkAnimTimer = null;
  }
}

// ---- 动作编排 ----
function isOrchestrationMode() {
  return !!orchestrationState && !userRigEnabled;
}

function getActionDuration(action) {
  if (!action) return 3;
  if (action.type === 'sequence') {
    const fps = action.fps || 12;
    const frames = Array.isArray(action.frames) ? action.frames.length : 0;
    return frames / fps;
  }
  if (action.type === 'gif') return 3;
  if (action.type === 'lottie') return 3;
  if (action.type === 'rig') return action.duration || 1;
  return 3;
}

function stopOrchestrationTimer() {
  if (orchestrationTimer) {
    clearTimeout(orchestrationTimer);
    orchestrationTimer = null;
  }
}

function advanceOrchestration() {
  if (!isOrchestrationMode()) return;
  const { sequence } = orchestrationState;
  if (!sequence || sequence.length === 0) return;
  orchestrationState.index = (orchestrationState.index + 1) % sequence.length;
  const nextAction = sequence[orchestrationState.index];
  playAction(nextAction);
}

function preloadNextOrchAction() {
  if (!isOrchestrationMode()) return;
  const pack = getActivePack();
  if (!pack) return;
  const { sequence, index } = orchestrationState;
  const nextIndex = (index + 1) % sequence.length;
  const nextAction = pack.config.actions[sequence[nextIndex]];
  if (!nextAction || nextAction.type !== 'sequence' || !Array.isArray(nextAction.frames)) return;
  preloadedOrchImages = Promise.all(nextAction.frames.map(f => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `file://${encodeURI(pathJoinForFileUrl(pack.basePath, f))}`;
  })));
}

function startOrchestrationTimer(action) {
  stopOrchestrationTimer();
  if (!isOrchestrationMode()) return;
  preloadNextOrchAction();
  const duration = getActionDuration(action);
  const interval = parseFloat(orchestrationState.interval) || 3;
  const totalSeconds = duration + interval;
  orchestrationTimer = setTimeout(() => {
    orchestrationTimer = null;
    advanceOrchestration();
  }, totalSeconds * 1000);
}

function startOrchestration() {
  if (!currentPack) return;
  const orch = currentPack.config?.actionOrchestration;
  if (!orch || !orch.enabled || !Array.isArray(orch.sequence) || orch.sequence.length === 0) {
    orchestrationState = null;
    return;
  }
  orchestrationState = {
    sequence: orch.sequence,
    interval: orch.interval || 3000,
    index: 0
  };
  const firstAction = orch.sequence[0];
  playAction(firstAction);
}

function stopOrchestration() {
  stopOrchestrationTimer();
  orchestrationState = null;
  preloadedOrchImages = null;
}

function startBehaviorForAction(action) {
  stopBehaviors();
  if (userRigEnabled) return;
  if (action.behavior === 'walk') {
    startWalking(action.speed || 60);
  } else if (action.behavior === 'idle-random') {
    scheduleRandomAction();
  }
}

async function startWalking(speed) {
  const { width: screenW } = await window.petAPI.getScreenSize();
  let { x, y } = await window.petAPI.getPosition();
  let dir = Math.random() > 0.5 ? 1 : -1;
  petEl.classList.toggle('flip', dir < 0);

  let last = performance.now();
  const step = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    x += dir * speed * dt;
    if (x <= 0) {
      x = 0;
      dir = 1;
      petEl.classList.remove('flip');
    }
    if (x >= screenW - 240) {
      x = screenW - 240;
      dir = -1;
      petEl.classList.add('flip');
    }
    window.petAPI.move(x, y);
    walkAnimTimer = requestAnimationFrame(step);
  };
  walkAnimTimer = requestAnimationFrame(step);
}

function scheduleRandomAction() {
  const pool = Object.keys(currentPack.config.actions).filter((n) => {
    const a = currentPack.config.actions[n];
    return !a.behavior || a.behavior === 'idle-random';
  });
  const delay = 5000 + Math.random() * 10000;
  behaviorTimer = setTimeout(() => {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick && pick !== currentActionName) playAction(pick);
    else scheduleRandomAction();
  }, delay);
}

let dragState = null;
let isDragging = false;
const DRAG_THRESHOLD = 5;

petEl.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  const pos = await window.petAPI.getPosition();
  dragState = {
    startScreenX: e.screenX,
    startScreenY: e.screenY,
    startWinX: pos.x,
    startWinY: pos.y
  };
  isDragging = false;
  stopOrchestration();
  stopBehaviors();
});

window.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const dx = e.screenX - dragState.startScreenX;
  const dy = e.screenY - dragState.startScreenY;
  if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    isDragging = true;
  }
  if (isDragging) {
    window.petAPI.move(dragState.startWinX + dx, dragState.startWinY + dy);
  }
});

window.addEventListener('mouseup', () => {
  if (!dragState) return;
  dragState = null;
  isDragging = false;
  if (currentAction) startBehaviorForAction(currentAction);
});

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.petAPI.showContextMenu();
});

let BUBBLE_MESSAGES = [
  '喵~',
  '你好呀！',
  '摸摸我~',
  '加油哦！',
  '想我了？',
  '嘿嘿~',
  '好困…',
  '要小鱼干！',
  '干嘛呀？',
  '陪我玩~',
  '喵呜~ ♡',
  '天气真好~',
  '喜欢你！',
  '别戳啦~',
  '嗯？',
  '开心！'
];

async function loadMessages() {
  try {
    const config = await window.petAPI.getPacks();
    const pack = config[0];
    if (pack && pack.config.messages && pack.config.messages.length > 0) {
      BUBBLE_MESSAGES = pack.config.messages;
    }
  } catch {}
}

let bubbleTimer = null;

function showBubble() {
  const msg = BUBBLE_MESSAGES[Math.floor(Math.random() * BUBBLE_MESSAGES.length)];
  bubbleEl.textContent = msg;
  bubbleEl.classList.remove('hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubbleEl.classList.add('hidden');
    bubbleTimer = null;
  }, 3000);
}

petEl.addEventListener('dblclick', (e) => {
  e.preventDefault();
  showBubble();
});

let lastClickTime = 0;
petEl.addEventListener('click', () => {
  const now = Date.now();
  if (isDragging) return;
  if (now - lastClickTime < 400) {
    showBubble();
    lastClickTime = 0;
  } else {
    lastClickTime = now;
  }
});

let wheelBusy = false;
window.addEventListener('wheel', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (wheelBusy) return;
  wheelBusy = true;
  try {
    const currentSize = await window.petAPI.getSize();
    const step = e.shiftKey ? 10 : 30;
    const delta = e.deltaY < 0 ? step : -step;
    await window.petAPI.setSize(currentSize + delta);
  } finally {
    setTimeout(() => {
      wheelBusy = false;
    }, 40);
  }
}, { passive: false, capture: true });

async function loadPack(name) {
  const packs = await window.petAPI.getPacks();
  const pack = packs.find((p) => p.name === name) || packs[0];
  if (!pack) {
    console.error('No pet packs found under assets/pets/');
    return;
  }
  currentPack = pack;
  window.petAPI.reportPack(pack.name);
  if (userRigEnabled && generatedRigPack) {
    playAction('idle');
    return;
  }

  // Check for action orchestration
  const orch = pack.config?.actionOrchestration;
  if (orch && orch.enabled && Array.isArray(orch.sequence) && orch.sequence.length > 0) {
    // Validate that all actions in sequence exist
    const validSequence = orch.sequence.filter(n => pack.config.actions[n]);
    if (validSequence.length > 0) {
      stopOrchestration();
      orchestrationState = {
        sequence: validSequence,
        interval: parseFloat(orch.interval) || 3,
        index: 0
      };
      playAction(validSequence[0]);
      return;
    }
  }

  stopOrchestration();
  const defaultAction = pack.config.defaultAction;
  if (defaultAction === '__random__') {
    playRandomAction();
  } else {
    const action = defaultAction || Object.keys(pack.config.actions)[0];
    playAction(action);
  }
}

function updateRigPreviewLayout() {}

function enableUserRig(pack) {
  generatedRigPack = pack;
  userRigEnabled = true;
  petEl.classList.remove('flip');
  updateRigPreviewLayout(true);
  setStatus('已生成方案 A 骨骼预览。可点击下方动作按钮切换。');
  window.petAPI.setSize(520).catch((error) => {
    console.error('[rig-upload] failed to resize window after upload:', error);
  });
  playAction('idle');
}

function handleUploadSource(fileOrPath) {
  if (!fileOrPath) return;

  if (typeof fileOrPath === 'string') {
    const normalized = fileOrPath.replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || 'image';
    const fileUrlPath = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized;
    setStatus(`正在读取 ${fileName}...`);
    const img = new Image();
    img.onload = () => {
      const rig = buildRigFromImage(img);
      enableUserRig(createGeneratedRigPack(rig));
    };
    img.onerror = () => {
      console.error('[rig-upload] failed to load image from path:', normalized);
      setStatus('图片加载失败，请换一张 PNG/JPG/WEBP 再试。');
    };
    img.src = `file://${encodeURI(fileUrlPath)}`;
    return;
  }

  if (fileOrPath?.dataUrl) {
    setStatus(`正在读取 ${fileOrPath.name || 'image'}...`);
    const img = new Image();
    img.onload = () => {
      const rig = buildRigFromImage(img);
      enableUserRig(createGeneratedRigPack(rig));
    };
    img.onerror = () => {
      console.error('[rig-upload] failed to load image from data url:', fileOrPath.path);
      setStatus('图片加载失败，请换一张 PNG/JPG/WEBP 再试。');
    };
    img.src = fileOrPath.dataUrl;
    return;
  }

  const file = fileOrPath;
  const reader = new FileReader();
  setStatus(`正在读取 ${file.name}...`);
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const rig = buildRigFromImage(img);
      enableUserRig(createGeneratedRigPack(rig));
    };
    img.onerror = () => {
      setStatus('图片加载失败，请换一张 PNG/JPG/WEBP 再试。');
    };
    img.src = reader.result;
  };
  reader.onerror = () => {
    setStatus('读取文件失败，请重新上传。');
  };
  reader.readAsDataURL(file);
}

actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!userRigEnabled) {
      setStatus('请先上传角色图，再切换方案 A 动作。');
      return;
    }
    const action = button.dataset.rigAction;
    playAction(action);
  });
});

window.petAPI.onSetAction((name) => {
  stopOrchestration();
  if (userRigEnabled && generatedRigPack?.config.actions[name]) {
    playAction(name);
    return;
  }
  playAction(name);
});
window.petAPI.onLoadPack((name) => {
  stopOrchestration();
  userRigEnabled = false;
  updateRigPreviewLayout(false);
  setStatus('已切回默认宠物包。上传图片可重新进入方案 A 模式。');
  loadPack(name);
});
window.petAPI.onReloadConfig(() => {
  loadPack(currentPack?.name || 'default');
  loadMessages();
});

(async () => {
  const packs = await window.petAPI.getPacks();
  if (packs.length) {
    loadPack(packs[0].name);
    loadMessages();
  } else {
    document.body.innerHTML =
      '<div style="color:#fff;background:rgba(0,0,0,0.6);padding:12px;border-radius:8px;font-family:sans-serif;font-size:12px;">' +
      '放一个宠物包到 <code>assets/pets/&lt;name&gt;/</code><br>' +
      '并提供 <code>config.json</code> 再启动。<br>' +
      '右键退出。</div>';
    document.body.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.petAPI.showContextMenu();
    });
  }
})();
