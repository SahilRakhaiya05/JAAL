(function () {
  'use strict';
  function copy(id, btn) {
    var t = document.getElementById(id).textContent;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
    function fallback() {
      var r = document.createRange();
      r.selectNodeContents(document.getElementById(id));
      var s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Press Ctrl+C'; }
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
  }
  document.getElementById('copy1').addEventListener('click', function (e) { copy('h1', e.currentTarget); });
  document.getElementById('copy2').addEventListener('click', function (e) { copy('h2', e.currentTarget); });
  document.getElementById('f').addEventListener('submit', function (e) { e.preventDefault(); document.getElementById('msg').hidden = false; });
})();
