const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');
const uploadZone = document.getElementById('upload-zone');
const videoInput = document.getElementById('video-input');
const uploadProgress = document.getElementById('upload-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const assetsGrid = document.getElementById('assets-grid');
const actionsList = document.getElementById('actions-list');
const messagesGrid = document.getElementById('messages-grid');
const showPetBtn = document.getElementById('show-pet-btn');
const petSizeSlider = document.getElementById('pet-size-slider');
const petSizeValue = document.getElementById('pet-size-value');
const petNameList = document.getElementById('pet-name-list');
const addPetNameBtn = document.getElementById('add-pet-name-btn');
const addActionBtn = document.getElementById('add-action-btn');
const addMessageBtn = document.getElementById('add-message-btn');
const actionModal = document.getElementById('action-modal');
const messageModal = document.getElementById('message-modal');
// petNameModal 不再使用
const assetPreviewModal = document.getElementById('asset-preview-modal');
const assetPreviewVideo = document.getElementById('asset-preview-video');
const assetPreviewEmpty = document.getElementById('asset-preview-empty');
const assetPreviewTitle = document.getElementById('asset-preview-title');
const actionForm = document.getElementById('action-form');
const messageForm = document.getElementById('message-form');
// petNameForm 不再使用

let currentEditAction = null;
let currentEditMessage = null;
let currentEditPetName = null;
let orchSequence = [];
let orchDirty = false;

function getDefaultMessages() {
  return [
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
}

async function refreshShowPetState() {
  const canShow = await window.panelAPI.canShowPet();
  showPetBtn.disabled = !canShow;
  showPetBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
    ${canShow ? '显示宠物' : '请先上传视频'}
  `;
}

function updatePetSizeValue(size) {
  if (!petSizeSlider || !petSizeValue) return;
  petSizeSlider.value = String(size);
  petSizeValue.textContent = `${size} px`;
}

async function loadPetSettings() {
  if (petSizeSlider && petSizeValue) {
    const size = await window.panelAPI.getPetSize();
    updatePetSizeValue(size);
  }

  if (petNameList) {
    await loadPetNames();
  }
}

async function loadPetNames() {
  const petNames = await window.panelAPI.getPetNames();
  petNameList.innerHTML = '';

  if (!petNames || petNames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-title">还没有猫咪名称</div>
      <div class="empty-state-text">请先添加猫咪名称，后续添加动作时可选择对应猫咪。</div>
    `;
    petNameList.appendChild(empty);
    return;
  }

  petNames.forEach((name, index) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `
      <div class="action-info">
        <div class="action-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9l-5 4.87L18.18 22 12 18.56 5.82 22 7 13.87 2 9l6.91-.74L12 2z"/>
          </svg>
        </div>
        <div>
          <div class="action-name">${name}</div>
          <div class="action-asset">${index === 0 ? '默认猫咪名称' : '可用于动作绑定'}</div>
        </div>
      </div>
      <div class="action-actions">
        <button class="icon-btn edit-pet-name" data-name="${name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn danger delete-pet-name" data-name="${name}" ${petNames.length <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `;
    petNameList.appendChild(card);
  });

  document.querySelectorAll('.edit-pet-name').forEach(btn => {
    btn.addEventListener('click', async () => {
      const oldName = btn.dataset.name;
      const newName = prompt('编辑猫咪名称:', oldName);
      if (!newName || newName.trim() === oldName) return;
      try {
        await window.panelAPI.savePetName({ name: newName.trim(), originalName: oldName });
        await loadPetNames();
        await loadActions();
      } catch (err) {
        alert('保存失败: ' + (err.message || err));
      }
    });
  });

  document.querySelectorAll('.delete-pet-name').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`确定要删除猫咪名称”${name}”吗？\n\n使用这个名称的动作会自动改绑到当前列表中的第一个猫咪名称。`)) return;
      try {
        await window.panelAPI.deletePetName(name);
      } catch (err) {
        alert('删除失败: ' + (err.message || err));
      }
      await loadPetNames();
      await loadActions();
    });
  });
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tab}`);
    });
  });
});

uploadZone.addEventListener('click', () => {
  videoInput.click();
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleVideoUpload(file);
});

videoInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleVideoUpload(file);
});

async function handleVideoUpload(file) {
  uploadZone.classList.add('hidden');
  uploadProgress.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '正在上传...';
  progressPercent.textContent = '0%';

  try {
    const result = await window.panelAPI.uploadVideo(file.path, progress => {
      progressFill.style.width = `${progress}%`;
      progressPercent.textContent = `${progress}%`;
      if (progress < 50) progressText.textContent = '正在提取帧...';
      else if (progress < 90) progressText.textContent = '正在去除背景...';
      else progressText.textContent = '正在完成...';
    });

    progressText.textContent = result.warning || '处理完成！';
    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';

    setTimeout(async () => {
      uploadZone.classList.remove('hidden');
      uploadProgress.classList.add('hidden');
      await loadAssets();
      await loadActions();
      await refreshShowPetState();
    }, 1000);

    return result;
  } catch (error) {
    progressText.textContent = `错误: ${error.message}`;
    setTimeout(() => {
      uploadZone.classList.remove('hidden');
      uploadProgress.classList.add('hidden');
    }, 3000);
  }
}

async function loadAssets() {
  const assets = await window.panelAPI.getAssets();
  assetsGrid.innerHTML = '';

  if (assets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-state-title">还没有可用素材</div>
      <div class="empty-state-text">请先上传视频，处理完成后这里才会出现可显示的宠物素材。</div>
    `;
    assetsGrid.appendChild(empty);
    return;
  }

  assets.forEach(asset => {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `
      <button class="asset-preview-trigger" data-name="${asset.name}" title="预览视频">
        <div class="asset-preview">
          <img src="file://${asset.preview}" alt="${asset.name}" />
          <div class="asset-preview-overlay">
            <span class="asset-preview-play">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              预览视频
            </span>
          </div>
        </div>
      </button>
      <div class="asset-info">
        <div class="asset-name">${asset.name}</div>
        <div class="asset-meta">${asset.frames} 帧${asset.video ? ' · 可预览原视频' : ''}</div>
      </div>
      <button class="asset-delete" data-name="${asset.name}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    card.dataset.assetName = asset.name;
    assetsGrid.appendChild(card);

    const previewTrigger = card.querySelector('.asset-preview-trigger');
    previewTrigger?.addEventListener('click', () => openAssetPreview(asset));
  });

  document.querySelectorAll('.asset-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const name = btn.dataset.name;
      if (!confirm(`确定要删除素材"${name}"吗？`)) return;
      await window.panelAPI.deleteAsset(name);
      await loadAssets();
      await loadActions();
      await refreshShowPetState();
    });
  });
}

async function loadActions() {
  const config = await window.panelAPI.getConfig();
  const actions = config.actions || {};
  actionsList.innerHTML = '';

  Object.entries(actions).forEach(([name, action]) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `
      <div class="action-info">
        <div class="action-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        <div>
          <div class="action-name">${name}</div>
          <div class="action-asset">${action.src || action.frames?.[0] || '未设置'}</div>
        </div>
      </div>
      <div class="action-actions">
        <button class="icon-btn edit-action" data-name="${name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn danger delete-action" data-name="${name}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;
    actionsList.appendChild(card);
  });

  document.querySelectorAll('.edit-action').forEach(btn => {
    btn.addEventListener('click', () => openActionModal(btn.dataset.name));
  });

  document.querySelectorAll('.delete-action').forEach(btn => {
    btn.addEventListener('click', () => deleteAction(btn.dataset.name));
  });
}

