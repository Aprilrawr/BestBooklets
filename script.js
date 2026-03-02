const STORAGE_KEY = 'booklet-planner-v3';
const VERSION = 3;
const DEFAULT_PAGES = 82;

const pagesInput = document.getElementById('pagesInput');
const applyPagesButton = document.getElementById('applyPagesButton');
const pagesBadge = document.getElementById('pagesBadge');
const spreadsContainer = document.getElementById('spreadsContainer');
const labelsList = document.getElementById('labelsList');
const addLabelButton = document.getElementById('addLabelButton');
const resetPlacementsButton = document.getElementById('resetPlacementsButton');
const stageWrap = document.getElementById('stage-wrap');
const scaleRoot = document.getElementById('scale-root');

let selectedLabelId = null;
let activeDragLabelId = null;
let pointerDrag = null;
let state = loadState();

function isPageDroppable(page) {
  return !isLockedPage(page) && !isPageLockedBySpan(page);
}

function clearDropTargets() {
  document.querySelectorAll('.page-cell.drop-target').forEach((node) => {
    node.classList.remove('drop-target');
  });
}

function pageFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  const cell = element?.closest?.('.page-cell[data-page]');
  if (!cell) {
    return null;
  }
  const page = Number(cell.dataset.page);
  if (!Number.isInteger(page) || !isPageDroppable(page)) {
    return null;
  }
  return { page, cell };
}

function beginPointerDrag(event, labelId, labelText) {
  if (event.button !== 0) {
    return;
  }

  if (event.pointerType && event.pointerType !== 'mouse') {
    return;
  }

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = labelText;
  document.body.append(ghost);

  pointerDrag = {
    labelId,
    ghost,
    targetPage: null
  };

  ghost.style.left = `${event.clientX + 12}px`;
  ghost.style.top = `${event.clientY + 12}px`;
}

function updatePointerDrag(event) {
  if (!pointerDrag) {
    return;
  }

  pointerDrag.ghost.style.left = `${event.clientX + 12}px`;
  pointerDrag.ghost.style.top = `${event.clientY + 12}px`;

  clearDropTargets();
  const hit = pageFromPoint(event.clientX, event.clientY);
  if (!hit) {
    pointerDrag.targetPage = null;
    return;
  }

  pointerDrag.targetPage = hit.page;
  hit.cell.classList.add('drop-target');
}

function endPointerDrag() {
  if (!pointerDrag) {
    return;
  }

  const { labelId, targetPage, ghost } = pointerDrag;
  ghost.remove();
  clearDropTargets();

  if (targetPage) {
    const ok = placeLabelOnPage(labelId, targetPage);
    if (ok) {
      selectedLabelId = null;
    }
  }

  pointerDrag = null;
  render();
}

