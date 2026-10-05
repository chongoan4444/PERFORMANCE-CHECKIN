// ==UserScript==
// @name         Pancake - Dọn Console mỗi 30 giây
// @namespace    arena.salescript
// @version      1.0.0
// @description  Xóa nội dung đang hiển thị trong DevTools Console mỗi 30 giây khi tab Pancake đang mở.
// @match        *://*.pancake.vn/*
// @run-at       document-end
// @noframes
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const INTERVAL_MS = 10_000;

    // Chỉ xóa Console khi tab đang hiển thị; tránh chạy việc không cần thiết ở tab nền.
    const timerId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;

        try {
            console.clear();
        } catch (_) {
            // Một số trình duyệt hoặc cấu hình DevTools có thể chặn console.clear().
        }
    }, INTERVAL_MS);

    // Dọn timer khi trang rời đi; context cũng sẽ bị hủy khi reload.
    window.addEventListener('pagehide', () => {
        window.clearInterval(timerId);
    }, { once: true });
})();