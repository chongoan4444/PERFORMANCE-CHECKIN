// ==UserScript==
// @name         Pancake Auto Upsale V5 (optimized)
// @namespace    http://tampermonkey.net/
// @version      5.24
// @description  REAL ID + Direct Row Observer + Stop Snippet + đo riêng pha dán/pha chờ. Selectors verified against Pancake dashboard source.
// @match        *://*.pancake.vn/*
// @grant        GM_getClipboard
// @run-at       document-end
// @noframes
// ==/UserScript==

/*
 * ============================================================
 *  V5 — selector đã đối chiếu với source thật của Pancake
 *  (html.txt = dashboard chưa mở hội thoại, html2.txt = đang mở)
 *
 *  Nguồn gốc từng selector:
 *
 *  #conversationList.rc-virtual-list.infinite-conv-list
 *     └ .rc-virtual-list-holder
 *         └ .rc-virtual-list-holder-inner
 *              └ <div id="{pageId}_{conversationId}">      ← REAL ID nằm ở đây
 *                   └ <div id="{pageId}_{conversationId}__{rowIndex}"
 *                          class="media conversation-list-item [selected]">
 *                        ├ .media-left.render-avatar-cus
 *                        └ .media-body.body-conver-item
 *                             ├ .name-module  > .name-text / .time-modul
 *                             ├ .snippet-wrap > .snippet-line > .snippet-text
 *                             └ .tag-wrap     > .list_tags_conv_{id} > .conversation_tags_item
 *
 *  #messageCol > #message-col-list > .virtual-scroll-area > .message-list
 *     └ <div id="message_m_{msgId}" class="media m-b-md inbox-message-ele [media-current-user]">
 *          └ .media-body > .media-body-text.media-message-from-page
 *               └ .message-text-field > .message-text-ele.page-message
 *
 *  #reply_box > .reply-box-container > .reply-box__text-area
 *     └ <textarea id="replyBoxComposer" placeholder="Trả lời từ {tên page}">
 *
 *  .chat-menu > .selected-customer > #pageCustomer > .customer-name
 *
 *  LƯU Ý TỪ SOURCE:
 *  - Ô soạn là <textarea> thường (KHÔNG phải Draft.js / contenteditable).
 *  - Danh sách hội thoại bị ảo hóa (virtual list): chỉ ~10 row tồn tại
 *    trong DOM, phần tử được tái sử dụng → không được cache row node.
 *  - Row đang mở mang class "selected" (KHÔNG phải "active").
 *  - Source KHÔNG có nút "Gửi" (textarea đang trống) → gửi bằng Enter.
 * ============================================================
 */

