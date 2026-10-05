// ==UserScript==
// @name         Pancake - F1 bắt mess đã gắn tag
// @namespace    https://tampermonkey.net/
// @version      1.0
// @description  F1: bắt mess unread đã có tag, loại comment và loại SVG path chỉ định. Chỉ click hội thoại.
// @match        https://pancake.vn/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (window.top !== window.self) return;

    // =====================================================
    // SINGLETON
    // =====================================================

    const INSTANCE_KEY = '__PANCAKE_F1_TAGGED_MESS__';

    try {
        const oldInstance = window[INSTANCE_KEY];

        if (
            oldInstance &&
            typeof oldInstance.destroy === 'function'
        ) {
            oldInstance.destroy();
        }
    } catch (error) {
        console.warn(
            '[Pancake F1 Tagged Mess] Cleanup instance cũ lỗi:',
            error
        );
    }

    let destroyed = false;
    let waiting = false;
    let observer = null;
    let claimedItem = null;

    const cleanupFunctions = [];

    function addCleanup(fn) {
        cleanupFunctions.push(fn);
    }

    function addManagedEventListener(
        target,
        type,
        listener,
        options
    ) {
        target.addEventListener(
            type,
            listener,
            options
        );

        addCleanup(() => {
            target.removeEventListener(
                type,
                listener,
                options
            );
        });
    }

    // =====================================================
    // SVG PATH CẦN LOẠI
    // =====================================================

    const EXCLUDED_PATH =
        'M232,200a8,8,0,0,1-16,0,88.1,88.1,0,0,0-88-88H88v40a8,8,0,0,1-13.66,5.66l-48-48a8,8,0,0,1,0-11.32l48-48A8,8,0,0,1,88,56V96h40A104.11,104.11,0,0,1,232,200Z';

    /*
     * Các dấu hiệu COMMENT lấy theo script cũ.
     */
    const COMMENT_ICON_PATH =
        'M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z';

    function normalizePath(path) {
        return String(path || '')
            .replace(/\s+/g, '');
    }

    const NORMALIZED_EXCLUDED_PATH =
        normalizePath(EXCLUDED_PATH);

    const NORMALIZED_COMMENT_PATH =
        normalizePath(COMMENT_ICON_PATH);

    // =====================================================
    // STATUS DOT
    // =====================================================

    function updateStatusDot() {
        if (destroyed) return;

        let dot = document.getElementById(
            'pancake-f1-tagged-mess-dot'
        );

        if (!dot) {
            dot = document.createElement('div');

            dot.id =
                'pancake-f1-tagged-mess-dot';

            Object.assign(
                dot.style,
                {
                    position: 'fixed',
                    right: '6px',
                    bottom: '6px',
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    zIndex: '2147483647',
                    pointerEvents: 'none'
                }
            );

            document.body.appendChild(dot);
        }

        dot.style.backgroundColor =
            waiting
                ? '#00d13f'
                : '#ff2d2d';
    }

    // =====================================================
    // CONVERSATION
    // =====================================================

    function getConversationList() {
        return document.getElementById(
            'conversationList'
        );
    }

    function getConversationItems() {
        const list = getConversationList();

        if (!list) {
            return [];
        }

        return Array.from(
            list.querySelectorAll(
                '.conversation-list-item'
            )
        );
    }

    // =====================================================
    // UNREAD
    // Giữ cách xác định giống script F1 cũ
    // =====================================================

    function isConversationUnread(item) {
        if (!item) {
            return false;
        }

        return (
            item.classList.contains('unread') ||
            !!item.closest('.unread') ||
            !!item.querySelector('.unread')
        );
    }

    // =====================================================
    // ĐÃ CÓ TAG
    // =====================================================

    function hasConversationTags(item) {
        if (!item) {
            return false;
        }

        const container =
            item.querySelector(
                'div[class*="list_tags_conv_"]'
            );

        if (!container) {
            return false;
        }

        return !!(
            container.querySelector(
                '.conversation_tags_item'
            ) ||
            container.children.length > 0
        );
    }

    // =====================================================
    // PATH BỊ LOẠI
    // =====================================================

    function hasExcludedPath(item) {
        if (!item) {
            return false;
        }

        return Array.from(
            item.querySelectorAll('path')
        ).some(path => {
            return (
                normalizePath(
                    path.getAttribute('d')
                ) ===
                NORMALIZED_EXCLUDED_PATH
            );
        });
    }

    // =====================================================
    // NHẬN DIỆN COMMENT
    // =====================================================

    function hasCommentPath(item) {
        if (!item) {
            return false;
        }

        return Array.from(
            item.querySelectorAll('path')
        ).some(path => {
            return normalizePath(
                path.getAttribute('d')
            ).includes(
                NORMALIZED_COMMENT_PATH
            );
        });
    }

    function hasCommentImage(item) {
        if (!item) {
            return false;
        }

        return !!item.querySelector(
            'img[src*="comments.svg"], ' +
            'img[src*="comment.svg"], ' +
            '[src*="comments.svg"]'
        );
    }

    function isComment(item) {
        return (
            hasCommentPath(item) ||
            hasCommentImage(item)
        );
    }

    // =====================================================
    // MESS
    // Giữ dấu hiệu envelope-selected của script cũ.
    // =====================================================

    function hasEnvelopeSelected(item) {
        if (!item) {
            return false;
        }

        return !!item.querySelector(
            'img[src*="envelope-selected.svg"]'
        );
    }

    // =====================================================
    // KIỂM TRA TARGET
    // =====================================================

    function isTarget(item) {
        const list =
            getConversationList();

        if (
            destroyed ||
            !item ||
            !item.isConnected ||
            !list ||
            !list.contains(item)
        ) {
            return false;
        }

        /*
         * 1. Phải unread.
         */
        if (!isConversationUnread(item)) {
            return false;
        }

        /*
         * 2. Phải là MESS theo dấu hiệu
         *    của script cũ.
         */
        if (!hasEnvelopeSelected(item)) {
            return false;
        }

        /*
         * 3. Không được là COMMENT.
         */
        if (isComment(item)) {
            return false;
        }

        /*
         * 4. Phải ĐÃ CÓ TAG.
         */
        if (!hasConversationTags(item)) {
            return false;
        }

        /*
         * 5. Không được chứa path đã chỉ định.
         */
        if (hasExcludedPath(item)) {
            return false;
        }

        return true;
    }

    // =====================================================
    // TÌM TARGET ĐẦU TIÊN
    // =====================================================

    function findFirstTarget() {
        const items =
            getConversationItems();

        for (const item of items) {
            if (isTarget(item)) {
                return item;
            }
        }

        return null;
    }

    // =====================================================
    // OBSERVER
    // =====================================================

    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    function stopWaiting() {
        waiting = false;
        claimedItem = null;

        stopObserver();
        updateStatusDot();
    }

    // =====================================================
    // CLICK TARGET
    // =====================================================

    function claimFirstTarget() {
        if (
            destroyed ||
            !waiting ||
            claimedItem
        ) {
            return false;
        }

        const item =
            findFirstTarget();

        if (!item) {
            return false;
        }

        /*
         * Recheck ngay trước khi claim.
         */
        if (!isTarget(item)) {
            return false;
        }

        /*
         * Claim trước khi click để mutation do
         * click không làm script bắt lần thứ 2.
         */
        claimedItem = item;
        waiting = false;

        stopObserver();
        updateStatusDot();

        console.info(
            '[Pancake F1 Tagged Mess] ' +
            'Tìm thấy mess unread đã có tag -> click.',
            item
        );

        try {
            /*
             * CHỈ CLICK.
             *
             * Không:
             * - gửi command
             * - gửi tin
             * - thêm tag
             * - mở preview
             */
            item.click();

            return true;

        } catch (error) {
            console.error(
                '[Pancake F1 Tagged Mess] Click lỗi:',
                error
            );

            claimedItem = null;

            return false;
        }
    }

    function startObserver() {
        stopObserver();

        if (
            destroyed ||
            !waiting
        ) {
            return;
        }

        observer =
            new MutationObserver(() => {
                if (
                    destroyed ||
                    !waiting ||
                    claimedItem
                ) {
                    return;
                }

                claimFirstTarget();
            });

        /*
         * Observe document.body vì Pancake có thể
         * render lại conversationList.
         */
        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
                attributeFilter: [
                    'class',
                    'src',
                    'd',
                    'style'
                ]
            }
        );

        /*
         * F1 vừa bật thì kiểm tra danh sách hiện tại
         * ngay lập tức.
         */
        claimFirstTarget();
    }

    // =====================================================
    // F1
    // =====================================================

    function toggleF1() {
        if (destroyed) {
            return;
        }

        /*
         * Đang chờ -> nhấn F1 lần nữa để hủy.
         */
        if (waiting) {
            console.info(
                '[Pancake F1 Tagged Mess] F1 OFF'
            );

            stopWaiting();

            return;
        }

        claimedItem = null;
        waiting = true;

        updateStatusDot();

        console.info(
            '[Pancake F1 Tagged Mess] F1 ON - ' +
            'chờ mess unread đã có tag.'
        );

        startObserver();
    }

    // =====================================================
    // CLICK CHUỘT THẬT -> HỦY CHỜ
    // =====================================================

    const pointerDownHandler = event => {
        if (destroyed) {
            return;
        }

        if (
            event.isTrusted &&
            waiting
        ) {
            console.info(
                '[Pancake F1 Tagged Mess] ' +
                'Hủy F1 do click chuột.'
            );

            stopWaiting();
        }
    };

    addManagedEventListener(
        window,
        'pointerdown',
        pointerDownHandler,
        true
    );

    // =====================================================
    // HOTKEY
    // =====================================================

    const keyDownHandler = event => {
        if (
            destroyed ||
            !event.isTrusted
        ) {
            return;
        }

        const isF1 =
            event.key === 'F1' ||
            event.keyCode === 112;

        if (!isF1) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.repeat) {
            return;
        }

        toggleF1();
    };

    addManagedEventListener(
        window,
        'keydown',
        keyDownHandler,
        true
    );

    // =====================================================
    // DESTROY
    // =====================================================

    function destroy() {
        if (destroyed) {
            return;
        }

        destroyed = true;
        waiting = false;
        claimedItem = null;

        stopObserver();

        const dot =
            document.getElementById(
                'pancake-f1-tagged-mess-dot'
            );

        if (dot) {
            dot.remove();
        }

        while (cleanupFunctions.length) {
            const cleanup =
                cleanupFunctions.pop();

            try {
                cleanup();
            } catch (error) {
                console.warn(
                    '[Pancake F1 Tagged Mess] Cleanup lỗi:',
                    error
                );
            }
        }

        console.info(
            '[Pancake F1 Tagged Mess] Destroyed.'
        );
    }

    window[INSTANCE_KEY] = {
        destroy
    };

    const beforeUnloadHandler = () => {
        destroy();
    };

    addManagedEventListener(
        window,
        'beforeunload',
        beforeUnloadHandler
    );

    // =====================================================
    // INIT
    // =====================================================

    updateStatusDot();

    console.info(
        '[Pancake F1 Tagged Mess] Loaded. ' +
        'F1 = bắt mess unread đầu tiên đã có tag, ' +
        'không phải comment, không có excluded SVG. ' +
        'Chỉ click conversation.'
    );

})();