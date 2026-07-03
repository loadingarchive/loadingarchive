// Gedeelde domino-footer-animatie, geladen door elke pagina (statische
// pagina's én de server-rendered handlers). Eén bron in plaats van de
// eerdere 8 inline kopieën.
//
// Belangrijk: het aantal balkjes hangt af van de containerbreedte. De rij
// wordt daarom herbouwd bij window-resize (gedebounced), anders blijft na
// het verkleinen van het venster een te brede rij staan die horizontaal
// buiten de pagina uitsteekt en de hele layout scheef duwt (de responsive
// bug die dit bestand oploste).
(function () {
  var GAP = 7, BAR = 3, ROW_H = 22, STEP = 40, TRAIL = 15, T_FALL = 120, T_RISE = 100, PAUSE = 800;

  window.initDominoRow = function (rowId) {
    var rowEl = document.getElementById(rowId);
    if (!rowEl) return;

    var gen = 0;          // generatieteller: maakt lopende tick-loops van een oude build inert
    var timeoutId = null; // pending setTimeout van de actieve loop
    var lastW = 0;

    function build() {
      var myGen = ++gen;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      rowEl.innerHTML = '';

      var FULL_W = rowEl.offsetWidth || 960;
      lastW = FULL_W;
      var NCOLS = Math.max(1, Math.floor((FULL_W + GAP) / (BAR + GAP)));

      var rowDiv = document.createElement('div');
      rowDiv.style.cssText = 'display:flex;gap:' + GAP + 'px;align-items:flex-end;height:' + ROW_H + 'px;overflow:visible';
      var bars = [];
      for (var i = 0; i < NCOLS; i++) {
        var b = document.createElement('div');
        b.className = 'd-bar';
        b.style.height = ROW_H + 'px';
        rowDiv.appendChild(b);
        bars.push(b);
      }
      rowEl.appendChild(rowDiv);
      rowEl.style.overflow = 'visible';

      var TOTAL = NCOLS + TRAIL, p = 0;
      function tick() {
        if (myGen !== gen) return; // rij is inmiddels herbouwd, stop deze loop
        var ci = NCOLS - 1 - p;
        if (p < NCOLS) { bars[ci].style.transition = 'transform ' + T_FALL + 'ms ease-in'; bars[ci].style.transform = 'rotateZ(-70deg)'; }
        var rp = p - TRAIL, rc = NCOLS - 1 - rp;
        if (rp >= 0 && rp < NCOLS) { bars[rc].style.transition = 'transform ' + T_RISE + 'ms ease-out'; bars[rc].style.transform = ''; }
        p++;
        if (p >= TOTAL) { p = 0; timeoutId = setTimeout(tick, PAUSE); }
        else { timeoutId = setTimeout(tick, STEP); }
      }
      tick();
    }

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (rowEl.offsetWidth !== lastW) build();
      }, 150);
    });

    build();
  };
})();