function createLabelId() {
  return `label-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function ensureEvenPages(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PAGES;
  }

  let next = Math.max(2, Math.floor(value));
  if (next % 2 !== 0) {
    next += 1;
  }
  return next;
}

function buildRowOrder(pages) {
  const order = [];
  for (let left = 1; left <= pages; left += 2) {
    order.push(left);
  }
  return order;
}

function createDefaultState() {
  const pages = DEFAULT_PAGES;
  const placements = {};

  for (let page = 1; page <= pages; page += 1) {
    placements[page] = [];
  }

  return {
    version: VERSION,
    pages,
    labels: [
      { id: createLabelId(), text: 'Casa del Mar' },
      { id: createLabelId(), text: 'Sunrise Suites' },
      { id: createLabelId(), text: 'Blue Horizon' }
    ],
    placements,
    spans: {},
    rowOrder: buildRowOrder(pages)
  };
}

function sanitizeState(raw) {
  const fallback = createDefaultState();

  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const pages = ensureEvenPages(Number(raw.pages));
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((label) => label && typeof label.id === 'string' && typeof label.text === 'string')
        .map((label) => ({ id: label.id, text: label.text.trim() || 'Untitled' }))
    : fallback.labels;

  const placements = {};
  for (let page = 1; page <= pages; page += 1) {
    const current = raw.placements?.[page];
    const safe = Array.isArray(current) ? current : [];
    placements[page] = safe
      .filter((id, index) => typeof id === 'string' && labels.some((label) => label.id === id) && safe.indexOf(id) === index)
      .slice(0, 4);
  }

  placements[1] = [];
  placements[2] = [];

  const rowOrder = Array.isArray(raw.rowOrder)
    ? raw.rowOrder.filter((page) => Number.isInteger(page) && page >= 1 && page <= pages - 1 && page % 2 === 1)
    : [];

  const uniqueRowOrder = [];
  for (const leftPage of rowOrder) {
    if (!uniqueRowOrder.includes(leftPage)) {
      uniqueRowOrder.push(leftPage);
    }
  }

  const expectedRows = pages / 2;
  let finalRowOrder = uniqueRowOrder;
  if (finalRowOrder.length !== expectedRows) {
    finalRowOrder = buildRowOrder(pages);
  }

  const spans = {};
  if (raw.spans && typeof raw.spans === 'object') {
    for (const [anchorKey, span] of Object.entries(raw.spans)) {
      const anchor = Number(anchorKey);
      if (!Number.isInteger(anchor) || anchor < 3 || anchor > pages) {
        continue;
      }
      if (!span || typeof span.labelId !== 'string') {
        continue;
      }
      const exists = labels.some((label) => label.id === span.labelId);
      if (!exists) {
        continue;
      }

      const pairLeft = anchor % 2 === 1 ? anchor : anchor - 1;
      if (pairLeft < 3 || pairLeft + 1 > pages) {
        continue;
      }

      placements[pairLeft] = placements[pairLeft].filter((id) => id !== span.labelId);
      placements[pairLeft + 1] = placements[pairLeft + 1].filter((id) => id !== span.labelId);
      spans[anchor] = { labelId: span.labelId, dir: 'next' };
    }
  }

  return {
    version: VERSION,
    pages,
    labels,
    placements,
    spans,
    rowOrder: finalRowOrder
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getLabelById(labelId) {
  return state.labels.find((label) => label.id === labelId) || null;
}

function getPlacedIds() {
  const placed = new Set();

  for (let page = 1; page <= state.pages; page += 1) {
    for (const id of state.placements[page] || []) {
      placed.add(id);
    }
  }

  for (const span of Object.values(state.spans)) {
    if (span?.labelId) {
      placed.add(span.labelId);
    }
  }

  return placed;
}

function getAvailableLabels() {
  const placed = getPlacedIds();
  return state.labels.filter((label) => !placed.has(label.id));
}

function getRowSpan(leftPage) {
  if (state.spans[leftPage]) {
    return { anchor: leftPage, labelId: state.spans[leftPage].labelId };
  }
  if (state.spans[leftPage + 1]) {
    return { anchor: leftPage + 1, labelId: state.spans[leftPage + 1].labelId };
  }
  return null;
}

function isLockedPage(page) {
  return page === 1 || page === 2;
}

function isPageLockedBySpan(page) {
  const left = page % 2 === 1 ? page : page - 1;
  return Boolean(getRowSpan(left));
}

function findLabelLocation(labelId) {
  for (let page = 1; page <= state.pages; page += 1) {
    if ((state.placements[page] || []).includes(labelId)) {
      return { type: 'page', page };
    }
  }

  for (const [anchor, span] of Object.entries(state.spans)) {
    if (span.labelId === labelId) {
      return { type: 'span', anchor: Number(anchor) };
    }
  }

  return null;
}

function removeLabelFromCurrentLocation(labelId) {
  const location = findLabelLocation(labelId);
  if (!location) {
    return;
  }

  if (location.type === 'page') {
    state.placements[location.page] = (state.placements[location.page] || []).filter((id) => id !== labelId);
    return;
  }

  if (location.type === 'span') {
    delete state.spans[location.anchor];
  }
}

function placeLabelOnPage(labelId, targetPage) {
  if (!labelId || !getLabelById(labelId)) {
    return false;
  }

  if (isLockedPage(targetPage) || isPageLockedBySpan(targetPage)) {
    return false;
  }

  const existing = findLabelLocation(labelId);
  if (existing?.type === 'page' && existing.page === targetPage) {
    return true;
  }

  const target = state.placements[targetPage] || [];
  if (!target.includes(labelId) && target.length >= 4) {
    return false;
  }

  removeLabelFromCurrentLocation(labelId);
  if (!state.placements[targetPage]) {
    state.placements[targetPage] = [];
  }
  if (!state.placements[targetPage].includes(labelId)) {
    state.placements[targetPage].push(labelId);
  }
  saveState();
  return true;
}

function removePlacedLabel(labelId) {
  removeLabelFromCurrentLocation(labelId);
  if (selectedLabelId === labelId) {
    selectedLabelId = null;
  }
  saveState();
  render();
}

function getPageLayoutMeta(count, index) {
  if (count <= 1) {
    return { size: 'full', badge: '' };
  }

  if (count === 2) {
    return { size: 'half', badge: '1/2' };
  }

  if (count === 3) {
    return index === 0 ? { size: 'half', badge: '1/2' } : { size: 'quarter', badge: '1/4' };
  }

  return { size: 'quarter', badge: '1/4' };
}

function canToggleSpread(page) {
  if (isLockedPage(page)) {
    return false;
  }

  const left = page % 2 === 1 ? page : page - 1;
  const currentSpan = getRowSpan(left);
  if (currentSpan) {
    return currentSpan.anchor === page;
  }

  const own = state.placements[page] || [];
  const other = state.placements[page % 2 === 1 ? page + 1 : page - 1] || [];
  return own.length === 1 && other.length === 0;
}

function toggleSpread(page) {
  if (!canToggleSpread(page)) {
    return;
  }

  const left = page % 2 === 1 ? page : page - 1;
  const active = getRowSpan(left);

  if (active) {
    const targetPage = active.anchor;
    const labelId = active.labelId;
    delete state.spans[targetPage];
    if (!state.placements[targetPage]) {
      state.placements[targetPage] = [];
    }
    if (!state.placements[targetPage].includes(labelId) && state.placements[targetPage].length < 4) {
      state.placements[targetPage].push(labelId);
    }
    saveState();
    render();
    return;
  }

  const labelId = state.placements[page][0];
  state.placements[page] = state.placements[page].filter((id) => id !== labelId);
  state.spans[page] = { labelId, dir: 'next' };
  saveState();
  render();
}

function extractRows() {
  return state.rowOrder.map((leftPage) => {
    const span = getRowSpan(leftPage);
    return {
      left: [...(state.placements[leftPage] || [])],
      right: [...(state.placements[leftPage + 1] || [])],
      span: span
        ? {
            anchorSide: span.anchor === leftPage ? 'left' : 'right',
            labelId: span.labelId
          }
        : null
    };
  });
}

function applyRows(rows) {
  const safeRows = rows.length > 0 ? rows : [{ left: [], right: [], span: null }];
  const pages = safeRows.length * 2;
  const placements = {};
  const spans = {};
  const rowOrder = [];

  safeRows.forEach((row, index) => {
    const leftPage = index * 2 + 1;
    const rightPage = leftPage + 1;
    rowOrder.push(leftPage);

    const leftLabels = [...(row.left || [])];
    const rightLabels = [...(row.right || [])];

    if (row.span?.labelId) {
      const spanId = row.span.labelId;
      const anchor = row.span.anchorSide === 'right' ? rightPage : leftPage;
      spans[anchor] = { labelId: spanId, dir: 'next' };
      placements[leftPage] = leftLabels.filter((id) => id !== spanId).slice(0, 4);
      placements[rightPage] = rightLabels.filter((id) => id !== spanId).slice(0, 4);
    } else {
      placements[leftPage] = leftLabels.slice(0, 4);
      placements[rightPage] = rightLabels.slice(0, 4);
    }
  });

  placements[1] = [];
  placements[2] = [];
  delete spans[1];
  delete spans[2];

  state.pages = pages;
  state.placements = placements;
  state.spans = spans;
  state.rowOrder = rowOrder;
  saveState();
}

function addRow(afterIndex) {
  const rows = extractRows();
  rows.splice(afterIndex + 1, 0, { left: [], right: [], span: null });
  applyRows(rows);
  render();
}

function removeRow(rowIndex) {
  if (rowIndex === 0) {
    return;
  }
  const rows = extractRows();
  rows.splice(rowIndex, 1);
  applyRows(rows);
  render();
}

function moveRow(rowIndex, delta) {
  const targetIndex = rowIndex + delta;
  if (rowIndex === 0 || targetIndex <= 0) {
    return;
  }

  const rows = extractRows();
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return;
  }

  const [picked] = rows.splice(rowIndex, 1);
  rows.splice(targetIndex, 0, picked);
  applyRows(rows);
  render();
}

function applyPageCount() {
  const requested = ensureEvenPages(Number(pagesInput.value));
  const rows = extractRows();
  const targetRows = requested / 2;

  if (targetRows > rows.length) {
    const toAdd = targetRows - rows.length;
    for (let i = 0; i < toAdd; i += 1) {
      rows.push({ left: [], right: [], span: null });
    }
  } else if (targetRows < rows.length) {
    rows.splice(targetRows);
  }

  applyRows(rows);
  pagesInput.value = String(state.pages);
  render();
}

function resetAllPlacements() {
  for (let page = 1; page <= state.pages; page += 1) {
    state.placements[page] = [];
  }
  state.spans = {};
  selectedLabelId = null;
  saveState();
  render();
}

function addNewLabel() {
  const text = window.prompt('Όνομα νέας ετικέτας:');
  if (!text) {
    return;
  }

  const normalized = text.trim();
  if (!normalized) {
    return;
  }

  state.labels.push({ id: createLabelId(), text: normalized });
  saveState();
  render();
}

function renderPool() {
  labelsList.innerHTML = '';
  const pool = getAvailableLabels();

  if (pool.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Δεν υπάρχουν διαθέσιμες ετικέτες.';
    labelsList.append(empty);
    return;
  }

  pool.forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pool-label${selectedLabelId === label.id ? ' selected' : ''}`;
    button.textContent = label.text;
    button.draggable = true;

    button.addEventListener('click', () => {
      selectedLabelId = selectedLabelId === label.id ? null : label.id;
      render();
    });

    button.addEventListener('dragstart', (event) => {
      activeDragLabelId = label.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({ labelId: label.id }));
      selectedLabelId = label.id;
    });

    button.addEventListener('dragend', () => {
      activeDragLabelId = null;
      clearDropTargets();
    });

    button.addEventListener('pointerdown', (event) => {
      beginPointerDrag(event, label.id, label.text);
    });

    labelsList.append(button);
  });
}

