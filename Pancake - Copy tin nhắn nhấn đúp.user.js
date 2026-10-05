// ==UserScript==
// @name         Pancake - Copy tin nhắn nhấn đúp
// @namespace    https://pancake.vn/
// @version      1.1
// @description  Click đúp vào tin nhắn Pancake để copy toàn bộ nội dung
// @match        https://pancake.vn/*
// @match        https://*.pancake.vn/*
// @grant        GM_setClipboard
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================
    // HIỆN THÔNG BÁO "ĐÃ COPY"
    // =====================================================
    function showCopied(element) {
        const rect = element.getBoundingClientRect();

        const toast = document.createElement('div');
        toast.textContent = '✓ Đã copy';

        Object.assign(toast.style, {
            position: 'fixed',
            left: `${rect.left + rect.width / 2}px`,
            top: `${Math.max(10, rect.top - 35)}px`,
            transform: 'translateX(-50%)',
            background: '#16a34a',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            fontFamily: 'Arial, sans-serif',
            zIndex: '2147483647',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,.2)',
            opacity: '1',
            transition: 'opacity .25s ease'
        });

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
        }, 600);

        setTimeout(() => {
            toast.remove();
        }, 900);
    }


    // =====================================================
    // HIỆU ỨNG BONG BÓNG SAU KHI COPY
    // =====================================================
    function flashMessage(element) {
        const oldOutline = element.style.outline;
        const oldBoxShadow = element.style.boxShadow;
        const oldTransition = element.style.transition;

        element.style.transition = 'all .15s ease';
        element.style.outline = '2px solid #22c55e';
        element.style.boxShadow = '0 0 0 3px rgba(34,197,94,.20)';

        setTimeout(() => {
            element.style.outline = oldOutline;
            element.style.boxShadow = oldBoxShadow;
        }, 400);

        setTimeout(() => {
            element.style.transition = oldTransition;
        }, 600);
    }


    // =====================================================
    // COPY KHI CLICK ĐÚP
    // =====================================================
    document.addEventListener('dblclick', function (event) {

        // Tìm bong bóng tin nhắn
        const message = event.target.closest('.message-text-ele');

        if (!message) return;

        // Lấy toàn bộ text đang hiển thị trong tin nhắn
        const text = message.innerText
            .replace(/\u00A0/g, ' ')
            .trim();

        if (!text) return;

        // Ngăn một số hành vi dblclick mặc định
        event.preventDefault();
        event.stopPropagation();

        // Copy
        GM_setClipboard(text, 'text');

        // Hiệu ứng
        flashMessage(message);
        showCopied(message);

        console.log('[Pancake Copy] Đã copy:', text);

    }, true);

})();