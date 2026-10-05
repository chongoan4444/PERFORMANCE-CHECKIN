// ==UserScript==
// @name         Pancake Mở ảnh nhanh
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Bấm ` để mở bảng chọn ảnh, bấm lại ` để đóng bảng chọn ảnh trên Pancake
// @match        https://pancake.vn/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Hàm kiểm tra phần tử có đang thực sự hiển thị trên màn hình hay không
    function isElementVisible(el) {
        if (!el) return false;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    window.addEventListener('keydown', function(event) {
        // Kiểm tra xem phím vừa nhấn có phải là phím ` (Backtick) hay không
        if (event.key === '`' || event.code === 'Backquote') {

            // 1. Tìm nút đóng bảng chọn ảnh
            const closeBtn = document.querySelector('.select-photo-modal-icon-close');

            // 2. Kiểm tra nếu nút đóng đang hiển thị (đồng nghĩa bảng chọn ảnh đang mở)
            if (closeBtn && isElementVisible(closeBtn)) {
                event.preventDefault();
                event.stopPropagation();
                closeBtn.click();
                return;
            }

            // 3. Nếu bảng chưa mở, tìm và kích hoạt nút mở chọn ảnh
            const photoButton = document.querySelector('.badge-photos .new-reply-box-btn') ||
                                document.querySelector('.badge-photos');

            if (photoButton && isElementVisible(photoButton)) {
                event.preventDefault();
                event.stopPropagation();
                photoButton.click();
            }
        }
    }, true); // Bật capture phase để bắt sự kiện trước các handler mặc định
})();