function createLabelPill(labelId, page, count, index) {
  const label = getLabelById(labelId);
  if (!label) {
    return null;
  }

  const { size, badge } = getPageLayoutMeta(count, index);
  const pill = document.createElement('div');
  pill.className = `label-pill ${size}${selectedLabelId === labelId ? ' selected' : ''}`;
  pill.draggable = !isLockedPage(page) && !isPageLockedBySpan(page);

  const text = document.createElement('span');
  text.className = 'label-text';
  text.textContent = label.text;

  pill.addEventListener('click', (event) => {
    event.stopPropagation();
    selectedLabelId = selectedLabelId === labelId ? null : labelId;
    render();
  });

  pill.addEventListener('dragstart', (event) => {
    activeDragLabelId = labelId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ labelId }));
    selectedLabelId = labelId;
  });

  pill.addEventListener('dragend', () => {
    activeDragLabelId = null;
    clearDropTargets();
  });

  pill.addEventListener('pointerdown', (event) => {
    beginPointerDrag(event, labelId, label.text);
  });

  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'label-badge';
    badgeEl.textContent = badge;
    pill.append(text, badgeEl);
  } else {
    pill.append(text);
  }

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'label-remove';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', 'Αφαίρεση ετικέτας');
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removePlacedLabel(labelId);
  });

  pill.append(removeButton);
  return pill;
}

