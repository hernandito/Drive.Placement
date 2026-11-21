/* Drive Placement - Dashboard tile behavior.
   - Responsive chip levels: measures column width and sets dp-lvl-1..4 on the tile.
   - Floating pop-over: hover (desktop) or tap-to-pin (touch) a chip to see the
     full drive card. The card is position:fixed on <body>, so it floats over the
     whole dashboard and is never clipped by the tile. Auto-flips to stay on screen. */
(function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var pop = null;        // the single live pop-over element
    var pinned = false;    // is it click-pinned open?

    function removePop() {
        if (pop) { pop.remove(); pop = null; }
        pinned = false;
    }

    function cardHtml(d, isDark, withClose) {
        var tempCls = '', tempTxt = '--';
        if (d.spundown) { tempCls = 'sleep'; tempTxt = 'Zzz'; }
        else if (d.temp !== null && d.temp !== undefined) {
            tempTxt = d.temp + '°';
            tempCls = d.temp >= 55 ? 'hot' : (d.temp >= 45 ? 'warm' : '');
        }

        var usageHtml = '';
        var hasParts = false; // dashboard pop-over keeps it simple; partitions live on the full page
        if (d.mounted === false && !hasParts) {
            usageHtml = '<div class="dp-pop-free"><span class="dp-pop-nm">Not mounted</span></div>';
        } else if (d.usedPct !== null && d.usedPct !== undefined) {
            var freePct = 100 - d.usedPct;
            usageHtml = '<div class="dp-pop-bar"><span style="width:' + d.usedPct + '%"></span></div>'
                      + '<div class="dp-pop-free"><span>' + (d.freeLabel ? 'Free ' + esc(d.freeLabel) : 'Free') + '</span>'
                      + '<b>' + freePct + '% free</b></div>';
        }

        var fmt = d.format ? esc(d.format) : '';
        var closeBtn = withClose ? '<button class="dp-pop-close" aria-label="Close">×</button>' : '';

        return '<div class="dp-pop-head"><span class="dp-pop-name">' + esc(d.name || '') + '</span>'
             + '<span class="dp-pop-temp ' + tempCls + '">' + tempTxt + '</span>' + closeBtn + '</div>'
             + '<div class="dp-pop-size">' + esc(d.size || '') + '</div>'
             + '<div class="dp-pop-serial">' + esc(d.last4 || '') + '</div>'
             + (fmt ? '<div class="dp-pop-sub"><span>' + fmt + '</span></div>' : '')
             + usageHtml
             + '<div class="dp-pop-cat">' + esc(d.catLabel || '') + '</div>';
    }

    function positionPop(el, chip) {
        var r = chip.getBoundingClientRect();
        var w = el.offsetWidth, h = el.offsetHeight;
        var vw = window.innerWidth, vh = window.innerHeight, gap = 8;
        var left = r.right + gap;
        if (left + w > vw - gap) left = r.left - w - gap;   // flip to the left
        if (left < gap) left = Math.max(gap, vw - w - gap);
        var top = r.top;
        if (top + h > vh - gap) top = vh - h - gap;         // nudge up to stay on screen
        if (top < gap) top = gap;
        el.style.left = Math.round(left) + 'px';
        el.style.top = Math.round(top) + 'px';
    }

    function showPop(chip, data, isDark, pin) {
        removePop();
        var d = data[chip.getAttribute('data-id')];
        if (!d) return;
        pop = document.createElement('div');
        pop.className = 'dp-dash-pop' + (isDark ? ' dp-dash-dark' : '') + (pin ? ' dp-pop-pinned' : '');
        pop.innerHTML = cardHtml(d, isDark, pin);
        document.body.appendChild(pop);
        positionPop(pop, chip);
        pinned = !!pin;
        if (pin) {
            var x = pop.querySelector('.dp-pop-close');
            if (x) x.addEventListener('click', function (e) { e.stopPropagation(); removePop(); });
        }
    }

    function setupTile(tile) {
        if (tile.__dpInit) return;
        tile.__dpInit = true;
        var data = (window.__dpDash || {})[tile.id] || {};
        var isDark = tile.classList.contains('dp-dash-dark');

        // ---- responsive leveling ----
        function applyLevel() {
            var cols = tile.querySelectorAll('.dp-dash-col');
            if (!cols.length) return;
            var minW = Infinity;
            cols.forEach(function (c) { minW = Math.min(minW, c.clientWidth); });
            var lvl = minW >= 110 ? 1 : (minW >= 70 ? 2 : (minW >= 46 ? 3 : 4));
            tile.classList.remove('dp-lvl-1', 'dp-lvl-2', 'dp-lvl-3', 'dp-lvl-4');
            tile.classList.add('dp-lvl-' + lvl);
        }
        applyLevel();
        if (window.ResizeObserver) { new ResizeObserver(applyLevel).observe(tile); }
        window.addEventListener('resize', applyLevel);

        // ---- hover + tap pop-over ----
        tile.querySelectorAll('.dp-dchip').forEach(function (chip) {
            chip.addEventListener('mouseenter', function () { if (!pinned) showPop(chip, data, isDark, false); });
            chip.addEventListener('mouseleave', function () { if (!pinned) removePop(); });
            chip.addEventListener('focus', function () { if (!pinned) showPop(chip, data, isDark, false); });
            chip.addEventListener('blur', function () { if (!pinned) removePop(); });
            chip.addEventListener('click', function (e) {
                e.stopPropagation();
                var already = pinned && pop;
                showPop(chip, data, isDark, true);   // pin it
                if (already) { /* re-pin to the newly clicked chip */ }
            });
        });
    }

    // Click anywhere else closes a pinned card.
    document.addEventListener('click', function (e) {
        if (pinned && pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('.dp-dchip'))) {
            removePop();
        }
    });

    function init() {
        var tiles = document.querySelectorAll('.dp-dash');
        for (var i = 0; i < tiles.length; i++) setupTile(tiles[i]);
    }
    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);
})();
