// ==UserScript==
// @name         Botcake - Auto vào gửi tin nhắn
// @namespace    https://botcake.io/
// @version      4.0
// @description  Chỉ click Gửi tin nhắn khi phát hiện Page Facebook thay đổi
// @match        https://botcake.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    let currentPageId = null;
    let firstRun = true;
    let timer = null;

    // =========================
    // LẤY PAGE ID HIỆN TẠI
    // =========================
    function getPageId() {
        const avatars = document.querySelectorAll(
            'span.ant-avatar img[src*="/pages/"][src*="/botcake/avatar"]'
        );

        for (const img of avatars) {
            const match = img.src.match(/\/pages\/(\d+)\/botcake\/avatar/);

            if (match) {
                return match[1];
            }
        }

        return null;
    }

    // =========================
    // CLICK GỬI TIN NHẮN
    // =========================
    function clickSendMessage(pageId) {
        const titles = document.querySelectorAll(
            'span.ant-menu-title-content'
        );

        const title = [...titles].find(el =>
            el.textContent.trim() === 'Gửi tin nhắn' &&
            el.offsetParent !== null
        );

        if (!title) {
            // Menu chưa render xong -> thử lại
            setTimeout(() => {
                // Chỉ click nếu vẫn đang ở đúng Page
                if (getPageId() === pageId) {
                    clickSendMessage(pageId);
                }
            }, 500);

            return;
        }

        const menu =
            title.closest('.ant-menu-item') ||
            title.closest('a') ||
            title;

        console.log(
            '[Botcake] Click Gửi tin nhắn - Page:',
            pageId
        );

        menu.click();
    }

    // =========================
    // CHECK PAGE
    // =========================
    function checkPage() {
        const pageId = getPageId();

        if (!pageId) {
            return;
        }

        // Lần đầu mở Botcake
        if (firstRun) {
            firstRun = false;
            currentPageId = pageId;

            console.log(
                '[Botcake] Page ban đầu:',
                pageId
            );

            clickSendMessage(pageId);
            return;
        }

        // Page không đổi
        if (pageId === currentPageId) {
            return;
        }

        // =========================
        // PAGE ĐÃ ĐỔI
        // =========================

        console.log(
            '[Botcake] Đổi Page:',
            currentPageId,
            '->',
            pageId
        );

        currentPageId = pageId;

        // Chờ Botcake render page mới
        setTimeout(() => {
            // Xác nhận vẫn đang ở Page này
            if (getPageId() === pageId) {
                clickSendMessage(pageId);
            }
        }, 600);
    }

    // =========================
    // THEO DÕI DOM
    // =========================
    const observer = new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
            checkPage();
        }, 150);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
    });

    // Check lần đầu
    checkPage();

})();