(function () {
    'use strict';

    const VERSION = '5.24';

    /* =========================================================
     * SELECTORS — tất cả lấy từ HTML thật, không đoán
     * =======================================================*/

    const SEL = {
        listRoot:    '#conversationList',
        row:         '.conversation-list-item',
        /*
         * V5.20 — ĐÃ ĐỐI CHIẾU VỚI DỮ LIỆU SERVER (pancake.vn2.har).
         * Trường `snippet` trong response của /api/v1/conversations xuất hiện
         * NGUYÊN VẸN trong <div class="snippet-text"> — xác nhận selector này
         * đọc đúng thứ mà server gửi, không phải text bị cắt/xáo.
         *   server: "Chị cho em xin chiều cao + cân nặng em chọn size phù hợp…"
         *   DOM   : <div class="snippet-text">Chị cho em xin chiều cao + cân nặng…
         *
         * KHÔNG CÓ DẤU CHƯA ĐỌC TRÊN ROW — đã kiểm lại bằng dữ liệu thật:
         *   • <span class="ant-badge"> bọc avatar xuất hiện ở 100% row (9/9 và
         *     10/10 trong hai bản dump) ⇒ chỉ là wrapper cố định của antd.
         *   • Không row nào có <sup class="ant-badge-count"> hay ant-badge-dot.
         *   • Các badge đếm (unread-conv-count) nằm ở trình CHUYỂN TRANG, không
         *     phải row.
         * ⇒ unread_count chỉ có ở server. Script vẫn KHÔNG phân biệt được row
         *   đã đọc/chưa đọc (xem mục "Lùi lên ở cuối" và rủi ro đã ghi).
         */
        snippet:     '.snippet-text',
        name:        '.name-text',
        headerName:  '#pageCustomer .customer-name'
    };

    const RE_ROW_ID        = /^(\d+_\d+)__\d+$/;   // "...__52"
    /*
     * V5.20 — ĐÃ KIỂM CHỨNG BẰNG DỮ LIỆU THẬT (SALESCRIPT/pancake.vn1.har,
     * giải mã payload base64 của GET /api/v1/conversations, 66 hội thoại):
     *   64/66  id = {page_id}_{peer_id}      (type = INBOX)
     *    2/66  id = {post_id}_{peer_id}      (type = COMMENT)
     * Cả hai đều khớp \d+_\d+, nên regex an toàn. Nhưng đoạn đầu KHÔNG PHẢI
     * lúc nào cũng là page id — đừng bao giờ tách đoạn đầu ra để suy ra trang.
     * (COMMENT còn có tags: [] ⇒ không lọt qua bộ lọc theo tag đang dùng.)
     */
    const RE_REAL_ID       = /^\d+_\d+$/;          // "{page_id}_{peer_id}" | COMMENT: "{post_id}_{peer_id}"

    /* Thời gian chờ (ms) */
    const T = {
        /*
         * selected = 0  (MẶC ĐỊNH)
         *   Không chờ hội thoại load: bắt được snippet đúng điều kiện là
         *   click → dán → gửi → kế tiếp ngay (đúng luồng bạn đang dùng).
         *   Vẫn có 2 lớp bảo vệ KHÔNG tốn thời gian:
         *     • composer chưa có thì phải đợi (không có chỗ mà dán)
         *     • sau khi dán kiểm tra lại text, React có xóa thì dán lại
         *
         * selected = 3000 (hoặc số ms bất kỳ > 0)
         *   Chờ tới khi row có class .selected khớp ID mục tiêu mới dán.
         *   An toàn hơn (chống gửi nhầm khách khi Pancake load chậm) nhưng
         *   chậm hơn đúng bằng thời gian Pancake mở hội thoại (đo được).
         */
        selected:  0,      // 0 = không chờ (nhanh nhất)
        composer:  3000,   // chờ #replyBoxComposer xuất hiện
        observer:  3000,   // watchdog cho conversation kế tiếp
        /* Nhịp kiểm tra dự phòng: NHANH lúc đầu (giảm jitter), thưa dần sau đó
           (đỡ tốn CPU). Fix cứng 1 nhịp sẽ làm thời gian bắt khách kế dao động
           0–250ms → cảm giác "lúc nhanh lúc chậm". */
        /*
         * Nhịp poll dự phòng khi CHỜ khách kế.
         * Mỗi nhịp gọi elementFromPoint() → ÉP TRÌNH DUYỆT TÍNH LẠI LAYOUT.
         * Ở 40 ms = 25 lần ép layout/giây — trên máy yếu đủ làm ì cả trang
         * (đo được: 70 thao tác + ~25 reflow mỗi giây chờ).
         * Từ V5.15 nới ra 100/200/300 (10→5→3 lần/giây): quét chủ động làm
         * pha chờ chỉ còn ~32 ms, nên nhịp nhanh không còn đáng để trả bằng CPU.
         */
        pollFast:  100,    // 0–400ms đầu
        pollMid:   200,    // 400–1200ms
        pollSlow:  300,    // sau đó
        minGap:    16,     // gộp các lần check observer (xem scheduleCheck)
        gapMid:    60,     // sau 200 ms chờ
        gapSlow:   120,    // sau 1200 ms chờ

        /*
         * QUÉT CHỦ ĐỘNG (V5.6) — thay đổi duy nhất chạm được vào độ trễ thật
         *
         * Đo ở máy bạn (V5.5, mọi delay = 0): TB ~646 ms/khách, trong đó
         *   373 ms (58%) = CHỜ Pancake xếp lại danh sách để một khách khác
         *                  xuất hiện ở đúng toạ độ dấu đỏ
         *   ~273 ms(42%) = click → dán → Enter
         * Source (html2.txt, i18n "unreadFirstMode" / "pushUnreadConvToTop"):
         * Pancake đẩy hội thoại chưa đọc lên đầu danh sách ⇒ khách kế tiếp ĐÃ
         * NẰM SẴN trong DOM, ngay dưới row vừa gửi. Không cần đợi nó đổi chỗ.
         *
         * scan = 1: sau Enter, lấy ngay row kế tiếp trong #conversationList.
         * scan = 0: hành vi cũ (đứng chờ Pancake đổi ở dấu đỏ).
         *
         * LƯU Ý AN TOÀN: 373 ms chờ trước đây TÌNH CỜ cho React đủ thời gian
         * đổi ngữ cảnh hội thoại. Bỏ nó đi ⇒ PHẢI bật chốt .selected trước khi
         * dán (scanGate), kẻo dán nhầm sang khách trước.
         */
        scan:       1,
        /* ms: dán lại cho tới khi composer GIỮ được nội dung. Tốn 0 ms khi dán
           ngay được (vòng lặp kiểm tra trước rồi mới await). Nâng lên 2000 để
           chịu được cả trường hợp Pancake load draft bất đồng bộ. */
        pasteHold:  2000,
        /* ms: XÁC NHẬN TIN ĐÃ GỬI XONG — CHỈ chạy khi tab vừa bị ẩn trong
           lượt đó (xem V5.22, biến tabHiddenDuringStep).
           Lý do: log máy bạn ghi `enter 2 ms`, tức script bấm Enter xong 2 ms
           đã click sang khách kế, trong khi Pancake gửi BẤT ĐỒNG BỘ qua
           WebSocket — cùng log đó có `getGlobalIdFromWS` mất 6 s và 30 s, kèm
           `DONE LISTEN SOCKET V2` (socket nối lại). Khi tab bị ẩn, WS bị kẹp
           ⇒ cửa sổ "tin đang gửi" kéo dài ⇒ click sang khách kế làm rớt tin.
           Dấu hiệu đã gửi xong: Pancake XÓA composer.
           V5.23: chạy LUÔN (không chỉ khi tab ẩn) và ĐO THỜI GIAN, vì ta chưa
           biết Pancake mất bao lâu để xóa composer. 600 ms = đủ cho đường
           bình thường, không đủ để kéo chết một lượt chạy. */
        sendConfirm: 600,
        /* ms: CHỜ THÊM khi 600 ms đầu chưa xong — tức Pancake đang đi đường
           api → extension → socket (xem §36). Nguồn gốc: server trả
           `last_customer_interactive_at: null` cho 20/30 hội thoại (đếm được
           trong pancake.vn2.har) ⇒ Pancake không tính được cửa sổ 24h ⇒ thử
           `api` trước, hỏng, rồi mới tới `extension` (cần getGlobalIdFromWS —
           log thật ghi 1 s / 6 s / 30 s).
           Không chờ ⇒ tin vẫn đang bay mà script đã sang khách kế ⇒ người dùng
           thấy "dán nhưng không gửi". 10 s = đủ cho phần lớn, không đủ để kéo
           chết cả lượt chạy. */
        sendConfirmSlow: 0
    };

    /** Nhịp poll dựa trên thời gian đã chờ. */
    function pollDelay(elapsed) {
        if (elapsed < 400) return T.pollFast;
        if (elapsed < 1200) return T.pollMid;
        return T.pollSlow;
    }

    /**
     * Khoảng ghép tối thiểu giữa 2 lần check DO MUTATIONOBSERVER kích hoạt.
     *
     * Mỗi lần check gọi elementFromPoint() ⇒ ÉP TRÌNH DUYỆT TÍNH LẠI LAYOUT.
     * Ở 16 ms cố định, nếu Pancake mutate danh sách liên tục (đang nạp trang,
     * xếp lại, hoặc retry sau 429) thì check chạy TỚI ~62 LẦN/GIÂY — mỗi lần
     * ép layout lại toàn bộ danh sách ảo hoá.
     * Phép đo V5.15 (9 reflow/giây) đo trong jsdom với danh sách ĐỨNG YÊN nên
     * chỉ thấy nhánh poll, KHÔNG thấy nhánh mutation này — đó là chỗ đo sót.
     *
     * Nới ngay từ đầu thì lại làm chậm phát hiện khách kế, nên nới THEO THỜI
     * GIAN ĐÃ CHỜ: 200 ms đầu giữ nguyên 16 ms (đúng nhịp đã đo — chờ 1–3 ms,
     * fast-path 24 ms), sau đó 60 ms rồi 120 ms. Nhánh chờ DÀI, tức nhánh tốn
     * CPU thật khi máy đang nghẽn, hạ từ ~62 xuống ~8 lần ép layout/giây.
     */
    function checkGap(elapsed) {
        if (elapsed < 200) return T.minGap;
        if (elapsed < 1200) return T.gapMid;
        return T.gapSlow;
    }

    /* =========================================================
     * STATE
     * =======================================================*/

    let isRunning = false;
    let isWaitingForEnter = false;

    /**
     * V5.22 — Tab có bị ẨN trong lúc đang xử lý 1 khách hay không.
     *
     * Chỉ dùng để QUYẾT ĐỊNH CÓ XÁC NHẬN GỬI HAY KHÔNG. Đường nhanh (tab luôn
     * hiện) giữ nguyên 100% — không thêm bất kỳ nhịp chờ nào, vẫn 2–3 khách/giây.
     * Chỉ lượt nào tab vừa bị ẩn mới chạy xác nhận.
     */
    let tabHiddenDuringStep = false;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) tabHiddenDuringStep = true;
    }, true);

    let initialSnippet = null;
    let cachedText = '';

    let autoEnter = false;
    let bypassSnippet = false;
    let scanEnabled = true;   // V5.6 quét chủ động (công tắc trong panel, mặc định ON)
    let hotkeyEnabled = false;   // luôn OFF sau reload

    let runToken = 0;
    let lastConversationId = '';

    /* V5.6: mọi ID đã xử lý trong 1 lần chạy. Dùng khi quét chủ động, để chắc
       chắn không bao giờ quay lại 1 khách đã gửi (kể cả khi list chưa đổi). */
    const handledIds = new Set();
    /** V5.23 — ID những khách đã bấm Enter nhưng KHÔNG thấy Pancake xóa composer. */
    let unsentIds = [];
    /** V5.24 — số khách phải đi đường chậm (api → extension/socket). */
    let slowSends = 0;

    /* Bối cảnh khách đang xử lý — in ra cùng lý do dừng để tự chẩn đoán
       mà không cần hỏi lại người dùng. */
    let lastCtx = null;

    let cachedComposer = null;   // node ổn định, có thể cache (có isConnected check)

    let activePicker = null;
    let stopSnippet = '';
    let clickPos = null;

    /* Thống kê thời gian mỗi khách — để tự nhìn thấy độ trễ thật */
    let stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
    let upNoticed = false;    // V5.18: đã in 1 lần thông báo "lùi lên" chưa
    let pendingSend = null;   // pha dán của tin vừa gửi, chờ ghép với pha chờ
    let stepStart = 0;    // lúc bắt đầu xử lý 1 khách
    let sentAt = 0;       // lúc vừa bấm Enter xong
    let lastWaitMs = 0;   // pha chờ của khách vừa xong
    let lastSendMs = 0;   // pha dán của khách vừa xong

    function resetStats() {
        stats = { sent: 0, cycles: 0, totalMs: 0, sendMs: 0, waitMs: 0, min: 0, max: 0 };
        pendingSend = null;
        phaseSum = null;
        unsentIds = [];
        slowSends = 0;
        upNoticed = false;   // V5.18: mỗi lượt chạy chỉ in 1 lần "lùi lên"
        renderStats();
    }

    /** Pha 1 — vừa bấm Enter xong: tính ngay, không đợi khách kế. */
    function recordSend(sendMs) {
        stats.sent++;
        stats.sendMs += sendMs;
        pendingSend = sendMs;
        renderStats();
    }

    /** Pha 2 — bắt được khách kế: ghép với pha 1 thành 1 chu kỳ hoàn chỉnh. */
    function recordWait(waitMs) {
        if (pendingSend === null) return;
        const total = pendingSend + waitMs;
        pendingSend = null;

        stats.cycles++;
        stats.waitMs += waitMs;
        stats.totalMs += total;
        if (!stats.min || total < stats.min) stats.min = total;
        if (total > stats.max) stats.max = total;

        renderStats();
        console.info(
            `[Pancake Auto] #${stats.cycles} dán ${(total - waitMs).toFixed(0)}ms · chờ ${waitMs.toFixed(0)}ms`
            + phaseText()
        );
    }

    function renderStats() {
        const el = txtStats || document.querySelector('#pk-root [id="pk-stats"]');
        if (!el) return;
        if (!stats.sent) { el.textContent = '📊 Chưa có dữ liệu'; return; }
        const n = stats.cycles || 1;
        const avg = (stats.sendMs + stats.waitMs) / n;
        const avgSend = stats.sendMs / n;
        const avgWait = stats.waitMs / n;
        el.textContent = `📊 ${stats.sent} tin · TB ${(avg / 1000).toFixed(2)}s`
            + ` (dán ${avgSend.toFixed(0)}ms · chờ ${avgWait.toFixed(0)}ms)`
            + (stats.cycles ? ` · ${(stats.min / 1000).toFixed(2)}–${(stats.max / 1000).toFixed(2)}s` : '');
    }

    /* ===== V5.14: đo TỪNG ĐOẠN trong pha dán =====
       Pha dán đang chiếm 93% chu kỳ (417 ms). Không đo từng đoạn thì mọi nỗ lực
       tối ưu chỉ là đoán. Các mốc:
         click    = fullClick (React xử lý click, mở hội thoại)
         composer = lấy được #replyBoxComposer
         paste    = dán + giữ nội dung (gồm cả số lần phải dán lại)
         nhiп     = nhịp chờ trước Enter (D.autoEnter, mặc định 1 nextTick)
         enter    = focus + bấm Enter (React xử lý gửi)
    */
    let phaseMs  = null;
    let phaseAt  = 0;
    let pasteTries = 0;

    function phaseReset() {
        phaseAt  = performance.now();
        phaseMs  = { click: 0, composer: 0, paste: 0, nhịp: 0, enter: 0, confirm: 0 };
        pasteTries = 0;
    }

    function phaseMark(key) {
        if (!phaseMs) return;
        const now = performance.now();
        phaseMs[key] = Math.round(now - phaseAt);
        phaseAt = now;
    }

    let phaseSum = null;

    function phaseAccumulate() {
        if (!phaseMs) return;
        if (!phaseSum) phaseSum = { click: 0, composer: 0, paste: 0, nhịp: 0, enter: 0, confirm: 0, tries: 0, n: 0 };
        for (const k of ['click', 'composer', 'paste', 'nhịp', 'enter', 'confirm']) phaseSum[k] += phaseMs[k];
        phaseSum.tries += pasteTries;
        phaseSum.n++;
    }

    function phaseSummary() {
        if (!phaseSum || !phaseSum.n) return;
        const n = phaseSum.n;
        const ms = k => (phaseSum[k] / n).toFixed(0);
        console.info(
            `[Pancake Auto] TỔNG ${n} khách — trung bình mỗi khách:\n` +
            `   click    ${ms('click')} ms   (React mở hội thoại)\n` +
            `   composer ${ms('composer')} ms\n` +
            `   paste    ${ms('paste')} ms   (dán lại ${(phaseSum.tries / n).toFixed(1)} lần/khách)\n` +
            `   nhịp     ${ms('nhịp')} ms   (chờ trước Enter)\n` +
            `   enter    ${ms('enter')} ms   (React gửi)\n` +
            `   xác nhận ${ms('confirm')} ms   (chờ Pancake xóa composer = đã gửi)`
            + (slowSends
                ? `\n   ⏳ ${slowSends}/${n} khách phải đi đường chậm (api → extension/socket)`
                : '')
            + (unsentIds.length
                ? `\n   ⚠ ${unsentIds.length} khách KHÔNG THẤY GỬI: ${unsentIds.join(', ')}`
                : '')
        );
    }

    function phaseText() {
        if (!phaseMs) return '';
        return ` · click ${phaseMs.click} · composer ${phaseMs.composer}`
             + ` · paste ${phaseMs.paste}(${pasteTries} lần)`
             + ` · nhịp ${phaseMs.nhịp} · enter ${phaseMs.enter}`
             + ` · xác nhận ${phaseMs.confirm}`;
    }

    /* Observer */
    let listObserver = null;
    let observerState = null;
    let lastCheckAt = 0;

    /* =========================================================
     * STORAGE (giữ nguyên key để không mất cài đặt cũ)
     * =======================================================*/

    const K = {
        pos:   'pancake_auto_pos_v7',
        ui:    'pancake_auto_ui_v7',
        speed: 'pancake_auto_speed_v7',
        stop:  'pancake_auto_stop_snippet_v1'
    };

    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return fallback;
                const parsed = JSON.parse(raw);
                return parsed === null || parsed === undefined ? fallback : parsed;
            } catch (err) {
                return fallback;
            }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (err) {}
        }
    };

    /* =========================================================
     * HELPERS
     * =======================================================*/

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /**
     * Chờ 1 nhịp render NHƯNG không bao giờ kẹt.
     *
     * requestAnimationFrame BỊ DỪNG khi tab chạy nền → V4 (dùng nextFrame)
     * đứng im cho tới khi người dùng quay lại tab. Ở đây race rAF với
     * setTimeout(24ms): foreground thì nhanh (≈1 frame), background vẫn tiến.
     */
    function nextTick(max = 24) {
        return new Promise(resolve => {
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            try { requestAnimationFrame(finish); } catch (err) {}
            setTimeout(finish, max);
        });
    }

    /**
     * V5.22 — Chờ Pancake XÓA composer, tức tin đã gửi xong.
     *
     * CHỈ được gọi khi tab vừa bị ẩn trong lượt đó (đường nhanh không đổi).
     * Trả true nếu composer đã trống (hoặc không còn node); false nếu hết giờ.
     */
    async function waitForSent(token, timeout = T.sendConfirm) {
        const until = performance.now() + timeout;
        while (performance.now() < until) {
            if (!isRunning || token !== runToken) return false;
            const box = getComposer();
            if (!box || !String(box.value || '').length) return true;
            await nextTick();
        }
        return false;
    }

    const normalizeText = text => String(text ?? '').replace(/\s+/g, ' ').trim();

    const clampInt = (value, min = 0) => {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? Math.max(min, n) : min;
    };

    /* =========================================================
     * SPEED SETTINGS
     * =======================================================*/

    const DEFAULT_SPEED = { transition: 0, snippet: 0, conversation: 0, autoEnter: 0, observer: 3000, gate: 0, enter: 1, upBottom: 1 };
    const speed = { ...DEFAULT_SPEED, ...(store.get(K.speed, {}) || {}) };

    /*
     * V5.19 — ĐÃ BỎ CÁC Ô CHỈNH DELAY KHỎI PANEL.
     *
     * Vì sao: đo trên máy thật (§24, §25) cho thấy phần việc của script chỉ
     * ~14/407 ms = 3.7% chu kỳ; 96.3% là Pancake render hội thoại. Mọi delay
     * phụ đều đang = 0, không còn việc gì để chỉnh.
     *
     * QUAN TRỌNG — các giá trị này KHÔNG CÒN đọc từ bộ nhớ đã lưu. Nếu bạn
     * từng chỉnh một ô rồi bây giờ xoá ô đi, giá trị cũ sẽ ÂM THẦM chạy mà
     * không nhìn thấy được trên giao diện nữa. Nên chốt cứng mặc định ở đây
     * VÀ dọn sạch khoá cũ trong bộ nhớ (purgeDeadDelays bên dưới) để không
     * còn delay vô hình. Muốn đổi thì sửa DEFAULT_SPEED trong code.
     */
    const PINNED = { transition: 0, snippet: 0, conversation: 0, autoEnter: 0, observer: 3000, gate: 0 };

    const D = {
        transition:   PINNED.transition,      // "Sau Enter"        — đã bỏ ô chỉnh
        snippet:      PINNED.snippet,         // "Sau bắt ID"       — đã bỏ ô chỉnh
        conversation: PINNED.conversation,    // "Click → composer" — đã bỏ ô chỉnh
        autoEnter:    PINNED.autoEnter,       // "Dán → Gửi"        — đã bỏ ô chỉnh
        /* Giới hạn chờ khách kế hiện ra ở dấu đỏ. Đây là TIMEOUT, không phải
           delay chèn thêm — vẫn còn hiệu lực, đã bỏ ô chỉnh. */
        observer:     PINNED.observer,
        /*
         * CHỐT AN TOÀN trước Enter — MẶC ĐỊNH 0 = TẮT (đúng nhịp V5.5).
         *   > 0: chờ .selected khớp ID tối đa bấy nhiêu ms rồi mới Enter.
         *
         * Lịch sử để hiểu vì sao mặc định TẮT:
         *   V5.6 đặt chốt TRƯỚC lúc dán  → lỗi "Composer không giữ nội dung"
         *   V5.7 dời chốt xuống TRƯỚC ENTER → vẫn lỗi đó trên máy thật
         * ⇒ Điểm chung: SAU KHI React commit hội thoại mới, dán vào composer
         *   không còn giữ được nội dung. Không tái hiện được trong jsdom
         *   (jsdom không có React thật), nên đưa ra thành tuỳ chọn thay vì
         *   đoán tiếp. Bật lên nếu muốn đổi tốc độ lấy thêm một lớp an toàn.
         */
        gate:        PINNED.gate,
        /*
         * SỐ LẦN BẤM ENTER SAU KHI DÁN (mặc định 1).
         *
         * Source (i18n trong html2.txt) cho thấy Pancake có tuỳ chọn
         *   doubleEnterNextUnread: "[Enter] 2 lần để chuyển sang tin nhắn
         *   chưa đọc kế tiếp"
         *   → "Mỗi khi nhấn đúp phím [Enter] khi trả lời hội thoại, phần mềm
         *      sẽ tự động chuyển sang hội thoại chưa đọc kế tiếp"
         * Nếu bạn BẬT tuỳ chọn đó trong Pancake, đặt Số Enter = 2 để tận dụng.
         *
         * CẢNH BÁO: khi tuỳ chọn đó đang TẮT trong Pancake, Enter thứ 2 có thể
         * gửi thêm một tin nhắn trống. Chỉ tăng khi bạn biết rõ mình đang làm gì.
         * Giới hạn 1–3.
         */
        enter:       Math.min(3, Math.max(1, clampInt(speed.enter, 1)))
        ,
        /*
         * LÙI LÊN KHI Ở CUỐI BẢNG (V5.18) — mặc định 1 = BẬT.
         *
         * Khi không còn row chưa xử lý nào bên dưới (đang ở cuối danh sách),
         * lùi lên ĐÚNG 1 ROW ngay trên thay vì dừng. Người dùng chỉ ra: "row
         * bên trên sẽ đẩy xuống".
         *
         * Tại sao vẫn cho TẮT (0): chính người dùng này từng báo lỗi V5.10
         * "đang nhắm click vào những đoạn chat phía trên". Lùi TỪNG ROW MỘT
         * thì mỗi bước chỉ dịch đúng 1 row (không thể nhảy lên đầu danh sách
         * như V5.10), nhưng vẫn có khả năng chạm một row mà người dùng đã
         * CUỘN QUA mà không xử lý. Nên để sẵn công tắc tắt ngay trên panel.
         */
        upBottom:    speed.upBottom === 0 ? 0 : 1
    };

    function saveSpeed() {
        store.set(K.speed, D);
    }

    /**
     * Dọn các khoá delay đã bị bỏ khỏi giao diện.
     *
     * Nếu không làm bước này, một lần chỉnh từ trước (ví dụ từng đặt "Chờ
     * khách kế" = 0 = chờ mãi) sẽ tiếp tục chạy trong khi ô chỉnh đã biến mất
     * khỏi panel — không nhìn thấy, không sửa được. Đây chính là "delay vô
     * hình". Chỉ ghi lại bộ nhớ khi thật sự có gì để xoá.
     */
    (function purgeDeadDelays() {
        const saved = store.get(K.speed, null);
        if (!saved || typeof saved !== 'object') return;
        let dirty = false;
        Object.keys(PINNED).forEach(k => {
            if (Object.prototype.hasOwnProperty.call(saved, k) && saved[k] !== PINNED[k]) {
                delete saved[k];
                dirty = true;
            }
        });
        if (dirty) store.set(K.speed, saved);
    })();

    /* =========================================================
     * DOM LOOKUP — theo source
     * =======================================================*/

    /** Row (.conversation-list-item) chứa element, có guard nằm trong #conversationList. */
    function getRowFrom(element) {
        if (!element || !element.closest) return null;
        const row = element.closest(SEL.row);
        if (!row) return null;
        return row.closest(SEL.listRoot) ? row : null;
    }

    /**
     * REAL ID = {pageId}_{conversationId}  (COMMENT: {postId}_{peerId} — xem RE_REAL_ID)
     * Source: row có id="...__{rowIndex}", wrapper cha có id="{pageId}_{conversationId}".
     * rowIndex thay đổi khi list ảo hóa cuộn → KHÔNG dùng để định danh.
     */
    function getRealId(row) {
        if (!row) return '';

        const m = RE_ROW_ID.exec(row.id || '');
        if (m) return m[1];

        let node = row.parentElement;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const id = node.id || '';
            if (RE_REAL_ID.test(id)) return id;
        }
        return '';
    }

    const getSnippet = row => {
        const el = row && row.querySelector(SEL.snippet);
        return el ? normalizeText(el.textContent || '') : null;
    };

    const getName = row => {
        const el = row && row.querySelector(SEL.name);
        return el ? normalizeText(el.textContent || '') : '';
    };

    /**
     * Node #conversationList ổn định → cache lại.
     * ĐO ĐƯỢC (jsdom): query từ node này nhanh hơn ~15 lần so với
     * document.querySelector('#conversationList .conversation-list-item.selected')
     * (60 µs vs 885 µs). Hàm này được gọi lặp lại khi chờ hội thoại mở.
     */
    let cachedList = null;
    function getList() {
        if (cachedList && cachedList.isConnected) return cachedList;
        cachedList = document.getElementById('conversationList');
        return cachedList && cachedList.isConnected ? cachedList : null;
    }

    /** Row đang được mở — source: .conversation-list-item.selected */
    function getSelectedRow() {
        const list = getList();
        return list ? list.querySelector(SEL.row + '.selected') : null;
    }

    /** Tên khách đang mở — source: .chat-menu > #pageCustomer > .customer-name */
    const getHeaderName = () => {
        const el = document.querySelector(SEL.headerName);
        return el ? normalizeText(el.textContent || '') : '';
    };

    /** Ô soạn — source: <textarea id="replyBoxComposer"> */
    function getComposer() {
        if (cachedComposer && cachedComposer.isConnected) return cachedComposer;
        cachedComposer = document.getElementById('replyBoxComposer');
        return cachedComposer && cachedComposer.isConnected ? cachedComposer : null;
    }

    /* =========================================================
     * SNAPSHOT TẠI DẤU ĐỎ
     * =======================================================*/

    function getSnapshotAt(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el || root.contains(el)) return null;

        const row = getRowFrom(el);
        if (!row) return null;

        return { row, found: el, id: getRealId(row), snippet: getSnippet(row), name: getName(row), x, y };
    }

    const getSnapshot = () => (clickPos ? getSnapshotAt(clickPos.x, clickPos.y) : null);

    /* =========================================================
     * QUÉT CHỦ ĐỘNG (V5.6)
     *
     * Vì sao có phần này: V5.5 đứng chờ Pancake xếp lại danh sách để một khách
     * khác xuất hiện ở đúng toạ độ dấu đỏ — 373 ms/khách, 58% chu kỳ. Nhưng
     * khách kế tiếp đã nằm sẵn trong DOM ngay dưới row vừa gửi, nên không cần
     * đợi nó đổi chỗ: đọc row kế tiếp là xong.
     *
     * Source: #conversationList chứa các .conversation-list-item theo đúng
     * thứ tự danh sách (rc-virtual-list render đúng thứ tự đó — thấy rõ trong
     * html2.txt: các row nằm trong .rc-virtual-list-holder-inner, mỗi row bọc
     * bởi <div id="{pageId}_{conversationId}">).
     * =======================================================*/

    function listRows() {
        const list = getList();
        return list ? list.querySelectorAll(SEL.row) : null;
    }

    /** Row nằm ngay SAU row có REAL ID = afterId, trong cùng #conversationList. */
    function findRowAfter(afterId) {
        const rows = listRows();
        if (!rows || !afterId) return null;
        for (let i = 0; i < rows.length - 1; i++) {
            if (getRealId(rows[i]) === afterId) {
                const next = rows[i + 1];
                return next && next.isConnected ? next : null;
            }
        }
        return null;
    }

    /** Snapshot đủ dùng cho 1 row bất kỳ — không cần elementFromPoint. */
    function snapshotFromRow(row) {
        if (!row || !row.isConnected) return null;
        const box = row.getBoundingClientRect();
        return {
            row,
            found: row,
            id: getRealId(row),
            snippet: getSnippet(row),
            name: getName(row),
            x: Math.round(box.left + box.width / 2),
            y: Math.round(box.top + box.height / 2)
        };
    }

    /**
     * Row đầu tiên trong số các row đang render mà CHƯA xử lý.
     *
     * Dùng làm phương án dự phòng khi "row kế tiếp" không còn dùng được:
     * Pancake xô lệch danh sách (xóa hội thoại vừa gửi → các row dưới trồi lên,
     * hoặc đẩy nó lên đầu → các row trên bị đẩy xuống), nên row nằm ngay sau
     * khách vừa gửi có thể lại là một khách ĐÃ gửi.
     * Không dùng vị trí/toạ độ → miễn nhiễm với mọi kiểu xô lệch.
     */
    /** Vị trí của row có REAL ID = id trong danh sách đang render (-1 = không có). */
    function indexOfRow(id) {
        const rows = listRows();
        if (!rows || !id) return -1;
        for (let i = 0; i < rows.length; i++) {
            if (getRealId(rows[i]) === id) return i;
        }
        return -1;
    }

    /**
     * Row đầu tiên CHƯA XỬ LÝ, tính TỪ vị trí `from` TRỞ ĐI — KHÔNG BAO GIỜ
     * quay ngược lên trên.
     *
     * Vì sao phải có `from`: danh sách là ảo hoá (rc-virtual-list), nên
     * querySelectorAll chỉ trả về một CỬA SỐ row đang render. Quét từ index 0
     * sẽ chạm vào row trên cùng của cửa số đó — khi người dùng cuộn xuống
     * cuối, đấy lại là những đoạn chat PHÍA TRÊN, hoàn toàn không phải chỗ họ
     * đang nhắm. Chính vì thế script từng nhảy đi click mấy đoạn chat ở trên.
     */
    function firstUnhandledRowFrom(from = 0) {
        const rows = listRows();
        if (!rows) return null;

        const filterOn = !bypassSnippet && initialSnippet;

        for (let i = Math.max(0, from); i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.isConnected) continue;
            const id = getRealId(row);
            if (!id || id === lastConversationId || handledIds.has(id)) continue;
            /* Đang bật lọc snippet: chỉ nhận row khớp mẫu, kẻo dừng oan */
            if (filterOn && getSnippet(row) !== initialSnippet) continue;
            return row;
        }
        return null;
    }

    /**
     * Lấy khách kế tiếp NGAY LẬP TỨC, không chờ Pancake.
     * Trả null khi không còn row nào để quét → executeStep sẽ gọi
     * waitForNextRow() (chờ như cũ) làm dự phòng.
     */
    function scanNextRow() {
        /* Pancake đã kịp đổi ngay tại dấu đỏ → dùng luôn, không tốn chờ */
        const at = getSnapshot();
        if (at && at.id && at.id !== lastConversationId && !handledIds.has(at.id)) return at;

        /* Vẫn là khách vừa gửi → lấy row kế tiếp trong danh sách */
        const after = snapshotFromRow(findRowAfter(lastConversationId));
        if (after && after.id && after.id !== lastConversationId
            && !handledIds.has(after.id)) return after;

        /* Danh sách đã xô lệch: "row kế tiếp" lại là khách đã gửi → quét TỪ
           VỊ TRÍ ĐANG XỬ LÝ TRỞ ĐI, lấy row đầu tiên chưa xử lý.
           KHÔNG quét từ đầu danh sách (xem firstUnhandledRowFrom). */
        let from = indexOfRow(lastConversationId);
        if (from < 0 && at && at.id) from = indexOfRow(at.id);   // neo theo dấu đỏ
        if (from < 0) return null;                               // không định vị được → chờ

        const any = snapshotFromRow(firstUnhandledRowFrom(from));
        if (any && any.id && !handledIds.has(any.id)) return any;

        /*
         * V5.18 — Ở CUỐI BẢNG, HẾT ROW BÊN DƯỚI ⇒ LÙI LÊN ĐÚNG 1 ROW NGAY TRÊN.
         *
         * Vì sao cần: ở cuối danh sách không còn row nào chưa xử lý, và Pancake
         * CHƯA kịp xếp lại (máy bạn đang bị 429 / cacheDb timeout nên việc xếp
         * lại chậm hơn cả nhịp quét của script — thấy rõ trong log: current_count
         * 168 → 5960 kèm hàng loạt 429). Khi ấy script cũ DỪNG HẲN, dù thực tế
         * row bên trên sẽ bị đẩy xuống.
         *
         * Lưu ý: cơ chế "row bên trên bị đẩy xuống" (hội thoại vừa gửi nhảy lên
         * đầu danh sách) ĐÃ được xử lý từ V5.13 nhờ getSnapshot() đọc lại dấu
         * đỏ — model D trong verify-shift.js chứng minh. Chỗ hở là trường hợp
         * Pancake CHƯA xếp lại kịp (model C), đang dừng oan.
         *
         * GIỚI HẠN BẮT BUỘC — chỉ lùi ĐÚNG 1 ROW, KHÔNG QUÉT NGƯỢC:
         *   V5.10 từng quét từ index 0 (= đỉnh cửa sổ ảo hoá) và bị chính người
         *   dùng này báo lỗi "đang nhắm click vào những đoạn chat phía trên".
         *   Lùi từng row một thì mỗi bước chỉ dịch đúng 1 row ⇒ KHÔNG BAO GIỜ
         *   nhảy được lên đầu danh sách. Vì vậy nếu row ngay trên đã xử lý rồi
         *   thì TRẢ NULL: đi tiếp tức là quét, tức là lặp lại lỗi V5.10.
         */
        if (D.upBottom && from > 0) {
            const rows = listRows();
            const up = rows[from - 1];
            if (up && up.isConnected) {
                const upId = getRealId(up);
                if (upId && upId !== lastConversationId && !handledIds.has(upId)) {
                    const filtering = !bypassSnippet && initialSnippet;
                    if (!filtering || getSnippet(up) === initialSnippet) {
                        if (!upNoticed) {
                            upNoticed = true;
                            console.log('[Pancake Auto] Hết row bên dưới (đang ở cuối bảng)'
                                + ' → lùi lên TỪNG row một, mỗi bước đúng 1 row.');
                        }
                        return snapshotFromRow(up);
                    }
                }
            }
        }

        return null;
    }

    /* =========================================================
     * POLLING HELPER
     * =======================================================*/

    async function waitUntil(callback, { timeout = 500, interval = 16, token = runToken } = {}) {
        const started = performance.now();
        while (isRunning && token === runToken && performance.now() - started < timeout) {
            try {
                const result = callback();
                if (result) return result;
            } catch (err) {}
            await sleep(interval);
        }
        return null;
    }

    /* =========================================================
     * UI — style gom thành 1 block (nhẹ hơn inline style)
     * =======================================================*/

    const CSS = `
#pk-root{position:fixed;bottom:25px;right:25px;z-index:2147483647;
  font-family:Roboto,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;user-select:none}
#pk-panel{width:255px;display:flex;flex-direction:column;gap:8px;padding:12px;
  background:rgba(26,26,30,.96);color:#fff;border:1px solid #444;border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:12px;
  max-height:calc(100vh - 30px);overflow-y:auto;box-sizing:border-box}
#pk-header{display:flex;justify-content:space-between;align-items:center;cursor:move;
  font-weight:700;border-bottom:1px solid #444;padding-bottom:6px}
#pk-min{cursor:pointer;color:#aaa;padding:0 5px}
.pk-card{background:#151515;border:1px solid #444;border-radius:6px;padding:7px;
  display:flex;flex-direction:column;gap:6px}
.pk-card.red{border-color:#5c2a2a}
.pk-title{text-align:center;font-size:11px;font-weight:700}
.pk-title.red{color:#ff7875}
.pk-row{display:flex;justify-content:space-between;align-items:center;gap:6px}
.pk-label{color:#aaa;font-size:10px}
.pk-num{width:58px;background:#080808;color:#fff;border:1px solid #555;border-radius:4px;
  text-align:center;padding:3px}
.pk-hint{color:#777;text-align:center;font-size:9px}
.pk-btn{padding:7px;border-radius:4px;cursor:pointer;font-size:11px;
  background:#333;color:#bbb;border:1px solid #555}
.pk-btn.wide{width:100%}
.pk-btn.flex{flex:1}
.pk-btn.on-green{background:#389e0d;color:#fff;border-color:#52c41a}
.pk-btn.on-amber{background:#d48806;color:#fff;border-color:#faad14}
.pk-btn.purple{background:#722ed1;color:#fff;border-color:#9254de}
.pk-btn.danger{background:#222;color:#ff7875}
.pk-btn:disabled{opacity:.5;cursor:not-allowed}
#pk-run{width:100%;background:#1677ff;color:#fff;font-weight:700;border:0;
  border-radius:5px;padding:8px;cursor:pointer;font-size:12px}
#pk-hotkey{width:75px;background:#080808;color:#fff;border:1px solid #555;
  border-radius:4px;padding:4px}
#pk-text{box-sizing:border-box;width:100%;background:#111;color:#fff;
  border:1px solid #555;border-radius:4px;padding:6px}
#pk-pos{text-align:center;font-size:10px;color:#888}
#pk-id{text-align:center;font-size:9px;color:#777;word-break:break-all}
#pk-observer{text-align:center;font-size:9px;color:#777}
#pk-hotkey-hint{text-align:center;font-size:10px;color:#777}
#pk-status{min-height:16px;text-align:center;font-size:11px;color:#aaa;word-break:break-word}
#pk-stats{text-align:center;font-size:9px;color:#5f5f5f}
#pk-stop-snippet{color:#777;text-align:center;font-size:10px;word-break:break-word;
  max-height:42px;overflow:hidden}
#pk-bubble{display:none;width:42px;height:42px;border-radius:50%;background:#1677ff;
  color:#fff;font-size:20px;align-items:center;justify-content:center;cursor:move;
  box-shadow:0 4px 15px rgba(0,0,0,.4)}
#pk-marker{position:fixed;width:14px;height:14px;border-radius:50%;background:#ff4d4f;
  border:2px solid #fff;box-shadow:0 0 10px rgba(255,77,79,.9);pointer-events:none;
  z-index:2147483646;transform:translate(-50%,-50%);display:none}
`;

    const speedRow = (id, label, value) => `
      <div class="pk-row">
        <span class="pk-label">${label}</span>
        <input id="${id}" type="number" min="0" step="1" value="${value}" class="pk-num">
      </div>`;

    const root = document.createElement('div');
    root.id = 'pk-root';
    root.innerHTML = `
      <style>${CSS}</style>
      <div id="pk-panel">
        <div id="pk-header">
          <span>🤖 Auto UPSALE V5.24</span>
          <span id="pk-min">─</span>
        </div>

        <div class="pk-card">
          <div class="pk-title">⚙ Tuỳ chọn</div>
          ${speedRow('pk-enter-count',   'Số Enter',         D.enter)}
          ${speedRow('pk-up-bottom',     'Lùi lên ở cuối',   D.upBottom)}
          
        </div>

        <div class="pk-card pk-row">
          <span>⌨ Start / Stop</span>
          <select id="pk-hotkey">
            <option value="Tab">Tab</option>
            <option value="F4">F4</option>
          </select>
        </div>

        <button id="pk-hotkey-enable" class="pk-btn wide"></button>

        <input id="pk-text" type="text" placeholder="Nội dung gửi (trống = clipboard)">

        <div class="pk-row" style="gap:4px">
          <button id="pk-pick" class="pk-btn flex">🎯 Chấm vị trí</button>
          <button id="pk-clear" class="pk-btn danger">✕</button>
        </div>

        <div class="pk-row" style="gap:5px">
          <button id="pk-auto-enter" class="pk-btn flex"></button>
          <button id="pk-bypass" class="pk-btn flex"></button>
        </div>
        <div class="pk-row" style="gap:4px">
          <button id="pk-scan" class="pk-btn flex"></button>
        </div>

        <div class="pk-card red">
          <div class="pk-title red">🛑 Câu dừng</div>
          <div class="pk-row" style="gap:4px">
            <button id="pk-stop-pick" class="pk-btn flex purple">🎯 Thêm câu dừng</button>
            <button id="pk-stop-clear" class="pk-btn danger">✕ Hủy</button>
          </div>
          <div id="pk-stop-snippet">Chưa có câu dừng</div>
        </div>

        <div id="pk-pos"></div>
        <div id="pk-id"></div>
        <div id="pk-observer"></div>

        <button id="pk-run">▶ Bắt đầu</button>

        <div id="pk-hotkey-hint"></div>
        <div id="pk-status">Sẵn sàng</div>
        <div id="pk-stats">📊 Chưa có dữ liệu</div>
      </div>

      <div id="pk-bubble">🤖</div>
    `;

    const marker = document.createElement('div');
    marker.id = 'pk-marker';

    document.body.appendChild(root);
    document.body.appendChild(marker);

    /* ---- UI references (query 1 lần) ----
     * Dùng [id="..."] thay vì #id:
     * querySelector('#id') đi theo fast-path id của TOÀN document, nên trả null
     * nếu trang đã có phần tử trùng id ở ngoài panel (VD: V4 cùng chạy, hoặc
     * script khác inject trùng id). Selector thuộc tính không bị fast-path này.
     */
    const $ = id => root.querySelector(`[id="${id}"]`);

    const panel        = $('pk-panel');
    const bubble       = $('pk-bubble');
    const btnRun       = $('pk-run');
    const btnPick      = $('pk-pick');
    const btnClear     = $('pk-clear');
    const btnAutoEnter = $('pk-auto-enter');
    const btnBypass    = $('pk-bypass');
    const btnScan      = $('pk-scan');
    const btnHotkey    = $('pk-hotkey-enable');
    const btnStopPick  = $('pk-stop-pick');
    const btnStopClear = $('pk-stop-clear');
    const inputText    = $('pk-text');
    const selectHotkey = $('pk-hotkey');
    const txtPos       = $('pk-pos');
    const txtId        = $('pk-id');
    const txtObserver  = $('pk-observer');
    const txtStatus    = $('pk-status');
    const txtHotkeyHint= $('pk-hotkey-hint');
    const txtStop      = $('pk-stop-snippet');
    const txtStats     = $('pk-stats');
    /* V5.19: chỉ còn 2 ô (Số Enter · Lùi lên ở cuối) — các ô delay đã bỏ. */
    const inputs       = {
        enter:        $('pk-enter-count'),
        upBottom:     $('pk-up-bottom')
    };

    /* =========================================================
     * UI STATE
     * =======================================================*/

    let savedUI = store.get(K.ui, {}) || {};
    let activationHotkey = savedUI.hotkey === 'F4' ? 'F4' : 'Tab';

    autoEnter     = savedUI.autoEnter === true;
    bypassSnippet = savedUI.bypassSnippet === true;
    scanEnabled   = savedUI.scanEnabled !== false;      // V5.6 mặc định ON
    hotkeyEnabled = false;                       // không restore sau reload
    stopSnippet   = normalizeText(store.get(K.stop, '') || '');
    clickPos      = store.get(K.pos, null);

    function setStatus(text, color = '#aaa') {
        txtStatus.textContent = text;
        txtStatus.style.color = color;
    }

    function updateMarker() {
        if (!clickPos) { marker.style.display = 'none'; return; }
        marker.style.display = 'block';
        marker.style.left = clickPos.x + 'px';
        marker.style.top  = clickPos.y + 'px';
    }

    function updateIdStatus(snapshot) {
        if (!snapshot || !snapshot.id) {
            txtId.textContent = 'ID: không xác định';
            txtId.style.color = '#ff7875';
            return;
        }
        txtId.textContent = 'REAL ID: ' + snapshot.id;
        txtId.style.color = '#52c41a';
    }

    function updateStopUI() {
        if (stopSnippet) {
            txtStop.textContent = '🛑 ' + stopSnippet;
            txtStop.style.color = '#ff7875';
            txtStop.title = stopSnippet;
            btnStopClear.disabled = false;
        } else {
            txtStop.textContent = 'Chưa có câu dừng';
            txtStop.style.color = '#777';
            txtStop.title = '';
            btnStopClear.disabled = true;
        }
    }

    function syncUI() {
        btnHotkey.textContent = hotkeyEnabled ? '🔓 Kích hoạt Hotkey: ON' : '🔒 Kích hoạt Hotkey: OFF';
        btnHotkey.className = 'pk-btn wide' + (hotkeyEnabled ? ' on-green' : '');

        btnAutoEnter.textContent = autoEnter ? '⚡ Auto Enter: ON' : '⚡ Auto Enter: OFF';
        btnAutoEnter.className = 'pk-btn flex' + (autoEnter ? ' on-green' : '');

        btnBypass.textContent = bypassSnippet ? '⏭ Bỏ lọc: ON' : '⏭ Bỏ lọc: OFF';
        btnBypass.className = 'pk-btn flex' + (bypassSnippet ? ' on-amber' : '');

        btnScan.textContent = scanEnabled ? '🔎 Quét chủ động: ON' : '🔎 Quét chủ động: OFF';
        btnScan.className = 'pk-btn flex' + (scanEnabled ? ' on-green' : '');

        selectHotkey.value = activationHotkey;
        txtHotkeyHint.textContent = `${activationHotkey.toUpperCase()} = Bắt đầu / Dừng`;

        if (clickPos) {
            txtPos.textContent = `Tọa độ: (${clickPos.x}, ${clickPos.y})`;
            txtPos.style.color = '#52c41a';
        } else {
            txtPos.textContent = 'Chưa chọn tọa độ';
            txtPos.style.color = '#888';
        }

        updateStopUI();
    }

    /* Lưu UI (debounce) */
    let saveUITimer = null;

    function saveUI() {
        const rect = root.getBoundingClientRect();
        store.set(K.ui, {
            text: inputText.value,
            autoEnter,
            bypassSnippet,
            scanEnabled,
            hotkey: activationHotkey,
            minimized: panel.style.display === 'none',
            position: { left: Math.round(rect.left), top: Math.round(rect.top) }
        });
    }

    function scheduleSaveUI() {
        clearTimeout(saveUITimer);
        saveUITimer = setTimeout(saveUI, 250);
    }

    function keepInViewport() {
        const rect = root.getBoundingClientRect();
        const left = Math.max(0, Math.min(rect.left, Math.max(0, window.innerWidth - 50)));
        const top  = Math.max(0, Math.min(rect.top,  Math.max(0, window.innerHeight - 50)));
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.left = Math.round(left) + 'px';
        root.style.top  = Math.round(top) + 'px';
    }

    function restoreUI() {
        inputText.value = typeof savedUI.text === 'string' ? savedUI.text : '';

        const minimized = savedUI.minimized === true;
        panel.style.display = minimized ? 'none' : 'flex';
        bubble.style.display = minimized ? 'flex' : 'none';

        const p = savedUI.position;
        if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            root.style.left = p.left + 'px';
            root.style.top = p.top + 'px';
        }
        requestAnimationFrame(keepInViewport);
    }

    /* =========================================================
     * EVENTS
     * =======================================================*/

    Object.values(inputs).forEach(input => {
        input.addEventListener('change', () => {
            D.enter    = Math.min(3, Math.max(1, clampInt(inputs.enter.value, 1)));
            /* V5.19: V5.18 đưa upBottom vào danh sách inputs mà QUÊN nối vào
               đây ⇒ đổi ô "Lùi lên ở cuối" trên panel không có tác dụng. */
            D.upBottom = inputs.upBottom.value === '0' ? 0 : 1;
            saveSpeed();
        });
    });

    btnHotkey.onclick = () => { hotkeyEnabled = !hotkeyEnabled; syncUI(); };

    btnAutoEnter.onclick = () => { autoEnter = !autoEnter; syncUI(); saveUI(); };

    btnBypass.onclick = () => { bypassSnippet = !bypassSnippet; syncUI(); saveUI(); };

    btnScan.onclick = () => { scanEnabled = !scanEnabled; syncUI(); saveUI(); };

    selectHotkey.onchange = () => {
        activationHotkey = selectHotkey.value === 'F4' ? 'F4' : 'Tab';
        syncUI();
        saveUI();
    };

    inputText.addEventListener('input', scheduleSaveUI);

    $('pk-min').onclick = () => {
        panel.style.display = 'none';
        bubble.style.display = 'flex';
        saveUI();
    };

    let hasMoved = false;
    let suppressBubbleClick = false;

    bubble.onclick = event => {
        if (suppressBubbleClick) {
            suppressBubbleClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        bubble.style.display = 'none';
        panel.style.display = 'flex';
        keepInViewport();
        saveUI();
    };

    function makeDraggable(handle) {
        handle.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target.id === 'pk-min') return;

            const rect = root.getBoundingClientRect();
            const startX = event.clientX, startY = event.clientY;
            const startLeft = rect.left, startTop = rect.top;

            hasMoved = false;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
            event.preventDefault();

            const move = e => {
                const dx = e.clientX - startX, dy = e.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
                root.style.left = (startLeft + dx) + 'px';
                root.style.top  = (startTop + dy) + 'px';
                keepInViewport();
            };

            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                keepInViewport();
                if (handle === bubble && hasMoved) suppressBubbleClick = true;
                saveUI();
            };

            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        });
    }

    makeDraggable($('pk-header'));
    makeDraggable(bubble);
    window.addEventListener('resize', keepInViewport);

    /* =========================================================
     * PICKERS
     * =======================================================*/

    function removePicker() {
        if (activePicker) {
            window.removeEventListener('click', activePicker, true);
            activePicker = null;
        }
    }

    function startPicker(mode) {
        removePicker();

        const onPick = mode === 'pos'
            ? (row, event) => {
                clickPos = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
                store.set(K.pos, clickPos);
                updateMarker();
                syncUI();
                updateIdStatus(getSnapshot());
                return 'Đã lưu tọa độ';
            }
            : row => {
                const snippet = getSnippet(row);
                if (!snippet) {
                    setStatus('Không đọc được snippet.', '#ff7875');
                    return null;
                }
                stopSnippet = snippet;
                if (stopSnippet) store.set(K.stop, stopSnippet); else store.remove(K.stop);
                updateStopUI();
                return '🛑 Đã lưu câu dừng';
            };

        const hint = mode === 'pos'
            ? 'Click vào conversation...'
            : '🛑 Click conversation có câu muốn dừng...';

        setStatus(hint, '#faad14');

        activePicker = event => {
            if (root.contains(event.target)) return;

            const row = getRowFrom(event.target);
            if (!row) {
                setStatus('Không phải conversation. Hãy chấm lại.', '#ff7875');
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const message = onPick(row, event);
            if (message) setStatus(message, '#52c41a');
            removePicker();
        };

        window.addEventListener('click', activePicker, true);
    }

    btnPick.onclick = () => startPicker('pos');
    btnStopPick.onclick = () => startPicker('stop');

    btnStopClear.onclick = () => {
        stopSnippet = '';
        store.remove(K.stop);
        updateStopUI();
        setStatus('Đã hủy câu dừng');
    };

    btnClear.onclick = () => {
        clickPos = null;
        store.remove(K.pos);
        txtId.textContent = 'ID: chưa kiểm tra';
        txtId.style.color = '#777';
        updateMarker();
        syncUI();
    };

    /* =========================================================
     * CLICK — đủ chuỗi sự kiện để React nhận
     * =======================================================*/

    function fullClick(element, x, y) {
        if (!element || !element.isConnected) return false;

        const common = {
            bubbles: true, cancelable: true, composed: true,
            clientX: x, clientY: y, button: 0, view: window
        };

        try {
            const pointer = (type, buttons) => element.dispatchEvent(new PointerEvent(type, {
                ...common, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true
            }));
            const mouse = (type, buttons) => element.dispatchEvent(new MouseEvent(type, { ...common, buttons }));

            pointer('pointerdown', 1);
            mouse('mousedown', 1);
            pointer('pointerup', 0);
            mouse('mouseup', 0);
            element.dispatchEvent(new MouseEvent('click', { ...common }));
            return true;
        } catch (err) {
            try { element.click(); return true; } catch (err2) { return false; }
        }
    }

    /* =========================================================
     * GHI TEXT VÀO COMPOSER
     * Source: #replyBoxComposer là <textarea> do React điều khiển
     * → phải set qua native setter rồi bắn event 'input'.
     * =======================================================*/

    function setComposerValue(element, text) {
        if (!element || !text) return false;

        try {
            element.focus();

            if (element instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype, 'value'
                )?.set;

                /*
                 * BẪY CỦA REACT (nguyên nhân lỗi "Composer không giữ nội dung"
                 * khi nội dung gửi GIỐNG cái đang có sẵn trong composer):
                 *
                 * React theo dõi value bằng inputValueTracking. Hàm
                 * updateValueIfChanged(node) so giá trị mới với giá trị đã
                 * tracked; nếu GIỐNG HỆT thì trả false ⇒ React KHÔNG bắn
                 * onChange ⇒ Pancake không bao giờ biết có nội dung, rồi
                 * lần render sau nó đè composer bằng state cũ → mất text.
                 *
                 * Chuyện này xảy ra khi: lần chạy trước lỗi giữa chừng để lại
                 * text trong composer thành draft, hoặc Pancake tự điền sẵn
                 * nội dung. Cách xử lý chuẩn: xóa về rỗng trước (kèm 1 event
                 * input để React cập nhật tracker), rồi mới gán text.
                 */
                if (element.value === text) {
                    console.info(
                        '[Pancake Auto] Composer đã sẵn đúng nội dung (draft cũ?) '
                        + '→ xóa rồi gán lại để React chịu bắn onChange'
                    );
                    if (setter) setter.call(element, '');
                    else element.value = '';
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }

                if (setter) setter.call(element, text);
                else element.value = text;

                element.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }

            if (element.isContentEditable) {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(element);
                selection.removeAllRanges();
                selection.addRange(range);

                if (document.execCommand('insertText', false, text)) return true;

                element.textContent = text;
                element.dispatchEvent(new InputEvent('input', {
                    bubbles: true, inputType: 'insertText', data: text
                }));
                return true;
            }

            return false;
        } catch (err) {
            console.error('[Pancake Auto] setComposerValue:', err);
            return false;
        }
    }

    /**
     * Đọc nội dung gửi: ô text trong panel,否则 clipboard (đọc 1 lần/run).
     */
    async function getSendText() {
        const direct = inputText.value.trim();
        if (direct) return direct;
        if (cachedText) return cachedText;

        try {
            cachedText = (await navigator.clipboard.readText()) || '';
        } catch (err) {
            try {
                cachedText = (typeof GM_getClipboard === 'function' ? await GM_getClipboard() : '') || '';
            } catch (err2) {
                cachedText = '';
            }
        }
        return cachedText;
    }

    /* =========================================================
     * ENTER
     * KeyboardEventInit KHÔNG hỗ trợ keyCode/which (bị bỏ qua),
     * nên define thủ công phòng trường hợp site đọc keyCode.
     * =======================================================*/

    function makeEnterEvent(type) {
        const event = new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true
        });
        try {
            Object.defineProperty(event, 'keyCode', { get: () => 13 });
            Object.defineProperty(event, 'which',   { get: () => 13 });
        } catch (err) {}
        return event;
    }

    /* =========================================================
     * DIRECT ROW OBSERVER
     *
     * Theo dõi .rc-virtual-list-holder-inner:
     *  - childList: row được thêm/xóa khi list đổi
     *  - attributes(id|class), subtree: React tái sử dụng node và
     *    chỉ đổi id/class → childList sẽ KHÔNG bắn. Đây là lỗ hổng
     *    của bản V4 (chỉ nghe childList).
     *  - thêm nhịp poll thích ứng (40 → 120 → 250ms) vì elementFromPoint rất rẻ.
     * =======================================================*/

    function cleanupObserver() {
        if (listObserver) {
            listObserver.disconnect();
            try { listObserver.takeRecords(); } catch (err) {}
            listObserver = null;
        }
        if (observerState) {
            if (observerState.timeoutId) clearTimeout(observerState.timeoutId);
            if (observerState.pollId) clearInterval(observerState.pollId);
            if (observerState.checkTimer) clearTimeout(observerState.checkTimer);
        }
        observerState = null;

        txtObserver.textContent = '👁 Direct Observer: OFF';
        txtObserver.style.color = '#777';
    }

    function resolveObserver(snapshot) {
        const state = observerState;
        if (!state || state.resolved) return;

        state.resolved = true;
        cleanupObserver();

        if (snapshot) {
            txtObserver.textContent = '👁 Direct Observer: HIT';
            txtObserver.style.color = '#52c41a';
        } else {
            txtObserver.textContent = '👁 Direct Observer: TIMEOUT';
            txtObserver.style.color = '#faad14';
        }

        const resolve = state.resolve;
        state.resolve = null;
        if (resolve) resolve(snapshot);
    }

    /**
     * Gộp nhiều mutation thành 1 lần check.
     *
     * checkObserverTarget() gọi document.elementFromPoint() → ép trình duyệt
     * tính lại layout (forced reflow).
     *
     * ĐO ĐƯỢC: MutationObserver gom record theo microtask, nên React đổi 200 node
     * trong 1 frame chỉ = 1 callback (tôi từng đoán sai là 200 lần). Vì vậy lợi
     * ích của việc gộp này KHÔNG lớn — nó chỉ tránh trường hợp poll dự phòng và
     * mutation check rơi vào cùng 1 frame (2 lần reflow thay vì 1). Giữ lại vì
     * rẻ, nhưng đừng trông chờ nó tạo khác biệt lớn.
     *
     * Dùng setTimeout (không dùng requestAnimationFrame) vì rAF bị dừng khi tab
     * chạy nền — script vẫn phải chạy được khi người dùng chuyển tab.
     */
    function scheduleCheck() {
        const state = observerState;
        if (!state || !state.active || state.resolved) return;
        if (state.checkTimer) return;                       // đã có lịch → gộp

        /* startedAt = 0 khi check chạy trước khi vào nhánh chờ (race lúc
           activate) → giữ nhịp nhanh T.minGap. */
        const elapsed = state.startedAt ? performance.now() - state.startedAt : 0;
        const wait = Math.max(0, checkGap(elapsed) - (performance.now() - lastCheckAt));
        state.checkTimer = setTimeout(() => {
            const current = observerState;
            if (!current) return;
            current.checkTimer = null;
            checkObserverTarget();
        }, wait);
    }

    function checkObserverTarget() {
        const state = observerState;
        if (!state || !state.active || state.resolved) return;
        if (!isRunning || state.token !== runToken) return;

        lastCheckAt = performance.now();

        const snapshot = getSnapshot();
        if (!snapshot || !snapshot.id) return;
        if (snapshot.id === state.oldId) return;   // vẫn là conversation cũ

        /* V5.6: quét chủ động có thể gửi hết các row đang hiện rồi mới rơi vào
           nhánh chờ này. Không được nhận lại 1 khách đã gửi — kẻo lặp vô hạn. */
        if (handledIds.has(snapshot.id)) return;

        resolveObserver(snapshot);
    }

    function armListObserver(row, conversationId, token) {
        cleanupObserver();

        if (!row || !conversationId || !isRunning || token !== runToken) return false;

        const inner = getList()?.querySelector('.rc-virtual-list-holder-inner')
            || row.closest(SEL.listRoot)?.querySelector('.rc-virtual-list-holder-inner');

        if (!inner) {
            console.warn('[Pancake Auto] Không tìm thấy .rc-virtual-list-holder-inner');
            return false;
        }

        observerState = {
            token, oldId: conversationId,
            active: false, resolved: false, resolve: null,
            timeoutId: null, pollId: null, checkTimer: null, startedAt: 0
        };

        listObserver = new MutationObserver(() => {
            const state = observerState;
            if (!state || !state.active || state.resolved) return;
            if (!isRunning || state.token !== runToken) return;
            scheduleCheck();          // gộp: không check ngay trong callback
        });

        try {
            listObserver.observe(inner, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['id', 'class']
            });

            txtObserver.textContent = '👁 Direct Observer: ARMED';
            txtObserver.style.color = '#52c41a';
            return true;
        } catch (err) {
            console.error('[Pancake Auto] Observer attach:', err);
            cleanupObserver();
            return false;
        }
    }

    function activateListObserver(token) {
        const state = observerState;
        if (!state || state.token !== token || token !== runToken) return;
        if (state.resolved || !isRunning) return;

        state.active = true;
        txtObserver.textContent = '👁 Direct Observer: WATCHING';
        txtObserver.style.color = '#52c41a';

        checkObserverTarget();   // bắt race: row đã đổi trước khi activate
    }

    function waitForNextConversation(token, timeout = D.observer) {
        return new Promise(resolve => {
            const state = observerState;
            if (!state || state.token !== token || token !== runToken || !isRunning) {
                resolve(null);
                return;
            }

            state.resolve = resolve;
            state.active = true;

            txtObserver.textContent = '👁 Direct Observer: WATCHING';
            txtObserver.style.color = '#52c41a';

            checkObserverTarget();
            if (state.resolved) return;

            /* Dự phòng + chống jitter: nhịp NHANH lúc đầu (40ms) rồi thưa dần
               (120ms → 250ms). Nhịp cố định 250ms làm thời gian phát hiện khách
               kế dao động 0–250ms ⇒ "lúc nhanh lúc chậm". */
            state.startedAt = performance.now();
            const tick = () => {
                const current = observerState;
                if (!current || current.resolved || current.token !== token) return;
                if (!isRunning) return;
                scheduleCheck();
                current.pollId = setTimeout(
                    tick, pollDelay(performance.now() - (current.startedAt || 0))
                );
            };
            if (T.pollFast > 0) state.pollId = setTimeout(tick, T.pollFast);

            /* timeout = 0 → chờ tới khi danh sách đổi (không watchdog) */
            if (timeout > 0) {
                state.timeoutId = setTimeout(() => {
                    const current = observerState;
                    if (!current || current.resolved || current.token !== token) return;
                    checkObserverTarget();
                    if (current.resolved) return;
                    resolveObserver(null);
                }, timeout);
            }
        });
    }

    async function waitForNextRow(token) {
        if (D.transition > 0) {
            await sleep(D.transition);
            if (!isRunning || token !== runToken) return null;
        }

        setStatus('👁 Chờ conversation kế tiếp...', '#faad14');

        let snapshot = await waitForNextConversation(token);
        if (!snapshot || !isRunning || token !== runToken) return null;

        lastWaitMs = performance.now() - sentAt;

        if (D.snippet > 0) {
            await sleep(D.snippet);
            if (!isRunning || token !== runToken) return null;

            const latest = getSnapshot();   // đọc lại sau delay
            if (latest) snapshot = latest;
        }
        return snapshot;
    }

    /* =========================================================
     * CHỜ HỘI THOẠI ĐƯỢC MỞ ĐÚNG
     * Đây là chốt an toàn quan trọng nhất của V5.
     *
     * Bản V4 lấy #replyBoxComposer ngay sau click. Node này tồn tại
     * suốt (chỉ mất khi chưa mở hội thoại nào), nên script có thể
     * dán + Enter khi hội thoại mới CHƯA thực sự mở → sai khách.
     *
     * Source: row đang mở mang class .selected, id wrapper = REAL ID.
     * =======================================================*/

    async function waitForConversationOpen(snapshot, token, gate = T.selected) {
        const targetId = snapshot.id;
        const targetName = snapshot.name;

        /* gate <= 0: không chờ, dán luôn (hành vi V4, nhanh nhất).
           Bật quét chủ động + D.gate > 0 thì executeStep truyền D.gate vào đây. */
        if (gate <= 0) return { ok: true, skipped: true };

        /*
         * Khi được bật: lắng nghe sự kiện thay vì poll — React thêm class .selected
         * → MutationObserver bắn ngay sau commit (≈0ms). Vẫn giữ 1 poll chậm 50ms
         * làm dự phòng nếu observer lỡ nhịp.
         */

        const matches = () => {
            const selected = getSelectedRow();
            return !!selected && getRealId(selected) === targetId;
        };

        const ok = await new Promise(resolve => {
            const list = getList();
            let settled = false;
            let observer = null;
            let pollId = null;
            let timeoutId = null;

            const finish = value => {
                if (settled) return;
                settled = true;
                if (observer) observer.disconnect();
                if (pollId) clearInterval(pollId);
                if (timeoutId) clearTimeout(timeoutId);
                resolve(value);
            };

            const verify = () => {
                if (!isRunning || token !== runToken) return finish(false);
                if (matches()) finish(true);
            };

            if (matches()) return finish(true);

            try {
                observer = new MutationObserver(verify);
                observer.observe(list || document.body, {
                    subtree: !!list,
                    attributes: true,
                    attributeFilter: ['class', 'id']
                });
            } catch (err) { observer = null; }

            pollId = setInterval(verify, 50);
            timeoutId = setTimeout(() => finish(false), gate);
        });

        if (!ok) return { ok: false, reason: 'Hội thoại không mở (không khớp .selected)' };

        /* Chống gửi sai khách: đổi tên hội thoại thì cảnh báo, không dừng. */
        const headerName = getHeaderName();
        if (targetName && headerName && headerName !== targetName) {
            console.warn(
                '[Pancake Auto] Tên không khớp:', { row: targetName, header: headerName }
            );
            setStatus(`⚠ Tên lệch: ${headerName}`, '#faad14');
        }

        return { ok: true };
    }

    async function getComposerAfterClick(token) {
        if (D.conversation > 0) await sleep(D.conversation);

        if (!isRunning || token !== runToken) return null;

        /* Chỉ chờ 1 nhịp khi composer chưa có (thường đã có sẵn từ khách trước) */
        let composer = getComposer();
        if (composer) return composer;

        await nextTick();
        if (!isRunning || token !== runToken) return null;

        composer = getComposer();
        if (composer) return composer;

        return waitUntil(() => {
            const current = getComposer();
            return current && current.isConnected ? current : null;
        }, { timeout: T.composer, interval: 16, token });
    }

    /**
     * Dán và GIỮ nội dung qua các lần React re-render.
     *
     * V5.6 lỗi "Composer không giữ nội dung" (người dùng báo thật): bật chốt
     * .selected khiến ta dán SAU khi React đã commit hội thoại mới — đúng lúc
     * Pancake render draft của hội thoại đó và xóa text. V5.5 dán trước lúc
     * commit nên không bị.
     *
     * Cách sửa: (a) dời chốt .selected xuống TRƯỚC ENTER thay vì trước lúc dán;
     * (b) thay "dán lại đúng 1 lần" bằng "dán lại cho tới khi giữ được", tối đa
     * T.pasteHold ms. Vòng lặp kiểm tra TRƯỚC rồi mới await ⇒ KHÔNG tốn thời
     * gian trong trường hợp bình thường (dán ngay là xong).
     *
     * Trả { ok, composer }; composer có thể là node mới nếu React thay node.
     */
    /**
     * So khớp "đủ tốt".
     * <textarea> tự chuẩn hoá CRLF → LF (theo chuẩn HTML), nên nội dung y hệt
     * vẫn có thể so ra KHÁC nếu text gốc còn \r. So trực tiếp trong trường hợp
     * đó sẽ đốt hết T.pasteHold rồi dừng oan.
     */
    const sameText = (a, b) =>
        a === b ||
        String(a).replace(/\r\n?/g, '\n') === String(b).replace(/\r\n?/g, '\n');

    /** In CHUỖI (không phải Object) để người dùng copy được ngay từ console. */
    function logPasteFail(label, box, text, tries) {
        const val = box ? String(box.value ?? '') : '(không có node)';
        const exp = String(text ?? '');
        let khac = 'y hệt';
        if (val !== exp) {
            if (val.length !== exp.length) khac = `khác ĐỘ DÀI (${val.length} vs ${exp.length})`;
            else {
                for (let i = 0; i < Math.max(val.length, exp.length); i++) {
                    if (val[i] !== exp[i]) {
                        khac = `khác tại ký tự ${i}: composer ${JSON.stringify(val.slice(i, i + 12))}` +
                               ` vs text ${JSON.stringify(exp.slice(i, i + 12))}`;
                        break;
                    }
                }
            }
        }
        console.warn(
            `[Pancake Auto] ${label}\n` +
            `   thử lại      : ${tries} lần trong ${T.pasteHold} ms\n` +
            `   connected    : ${box ? box.isConnected : '-'}\n` +
            `   disabled/ro  : ${box ? box.disabled : '-'} / ${box ? box.readOnly : '-'}\n` +
            `   maxLength    : ${box ? box.maxLength : '-'}\n` +
            `   độ dài       : composer ${val.length} vs text ${exp.length}\n` +
            `   khác nhau    : ${khac}\n` +
            `   composer đầu : ${JSON.stringify(val.slice(0, 120))}\n` +
            `   text đầu     : ${JSON.stringify(exp.slice(0, 120))}`
        );
    }

    async function pasteAndHold(startComposer, text, token) {
        if (!startComposer || !setComposerValue(startComposer, text)) {
            return { ok: false, composer: startComposer, tries: 0 };
        }

        let box   = startComposer;
        let tries = 0;
        let held  = box.isConnected && sameText(box.value, text);
        const holdUntil = performance.now() + T.pasteHold;

        while (!held && performance.now() < holdUntil) {
            tries++;
            await nextTick();
            if (!isRunning || token !== runToken) return { ok: false, composer: box, tries };

            const fresh = getComposer();
            if (fresh && fresh !== box) box = fresh;   // React thay node composer

            setComposerValue(box, text);
            held = box.isConnected && sameText(box.value, text);
        }
        return { ok: held, composer: box, tries };
    }

    /* =========================================================
     * EXECUTE STEP
     * =======================================================*/

    async function executeStep(afterEnter = false, token = runToken) {
        if (!isRunning || token !== runToken || !clickPos) return;

        tabHiddenDuringStep = false;   // V5.22: bắt đầu 1 khách mới → đặt lại
        stepStart = performance.now();

        let snapshot = null;
        let scanned   = false;

        if (!afterEnter) {
            snapshot = getSnapshot();
        } else {
            /*
             * QUÉT CHỦ ĐỘNG (V5.6): lấy khách kế ngay trong DOM, KHÔNG chờ
             * Pancake xếp lại danh sách. Chỉ khi quét không ra row nào
             * (đã gửi hết các row đang hiện) mới chờ như V5.5 trở về trước.
             */
            if (scanEnabled) {
                snapshot = scanNextRow();
                scanned  = !!snapshot;
            }
            if (!snapshot) snapshot = await waitForNextRow(token);
        }

        /* Đặt lại mốc: pha dán chỉ tính TỪ LÚC CÓ KHÁCH MỚI, không gồm pha chờ.
           (Trước đây đặt trước await nên pha dán bị cộng thêm cả pha chờ.) */
        stepStart = performance.now();

        /* Ghép pha chờ vào chu kỳ của khách trước (đã ghi pha dán lúc Enter).
           Quét ra ngay ⇒ pha chờ chỉ bằng đúng 1 lần đọc DOM (~0 ms).
           recordWait() in chi tiết 5 mốc, nên PHẢI gọi TRƯỚC phaseReset() —
           reset trước thì dòng in ra toàn số 0 (lỗi của V5.14/V5.15). */
        if (afterEnter) {
            if (scanned) lastWaitMs = sentAt ? performance.now() - sentAt : 0;
            if (lastWaitMs) {
                recordWait(lastWaitMs);
                lastWaitMs = 0;
            }
        }

        phaseReset();

        if (!isRunning || token !== runToken) return;

        if (!snapshot && afterEnter && scanEnabled) {
            /*
             * V5.17 — Hết giờ chờ mà không có khách mới.
             * Với danh sách lớn (~6000 hội thoại, thấy trong log máy bạn),
             * Pancake nạp thêm row theo trang và đang BỊ 429 / cacheDb timeout,
             * nên có lúc cửa sổ ảo hoá chưa kịp có row mới trong 3 giây.
             * Dừng hẳn ở đây là dừng oan. Quét lại ĐÚNG 1 LẦN: nếu lúc này đã
             * có row chưa xử lý thì tiếp tục, không có thì mới dừng.
             * Chỉ biến "dừng" thành "tiếp tục", không đổi bất kỳ nhánh nào khác.
             */
            const retry = scanNextRow();
            if (retry && retry.id && retry.id !== lastConversationId
                && !handledIds.has(retry.id)) snapshot = retry;
        }

        if (!snapshot) return stop('Không bắt được conversation mới');
        if (!snapshot.id) return stop('Không xác định được REAL conversation ID');
        if (snapshot.snippet === null) return stop('Snippet chưa sẵn sàng');

        const currentSnippet = snapshot.snippet;

        /* ---- Câu dừng: ưu tiên cao nhất ---- */
        if (stopSnippet && currentSnippet === stopSnippet) {
            return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
        }

        /* ---- Lọc snippet theo mẫu ---- */
        if (initialSnippet === null) {
            initialSnippet = currentSnippet;
        } else if (!bypassSnippet && currentSnippet !== initialSnippet) {
            return stop('Dừng: snippet không trùng mẫu');
        }

        /* ---- Chặn xử lý lại 1 ID ---- */
        if (lastConversationId && snapshot.id === lastConversationId) {
            return stop('Chặn xử lý lại cùng conversation');
        }
        lastConversationId = snapshot.id;
        /* V5.17: ngưỡng cũ 1000. Log máy bạn cho thấy danh sách ~6000 hội
           thoại (current_count lên tới 5960), nên một ca chạy dài có thể vượt
           1000 và bắt đầu QUÊN ID cũ ⇒ nguy cơ gửi lại một khách thật.
           Set<string> ~20k mục tốn chưa tới 3 MB — rẻ hơn rất nhiều so với
           gửi nhầm. Không bao giờ xoá trong lượt chạy bình thường. */
        if (handledIds.size > 20000) handledIds.delete(handledIds.values().next().value);
        handledIds.add(snapshot.id);

        const row = snapshot.row;
        if (!row || !row.isConnected) return stop('Conversation row không còn tồn tại');

        /* Toạ độ click: với row do quét chủ động lấy được, bấm vào GIỮA row đó
           (toạ độ dấu đỏ chỉ đúng cho row đang nằm ở vị trí dấu đỏ). */
        const clickX = Number.isFinite(snapshot.x) ? snapshot.x : clickPos.x;
        const clickY = Number.isFinite(snapshot.y) ? snapshot.y : clickPos.y;

        /* Critical path: NEW ID → CLICK (không làm gì nặng trước click) */
        if (!fullClick(row, clickX, clickY)) {
            return stop('Không click được conversation');
        }

        phaseMark('click');                 // fullClick xong (React mở hội thoại)

        updateIdStatus(snapshot);
        setStatus('Đã bắt ID → đang mở conversation...', '#52c41a');

        /* Chốt .selected được DỜI XUỐNG TRƯỚC ENTER (xem bên dưới).
           Lý do: dán ngay sau click (nhịp V5.5) thì text mới sống sót qua lần
           render draft của hội thoại mới; chờ chốt xong mới dán là dán đúng
           vào lúc Pancake xóa text → lỗi "Composer không giữ nội dung".
           Chế độ cũ (scan OFF) vẫn giữ chốt ở vị trí này như V5.5. */
        if (!scanEnabled) {
            const opened = await waitForConversationOpen(snapshot, token, T.selected);
            if (!isRunning || token !== runToken) return;
            if (!opened.ok) return stop(opened.reason);
        }

        /* Arm observer cho vòng sau (sau click, trước dán/gửi) */
        if (!armListObserver(row, snapshot.id, token)) {
            return stop('Không gắn được Direct Observer');
        }

        /* ---- Composer ---- */
        let   composer = await getComposerAfterClick(token);
        if (!isRunning || token !== runToken) return;
        if (!composer) return stop('Không tìm thấy #replyBoxComposer');
        phaseMark('composer');

        /* ---- Nội dung ---- */
        const text = await getSendText();
        if (!isRunning || token !== runToken) return;

        lastCtx = {
            id:        snapshot.id,
            ten:       snapshot.name,
            snippet:   snapshot.snippet,
            mauSnip:   initialSnippet,
            boLocSnip: bypassSnippet,
            quiChuong: scanEnabled,
            chot:      D.gate,
            doDaiText: text ? text.length : 0,
            textDau:   text ? text.slice(0, 60) : ''
        };

        if (!text) return stop('Không có nội dung gửi');

        /* ---- Dán ----
           pasteAndHold tự dán lần đầu; KHÔNG dán ở ngoài (từng sót 1 lần dán
           thừa ở đây → 3 lần dán/khách thay vì 2). */
        /* Dán ngay (nhịp V5.5) rồi GIỮ nội dung qua các lần React render */
        let pasted = await pasteAndHold(composer, text, token);
        if (!isRunning || token !== runToken) return;
        if (!pasted.ok) {
            logPasteFail('Composer không giữ nội dung (dán lần 1)', pasted.composer, text, pasted.tries);
            return stop('Composer không giữ nội dung (React đã reset)');
        }
        composer = pasted.composer;
        pasteTries = pasted.tries || 0;
        phaseMark('paste');

        /* ---- CHỐT AN TOÀN TRƯỚC ENTER (chỉ khi bật quét chủ động VÀ D.gate > 0) ----
           MẶC ĐỊNH D.gate = 0 ⇒ bỏ qua hoàn toàn, giữ đúng nhịp V5.5 (thứ đang
           chạy tốt). Xem chú thích tại D.gate để hiểu vì sao không mặc định bật. */
        if (scanEnabled && D.gate > 0) {
            const opened = await waitForConversationOpen(snapshot, token, D.gate);
            if (!isRunning || token !== runToken) return;
            if (!opened.ok) return stop(opened.reason);

            /* CHỈ dán lại khi text THỰC SỰ bị mất (React xóa lúc commit).
               Còn giữ nguyên thì không đụng vào — tránh dán thừa. */
            if (!composer.isConnected || composer.value !== text) {
                pasted = await pasteAndHold(composer, text, token);
                if (!isRunning || token !== runToken) return;
                if (!pasted.ok) {
                    logPasteFail('Mất nội dung sau chốt (dán lần 2, gate=' + D.gate + ')',
                        pasted.composer, text, pasted.tries);
                    return stop('Composer không giữ nội dung (React đã reset)');
                }
                composer = pasted.composer;
            }
        }

        isWaitingForEnter = true;

        /* ---- Chờ ENTER thủ công ---- */
        if (!autoEnter) {
            setStatus('Đã dán. Hãy ấn ENTER', '#1677ff');
            return;
        }

        /* ---- Tự gửi ---- */
        setStatus('⚡ Đang gửi...', '#52c41a');

        if (D.autoEnter > 0) await sleep(D.autoEnter);
        else await nextTick();

        if (!isRunning || token !== runToken || !isWaitingForEnter) return;

        phaseMark('nhịp');

        activateListObserver(token);      // observer sẵn sàng trước khi gửi

        /* ---- CHỐT LẠI NODE COMPOSER NGAY TRƯỚC ENTER (V5.21) ----
         *
         * Lỗi thực tế (người dùng báo): "click ra tab khác rồi quay lại nó sẽ
         * bỏ xót 1 đoạn chat, dán vào nhưng không gửi đi".
         *
         * Cơ chế: `composer` được giữ TỪ LÚC DÁN, nhưng giữa lúc dán và lúc
         * bấm Enter có `await nextTick()`. Khi tab bị ẨN, Chrome kẹp
         * setTimeout xuống ≥1000 ms; lúc tab hiện lại Pancake render lại khung
         * hội thoại ⇒ React THAY node #replyBoxComposer. Enter bị dispatch vào
         * node ĐÃ DETACHED ⇒ React KHÔNG nhận được: React gắn listener ở ROOT
         * container, nên event trên node detached không bubble lên được root.
         * Chứng minh: verify-tabswitch.js phần A — root nhận 0 event.
         *
         * Hệ quả kép, khớp đúng 2 nửa của báo cáo:
         *   • text nằm lại trong composer, tin không gửi  → "dán nhưng không gửi"
         *   • handledIds.add(id) đã chạy TRƯỚC click, nên khách đó bị coi là
         *     đã xử lý vĩnh viễn, không bao giờ thử lại → "bỏ xót 1 đoạn chat"
         *     (đo được trong jsdom: thử 9 khách, gửi 8 tin).
         *
         * Cách sửa: chốt lại node ngay trước Enter. Trường hợp bình thường
         * getComposer() trả đúng node đang giữ (đã cache) ⇒ `target ===
         * composer` và text còn nguyên ⇒ KHÔNG thêm bất kỳ nhịp chờ nào.
         * Chỉ khi node bị thay (đúng lúc tab vừa hiện lại) mới dán lại, và
         * pasteAndHold dán được ngay ⇒ cũng không tốn nhịp chờ.
         */
        const liveComposer = getComposer();
        let target = (liveComposer && liveComposer.isConnected) ? liveComposer : composer;

        if (!target.isConnected) {
            return stop('Composer không còn trong DOM trước Enter (tab vừa hiện lại?)');
        }

        if (target !== composer || !sameText(target.value, text)) {
            /* Node bị thay ⇒ React có thể đã mất draft. Dán lại rồi mới Enter,
               kẻo bấm Enter vào composer trống. */
            const re = await pasteAndHold(target, text, token);
            if (!isRunning || token !== runToken) return;
            if (!re.ok) {
                logPasteFail('Mất nội dung trước Enter (composer bị thay)',
                    re.composer, text, re.tries);
                return stop('Composer không giữ nội dung (tab vừa hiện lại?)');
            }
            target = re.composer;
        }
        composer = target;

        composer.focus();
        isWaitingForEnter = false;        // listener Enter thật không khởi động vòng mới

        composer.dispatchEvent(makeEnterEvent('keydown'));
        composer.dispatchEvent(makeEnterEvent('keyup'));

        /* Mốc pha dán tính SAU Enter đầu tiên (tin đã gửi) */
        sentAt = performance.now();
        phaseMark('enter');
        lastSendMs = sentAt - stepStart;
        recordSend(lastSendMs);
        phaseAccumulate();

        /* Thêm (Số Enter - 1) lần nữa. React có thể thay node composer sau
           Enter đầu, nên lấy lại node trước mỗi lần bấm tiếp. */
        for (let i = 1; i < D.enter; i++) {
            await nextTick();
            if (!isRunning || token !== runToken) return;

            const fresh = getComposer();
            const target = fresh && fresh.isConnected ? fresh : composer;
            target.dispatchEvent(makeEnterEvent('keydown'));
            target.dispatchEvent(makeEnterEvent('keyup'));
        }

        /*
         * V5.22 — XÁC NHẬN GỬI, CHỈ khi tab vừa bị ẩn trong lượt này.
         *
         * Bằng chứng từ log thật: `enter 2 ms` (script bấm Enter xong 2 ms đã
         * click sang khách kế) trong khi Pancake gửi BẤT ĐỒNG BỘ qua WebSocket
         * — cùng log có `getGlobalIdFromWS` mất 6 s và 30 s + `DONE LISTEN
         * SOCKET V2`. Khi tab bị ẩn, WS bị kẹp ⇒ tin đang gửi bị rớt khi ta
         * click khách kế ⇒ "dán vào nhưng không gửi đi", và vì handledIds.add()
         * đã chạy nên khách đó BỊ BỎ XÓT LUÔN.
         *
         * Xử lý: chờ Pancake xóa composer (= đã gửi). Không được thì bấm lại
         * Enter đúng 1 lần rồi kiểm lại; vẫn không được ⇒ DỪNG với lý do rõ
         * ràng thay vì lặng lẽ bỏ qua khách (stop() clear handledIds ⇒ chạy
         * lại sẽ gửi lại khách đó).
         *
         * Đường nhanh KHÔNG đổi: tab không bao giờ ẩn ⇒ khối này không chạy.
         */
        {
            const t0 = performance.now();
            /*
             * KHÔNG BAO GIỜ bấm lại Enter ở đây.
             * Composer là DÙNG CHUNG: ta không phân biệt được "chưa gửi" với
             * "đang gửi". Bấm lại ⇒ nếu tin kia đang gửi dở và rồi cũng đi,
             * khách nhận 2 tin. Gửi TRÙNG cho khách thật còn tệ hơn mất tin
             * (đã đo được: verify-shift báo "gửi 6 lần / 3 hội thoại").
             * Chỉ ĐO và CẢNH BÁO để người dùng biết mà gửi lại tay.
             */
            const okFast = await waitForSent(token, T.sendConfirm);
            if (!isRunning || token !== runToken) return;

            let ok = okFast;
            if (!okFast) {
                /*
                 * ĐƯỜNG CHẬM. Pancake đang đi api → extension → socket.
                 * Báo lên panel để người dùng thấy script không bị treo.
                 */
                setStatus('⏳ Pancake đang gửi (đường chậm)…', '#faad14');
                ok = await waitForSent(token, T.sendConfirmSlow);
                if (!isRunning || token !== runToken) return;
                if (ok) slowSends++;
            }
            phaseMark('confirm');

            if (ok && !okFast) {
                console.info(
                    `[Pancake Auto] Gửi chậm (api → extension/socket): `
                    + `${(performance.now() - t0).toFixed(0)} ms`
                    + `${tabHiddenDuringStep ? ' (tab vừa bị ẩn)' : ''}`
                    + ` — khách ${snapshot.name || '?'} (${snapshot.id})`
                    + ` — hội thoại này KHÔNG CÓ last_customer_interactive_at`
                );
            }

            if (!ok) {
                unsentIds.push(snapshot.id);
                console.warn(
                    `[Pancake Auto] ⚠ CHƯA THẤY GỬI sau `
                    + `${(performance.now() - t0).toFixed(0)} ms`
                    + `${tabHiddenDuringStep ? ' (tab vừa bị ẩn)' : ''}`
                    + ` — khách ${snapshot.name || '?'} (${snapshot.id})`
                    + ` — Pancake chưa xóa composer ⇒ tin có thể CHƯA ĐI`
                );
            }
        }

        executeStep(true, token).catch(err => {
            console.error('[Pancake Auto] Execute error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        });
    }

    function handleEnterDetected(token = runToken) {
        if (!isRunning || !isWaitingForEnter || token !== runToken) return;

        isWaitingForEnter = false;
        activateListObserver(token);

        executeStep(true, token).catch(err => {
            console.error('[Pancake Auto] Execute error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        });
    }

    /* =========================================================
     * ENTER THẬT TỪ BÀN PHÍM (isTrusted)
     * =======================================================*/

    window.addEventListener('keydown', event => {
        if (!event.isTrusted) return;            // bỏ Enter do script dispatch
        if (!isRunning || !isWaitingForEnter) return;
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;

        const composer = getComposer();
        const target = event.target;
        if (!composer || !(target === composer || composer.contains?.(target))) return;

        /* Không preventDefault: Pancake tự xử lý Enter thật. */
        activateListObserver(runToken);
        handleEnterDetected(runToken);
    }, true);

    /* =========================================================
     * STOP / START
     * =======================================================*/

    function stop(reason = '') {
        phaseSummary();
        if (reason) {
            console.info('[Pancake Auto] Dừng:', reason,
                lastCtx ? { ...lastCtx } : '(chưa có khách nào)');
        }
        lastCtx = null;
        isRunning = false;
        isWaitingForEnter = false;
        runToken++;

        removePicker();
        cleanupObserver();

        cachedComposer = null;
        cachedList = null;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        unsentIds = [];
        slowSends = 0;

        btnRun.textContent = '▶ Bắt đầu';
        btnRun.style.background = '#1677ff';
        bubble.style.background = '#1677ff';

        setStatus(
            reason || 'Đã dừng',
            reason.startsWith('🛑') ? '#ff4d4f' : reason ? '#faad14' : '#aaa'
        );
    }

    async function start() {
        if (isRunning) return;

        if (!clickPos) {
            alert('Hãy chấm vị trí conversation trước.');
            return;
        }

        removePicker();
        cleanupObserver();
        cachedComposer = null;

        isRunning = true;
        isWaitingForEnter = false;
        initialSnippet = null;
        lastConversationId = '';
        handledIds.clear();
        unsentIds = [];
        slowSends = 0;
        cachedText = '';
        resetStats();

        const token = ++runToken;

        btnRun.textContent = '⏹ Dừng lại';
        btnRun.style.background = '#ff4d4f';
        bubble.style.background = '#ff4d4f';

        setStatus('⚡ Direct Row Observer đang chạy...', '#52c41a');

        const initial = getSnapshot();
        if (!initial) return stop('Không tìm thấy conversation tại dấu đỏ');
        if (!initial.id) return stop('Không đọc được REAL conversation ID tại dấu đỏ');
        if (initial.snippet === null) return stop('Không đọc được .snippet-text');

        if (stopSnippet && initial.snippet === stopSnippet) {
            return stop(`🛑 Đã gặp câu dừng: ${stopSnippet}`);
        }

        updateIdStatus(initial);

        /* Đọc clipboard 1 lần nếu ô text trống */
        if (!inputText.value.trim()) await getSendText();
        if (!isRunning || token !== runToken) return;

        try {
            await executeStep(false, token);
        } catch (err) {
            console.error('[Pancake Auto] Start error:', err);
            if (isRunning && token === runToken) stop('Script lỗi - xem Console');
        }
    }

    btnRun.onclick = () => (isRunning ? stop() : start());

    /* =========================================================
     * HOTKEY
     * =======================================================*/

    window.addEventListener('keydown', event => {
        if (!hotkeyEnabled) return;
        if (event.key !== activationHotkey) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
        if (root.contains(event.target)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.repeat) return;

        if (isRunning) stop(`Đã dừng bằng ${activationHotkey.toUpperCase()}`);
        else start();
    }, true);

    /* =========================================================
     * PAGE HIDE
     * =======================================================*/

    window.addEventListener('pagehide', () => {
        cleanupObserver();
        clearTimeout(saveUITimer);
        saveUITimer = null;
        saveUI();
        saveSpeed();
    });

    /* =========================================================
     * INIT
     * =======================================================*/

    updateMarker();
    restoreUI();
    syncUI();

    console.info(`[Pancake Auto] V${VERSION} sẵn sàng`);

    if (clickPos) setTimeout(() => updateIdStatus(getSnapshot()), 0);
})();
