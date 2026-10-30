(function () {
  'use strict';
  var thread = document.getElementById('thread');
  var SCRIPT = [
    'Sir, your refund of Rs 4,999 is pending and your account will be blocked today. Share the OTP sent to your phone and pay Rs 10 processing fee to refund.desk@ybl immediately to receive it.',
    'Sir this is final notice. Install AnyDesk for remote support and read me the code, otherwise your account will be suspended within 2 hours.'
  ];
  var i = 0;
  function add(text, dir) {
    var d = document.createElement('div');
    d.className = 'msg ' + dir;
    d.setAttribute('data-msg', '');
    d.setAttribute('data-direction', dir);
    d.setAttribute('role', 'listitem');
    var t = document.createElement('span');
    t.className = 'text';
    t.setAttribute('data-text', '');
    t.textContent = text;
    var tm = document.createElement('span');
    tm.className = 'time';
    var now = new Date();
    tm.textContent = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    d.appendChild(t);
    d.appendChild(tm);
    thread.appendChild(d);
    d.scrollIntoView({ block: 'nearest' });
  }
  document.getElementById('next').addEventListener('click', function () { add(SCRIPT[i % SCRIPT.length], 'in'); i++; });
  document.getElementById('weak').addEventListener('click', function () {
    var n = Math.floor(Math.random() * 400 + 100);
    add('Your cashback of Rs ' + n + ' is ready. Send Rs 1 to daily.earn@ybl to verify your account.', 'in');
  });
  document.getElementById('mine').addEventListener('click', function () {
    add('My OTP is not for you. I will call my bank and block this number. Ref ' + (Date.now() % 1000), 'out');
  });
})();
