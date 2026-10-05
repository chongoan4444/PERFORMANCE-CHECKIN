// ==UserScript==
// @name         Pancake Tự động dọn thông báo fix lag
// @namespace    pancake-auto-close
// @version      1.0
// @match        https://pancake.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    function closeNotifications() {
        document
            .querySelectorAll('.ant-notification-notice-close')
            .forEach(button => button.click());
    }

    // Xóa các thông báo đang có
    closeNotifications();

    // Tự động xử lý thông báo mới xuất hiện
    const observer = new MutationObserver(() => {
        closeNotifications();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();