async function loadMessages() {
  const config = await window.panelAPI.getConfig();
  const messages = (config.messages && config.messages.length > 0)
    ? config.messages
    : getDefaultMessages();

  messagesGrid.innerHTML = '';

  messages.forEach((msg, index) => {
    const card = document.createElement('div');
    card.className = 'message-card';
    card.innerHTML = `
      <div class="message-text">${msg}</div>
      <div class="message-actions">
        <button class="icon-btn edit-message" data-index="${index}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn danger delete-message" data-index="${index}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;
    messagesGrid.appendChild(card);
  });

  document.querySelectorAll('.edit-message').forEach(btn => {
    btn.addEventListener('click', () => openMessageModal(parseInt(btn.dataset.index, 10)));
  });

  document.querySelectorAll('.delete-message').forEach(btn => {
    btn.addEventListener('click', () => deleteMessage(parseInt(btn.dataset.index, 10)));
  });
}

function openActionModal(name = null) {
  currentEditAction = name;
  const title = document.getElementById('modal-title');
  const nameInput = document.getElementById('action-name');
  const petSelect = document.getElementById('action-pet');
  const assetSelect = document.getElementById('action-asset');

  title.textContent = name ? '编辑动作' : '添加动作';
  nameInput.value = name || '';
  nameInput.disabled = false;

  Promise.all([loadActionPetOptions(), loadAssetOptions()]).then(() => {
    if (name) {
      window.panelAPI.getConfig().then(config => {
        const action = config.actions[name];
        if (action) {
          petSelect.value = action.petName || config.name || '';
          assetSelect.value = action.src || action.frames?.[0] || '';
          document.getElementById('action-loop').checked = action.loop !== false;
        }
      });
    } else {
      window.panelAPI.getPetName().then(petName => {
        petSelect.value = petName || '';
      });
      document.getElementById('action-loop').checked = true;
    }
  });

  actionModal.classList.remove('hidden');
}

async function loadAssetOptions() {
  const assetSelect = document.getElementById('action-asset');
  const assets = await window.panelAPI.getAssets();

  assetSelect.innerHTML = '<option value="">请选择素材</option>';
  assets.forEach(asset => {
    assetSelect.innerHTML += `<option value="${asset.name}">${asset.name} (${asset.frames}帧)</option>`;
  });
}

async function loadActionPetOptions() {
  const petSelect = document.getElementById('action-pet');
  const petNames = await window.panelAPI.getPetNames();

  petSelect.innerHTML = '<option value="">请选择猫咪</option>';
  petNames.forEach(name => {
    petSelect.innerHTML += `<option value="${name}">${name}</option>`;
  });
}

function closeActionModal() {
  actionModal.classList.add('hidden');
  currentEditAction = null;
  actionForm.reset();
}

function openMessageModal(index = null) {
  currentEditMessage = index;
  const title = document.getElementById('message-modal-title');
  const textInput = document.getElementById('message-text');

  title.textContent = index !== null ? '编辑消息' : '添加消息';

  if (index !== null) {
    window.panelAPI.getConfig().then(config => {
      const messages = (config.messages && config.messages.length > 0)
        ? config.messages
        : getDefaultMessages();
      textInput.value = messages[index] || '';
    });
  } else {
    textInput.value = '';
  }

  messageModal.classList.remove('hidden');
}

function closeMessageModal() {
  messageModal.classList.add('hidden');
  currentEditMessage = null;
  messageForm.reset();
}

function openAssetPreview(asset) {
  if (!assetPreviewModal || !assetPreviewVideo || !assetPreviewEmpty || !assetPreviewTitle) return;

  assetPreviewTitle.textContent = `${asset.name} · 视频预览`;
  assetPreviewVideo.pause();
  assetPreviewVideo.removeAttribute('src');
  assetPreviewVideo.load();

  if (asset.video) {
    assetPreviewVideo.src = `file://${asset.video}`;
    assetPreviewVideo.classList.remove('hidden');
    assetPreviewEmpty.classList.add('hidden');
  } else {
    assetPreviewVideo.classList.add('hidden');
    assetPreviewEmpty.classList.remove('hidden');
  }

  assetPreviewModal.classList.remove('hidden');
}

function closeAssetPreviewModal() {
  if (!assetPreviewModal || !assetPreviewVideo) return;
  assetPreviewModal.classList.add('hidden');
  assetPreviewVideo.pause();
  assetPreviewVideo.removeAttribute('src');
  assetPreviewVideo.load();
}

async function saveAction(e) {
  e.preventDefault();
  const name = document.getElementById('action-name').value.trim();
  const petName = document.getElementById('action-pet').value;
  const asset = document.getElementById('action-asset').value;
  const loop = document.getElementById('action-loop').checked;

  if (!name || !petName || !asset) return;

  await window.panelAPI.saveAction(name, { petName, asset, loop, originalName: currentEditAction });
  closeActionModal();
  await loadActions();
  await loadOrchestration();
  await refreshShowPetState();
}

async function deleteAction(name) {
  if (!confirm(`确定要删除动作"${name}"吗？`)) return;
  await window.panelAPI.deleteAction(name);
  await loadActions();
  await loadOrchestration();
  await refreshShowPetState();
}

// ---- 动作编排 ----
async function loadOrchestration() {
  const config = await window.panelAPI.getConfig();
  const orch = config.actionOrchestration || { enabled: false, interval: 3, sequence: [] };
  const actions = config.actions || {};
  const actionNames = Object.keys(actions);

  document.getElementById('orch-enabled').checked = !!orch.enabled;
  document.getElementById('orch-interval').value = orch.interval || 3000;

  // Filter out actions that no longer exist
  orchSequence = (orch.sequence || []).filter(n => actionNames.includes(n));
  orchDirty = false;

  renderOrchSequence();
  renderOrchAddOptions();
}

function renderOrchSequence() {
  const container = document.getElementById('orch-sequence');
  container.innerHTML = '';

  if (orchSequence.length === 0) {
    container.innerHTML = '<div class="orchestration-empty">尚未添加编排动作，请从下方选择动作添加</div>';
    return;
  }

  orchSequence.forEach((name, index) => {
    const item = document.createElement('div');
    item.className = 'orch-item';
    item.draggable = true;
    item.dataset.index = index;
    item.innerHTML = `
      <div class="orch-drag-handle" title="拖拽排序">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/>
          <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
          <circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>
        </svg>
      </div>
      <div class="orch-index">${index + 1}</div>
      <div class="orch-name">${name}</div>
      ${index < orchSequence.length - 1 ? '<div class="orch-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg></div>' : '<div class="orch-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></div>'}
      <button class="orch-remove" data-index="${index}" title="移除">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    // Drag events
    item.addEventListener('dragstart', e => {
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.orch-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const toIndex = parseInt(item.dataset.index, 10);
      if (fromIndex === toIndex) return;
      const [moved] = orchSequence.splice(fromIndex, 1);
      orchSequence.splice(toIndex, 0, moved);
      orchDirty = true;
      renderOrchSequence();
      saveOrchestration();
    });

    // Remove button
    item.querySelector('.orch-remove').addEventListener('click', () => {
      orchSequence.splice(index, 1);
      orchDirty = true;
      renderOrchSequence();
      renderOrchAddOptions();
      saveOrchestration();
    });

    container.appendChild(item);
  });
}

function renderOrchAddOptions() {
  const select = document.getElementById('orch-add-select');
  const config_promise = window.panelAPI.getConfig();
  config_promise.then(config => {
    const actions = config.actions || {};
    const available = Object.keys(actions).filter(n => !orchSequence.includes(n));
    select.innerHTML = '<option value="">选择要添加的动作</option>';
    available.forEach(name => {
      select.innerHTML += `<option value="${name}">${name}</option>`;
    });
    select.disabled = available.length === 0;
    document.getElementById('orch-add-btn').disabled = available.length === 0;
  });
}

function addToOrchestration() {
  const select = document.getElementById('orch-add-select');
  const name = select.value;
  if (!name || orchSequence.includes(name)) return;
  orchSequence.push(name);
  orchDirty = true;
  renderOrchSequence();
  renderOrchAddOptions();
  saveOrchestration();
}

async function saveOrchestration() {
  const enabled = document.getElementById('orch-enabled').checked;
  const interval = parseFloat(document.getElementById('orch-interval').value) || 3;

  // 开启编排时，如果序列为空，自动添加所有可用动作
  if (enabled && orchSequence.length === 0) {
    const config = await window.panelAPI.getConfig();
    const actionNames = Object.keys(config.actions || {});
    if (actionNames.length === 0) {
      document.getElementById('orch-enabled').checked = false;
      alert('没有可用的动作，请先添加动作后再开启编排。');
      return;
    }
    orchSequence = [...actionNames];
    orchDirty = true;
    renderOrchSequence();
    renderOrchAddOptions();
  }

  try {
    await window.panelAPI.saveOrchestration({ enabled, interval, sequence: orchSequence });
  } catch (e) {
    console.error('保存编排配置失败:', e);
  }
  orchDirty = false;
}

async function saveMessage(e) {
  e.preventDefault();
  const text = document.getElementById('message-text').value.trim();
  if (!text) return;

  await window.panelAPI.saveMessage(currentEditMessage, text);
  closeMessageModal();
  await loadMessages();
}

async function deleteMessage(index) {
  if (!confirm('确定要删除这条消息吗？')) return;
  await window.panelAPI.deleteMessage(index);
  await loadMessages();
}

addActionBtn.addEventListener('click', () => openActionModal());
addMessageBtn.addEventListener('click', () => openMessageModal());
addPetNameBtn.addEventListener('click', async () => {
  const name = prompt('请输入猫咪名称:');
  if (!name || !name.trim()) return;
  try {
    await window.panelAPI.savePetName({ name: name.trim() });
    await loadPetNames();
    await loadActions();
  } catch (err) {
    alert('保存失败: ' + (err.message || err));
  }
});

// 兜底：用事件委托确保添加猫咪按钮始终可用
document.addEventListener('click', async (e) => {
  if (e.target.closest('#add-pet-name-btn')) {
    const name = prompt('请输入猫咪名称:');
    if (!name || !name.trim()) return;
    try {
      await window.panelAPI.savePetName({ name: name.trim() });
      await loadPetNames();
      await loadActions();
    } catch (err) {
      alert('保存失败: ' + (err.message || err));
    }
  }
});

// 动作编排事件
document.getElementById('orch-add-btn').addEventListener('click', addToOrchestration);
document.getElementById('orch-enabled').addEventListener('change', async () => {
  await saveOrchestration();
});
document.getElementById('orch-interval').addEventListener('change', async () => {
  await saveOrchestration();
});
showPetBtn.addEventListener('click', async () => {
  const shown = await window.panelAPI.showPet();
  if (!shown) {
    await refreshShowPetState();
  }
});

if (petSizeSlider) {
  petSizeSlider.addEventListener('input', () => {
    updatePetSizeValue(Number(petSizeSlider.value));
  });

  petSizeSlider.addEventListener('change', async () => {
    const size = Number(petSizeSlider.value);
    await window.panelAPI.setPetSize(size);
    updatePetSizeValue(size);
  });
}

document.getElementById('modal-close').addEventListener('click', closeActionModal);
document.getElementById('modal-cancel').addEventListener('click', closeActionModal);
document.getElementById('message-modal-close').addEventListener('click', closeMessageModal);
document.getElementById('message-modal-cancel').addEventListener('click', closeMessageModal);
document.getElementById('asset-preview-close').addEventListener('click', closeAssetPreviewModal);

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) {
      closeActionModal();
      closeMessageModal();
      closeAssetPreviewModal();
    }
  });
});

actionForm.addEventListener('submit', saveAction);
messageForm.addEventListener('submit', saveMessage);
// petNameForm 不再使用，猫咪名称通过 prompt 管理

(async function init() {
  await loadAssets();
  await loadActions();
  await loadMessages();
  await loadPetSettings();
  await refreshShowPetState();
  await loadOrchestration();
})();

// 全局错误捕获
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});
window.onerror = function(msg, src, line, col, err) {
  console.error('Global error:', msg, src, line, col, err);
};
