// ==UserScript==
// @name         Pancake - Chốt & Data + Copy Sheet
// @namespace    pancake-stat-tag
// @version      1.4.0
// @description  Tổng hợp tag tên không chứa số, Chốt/Data và Copy Sheet
// @match        https://pancake.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'pk-tag-summary-panel';
    const STYLE_ID = 'pk-tag-summary-style';
    const TARGET_PATH = '/multi_pages/statistic/tag';

    // =========================================================
    // KIỂM TRA ĐÚNG TRANG
    // =========================================================

    function isTargetPage() {
        return window.location.pathname.replace(/\/+$/, '') === TARGET_PATH;
    }

    // =========================================================
    // XÓA PANEL
    // =========================================================

    function removePanel() {
        document.getElementById(PANEL_ID)?.remove();
    }

    // =========================================================
    // CHUẨN HÓA TÊN
    // =========================================================

    function normalize(str) {
        return (str || '')
            .normalize('NFC')
            .trim()
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase('vi-VN');
    }

    // =========================================================
    // KIỂM TRA TAG CÓ PHẢI TÊN HỢP LỆ KHÔNG
    //
    // CHO PHÉP:
    // T.Hà
    // H.Nga
    // TÚ ANH
    // Tú Ớt
    // H-Hà
    // T_Hà
    // T.Hà chốt
    //
    // LOẠI:
    // T.Hà 1
    // T.Hà1
    // Sale 2
    // 123
    // Data30
    // T.Hà chốt 2
    //
    // Chỉ cần xuất hiện số 0-9 => bỏ qua toàn bộ tag
    // =========================================================

    function isValidNameTag(name) {
        if (!name) {
            return false;
        }

        const cleaned = name.trim();

        if (!cleaned) {
            return false;
        }

        // Có bất kỳ chữ số nào => loại
        if (/\d/.test(cleaned)) {
            return false;
        }

        // Phải có ít nhất 1 ký tự chữ Unicode
        // Bao gồm chữ tiếng Việt
        if (!/\p{L}/u.test(cleaned)) {
            return false;
        }

        return true;
    }

    // =========================================================
    // CHUYỂN TEXT THÀNH SỐ
    // =========================================================

    function parseNumber(str) {
        if (!str) {
            return 0;
        }

        const cleaned = String(str)
            .trim()
            .replace(/\s/g, '')
            .replace(/[.,](?=\d{3}(?:\D|$))/g, '')
            .replace(/[^\d-]/g, '');

        const n = parseInt(cleaned, 10);

        return Number.isFinite(n) ? n : 0;
    }

    // =========================================================
    // FORMAT SỐ
    // =========================================================

    function formatNumber(n) {
        return Number(n || 0).toLocaleString('vi-VN');
    }

    // =========================================================
    // LẤY DÒNG PANCAKE
    // =========================================================

    function getRows() {
        return [
            ...document.querySelectorAll('.row_tag_data')
        ];
    }

    // =========================================================
    // ĐỌC DATA
    // =========================================================

    function readData() {
        const result = new Map();

        getRows().forEach(row => {

            const cells = row.querySelectorAll('.ant-table-cell');

            if (!cells.length) {
                return;
            }

            // =================================================
            // LẤY TÊN TAG
            // =================================================

            const nameEl =
                cells[0]?.querySelector('.pancake-antd-tooltip') ||
                cells[0]?.querySelector('.statistic-tag-item');

            if (!nameEl) {
                return;
            }

            const rawName = nameEl.textContent.trim();

            if (!rawName) {
                return;
            }

            // =================================================
            // QUAN TRỌNG:
            // TAG CÓ SỐ => BỎ QUA HOÀN TOÀN
            // =================================================

            if (!isValidNameTag(rawName)) {
                return;
            }

            // =================================================
            // LẤY GIÁ TRỊ
            // =================================================

            const totalEl = row.querySelector(
                '.statistic-tag-item.total'
            );

            const valueEl =
                totalEl ||
                cells[1]?.querySelector('.statistic-tag-item span') ||
                cells[1]?.querySelector('.statistic-tag-item');

            if (!valueEl) {
                return;
            }

            const value = parseNumber(valueEl.textContent);

            const normalizedName = normalize(rawName);

            // =================================================
            // KIỂM TRA TAG CHỐT
            // =================================================

            const isChot = /\s+chốt\s*$/iu.test(normalizedName);

            // =================================================
            // LẤY TÊN GỐC
            //
            // T.Hà       => t.hà
            // T.Hà chốt  => t.hà
            // =================================================

            const baseName = normalizedName
                .replace(/\s+chốt\s*$/iu, '')
                .trim();

            if (!baseName) {
                return;
            }

            // Kiểm tra lại tên gốc
            if (!isValidNameTag(baseName)) {
                return;
            }

            // =================================================
            // TẠO NGƯỜI
            // =================================================

            if (!result.has(baseName)) {

                result.set(baseName, {
                    key: baseName,

                    displayName: isChot
                        ? rawName
                            .replace(/\s+chốt\s*$/iu, '')
                            .trim()
                        : rawName,

                    chot: 0,
                    data: 0
                });
            }

            const item = result.get(baseName);

            // =================================================
            // CỘNG DATA / CHỐT
            // =================================================

            if (isChot) {

                item.chot += value;

            } else {

                item.displayName = rawName;
                item.data += value;
            }
        });

        // =====================================================
        // SẮP XẾP THEO TÊN
        // =====================================================

        return [...result.values()].sort((a, b) =>
            a.displayName.localeCompare(
                b.displayName,
                'vi',
                {
                    sensitivity: 'base'
                }
            )
        );
    }

    // =========================================================
    // COPY CLIPBOARD
    // =========================================================

    async function copyToClipboard(text) {
        try {

            await navigator.clipboard.writeText(text);

            return true;

        } catch (error) {

            try {

                const textarea = document.createElement('textarea');

                textarea.value = text;

                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '-9999px';
                textarea.style.opacity = '0';

                document.body.appendChild(textarea);

                textarea.focus();
                textarea.select();

                document.execCommand('copy');

                textarea.remove();

                return true;

            } catch (e) {

                console.error('Không thể copy:', e);

                return false;
            }
        }
    }

    // =========================================================
    // CSS
    // =========================================================

    function createStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');

        style.id = STYLE_ID;

        style.textContent = `

            #${PANEL_ID} {
                position: fixed;
                top: 90px;
                right: 20px;
                width: 520px;
                max-height: 75vh;
                z-index: 999999;

                background: #fff;
                color: #222;

                border-radius: 10px;
                border: 1px solid #e6e6e6;

                box-shadow: 0 5px 25px rgba(0,0,0,.25);

                font-family: Arial, sans-serif;
                overflow: hidden;
            }

            #${PANEL_ID} .pk-header {
                background: #1677ff;
                color: #fff;

                padding: 10px 12px;

                display: flex;
                align-items: center;
                justify-content: space-between;

                cursor: move;
                user-select: none;
            }

            #${PANEL_ID} .pk-title {
                font-size: 15px;
                font-weight: 700;
            }

            #${PANEL_ID} .pk-subtitle {
                font-size: 11px;
                opacity: .85;
                margin-top: 3px;
            }

            #${PANEL_ID} .pk-header-actions {
                display: flex;
                gap: 5px;
            }

            #${PANEL_ID} .pk-header button {
                width: 30px;
                height: 30px;

                border: 0;
                border-radius: 5px;

                background: rgba(255,255,255,.18);
                color: white;

                cursor: pointer;
                font-size: 17px;
            }

            #${PANEL_ID} .pk-header button:hover {
                background: rgba(255,255,255,.32);
            }

            #${PANEL_ID} .pk-content {
                overflow: auto;
                max-height: calc(75vh - 52px);
            }

            #${PANEL_ID} table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
            }

            #${PANEL_ID} th,
            #${PANEL_ID} td {
                padding: 10px;
                border-bottom: 1px solid #eee;
                white-space: nowrap;
            }

            #${PANEL_ID} th {
                position: sticky;
                top: 0;
                z-index: 5;

                background: #f5f7fa;
                font-weight: 700;
            }

            #${PANEL_ID} th:first-child,
            #${PANEL_ID} td:first-child {
                text-align: left;
            }

            #${PANEL_ID} th:nth-child(2),
            #${PANEL_ID} td:nth-child(2),
            #${PANEL_ID} th:nth-child(3),
            #${PANEL_ID} td:nth-child(3) {
                text-align: right;
            }

            #${PANEL_ID} tbody tr:hover {
                background: #f5f9ff;
            }

            #${PANEL_ID} .pk-name {
                font-weight: 600;
                max-width: 140px;

                overflow: hidden;
                text-overflow: ellipsis;
            }

            #${PANEL_ID} .pk-chot {
                color: #16a34a;
                font-weight: 700;
                font-size: 14px;
            }

            #${PANEL_ID} .pk-chot-header {
                color: #15803d;
            }

            #${PANEL_ID} .pk-data {
                color: #1677ff;
                font-weight: 700;
                font-size: 14px;
            }

            #${PANEL_ID} .pk-data-header {
                color: #1677ff;
            }

            #${PANEL_ID} .pk-copy-btn {
                border: none;

                background: #1677ff;
                color: #fff;

                padding: 6px 10px;
                border-radius: 5px;

                cursor: pointer;

                font-size: 12px;
                font-weight: 600;

                white-space: nowrap;
                min-width: 58px;
            }

            #${PANEL_ID} .pk-copy-btn:hover {
                background: #0958d9;
            }

            #${PANEL_ID} .pk-copy-btn.copied {
                background: #16a34a;
            }

            #${PANEL_ID} .pk-copy-btn.error {
                background: #dc2626;
            }

            #${PANEL_ID} th:last-child,
            #${PANEL_ID} td:last-child {
                text-align: center;
                width: 75px;
            }

            #${PANEL_ID} .pk-status {
                padding: 7px 10px;

                font-size: 11px;
                color: #888;

                background: #fafafa;

                border-top: 1px solid #eee;
            }
        `;

        document.head.appendChild(style);
    }

    // =========================================================
    // TẠO PANEL
    // =========================================================

    function createPanel() {

        if (!isTargetPage()) {
            removePanel();
            return;
        }

        if (document.getElementById(PANEL_ID)) {
            return;
        }

        createStyle();

        const panel = document.createElement('div');

        panel.id = PANEL_ID;

        panel.innerHTML = `

            <div class="pk-header">

                <div>

                    <div class="pk-title">
                        📊 Tổng hợp Tag
                    </div>

                    <div class="pk-subtitle">
                        Chỉ tính tag tên không chứa số
                    </div>

                </div>

                <div class="pk-header-actions">

                    <button
                        class="pk-refresh"
                        title="Cập nhật ngay"
                    >
                        ↻
                    </button>

                    <button
                        class="pk-minimize"
                        title="Thu gọn"
                    >
                        −
                    </button>

                </div>

            </div>

            <div class="pk-content">

                <table>

                    <thead>

                        <tr>

                            <th>
                                Tên
                            </th>

                            <th class="pk-chot-header">
                                Đã chốt
                            </th>

                            <th class="pk-data-header">
                                Data đã bắt
                            </th>

                            <th>
                                Copy
                            </th>

                        </tr>

                    </thead>

                    <tbody class="pk-summary-body">
                    </tbody>

                </table>

                <div class="pk-status">
                    Đang đọc dữ liệu...
                </div>

            </div>
        `;

        document.body.appendChild(panel);

        // =====================================================
        // REFRESH
        // =====================================================

        panel
            .querySelector('.pk-refresh')
            .addEventListener(
                'click',
                update
            );

        // =====================================================
        // THU GỌN
        // =====================================================

        panel
            .querySelector('.pk-minimize')
            .addEventListener(
                'click',
                function () {

                    const content =
                        panel.querySelector('.pk-content');

                    if (content.style.display === 'none') {

                        content.style.display = '';
                        this.textContent = '−';

                    } else {

                        content.style.display = 'none';
                        this.textContent = '+';
                    }
                }
            );

        makeDraggable(panel);
    }

    // =========================================================
    // UPDATE
    // =========================================================

    function update() {

        if (!isTargetPage()) {
            removePanel();
            return;
        }

        createPanel();

        const panel =
            document.getElementById(PANEL_ID);

        if (!panel) {
            return;
        }

        const body =
            panel.querySelector('.pk-summary-body');

        if (!body) {
            return;
        }

        const data = readData();

        body.innerHTML = '';

        data.forEach(item => {

            const tr =
                document.createElement('tr');

            // =================================================
            // TÊN
            // =================================================

            const nameCell =
                document.createElement('td');

            nameCell.className =
                'pk-name';

            nameCell.textContent =
                item.displayName;

            nameCell.title =
                item.displayName;

            // =================================================
            // ĐÃ CHỐT
            // =================================================

            const chotCell =
                document.createElement('td');

            chotCell.className =
                'pk-chot';

            chotCell.textContent =
                formatNumber(item.chot);

            // =================================================
            // DATA ĐÃ BẮT
            // =================================================

            const dataCell =
                document.createElement('td');

            dataCell.className =
                'pk-data';

            dataCell.textContent =
                formatNumber(item.data);

            // =================================================
            // COPY
            // =================================================

            const copyCell =
                document.createElement('td');

            const copyBtn =
                document.createElement('button');

            copyBtn.className =
                'pk-copy-btn';

            copyBtn.textContent =
                'Copy';

            copyBtn.title =
                `Copy: ${item.chot} | ${item.data}`;

            copyBtn.addEventListener(
                'click',
                async function () {

                    // ==========================================
                    // CHỐT [TAB] DATA
                    //
                    // 43    560
                    //
                    // Dán Google Sheet:
                    //
                    // | 43 | 560 |
                    // ==========================================

                    const textToCopy =
                        `${item.chot}\t${item.data}`;

                    const success =
                        await copyToClipboard(
                            textToCopy
                        );

                    if (success) {

                        copyBtn.textContent =
                            '✓ Đã copy';

                        copyBtn.classList.add(
                            'copied'
                        );

                        setTimeout(() => {

                            if (
                                document.body.contains(copyBtn)
                            ) {

                                copyBtn.textContent =
                                    'Copy';

                                copyBtn.classList.remove(
                                    'copied'
                                );
                            }

                        }, 1200);

                    } else {

                        copyBtn.textContent =
                            'Lỗi';

                        copyBtn.classList.add(
                            'error'
                        );

                        setTimeout(() => {

                            if (
                                document.body.contains(copyBtn)
                            ) {

                                copyBtn.textContent =
                                    'Copy';

                                copyBtn.classList.remove(
                                    'error'
                                );
                            }

                        }, 1500);
                    }
                }
            );

            copyCell.appendChild(copyBtn);

            // =================================================
            // TÊN | ĐÃ CHỐT | DATA ĐÃ BẮT | COPY
            // =================================================

            tr.append(
                nameCell,
                chotCell,
                dataCell,
                copyCell
            );

            body.appendChild(tr);
        });

        // =====================================================
        // STATUS
        // =====================================================

        const status =
            panel.querySelector('.pk-status');

        if (status) {

            status.textContent =
                `${data.length} tên hợp lệ • ` +
                `Bỏ qua tag có số • ` +
                `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
        }
    }

    // =========================================================
    // KÉO PANEL
    // =========================================================

    function makeDraggable(panel) {

        const header =
            panel.querySelector('.pk-header');

        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener(
            'mousedown',
            e => {

                if (e.target.tagName === 'BUTTON') {
                    return;
                }

                dragging = true;

                const rect =
                    panel.getBoundingClientRect();

                offsetX =
                    e.clientX - rect.left;

                offsetY =
                    e.clientY - rect.top;

                panel.style.right =
                    'auto';
            }
        );

        document.addEventListener(
            'mousemove',
            e => {

                if (!dragging) {
                    return;
                }

                if (
                    !document.body.contains(panel)
                ) {

                    dragging = false;

                    return;
                }

                let left =
                    e.clientX - offsetX;

                let top =
                    e.clientY - offsetY;

                left = Math.max(
                    0,
                    Math.min(
                        left,
                        window.innerWidth -
                        panel.offsetWidth
                    )
                );

                top = Math.max(
                    0,
                    Math.min(
                        top,
                        window.innerHeight - 40
                    )
                );

                panel.style.left =
                    `${left}px`;

                panel.style.top =
                    `${top}px`;
            }
        );

        document.addEventListener(
            'mouseup',
            () => {

                dragging = false;
            }
        );
    }

    // =========================================================
    // DEBOUNCE UPDATE
    // =========================================================

    let updateTimer = null;

    function scheduleUpdate() {

        clearTimeout(updateTimer);

        updateTimer = setTimeout(
            () => {

                if (isTargetPage()) {

                    update();

                } else {

                    removePanel();
                }

            },
            300
        );
    }

    // =========================================================
    // THEO DÕI DOM PANCAKE
    // =========================================================

    const observer =
        new MutationObserver(
            mutations => {

                if (!isTargetPage()) {

                    removePanel();

                    return;
                }

                const relevant =
                    mutations.some(
                        mutation => {

                            const target =
                                mutation.target;

                            if (
                                target.nodeType === 1 &&
                                target.closest &&
                                target.closest(
                                    '#' + PANEL_ID
                                )
                            ) {

                                return false;
                            }

                            return true;
                        }
                    );

                if (relevant) {

                    scheduleUpdate();
                }
            }
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true,
            characterData: true
        }
    );

    // =========================================================
    // THEO DÕI URL
    // =========================================================

    let lastUrl =
        window.location.href;

    setInterval(
        () => {

            if (
                window.location.href !==
                lastUrl
            ) {

                lastUrl =
                    window.location.href;

                if (!isTargetPage()) {

                    removePanel();

                } else {

                    setTimeout(
                        () => {

                            if (isTargetPage()) {

                                createPanel();
                                update();
                            }

                        },
                        300
                    );
                }
            }

            if (!isTargetPage()) {

                removePanel();
            }

        },
        200
    );

    // =========================================================
    // BACKUP UPDATE 2 GIÂY
    // =========================================================

    setInterval(
        () => {

            if (isTargetPage()) {

                update();

            } else {

                removePanel();
            }

        },
        2000
    );

    // =========================================================
    // KHỞI ĐỘNG
    // =========================================================

    if (isTargetPage()) {

        createPanel();
        update();
    }

})();