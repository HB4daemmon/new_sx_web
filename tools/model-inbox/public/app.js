(() => {
  'use strict';

  const SESSION_KEY = 'modelInboxAccessKey';
  const DEFAULT_LIMITS = {
    maxFileBytes: 52428800,
    maxTotalBytes: 524288000,
    maxFiles: 200
  };
  const elements = {
    authView: document.getElementById('auth-view'),
    workspaceView: document.getElementById('workspace-view'),
    authForm: document.getElementById('auth-form'),
    accessKey: document.getElementById('access-key'),
    connectButton: document.getElementById('connect-button'),
    authMessage: document.getElementById('auth-message'),
    connectionLabel: document.getElementById('connection-label'),
    changeKey: document.getElementById('change-key'),
    singleLimit: document.getElementById('single-limit'),
    quotaUsed: document.getElementById('quota-used'),
    fileCount: document.getElementById('file-count'),
    dropZone: document.getElementById('drop-zone'),
    chooseFiles: document.getElementById('choose-files'),
    fileInput: document.getElementById('file-input'),
    queueList: document.getElementById('queue-list'),
    queueEmpty: document.getElementById('queue-empty'),
    queueCount: document.getElementById('queue-count'),
    uploadNote: document.getElementById('upload-note'),
    noteCount: document.getElementById('note-count'),
    uploadButton: document.getElementById('upload-button'),
    uploadMessage: document.getElementById('upload-message'),
    refreshRecords: document.getElementById('refresh-records'),
    recordsMessage: document.getElementById('records-message'),
    recordsList: document.getElementById('records-list'),
    recordsEmpty: document.getElementById('records-empty'),
    announcer: document.getElementById('announcer')
  };
  const state = {
    token: null,
    limits: { ...DEFAULT_LIMITS },
    usage: { bytes: 0, files: 0 },
    records: [],
    queue: [],
    uploadingBatch: false,
    activeRequest: null,
    nextQueueId: 1
  };
  const queueNodes = new Map();

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function makeIcon(name) {
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', name);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function updateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function setMessage(node, text, isError = false) {
    node.textContent = text || '';
    node.classList.toggle('is-error', Boolean(isError && text));
  }

  function announce(text) {
    elements.announcer.textContent = '';
    window.requestAnimationFrame(() => {
      elements.announcer.textContent = text;
    });
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.floor(bytes)} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let amount = bytes / 1024;
    let unit = units[0];
    for (let index = 1; amount >= 1024 && index < units.length; index += 1) {
      amount /= 1024;
      unit = units[index];
    }
    return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
  }

  function formatLimitMiB(value) {
    const amount = Number(value) / (1024 * 1024);
    if (!Number.isFinite(amount)) return '50 MiB';
    return `${Number.isInteger(amount) ? amount : amount.toFixed(1)} MiB`;
  }

  function updateUsage() {
    elements.singleLimit.textContent = formatLimitMiB(state.limits.maxFileBytes);
    elements.quotaUsed.textContent =
      `${formatBytes(state.usage.bytes)} / ${formatLimitMiB(state.limits.maxTotalBytes)}`;
    elements.fileCount.textContent = `${state.usage.files} / ${state.limits.maxFiles}`;
  }

  function setAuthView(message = '', isError = false, pending = false) {
    elements.workspaceView.hidden = true;
    elements.authView.hidden = false;
    elements.connectionLabel.textContent = pending ? '连接中' : '未连接';
    elements.authMessage.textContent = message;
    elements.authMessage.classList.toggle('is-error', Boolean(isError && message));
    elements.connectButton.disabled = pending;
    elements.accessKey.disabled = pending;
  }

  function saveToken(token) {
    state.token = token;
    try {
      window.sessionStorage.setItem(SESSION_KEY, token);
    } catch {
      setMessage(elements.authMessage, '浏览器无法保存本次会话密钥。', true);
      return false;
    }
    return true;
  }

  function clearToken() {
    state.token = null;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // The in-memory token is cleared even if session storage is unavailable.
    }
  }

  function parseResponse(response) {
    return response.json().catch(() => ({}));
  }

  function describeApiError(payload, fallback) {
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      const messages = {
        'Invalid file name': '文件名无效，请移除路径符号或控制字符。',
        'File is too large': '文件超过单文件限额。',
        'Upload note is too long': '备注超过 2000 字。',
        'Too many active uploads': '当前上传较多，请稍后重试。',
        'Inbox file limit reached': '收件箱文件数已满。',
        'Inbox storage limit reached': '收件箱剩余空间不足。',
        'Inbox storage is unavailable': '存储空间暂不可用，请稍后重试。',
        'Upload timed out': '上传超时，请重试。',
        'Upload interrupted': '上传已中断，请重试。',
        'Request origin is not allowed': '访问来源不匹配，请使用原始访问地址。',
        'Not found': '文件不存在。',
      };
      return messages[payload.error.trim()] || fallback;
    }
    return fallback;
  }

  function showUnauthorized() {
    clearToken();
    setAuthView('访问密钥无效或已失效，请重新连接。', true);
    elements.accessKey.value = '';
    elements.accessKey.focus();
  }

  function updateAppView(data) {
    if (data && data.limits && typeof data.limits === 'object') {
      state.limits = {
        maxFileBytes: positiveNumber(data.limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes),
        maxTotalBytes: positiveNumber(data.limits.maxTotalBytes, DEFAULT_LIMITS.maxTotalBytes),
        maxFiles: positiveNumber(data.limits.maxFiles, DEFAULT_LIMITS.maxFiles)
      };
    }
    if (data && data.usage && typeof data.usage === 'object') {
      state.usage = {
        bytes: positiveNumber(data.usage.bytes, 0),
        files: positiveNumber(data.usage.files, 0)
      };
    }
    if (data && Array.isArray(data.files)) state.records = data.files;
    updateUsage();
    renderRecords();
    renderQueue();
    elements.authView.hidden = true;
    elements.workspaceView.hidden = false;
    setMessage(elements.authMessage, '');
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  async function connectWithToken(token, persist) {
    const candidate = String(token || '').trim();
    if (!candidate) {
      setAuthView('请输入访问密钥。', true);
      elements.accessKey.focus();
      return;
    }

    state.token = candidate;
    setAuthView('正在验证访问密钥…', false, true);
    try {
      const response = await fetch('/api/uploads', {
        method: 'GET',
        headers: { Authorization: `Bearer ${candidate}` },
        cache: 'no-store'
      });
      const payload = await parseResponse(response);
      if (state.token !== candidate) return;
      if (response.status === 401) {
        clearToken();
        setAuthView('访问密钥无效或已失效，请检查后重试。', true);
        elements.accessKey.value = '';
        elements.accessKey.focus();
        return;
      }
      if (!response.ok) {
        state.token = null;
        setAuthView(describeApiError(payload, '无法连接，请稍后重试。'), true);
        elements.accessKey.value = '';
        return;
      }
      if (persist && !saveToken(candidate)) {
        state.token = null;
        setAuthView('浏览器无法保存本次会话密钥，请检查隐私设置后重试。', true);
        elements.accessKey.value = '';
        return;
      }
      state.token = candidate;
      elements.accessKey.value = '';
      updateAppView(payload);
      setMessage(elements.recordsMessage, '');
      setMessage(elements.uploadMessage, '');
    } catch {
      state.token = null;
      setAuthView('连接失败，请检查网络后重试。', true);
      elements.accessKey.value = '';
    } finally {
      elements.connectButton.disabled = false;
      elements.accessKey.disabled = false;
      updateIcons();
    }
  }

  async function loadRecords(options = {}) {
    if (!state.token) return false;
    const token = state.token;
    const showLoading = options.showLoading !== false;
    if (showLoading) {
      setMessage(elements.recordsMessage, '正在读取记录…');
      elements.refreshRecords.disabled = true;
    }
    try {
      const response = await fetch('/api/uploads', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const payload = await parseResponse(response);
      if (state.token !== token) return false;
      if (response.status === 401) {
        showUnauthorized();
        return false;
      }
      if (!response.ok) {
        setMessage(
          elements.recordsMessage,
          describeApiError(payload, '读取记录失败，请重试。'),
          true
        );
        return false;
      }
      updateAppView(payload);
      setMessage(elements.recordsMessage, '');
      return true;
    } catch {
      setMessage(elements.recordsMessage, '读取记录失败，请检查网络后重试。', true);
      return false;
    } finally {
      elements.refreshRecords.disabled = false;
    }
  }

  function makeActionButton(iconName, title, className, callback) {
    const button = makeElement('button', `button button-subtle button-icon ${className || ''}`);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(makeIcon(iconName));
    button.addEventListener('click', callback);
    return button;
  }

  function getQueueStatus(item) {
    if (item.status === 'success') return ['已上传', 'is-success'];
    if (item.status === 'uploading') return [`上传中 ${Math.floor(item.progress)}%`, ''];
    if (item.status === 'failed' || item.status === 'cancelled' || item.status === 'blocked') {
      return [item.error || '上传失败', 'is-error'];
    }
    return ['等待上传', ''];
  }

  function renderQueue() {
    elements.queueList.replaceChildren();
    queueNodes.clear();
    const hasItems = state.queue.length > 0;
    elements.queueEmpty.hidden = hasItems;
    elements.queueCount.textContent = `${state.queue.length} 个文件`;

    for (const item of state.queue) {
      const row = makeElement('li', 'queue-item');
      const fileName = makeElement('span', 'queue-file', item.file.name);
      const meta = makeElement('div', 'queue-meta');
      const size = makeElement('span', '', formatBytes(item.file.size));
      const [statusText, statusClass] = getQueueStatus(item);
      const status = makeElement('span', `queue-status ${statusClass}`, statusText);
      const actions = makeElement('div', 'queue-actions');
      const progress = makeElement('progress', 'queue-progress');
      progress.max = 100;
      progress.value = item.progress;
      progress.setAttribute('aria-label', '文件上传进度');
      progress.hidden = item.status !== 'uploading';

      meta.append(size, status);
      row.append(fileName, actions, meta, progress);

      if (item.status === 'uploading') {
        actions.append(makeActionButton('x', '取消上传', 'button-danger', () => cancelItem(item)));
      } else if (item.status === 'failed' || item.status === 'cancelled') {
        const retry = makeActionButton('rotate-ccw', '重试上传', '', () => retryItem(item));
        retry.disabled = !state.token || state.uploadingBatch;
        actions.append(retry);
      }
      if (item.status !== 'uploading' && item.status !== 'success') {
        actions.append(makeActionButton('trash-2', '移除此文件', 'button-danger', () => removeItem(item)));
      }
      queueNodes.set(item.id, { status, progress });
      elements.queueList.append(row);
    }
    updateUploadButton();
    updateIcons();
  }

  function updateQueueProgress(item) {
    const nodes = queueNodes.get(item.id);
    if (!nodes) return;
    nodes.progress.value = item.progress;
    nodes.status.textContent = `上传中 ${Math.floor(item.progress)}%`;
  }

  function updateUploadButton() {
    const canUpload = state.queue.some(item => item.status === 'queued' || item.status === 'failed' || item.status === 'cancelled');
    elements.uploadButton.disabled = !state.token || !canUpload || state.uploadingBatch;
  }

  function queueFile(file) {
    if (!file) return;
    const item = {
      id: state.nextQueueId++,
      file,
      status: 'queued',
      progress: 0,
      error: '',
      xhr: null,
      cancelRequested: false
    };
    if (file.size > state.limits.maxFileBytes) {
      item.status = 'blocked';
      item.error = `超过单文件限额 ${formatLimitMiB(state.limits.maxFileBytes)}`;
    } else if (state.usage.files + state.queue.filter(entry => entry.status !== 'success').length >= state.limits.maxFiles) {
      item.status = 'blocked';
      item.error = '已达到文件总数限额';
    }
    state.queue.push(item);
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) queueFile(file);
    elements.fileInput.value = '';
    setMessage(elements.uploadMessage, '');
    renderQueue();
  }

  function removeItem(item) {
    if (item.status === 'uploading' || item.status === 'success') return;
    state.queue = state.queue.filter(entry => entry.id !== item.id);
    renderQueue();
  }

  function cancelItem(item) {
    if (!item.xhr) return;
    item.cancelRequested = true;
    item.xhr.abort();
  }

  function validateBeforeUpload(item) {
    if (item.file.size > state.limits.maxFileBytes) {
      item.status = 'blocked';
      item.error = `超过单文件限额 ${formatLimitMiB(state.limits.maxFileBytes)}`;
      return false;
    }
    if (state.usage.files >= state.limits.maxFiles) {
      item.status = 'blocked';
      item.error = '已达到文件总数限额';
      return false;
    }
    if (state.usage.bytes + item.file.size > state.limits.maxTotalBytes) {
      item.status = 'blocked';
      item.error = '剩余总配额不足';
      return false;
    }
    return true;
  }

  function xhrError(xhr, fallback) {
    try {
      const payload = JSON.parse(xhr.responseText || '{}');
      return describeApiError(payload, fallback);
    } catch {
      return fallback;
    }
  }

  function uploadItem(item) {
    return new Promise(resolve => {
      if (!state.token) {
        item.status = 'failed';
        item.error = '请重新连接后重试';
        renderQueue();
        resolve(false);
        return;
      }
      if (!validateBeforeUpload(item)) {
        renderQueue();
        resolve(true);
        return;
      }

      const token = state.token;
      const xhr = new XMLHttpRequest();
      item.xhr = xhr;
      item.status = 'uploading';
      item.progress = 0;
      item.error = '';
      item.cancelRequested = false;
      state.activeRequest = xhr;
      renderQueue();
      setMessage(elements.uploadMessage, `正在上传：${item.file.name}`);
      xhr.upload.addEventListener('progress', event => {
        if (!event.lengthComputable || event.total <= 0) return;
        item.progress = Math.min(100, (event.loaded / event.total) * 100);
        updateQueueProgress(item);
      });

      xhr.onload = async () => {
        const payload = (() => {
          try {
            return JSON.parse(xhr.responseText || '{}');
          } catch {
            return {};
          }
        })();
        item.xhr = null;
        state.activeRequest = null;
        if (xhr.status === 201 && payload.file) {
          item.status = 'success';
          item.progress = 100;
          item.error = '';
          const uploadedSize = positiveNumber(payload.file.size, item.file.size);
          state.usage.bytes += uploadedSize;
          state.usage.files += 1;
          updateUsage();
          renderQueue();
          announce(`上传完成：${item.file.name}`);
          await loadRecords({ showLoading: false });
          resolve(true);
          return;
        }
        if (xhr.status === 401) {
          item.status = 'failed';
          item.error = '访问密钥已失效';
          renderQueue();
          showUnauthorized();
          resolve(false);
          return;
        }
        item.status = 'failed';
        item.error = xhrError(xhr, `上传失败（${xhr.status || '网络错误'}）`);
        renderQueue();
        setMessage(elements.uploadMessage, `上传失败：${item.error}`, true);
        resolve(true);
      };

      xhr.onerror = () => {
        item.xhr = null;
        state.activeRequest = null;
        item.status = 'failed';
        item.error = '网络错误，可重试';
        renderQueue();
        setMessage(elements.uploadMessage, item.error, true);
        resolve(true);
      };

      xhr.onabort = () => {
        item.xhr = null;
        state.activeRequest = null;
        item.status = 'cancelled';
        item.error = item.cancelRequested ? '已取消，可重试' : '上传已中断，可重试';
        renderQueue();
        setMessage(elements.uploadMessage, item.error);
        resolve(true);
      };

      try {
        xhr.open('POST', '/api/uploads');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
        xhr.setRequestHeader('X-Upload-Note', encodeURIComponent(Array.from(elements.uploadNote.value).slice(0, 2000).join('')));
        xhr.send(item.file);
      } catch {
        item.xhr = null;
        state.activeRequest = null;
        item.status = 'failed';
        item.error = '无法开始上传，可重试';
        renderQueue();
        setMessage(elements.uploadMessage, item.error, true);
        resolve(true);
      }
    });
  }

  async function uploadPending(items) {
    if (state.uploadingBatch || !state.token) return;
    state.uploadingBatch = true;
    setMessage(elements.uploadMessage, '');
    renderQueue();
    try {
      for (const item of items) {
        if (!state.token) break;
        if (item.status !== 'queued' && item.status !== 'failed' && item.status !== 'cancelled') continue;
        const shouldContinue = await uploadItem(item);
        if (!shouldContinue) break;
      }
    } finally {
      state.uploadingBatch = false;
      renderQueue();
      if (state.token && !state.queue.some(item => item.status === 'queued' || item.status === 'failed' || item.status === 'cancelled')) {
        setMessage(elements.uploadMessage, '上传队列已完成。');
      }
    }
  }

  async function retryItem(item) {
    if (!state.token || state.uploadingBatch || item.status === 'success' || item.status === 'blocked') return;
    state.uploadingBatch = true;
    renderQueue();
    try {
      await uploadItem(item);
    } finally {
      state.uploadingBatch = false;
      renderQueue();
    }
  }

  function dateLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString();
  }

  function copyText(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value);
    }
    return new Promise((resolve, reject) => {
      const temporary = document.createElement('textarea');
      temporary.value = value;
      temporary.setAttribute('readonly', '');
      temporary.className = 'visually-hidden';
      document.body.append(temporary);
      temporary.select();
      const copied = document.execCommand('copy');
      temporary.remove();
      copied ? resolve() : reject(new Error('copy failed'));
    });
  }

  function renderRecord(record) {
    const safeRecord = record && typeof record === 'object' ? record : {};
    const name = typeof safeRecord.originalName === 'string' ? safeRecord.originalName : '未命名文件';
    const id = typeof safeRecord.id === 'string' ? safeRecord.id : '';
    const item = makeElement('li', 'record-item');
    const main = makeElement('div', 'record-main');
    const filename = makeElement('span', 'record-name', name);
    const metadata = makeElement('div', 'record-meta');
    const uploadedAt = makeElement('span', '', dateLabel(safeRecord.uploadedAt));
    const size = makeElement('span', '', formatBytes(safeRecord.size));
    const shortId = makeElement('span', 'record-id', id ? `#${id.slice(0, 8)}` : '无记录 ID');
    const status = makeElement('span', 'record-state', '待审查');
    metadata.append(uploadedAt, size, shortId);
    main.append(filename, status, metadata);

    const actions = makeElement('div', 'record-actions');
    const download = makeElement('button', 'button button-subtle');
    download.type = 'button';
    download.title = '下载附件';
    download.setAttribute('aria-label', '下载此附件');
    download.append(makeIcon('download'), makeElement('span', '', '下载'));
    download.addEventListener('click', () => downloadRecord(safeRecord, download));

    const details = document.createElement('details');
    details.className = 'record-details';
    const summary = makeElement('summary', '', '详情');
    const detailGrid = makeElement('div', 'record-detail-grid');
    const idLabel = makeElement('span', '', '完整记录 ID');
    const idRow = makeElement('div', 'record-detail-id');
    const fullId = makeElement('code', '', id || '无');
    const copyId = makeActionButton('copy', '复制完整 ID', '', async () => {
      if (!id) return;
      try {
        await copyText(id);
        announce('已复制完整记录 ID');
      } catch {
        announce('复制失败');
      }
    });
    idRow.append(fullId, copyId);
    const shaLabel = makeElement('span', '', 'SHA-256');
    const sha = makeElement('code', '', typeof safeRecord.sha256 === 'string' ? safeRecord.sha256 : '无');
    const noteLabel = makeElement('span', '', '备注');
    const note = makeElement('p', 'record-note', typeof safeRecord.note === 'string' ? safeRecord.note : '无');
    detailGrid.append(idLabel, idRow, shaLabel, sha, noteLabel, note);
    details.append(summary, detailGrid);

    actions.append(download);
    item.append(main, actions, details);
    return item;
  }

  function renderRecords() {
    elements.recordsList.replaceChildren();
    for (const record of state.records) elements.recordsList.append(renderRecord(record));
    elements.recordsEmpty.hidden = state.records.length > 0;
    updateIcons();
  }

  async function downloadRecord(record, button) {
    if (!state.token || !record || typeof record.id !== 'string') return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/uploads/${encodeURIComponent(record.id)}/download`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${state.token}` },
        cache: 'no-store'
      });
      if (response.status === 401) {
        showUnauthorized();
        return;
      }
      if (!response.ok) {
        const payload = await parseResponse(response);
        setMessage(elements.recordsMessage, describeApiError(payload, '下载失败，请重试。'), true);
        return;
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = typeof record.originalName === 'string' ? record.originalName : 'attachment';
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setMessage(elements.recordsMessage, '');
    } catch {
      setMessage(elements.recordsMessage, '下载失败，请检查网络后重试。', true);
    } finally {
      button.disabled = false;
    }
  }

  function onBeforeUnload(event) {
    if (!state.activeRequest) return;
    event.preventDefault();
    event.returnValue = '';
  }

  function readTokenFromHash(hash) {
    const rawParams = hash.startsWith('#') ? hash.slice(1) : hash;
    const entry = rawParams.split('&').find(part => part.startsWith('token='));
    if (!entry) return { found: false, token: null };
    const rawToken = entry.slice('token='.length);
    try {
      return { found: true, token: decodeURIComponent(rawToken) };
    } catch {
      return { found: true, token: rawToken };
    }
  }

  elements.authForm.addEventListener('submit', event => {
    event.preventDefault();
    const candidate = elements.accessKey.value;
    elements.accessKey.value = '';
    connectWithToken(candidate, true);
  });

  elements.changeKey.addEventListener('click', () => {
    if (state.activeRequest) state.activeRequest.abort();
    clearToken();
    setAuthView('');
    elements.accessKey.value = '';
    elements.accessKey.focus();
  });

  elements.chooseFiles.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => addFiles(elements.fileInput.files));
  elements.dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    elements.dropZone.classList.add('is-dragging');
  });
  elements.dropZone.addEventListener('dragleave', event => {
    if (!elements.dropZone.contains(event.relatedTarget)) elements.dropZone.classList.remove('is-dragging');
  });
  elements.dropZone.addEventListener('drop', event => {
    event.preventDefault();
    elements.dropZone.classList.remove('is-dragging');
    addFiles(event.dataTransfer && event.dataTransfer.files);
  });
  elements.dropZone.addEventListener('keydown', event => {
    if (
      event.target !== elements.chooseFiles &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
  window.addEventListener('dragover', event => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', event => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files')) event.preventDefault();
  });
  elements.uploadNote.addEventListener('input', () => {
    const characters = Array.from(elements.uploadNote.value);
    if (characters.length > 2000) elements.uploadNote.value = characters.slice(0, 2000).join('');
    elements.noteCount.textContent = `${Math.min(characters.length, 2000)} / 2000`;
  });
  elements.uploadButton.addEventListener('click', () => {
    uploadPending(state.queue.filter(item => item.status === 'queued' || item.status === 'failed' || item.status === 'cancelled'));
  });
  elements.refreshRecords.addEventListener('click', () => loadRecords());
  window.addEventListener('beforeunload', onBeforeUnload);

  function initialize() {
    const hash = window.location.hash;
    const hashToken = readTokenFromHash(hash);
    let tokenFromHash = null;
    if (hashToken.found) {
      tokenFromHash = hashToken.token;
      if (tokenFromHash) {
        try {
          window.sessionStorage.setItem(SESSION_KEY, tokenFromHash);
        } catch {
          // The user can enter the key again if storage is unavailable.
        }
      }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    let storedToken = null;
    try {
      storedToken = window.sessionStorage.getItem(SESSION_KEY);
    } catch {
      storedToken = null;
    }
    const token = tokenFromHash || storedToken;
    if (token) {
      setAuthView('正在连接…', false, true);
      connectWithToken(token, false);
    } else {
      setAuthView();
    }
    updateIcons();
  }

  window.addEventListener('hashchange', initialize);
  initialize();
})();