function handleDropOnPage(event, page) {
  event.preventDefault();
  const raw = event.dataTransfer?.getData('text/plain');
  let droppedLabelId = null;

  if (raw) {
    try {
      const payload = JSON.parse(raw);
      if (payload?.labelId) {
        droppedLabelId = payload.labelId;
      }
    } catch {
      droppedLabelId = null;
    }
  }

  if (!droppedLabelId && activeDragLabelId) {
    droppedLabelId = activeDragLabelId;
  }

  if (!droppedLabelId) {
    return;
  }

  const ok = placeLabelOnPage(droppedLabelId, page);
  if (ok) {
    selectedLabelId = null;
    render();
  }
}

function attachGlobalPointerDragEvents() {
  window.addEventListener('pointermove', (event) => {
    updatePointerDrag(event);
  });

  window.addEventListener('pointerup', () => {
    endPointerDrag();
  });

  window.addEventListener('pointercancel', () => {
    endPointerDrag();
  });

  window.addEventListener('mousemove', (event) => {
    if (!pointerDrag) {
      return;
    }
    updatePointerDrag(event);
  });

  window.addEventListener('mouseup', () => {
    endPointerDrag();
  });
}

function createPageCell(page) {
  const cell = document.createElement('article');
  const locked = isLockedPage(page);
  const spanLocked = isPageLockedBySpan(page);
  const pageLabels = state.placements[page] || [];
  const canPlace = !locked && !spanLocked;

  cell.className = `page-cell${locked || spanLocked ? ' locked' : ''}`;
  cell.dataset.page = String(page);

  const header = document.createElement('div');
  header.className = 'page-header';

  const title = document.createElement('span');
  title.className = 'page-title';
  if (page === 1) {
    title.textContent = '1 · Οπισθόφυλλο';
  } else if (page === 2) {
    title.textContent = '2 · Εξώφυλλο';
  } else {
    title.textContent = `Σελίδα ${page}`;
  }

  header.append(title);

  if (canToggleSpread(page)) {
    const spreadButton = document.createElement('button');
    spreadButton.type = 'button';
    spreadButton.className = 'spread-toggle';
    spreadButton.textContent = '↔';
    const left = page % 2 === 1 ? page : page - 1;
    const active = getRowSpan(left);
    if (active && active.anchor === page) {
      spreadButton.classList.add('active');
    }
    spreadButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSpread(page);
    });
    header.append(spreadButton);
  }

  const layout = document.createElement('div');
  layout.className = `labels-layout count-${Math.min(pageLabels.length, 4)}`;
  pageLabels.forEach((currentLabelId, index) => {
    const pill = createLabelPill(currentLabelId, page, pageLabels.length, index);
    if (pill) {
      layout.append(pill);
    }
  });

  if (canPlace) {
    cell.addEventListener('dragover', (event) => {
      event.preventDefault();
      cell.classList.add('drop-target');
    });

    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drop-target');
    });

    cell.addEventListener('drop', (event) => {
      cell.classList.remove('drop-target');
      handleDropOnPage(event, page);
      activeDragLabelId = null;
    });

    cell.addEventListener('click', () => {
      if (!selectedLabelId) {
        return;
      }
      const ok = placeLabelOnPage(selectedLabelId, page);
      if (ok) {
        selectedLabelId = null;
        render();
      }
    });
  }

  cell.append(header, layout);
  return cell;
}

