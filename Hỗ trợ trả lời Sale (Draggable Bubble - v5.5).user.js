// ==UserScript==
// @name         Hỗ trợ trả lời Sale (Draggable Bubble - v5.5)
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  Trợ lý trả lời nhanh cho Sale - Kéo thả sắp xếp danh mục & mẫu câu, tự do di chuyển bong bóng, tự động chèn vào ô nhập liệu
// @author       Senior UserScript Developer
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Chặn chạy trong iframe ẩn/không cần thiết
  if (window.top !== window.self) return;

  // Track ô nhập liệu gần nhất được tương tác
  let lastActiveInput = null;
  // Track trạng thái kéo thả mẫu câu & danh mục
  let draggedItemState = null; // { catIdx, itemIdx }
  let draggedCatIdx = null;    // catIdx

  // Dữ liệu mặc định
  const DEFAULT_DATA = [
    {
      id: 'cat_1',
      title: 'Chào hỏi & Tư vấn',
      items: [
        { label: 'Chào khách', text: 'Dạ em chào anh/chị, em có thể hỗ trợ gì cho mình ạ?' },
        { label: 'Sẵn hàng', text: 'Dạ chào bạn, shop sẵn hàng mẫu này ạ!' },
      ],
    },
    {
      id: 'cat_2',
      title: 'Mặc thử mới lấy',
      items: [
        { label: 'Đồng kiểm', text: 'Dạ bên em có hỗ trợ đồng kiểm khi nhận hàng, mình mặc thử ưng ý mới thanh toán ạ.' },
      ],
    },
    {
      id: 'cat_3',
      title: 'Khách sợ mặc lộ',
      items: [
        { label: 'Chất vải & Lót', text: 'Chất vải này dày dặn, đứng phom và có lớp lót bên trong nên hoàn toàn không lo bị lộ đâu ạ.' },
      ],
    },
    {
      id: 'cat_4',
      title: 'Chênh lệch giá với shop khác',
      items: [
        { label: 'Hàng chuẩn', text: 'Dạ sản phẩm bên em là hàng chuẩn may kĩ, form chuẩn và bảo hành đổi trả, không phải hàng gia công đại trà ạ.' },
      ],
    },
  ];

  function normalizeData(data) {
    if (!Array.isArray(data)) return [];
    return data.map((cat) => ({
      ...cat,
      items: (cat.items || []).map((item) => {
        if (typeof item === 'string') {
          return { label: '', text: item };
        }
        return { label: item.label || '', text: item.text || '' };
      }),
    }));
  }

  function loadData() {
    try {
      if (typeof GM_getValue !== 'undefined') {
        const gm = GM_getValue('sqr_data_v5', null);
        if (Array.isArray(gm) && gm.length > 0) return normalizeData(gm);
      }
      const local = localStorage.getItem('sqr_data_v5');
      if (local) {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) return normalizeData(parsed);
      }
    } catch (e) {
      console.error('[Sales Assistant] Lỗi đọc dữ liệu:', e);
    }
    return normalizeData(DEFAULT_DATA);
  }

  function saveData(data) {
    try { if (typeof GM_setValue !== 'undefined') GM_setValue('sqr_data_v5', data); } catch (e) {}
    try { localStorage.setItem('sqr_data_v5', JSON.stringify(data)); } catch (e) {}
  }

  function loadPosition() {
    try {
      if (typeof GM_getValue !== 'undefined') {
        const pos = GM_getValue('sqr_btn_pos', null);
        if (pos && typeof pos.top === 'number' && typeof pos.left === 'number') return pos;
      }
      const local = localStorage.getItem('sqr_btn_pos');
      if (local) return JSON.parse(local);
    } catch (e) {}
    return { top: window.innerHeight - 70, left: window.innerWidth - 65 };
  }

  function savePosition(pos) {
    try { if (typeof GM_setValue !== 'undefined') GM_setValue('sqr_btn_pos', pos); } catch (e) {}
    try { localStorage.setItem('sqr_btn_pos', JSON.stringify(pos)); } catch (e) {}
  }

  function copyText(text) {
    try {
      if (typeof GM_setClipboard !== 'undefined') {
        GM_setClipboard(text);
        return;
      }
    } catch (e) {}
    try {
      navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // Khởi tạo Shadow DOM Host
  const host = document.createElement('div');
  host.id = 'sqr-shadow-host';
  host.style.cssText = 'position: fixed !important; z-index: 2147483647 !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; pointer-events: none !important;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  function isInputableElement(el) {
    if (!el || host.contains(el)) return false;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    const isStandardInput = (tagName === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(el.type)) || tagName === 'textarea';
    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    return isStandardInput || isEditable;
  }

  const updateActiveInput = (e) => {
    if (isInputableElement(e.target)) {
      lastActiveInput = e.target;
    }
  };
  document.addEventListener('focusin', updateActiveInput, true);
  document.addEventListener('mousedown', updateActiveInput, true);

  function fillToInput(el, text) {
    if (!el || !document.body.contains(el)) return false;
    try {
      el.focus();
      const tagName = el.tagName ? el.tagName.toLowerCase() : '';
      const isStandardInput = tagName === 'input' || tagName === 'textarea';
      const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

      if (isStandardInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          tagName === 'input' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(el, text);
        } else {
          el.value = text;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } else if (isEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);

        let success = false;
        try {
          success = document.execCommand('insertText', false, text);
        } catch (err) {
          success = false;
        }

        if (!success) {
          el.textContent = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
    } catch (err) {
      console.error('[Sales Assistant] Lỗi khi điền văn bản:', err);
    }
    return false;
  }

  let categories = loadData();
  let isEditMode = false;
  let isOpenPanel = false;
  let activeCatIds = new Set();

  const style = document.createElement('style');
  style.textContent = `
    * {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    #sqr-btn {
      position: fixed !important;
      width: 42px !important; height: 42px !important; border-radius: 50% !important;
      background: #2563eb !important; color: #ffffff !important;
      display: flex !important; align-items: center !important; justify-content: center !important;
      font-size: 20px !important; cursor: grab !important;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3) !important;
      pointer-events: auto !important; border: 2px solid #ffffff !important;
      user-select: none !important; touch-action: none !important;
      transition: transform 0.1s ease, box-shadow 0.1s ease !important;
    }
    #sqr-btn:active { cursor: grabbing !important; transform: scale(0.95) !important; }
    #sqr-panel {
      position: fixed !important;
      width: 350px !important; height: 460px !important;
      background: #ffffff !important; border: 2px solid #2563eb !important;
      border-radius: 12px !important; box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
      display: none !important; flex-direction: column !important;
      overflow: hidden !important; pointer-events: auto !important;
      z-index: 2147483646 !important;
    }
    #sqr-panel.show { display: flex !important; }
    .sqr-header {
      height: 48px !important; min-height: 48px !important; padding: 0 14px !important;
      background: #f1f5f9 !important; border-bottom: 1px solid #cbd5e1 !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      flex-shrink: 0 !important;
    }
    .sqr-title { font-weight: 700 !important; font-size: 14px !important; color: #0f172a !important; }
    .sqr-mode-btn {
      font-size: 11px !important; padding: 5px 10px !important; border-radius: 6px !important;
      border: 1px solid #cbd5e1 !important; cursor: pointer !important; font-weight: 600 !important;
    }
    .sqr-mode-work { background: #dcfce7 !important; color: #15803d !important; }
    .sqr-mode-edit { background: #fef3c7 !important; color: #b45309 !important; }

    .sqr-body {
      flex: 1 !important; padding: 10px !important; overflow-y: auto !important;
      background: #ffffff !important; display: block !important;
    }
    .sqr-cat {
      margin-bottom: 8px !important; border: 1px solid #cbd5e1 !important;
      border-radius: 8px !important; overflow: hidden !important; background: #ffffff !important;
      transition: border 0.15s ease !important;
    }
    .sqr-cat.dragging { opacity: 0.3 !important; background: #f1f5f9 !important; }
    .sqr-cat.drag-over-top { border-top: 3px solid #2563eb !important; }
    .sqr-cat.drag-over-bottom { border-bottom: 3px solid #2563eb !important; }

    .sqr-cat-header {
      padding: 10px 12px !important; background: #f8fafc !important;
      display: flex !important; justify-content: space-between !important; align-items: center !important;
      cursor: pointer !important; font-weight: 600 !important; font-size: 13px !important; color: #1e293b !important;
    }
    .sqr-cat-header:hover { background: #f1f5f9 !important; }
    .sqr-cat-left { display: flex !important; align-items: center !important; gap: 8px !important; flex: 1 !important; }

    .sqr-items { display: none !important; background: #ffffff !important; border-top: 1px solid #f1f5f9 !important; }
    .sqr-items.open { display: block !important; }

    .sqr-item {
      padding: 8px 12px !important; font-size: 12px !important; color: #334155 !important;
      border-bottom: 1px solid #f1f5f9 !important; cursor: pointer !important;
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      background: #ffffff !important; line-height: 1.4 !important;
      transition: background 0.15s ease !important;
    }
    .sqr-item:hover { background: #eff6ff !important; }
    .sqr-item.dragging { opacity: 0.3 !important; background: #e2e8f0 !important; }
    .sqr-item.drag-over-top { border-top: 2px solid #2563eb !important; }
    .sqr-item.drag-over-bottom { border-bottom: 2px solid #2563eb !important; }

    .sqr-drag-handle {
      cursor: grab !important; color: #94a3b8 !important;
      font-size: 16px !important; user-select: none !important; display: flex !important;
      align-items: center !important; justify-content: center !important;
    }
    .sqr-drag-handle:active { cursor: grabbing !important; }

    .sqr-item-text-box {
      flex: 1 !important; display: flex !important; flex-direction: column !important;
      gap: 2px !important; overflow: hidden !important; padding-right: 6px !important;
    }
    .sqr-item-label {
      font-weight: 700 !important; font-size: 12px !important; color: #1d4ed8 !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
    }
    .sqr-item-subtext {
      font-size: 11px !important; color: #64748b !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
    }
    .sqr-item-text-only { font-size: 12px !important; color: #334155 !important; }

    .sqr-btn-group { display: flex !important; gap: 6px !important; align-items: center !important; }
    .sqr-icon-btn { background: transparent !important; border: none !important; cursor: pointer !important; font-size: 13px !important; }
    .sqr-toast {
      position: fixed !important;
      background: #10b981 !important; color: #ffffff !important; padding: 6px 14px !important;
      border-radius: 20px !important; font-size: 12px !important; font-weight: 600 !important;
      display: none !important; box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
      pointer-events: auto !important; z-index: 2147483647 !important;
      white-space: nowrap !important;
    }
  `;
  shadow.appendChild(style);

  const btn = document.createElement('div');
  btn.id = 'sqr-btn';
  btn.textContent = '💬';

  const panel = document.createElement('div');
  panel.id = 'sqr-panel';

  const toast = document.createElement('div');
  toast.className = 'sqr-toast';
  toast.textContent = 'Đã nhập câu trả lời!';

  shadow.appendChild(btn);
  shadow.appendChild(panel);
  shadow.appendChild(toast);

  // Áp dụng vị trí đã lưu của bong bóng
  let currentPos = loadPosition();
  const applyBtnPosition = (top, left) => {
    const maxTop = window.innerHeight - 48;
    const maxLeft = window.innerWidth - 48;
    const boundedTop = Math.max(10, Math.min(top, maxTop));
    const boundedLeft = Math.max(10, Math.min(left, maxLeft));

    btn.style.top = `${boundedTop}px`;
    btn.style.left = `${boundedLeft}px`;
    return { top: boundedTop, left: boundedLeft };
  };
  currentPos = applyBtnPosition(currentPos.top, currentPos.left);

  // Tính toán vị trí Popup Panel bám theo Bong Bóng
  function updatePanelPosition() {
    const btnRect = btn.getBoundingClientRect();
    const panelWidth = 350;
    const panelHeight = 460;
    const margin = 10;

    // Trục X (Trái/Phải)
    let panelLeft = btnRect.right + margin;
    if (panelLeft + panelWidth > window.innerWidth) {
      panelLeft = btnRect.left - panelWidth - margin;
    }
    if (panelLeft < 10) panelLeft = 10;

    // Trục Y (Trên/Dưới)
    let panelTop = btnRect.top;
    if (panelTop + panelHeight > window.innerHeight) {
      panelTop = window.innerHeight - panelHeight - 10;
    }
    if (panelTop < 10) panelTop = 10;

    panel.style.left = `${panelLeft}px`;
    panel.style.top = `${panelTop}px`;

    // Cập nhật vị trí Toast
    toast.style.left = `${panelLeft}px`;
    toast.style.top = `${Math.max(10, panelTop - 36)}px`;
  }

  // Cơ chế Kéo Thả (Drag & Drop) Cho Nút Bong Bóng
  let isDraggingBtn = false;
  let hasMoved = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  const onDragStart = (e) => {
    isDraggingBtn = true;
    hasMoved = false;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX;
    startY = clientY;
    const rect = btn.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
  };

  const onDragMove = (e) => {
    if (!isDraggingBtn) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    if (Math.hypot(deltaX, deltaY) > 5) {
      hasMoved = true;
      currentPos = applyBtnPosition(initialTop + deltaY, initialLeft + deltaX);
      if (isOpenPanel) updatePanelPosition();
    }
  };

  const onDragEnd = () => {
    if (!isDraggingBtn) return;
    isDraggingBtn = false;
    if (hasMoved) {
      savePosition(currentPos);
    }
  };

  btn.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  btn.addEventListener('touchstart', onDragStart, { passive: true });
  document.addEventListener('touchmove', onDragMove, { passive: true });
  document.addEventListener('touchend', onDragEnd);

  btn.onclick = () => {
    if (hasMoved) return; // Nếu vừa kéo thả thì không kích hoạt mở panel
    isOpenPanel = !isOpenPanel;
    if (isOpenPanel) {
      updatePanelPosition();
      panel.classList.add('show');
      render();
    } else {
      panel.classList.remove('show');
    }
  };

  function showToast(msg) {
    updatePanelPosition();
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 1800);
  }

  function render() {
    const currentBody = panel.querySelector('.sqr-body');
    const savedScrollTop = currentBody ? currentBody.scrollTop : 0;

    panel.innerHTML = '';
    const fragment = document.createDocumentFragment();

    // Header
    const header = document.createElement('div');
    header.className = 'sqr-header';

    const title = document.createElement('span');
    title.className = 'sqr-title';
    title.textContent = 'Mẫu tin nhắn Sale';

    const modeBtn = document.createElement('button');
    modeBtn.className = `sqr-mode-btn ${isEditMode ? 'sqr-mode-edit' : 'sqr-mode-work'}`;
    modeBtn.textContent = isEditMode ? '✏️ Chỉnh sửa' : '⚡ Làm việc';
    modeBtn.onclick = (e) => {
      e.stopPropagation();
      isEditMode = !isEditMode;
      render();
    };

    header.appendChild(title);
    header.appendChild(modeBtn);
    fragment.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'sqr-body';

    categories.forEach((cat, catIdx) => {
      const catEl = document.createElement('div');
      catEl.className = 'sqr-cat';

      const catHeader = document.createElement('div');
      catHeader.className = 'sqr-cat-header';

      const catLeft = document.createElement('div');
      catLeft.className = 'sqr-cat-left';

      if (isEditMode) {
        const catDragHandle = document.createElement('span');
        catDragHandle.className = 'sqr-drag-handle';
        catDragHandle.textContent = '⠿';
        catDragHandle.title = 'Kéo để sắp xếp danh mục';
        catDragHandle.draggable = true;

        catDragHandle.ondragstart = (e) => {
          draggedCatIdx = catIdx;
          catEl.classList.add('dragging');
          itemsList.classList.remove('open');
          e.dataTransfer.effectAllowed = 'move';
        };

        catDragHandle.ondragend = () => {
          draggedCatIdx = null;
          shadow.querySelectorAll('.sqr-cat').forEach((el) => {
            el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
          });
          render();
        };

        catLeft.appendChild(catDragHandle);

        catEl.ondragover = (e) => {
          if (draggedCatIdx === null || draggedCatIdx === catIdx) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';

          const rect = catEl.getBoundingClientRect();
          const offset = e.clientY - rect.top;

          if (offset < rect.height / 2) {
            catEl.classList.add('drag-over-top');
            catEl.classList.remove('drag-over-bottom');
          } else {
            catEl.classList.add('drag-over-bottom');
            catEl.classList.remove('drag-over-top');
          }
        };

        catEl.ondragleave = () => {
          catEl.classList.remove('drag-over-top', 'drag-over-bottom');
        };

        catEl.ondrop = (e) => {
          if (draggedCatIdx === null || draggedCatIdx === catIdx) return;
          e.preventDefault();
          catEl.classList.remove('drag-over-top', 'drag-over-bottom');

          const fromIdx = draggedCatIdx;
          const movedCat = categories.splice(fromIdx, 1)[0];
          categories.splice(catIdx, 0, movedCat);

          draggedCatIdx = null;
          saveData(categories);
          render();
        };
      }

      const catTitle = document.createElement('span');
      catTitle.textContent = cat.title || 'Danh mục';
      catLeft.appendChild(catTitle);

      const rightControls = document.createElement('div');
      rightControls.className = 'sqr-btn-group';

      if (isEditMode) {
        const editBtn = document.createElement('button');
        editBtn.className = 'sqr-icon-btn';
        editBtn.textContent = '✏️';
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const newTitle = prompt('Sửa tên danh mục:', cat.title);
          if (newTitle && newTitle.trim()) {
            categories[catIdx].title = newTitle.trim();
            saveData(categories);
            render();
          }
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'sqr-icon-btn';
        delBtn.textContent = '🗑️';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Xóa danh mục "${cat.title}"?`)) {
            categories.splice(catIdx, 1);
            saveData(categories);
            render();
          }
        };

        rightControls.appendChild(editBtn);
        rightControls.appendChild(delBtn);
      } else {
        const arrowIcon = document.createElement('span');
        arrowIcon.textContent = activeCatIds.has(cat.id) ? '▾' : '▸';
        rightControls.appendChild(arrowIcon);
      }

      catHeader.appendChild(catLeft);
      catHeader.appendChild(rightControls);

      const itemsList = document.createElement('div');
      const isOpen = activeCatIds.has(cat.id);
      itemsList.className = `sqr-items ${isOpen ? 'open' : ''}`;

      (cat.items || []).forEach((itemObj, itemIdx) => {
        const itemLabel = itemObj.label || '';
        const itemText = itemObj.text || '';

        const itemEl = document.createElement('div');
        itemEl.className = 'sqr-item';

        if (isEditMode) {
          const dragHandle = document.createElement('span');
          dragHandle.className = 'sqr-drag-handle';
          dragHandle.style.marginRight = '8px';
          dragHandle.textContent = '⠿';
          dragHandle.title = 'Kéo để thay đổi vị trí câu';
          dragHandle.draggable = true;

          dragHandle.ondragstart = (e) => {
            draggedItemState = { catIdx, itemIdx };
            itemEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
          };

          dragHandle.ondragend = () => {
            draggedItemState = null;
            shadow.querySelectorAll('.sqr-item').forEach((el) => {
              el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
            });
          };

          itemEl.appendChild(dragHandle);

          itemEl.ondragover = (e) => {
            e.preventDefault();
            if (!draggedItemState || draggedItemState.catIdx !== catIdx || draggedItemState.itemIdx === itemIdx) return;

            e.dataTransfer.dropEffect = 'move';
            const rect = itemEl.getBoundingClientRect();
            const offset = e.clientY - rect.top;

            if (offset < rect.height / 2) {
              itemEl.classList.add('drag-over-top');
              itemEl.classList.remove('drag-over-bottom');
            } else {
              itemEl.classList.add('drag-over-bottom');
              itemEl.classList.remove('drag-over-top');
            }
          };

          itemEl.ondragleave = () => {
            itemEl.classList.remove('drag-over-top', 'drag-over-bottom');
          };

          itemEl.ondrop = (e) => {
            e.preventDefault();
            itemEl.classList.remove('drag-over-top', 'drag-over-bottom');
            if (!draggedItemState || draggedItemState.catIdx !== catIdx) return;

            const fromIdx = draggedItemState.itemIdx;
            const movedItem = categories[catIdx].items.splice(fromIdx, 1)[0];
            categories[catIdx].items.splice(itemIdx, 0, movedItem);

            draggedItemState = null;
            saveData(categories);
            render();
          };
        }

        const textBox = document.createElement('div');
        textBox.className = 'sqr-item-text-box';

        if (itemLabel) {
          const labelSpan = document.createElement('span');
          labelSpan.className = 'sqr-item-label';
          labelSpan.textContent = `[${itemLabel}]`;

          const subtextSpan = document.createElement('span');
          subtextSpan.className = 'sqr-item-subtext';
          subtextSpan.textContent = itemText;

          textBox.appendChild(labelSpan);
          textBox.appendChild(subtextSpan);
        } else {
          const textSpan = document.createElement('span');
          textSpan.className = 'sqr-item-text-only';
          textSpan.textContent = itemText;
          textBox.appendChild(textSpan);
        }

        itemEl.appendChild(textBox);

        if (isEditMode) {
          const itemControls = document.createElement('div');
          itemControls.className = 'sqr-btn-group';

          const editItemBtn = document.createElement('button');
          editItemBtn.className = 'sqr-icon-btn';
          editItemBtn.textContent = '✏️';
          editItemBtn.onclick = (e) => {
            e.stopPropagation();
            const newLabel = prompt('Sửa TÊN MÔ TẢ ngắn (Để trống nếu không dùng):', itemLabel);
            if (newLabel === null) return;

            const newText = prompt('Sửa NỘI DUNG MẪU CÂU đầy đủ:', itemText);
            if (newText && newText.trim()) {
              categories[catIdx].items[itemIdx] = {
                label: newLabel.trim(),
                text: newText.trim(),
              };
              saveData(categories);
              render();
            }
          };

          const delItemBtn = document.createElement('button');
          delItemBtn.className = 'sqr-icon-btn';
          delItemBtn.textContent = '❌';
          delItemBtn.onclick = (e) => {
            e.stopPropagation();
            categories[catIdx].items.splice(itemIdx, 1);
            saveData(categories);
            render();
          };

          itemControls.appendChild(editItemBtn);
          itemControls.appendChild(delItemBtn);
          itemEl.appendChild(itemControls);
        } else {
          itemEl.onclick = (e) => {
            e.stopPropagation();
            let isFilled = false;
            if (lastActiveInput) {
              isFilled = fillToInput(lastActiveInput, itemText);
            }
            //copyText(itemText);
            showToast(isFilled ? 'Đã ghi đè câu trả lời!' : 'Đã chép câu (chưa chọn ô nhập)');
          };
        }

        itemsList.appendChild(itemEl);
      });

      if (isEditMode) {
        const addItemBtn = document.createElement('div');
        addItemBtn.className = 'sqr-item';
        addItemBtn.style.cssText = 'color: #2563eb !important; font-weight: 600 !important; cursor: pointer !important;';
        addItemBtn.textContent = '+ Thêm mẫu câu mới';
        addItemBtn.onclick = (e) => {
          e.stopPropagation();
          const newLabel = prompt('Nhập TÊN MÔ TẢ ngắn (Ví dụ: Cảm ơn, Mặc thử... - Có thể bỏ trống):');
          if (newLabel === null) return;

          const newText = prompt('Nhập NỘI DUNG MẪU CÂU đầy đủ:');
          if (newText && newText.trim()) {
            categories[catIdx].items.push({
              label: newLabel.trim(),
              text: newText.trim(),
            });
            activeCatIds.add(cat.id);
            saveData(categories);
            render();
          }
        };
        itemsList.appendChild(addItemBtn);
      }

      catHeader.onclick = () => {
        if (activeCatIds.has(cat.id)) {
          activeCatIds.delete(cat.id);
        } else {
          activeCatIds.add(cat.id);
        }
        render();
      };

      catEl.appendChild(catHeader);
      catEl.appendChild(itemsList);
      body.appendChild(catEl);
    });

    if (isEditMode) {
      const addCatBtn = document.createElement('button');
      addCatBtn.style.cssText = 'width: 100% !important; padding: 8px !important; margin-top: 8px !important; border: 1px dashed #cbd5e1 !important; background: #f8fafc !important; color: #334155 !important; border-radius: 6px !important; cursor: pointer !important; font-weight: 600 !important;';
      addCatBtn.textContent = '+ Thêm Danh Mục Mới';
      addCatBtn.onclick = () => {
        const title = prompt('Nhập tên danh mục mới:');
        if (title && title.trim()) {
          const newId = 'cat_' + Date.now();
          categories.push({ id: newId, title: title.trim(), items: [] });
          activeCatIds.add(newId);
          saveData(categories);
          render();
        }
      };
      body.appendChild(addCatBtn);
    }

    fragment.appendChild(body);
    panel.appendChild(fragment);

    body.scrollTop = savedScrollTop;
  }
})();
