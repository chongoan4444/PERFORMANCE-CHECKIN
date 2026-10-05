// ==UserScript==
// @name         Pancake Điều hướng upsale nhanh
// @namespace    pancake-adjacent-snippet
// @version      7.3
// @description  Luôn bật. ↑ đầu cụm -> đáy. ↓ cuối cụm -> đầu. F8 đầu list, F9 cuối list.
// @match        *://pancake.vn/*
// @match        *://*.pancake.vn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // ẨN BOX TRẠNG THÁI
    // ============================================================

    const hideStatusStyle = document.createElement('style');

    hideStatusStyle.textContent = `
        #adj-snippet-box {
            display: none !important;
        }
    `;

    document.head.appendChild(hideStatusStyle);


    // ============================================================
    // CHỐNG CHẠY SCRIPT 2 LẦN
    // ============================================================

    if (window.__PANCAKE_ADJACENT_V73__) return;

    window.__PANCAKE_ADJACENT_V73__ = true;


    // ============================================================
    // SELECTORS
    // ============================================================

    const ITEM_SELECTOR =
        '.conversation-list-item';

    const SNIPPET_SELECTOR =
        '.snippet-text';

    const HOLDER_SELECTOR =
        '#conversationList .rc-virtual-list-holder';


    // ============================================================
    // CONFIG
    // ============================================================

    const CONFIG = {

        // React render
        renderDelay: 75,

        // Scroll mỗi bước
        step: 600,

        // Chống loop
        maxRounds: 99999,

        // Mép trên
        topOffset: 2,

        // Mép dưới
        bottomOffset: 4,

        // Retry căn vị trí sau React render
        positionRetries: 4,

        // Delay giữa retry
        retryDelay: 70
    };


    // ============================================================
    // STATE
    // ============================================================

    // LUÔN BẬT - KHÔNG CẦN F10
    const enabled = true;

    let searching = false;

    let currentId = '';
    let currentSnippet = '';

    let internalClick = false;

    let statusTimer = null;


    // ============================================================
    // UI
    // ============================================================

    const style =
        document.createElement('style');


    style.textContent = `

        #adj-snippet-box {

            position: fixed;

            right: 10px;
            bottom: 10px;

            z-index: 2147483647;

            padding: 7px 11px;

            border-radius: 7px;

            background: #111827;
            color: white;

            font: bold 12px Arial;

            box-shadow:
                0 3px 12px
                rgba(0,0,0,.30);

            pointer-events: none;
        }


        #adj-snippet-message {

            position: fixed;

            top: 15px;
            left: 50%;

            transform:
                translateX(-50%);

            z-index: 2147483647;

            padding: 7px 13px;

            border-radius: 7px;

            background:
                rgba(0,0,0,.86);

            color: white;

            font: 13px Arial;

            max-width: 650px;

            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;

            pointer-events: none;
        }

    `;


    document.head.appendChild(
        style
    );


    const box =
        document.createElement('div');


    box.id =
        'adj-snippet-box';


    document.body.appendChild(
        box
    );


    const msg =
        document.createElement('div');


    msg.id =
        'adj-snippet-message';


    msg.style.display =
        'none';


    document.body.appendChild(
        msg
    );


    // ============================================================
    // BASIC HELPERS
    // ============================================================

    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }


    function normalize(text) {

        return (text || '')

            .replace(
                /\s+/g,
                ' '
            )

            .trim();
    }


    function holder() {

        return document.querySelector(
            HOLDER_SELECTOR
        );
    }


    function items() {

        return Array.from(

            document.querySelectorAll(
                ITEM_SELECTOR
            )

        );
    }


    function snippet(item) {

        return normalize(

            item
                ?.querySelector(
                    SNIPPET_SELECTOR
                )
                ?.textContent

        );
    }


    function conversationId(item) {

        if (!item)
            return '';


        return (
            item.parentElement?.id ||
            item.id ||
            ''
        );
    }


    function findItemById(id) {

        if (!id)
            return null;


        for (
            const item of items()
        ) {

            if (
                conversationId(item) === id
            ) {

                return item;
            }
        }


        return null;
    }


    // ============================================================
    // MESSAGE
    // ============================================================

    function message(
        text,
        duration = 1200
    ) {

        clearTimeout(
            statusTimer
        );


        msg.textContent =
            text;


        msg.style.display =
            'block';


        if (duration > 0) {

            statusTimer =
                setTimeout(() => {

                    msg.style.display =
                        'none';

                }, duration);
        }
    }


    function updateBox() {

        if (searching) {

            box.style.background =
                '#9333ea';

            box.textContent =
                'ĐANG TÌM...';

            return;
        }


        if (currentSnippet) {

            box.style.background =
                '#16a34a';

            box.textContent =
                '↑ ĐẦU→ĐÁY | ↓ CUỐI→ĐẦU';

            return;
        }


        box.style.background =
            '#2563eb';

        box.textContent =
            'LUÔN BẬT | CLICK CHAT';
    }


    // ============================================================
    // SCROLL
    // ============================================================

    async function setScrollTop(
        h,
        value,
        delay = CONFIG.renderDelay
    ) {

        if (!h)
            return;


        const max =
            Math.max(

                0,

                h.scrollHeight -
                h.clientHeight

            );


        value =
            Math.max(

                0,

                Math.min(
                    value,
                    max
                )

            );


        h.scrollTop =
            value;


        h.dispatchEvent(

            new Event(
                'scroll',
                {
                    bubbles: true
                }
            )

        );


        if (delay) {

            await sleep(delay);
        }
    }


    // ============================================================
    // CĂN ITEM LÊN ĐẦU
    // ============================================================

    async function positionAtTop(id) {

        const h =
            holder();


        if (!h || !id)
            return;


        /*
         * Retry vì sau khi click,
         * React có thể thay element.
         */

        for (
            let retry = 0;

            retry <
            CONFIG.positionRetries;

            retry++
        ) {

            const item =
                findItemById(id);


            if (!item) {

                await sleep(
                    CONFIG.retryDelay
                );

                continue;
            }


            const hr =
                h.getBoundingClientRect();


            const ir =
                item.getBoundingClientRect();


            const difference =

                ir.top -

                hr.top -

                CONFIG.topOffset;


            /*
             * Đã đúng vị trí.
             */

            if (
                Math.abs(difference) <= 3
            ) {

                return;
            }


            await setScrollTop(

                h,

                h.scrollTop +
                difference,

                CONFIG.retryDelay

            );
        }
    }


    // ============================================================
    // CĂN ITEM XUỐNG ĐÁY
    // ============================================================

    async function positionAtBottom(id) {

        const h =
            holder();


        if (!h || !id)
            return;


        /*
         * Không giữ reference item cũ.
         * Mỗi retry đều query lại item
         * từ ID conversation.
         */

        for (
            let retry = 0;

            retry <
            CONFIG.positionRetries;

            retry++
        ) {

            const item =
                findItemById(id);


            if (!item) {

                await sleep(
                    CONFIG.retryDelay
                );

                continue;
            }


            const hr =
                h.getBoundingClientRect();


            const ir =
                item.getBoundingClientRect();


            /*
             * Vị trí bottom mong muốn.
             */

            const wantedBottom =

                hr.bottom -

                CONFIG.bottomOffset;


            /*
             * > 0:
             * item thấp hơn vị trí mong muốn.
             *
             * < 0:
             * item cao hơn vị trí mong muốn.
             */

            const difference =

                ir.bottom -

                wantedBottom;


            /*
             * Đã sát đáy.
             */

            if (
                Math.abs(difference) <= 4
            ) {

                return;
            }


            await setScrollTop(

                h,

                h.scrollTop +
                difference,

                CONFIG.retryDelay

            );
        }
    }


    // ============================================================
    // CLICK RESULT
    // ============================================================

    async function clickConversation(id) {

        let item =
            findItemById(id);


        if (!item)
            return false;


        internalClick =
            true;


        try {

            item.click();

        } finally {

            setTimeout(() => {

                internalClick =
                    false;

            }, 100);
        }


        /*
         * Cho Pancake nhận click.
         */

        await sleep(50);


        return true;
    }


    // ============================================================
    // ACTIVATE
    // ============================================================

    async function activate(
        id,
        text,
        position
    ) {

        if (!id || !text)
            return;


        currentId =
            id;

        currentSnippet =
            text;


        /*
         * Click result.
         */

        await clickConversation(id);


        /*
         * Chờ Pancake bắt đầu update.
         */

        await sleep(30);


        if (
            position === 'bottom'
        ) {

            await positionAtBottom(
                id
            );

        } else {

            await positionAtTop(
                id
            );
        }


        /*
         * Pancake đôi khi update DOM
         * sau khi position.
         */

        await sleep(50);


        if (
            position === 'bottom'
        ) {

            await positionAtBottom(
                id
            );

        } else {

            await positionAtTop(
                id
            );
        }


        currentId =
            id;

        currentSnippet =
            text;


        updateBox();
    }


    // ============================================================
    // FIND TOP OF ADJACENT CLUSTER
    // ============================================================

    async function findClusterTop() {

        if (searching)
            return;


        if (!currentSnippet) {

            message(
                'Hãy click một chat trước'
            );

            return;
        }


        const h =
            holder();


        if (!h)
            return;


        searching =
            true;


        updateBox();


        const target =
            currentSnippet;


        let resultId =
            currentId;


        try {

            for (
                let round = 0;

                round <
                CONFIG.maxRounds;

                round++
            ) {

                const list =
                    items();


                const current =
                    findItemById(
                        resultId
                    );


                if (current) {

                    const index =
                        list.indexOf(
                            current
                        );


                    /*
                     * Đi từng item phía trên.
                     */

                    for (
                        let i =
                            index - 1;

                        i >= 0;

                        i--
                    ) {

                        const text =
                            snippet(
                                list[i]
                            );


                        /*
                         * Vẫn trong cụm.
                         */

                        if (
                            text === target
                        ) {

                            resultId =
                                conversationId(
                                    list[i]
                                );

                            continue;
                        }


                        /*
                         * Gặp snippet khác.
                         * => đã tới đầu cụm.
                         */

                        await activate(

                            resultId,

                            target,

                            'bottom'

                        );


                        message(
                            '↑ Đầu cụm → dưới cùng'
                        );


                        return;
                    }
                }


                /*
                 * Nếu toàn bộ item phía trên
                 * đang render vẫn giống target,
                 * load thêm phía trên.
                 */

                const before =
                    h.scrollTop;


                if (
                    before <= 0
                ) {

                    /*
                     * Đầu toàn list đồng thời
                     * là đầu cụm.
                     */

                    await activate(

                        resultId,

                        target,

                        'bottom'

                    );


                    message(
                        '↑ Đầu cụm → dưới cùng'
                    );


                    return;
                }


                await setScrollTop(

                    h,

                    Math.max(

                        0,

                        before -
                        CONFIG.step

                    )

                );
            }


            /*
             * Safety fallback.
             */

            await activate(

                resultId,

                target,

                'bottom'

            );


        } catch (error) {

            console.error(
                '[CLUSTER TOP ERROR]',
                error
            );


        } finally {

            searching =
                false;


            updateBox();
        }
    }


    // ============================================================
    // FIND BOTTOM OF ADJACENT CLUSTER
    // ============================================================

    async function findClusterBottom() {

        if (searching)
            return;


        if (!currentSnippet) {

            message(
                'Hãy click một chat trước'
            );

            return;
        }


        const h =
            holder();


        if (!h)
            return;


        searching =
            true;


        updateBox();


        const target =
            currentSnippet;


        let resultId =
            currentId;


        try {

            for (
                let round = 0;

                round <
                CONFIG.maxRounds;

                round++
            ) {

                const list =
                    items();


                const current =
                    findItemById(
                        resultId
                    );


                if (current) {

                    const index =
                        list.indexOf(
                            current
                        );


                    /*
                     * Đi từng item phía dưới.
                     */

                    for (
                        let i =
                            index + 1;

                        i <
                        list.length;

                        i++
                    ) {

                        const text =
                            snippet(
                                list[i]
                            );


                        if (
                            text === target
                        ) {

                            resultId =
                                conversationId(
                                    list[i]
                                );

                            continue;
                        }


                        /*
                         * Gặp snippet khác
                         * => cuối cụm.
                         */

                        await activate(

                            resultId,

                            target,

                            'top'

                        );


                        message(
                            '↓ Cuối cụm → trên cùng'
                        );


                        return;
                    }
                }


                /*
                 * Load thêm phía dưới.
                 */

                const before =
                    h.scrollTop;


                const max =
                    Math.max(

                        0,

                        h.scrollHeight -
                        h.clientHeight

                    );


                if (
                    before >=
                    max - 1
                ) {

                    await activate(

                        resultId,

                        target,

                        'top'

                    );


                    message(
                        '↓ Cuối cụm → trên cùng'
                    );


                    return;
                }


                await setScrollTop(

                    h,

                    Math.min(

                        max,

                        before +
                        CONFIG.step

                    )

                );
            }


            /*
             * Safety fallback.
             */

            await activate(

                resultId,

                target,

                'top'

            );


        } catch (error) {

            console.error(
                '[CLUSTER BOTTOM ERROR]',
                error
            );


        } finally {

            searching =
                false;


            updateBox();
        }
    }


    // ============================================================
    // USER CLICK
    // ============================================================

    document.addEventListener(

        'click',

        function (event) {

            if (internalClick)
                return;


            const item =
                event.target.closest(
                    ITEM_SELECTOR
                );


            if (!item)
                return;


            const text =
                snippet(item);


            if (!text)
                return;


            currentId =
                conversationId(item);


            currentSnippet =
                text;


            updateBox();


            message(

                'Đã chọn: ' +

                text.slice(
                    0,
                    70
                )

            );

        },

        true
    );


    // ============================================================
    // KEYBOARD
    // ============================================================

    window.addEventListener(

        'keydown',

        function (event) {


            // ====================================================
            // F8 — KÉO LÊN TRÊN CÙNG DANH SÁCH
            // ====================================================

            if (
                event.key === 'F8' ||
                event.code === 'F8'
            ) {

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                const h =
                    holder();


                if (h) {

                    h.scrollTop =
                        0;


                    h.dispatchEvent(

                        new Event(
                            'scroll',
                            {
                                bubbles: true
                            }
                        )

                    );
                }


                return;
            }


            // ====================================================
            // F9 — KÉO XUỐNG DƯỚI CÙNG DANH SÁCH
            // ====================================================

            if (
                event.key === 'F9' ||
                event.code === 'F9'
            ) {

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                const h =
                    holder();


                if (h) {

                    h.scrollTop =
                        h.scrollHeight;


                    h.dispatchEvent(

                        new Event(
                            'scroll',
                            {
                                bubbles: true
                            }
                        )

                    );
                }


                return;
            }


            // ====================================================
            // ↑ TÌM ĐẦU CỤM → ĐƯA XUỐNG ĐÁY
            // ====================================================

            if (
                event.key === 'ArrowUp' ||
                event.code === 'ArrowUp'
            ) {

                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();


                findClusterTop();


                return;
            }


            // ====================================================
            // ↓ TÌM CUỐI CỤM → ĐƯA LÊN ĐẦU
            // ====================================================

            if (
                event.key === 'ArrowDown' ||
                event.code === 'ArrowDown'
            ) {

                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();


                findClusterBottom();


                return;
            }

        },

        true
    );


    // ============================================================
    // READY
    // ============================================================

    updateBox();


    message(
        'V7.3 READY — LUÔN BẬT',
        1800
    );


    console.log(
        '%cPancake Adjacent Snippet V7.3 READY — ALWAYS ON',
        'color:#22c55e;font-weight:bold;font-size:15px'
    );

})();