function renderSpreadRows() {
  spreadsContainer.innerHTML = '';

  state.rowOrder.forEach((leftPage, rowIndex) => {
    const row = document.createElement('section');
    row.className = 'spread-row';

    const controls = document.createElement('div');
    controls.className = 'row-controls';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'tiny-control';
    addBtn.textContent = '+';
    addBtn.title = 'Προσθήκη spread';
    addBtn.addEventListener('click', () => addRow(rowIndex));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tiny-control';
    removeBtn.textContent = '−';
    removeBtn.title = 'Αφαίρεση spread';
    removeBtn.disabled = rowIndex === 0;
    removeBtn.addEventListener('click', () => removeRow(rowIndex));

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'tiny-control';
    upBtn.textContent = '↑';
    upBtn.title = 'Μετακίνηση πάνω';
    upBtn.disabled = rowIndex <= 1;
    upBtn.addEventListener('click', () => moveRow(rowIndex, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'tiny-control';
    downBtn.textContent = '↓';
    downBtn.title = 'Μετακίνηση κάτω';
    downBtn.disabled = rowIndex === 0 || rowIndex === state.rowOrder.length - 1;
    downBtn.addEventListener('click', () => moveRow(rowIndex, 1));

    controls.append(addBtn, removeBtn, upBtn, downBtn);

    const bubble = document.createElement('div');
    bubble.className = 'spread-bubble';

    const pagesWrap = document.createElement('div');
    pagesWrap.className = 'spread-pages';
    pagesWrap.append(createPageCell(leftPage), createPageCell(leftPage + 1));

    const span = getRowSpan(leftPage);
    if (span) {
      const label = getLabelById(span.labelId);
      if (label) {
        const layer = document.createElement('div');
        layer.className = 'spread-layer';

        const spanPill = document.createElement('div');
        spanPill.className = 'span-pill';

        const text = document.createElement('span');
        text.className = 'label-text';
        text.textContent = label.text;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'label-remove';
        remove.textContent = '×';
        remove.addEventListener('click', () => removePlacedLabel(label.id));

        spanPill.append(text, remove);
        layer.append(spanPill);
        bubble.append(layer);
      }
    }

    bubble.append(pagesWrap);
    row.append(controls, bubble);
    spreadsContainer.append(row);
  });
}

function updatePagesBadge() {
  pagesBadge.textContent = `${state.pages} pages`;
  pagesBadge.classList.toggle('ok', state.pages % 4 === 0);
  pagesBadge.classList.toggle('warn', state.pages % 4 !== 0);
  pagesInput.value = String(state.pages);
}

function applyScaleToFit() {
  const baseWidth = 540;
  const baseHeight = 844;
  const availableWidth = Math.max(280, window.innerWidth - 16);
  const availableHeight = Math.max(480, window.innerHeight - 16);
  const scale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);

  stageWrap.style.width = `${baseWidth * scale}px`;
  stageWrap.style.height = `${baseHeight * scale}px`;
  scaleRoot.style.transform = `scale(${scale})`;
}

function render() {
  updatePagesBadge();
  renderSpreadRows();
  renderPool();
  applyScaleToFit();
}

applyPagesButton.addEventListener('click', applyPageCount);
resetPlacementsButton.addEventListener('click', resetAllPlacements);
addLabelButton.addEventListener('click', addNewLabel);

window.addEventListener('resize', applyScaleToFit);
attachGlobalPointerDragEvents();

render();
