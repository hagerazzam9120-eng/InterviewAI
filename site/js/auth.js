// auth.js — منطق صفحتي التسجيل والدخول (بيستخدم IA.api من main.js)
(function () {
  var form = document.getElementById('auth-form');
  if (!form) return;

  var mode = form.getAttribute('data-mode');            // register أو login
  var errBox = document.getElementById('auth-error');
  var btn = document.getElementById('auth-submit');

  // الصفحة اللي نرجع لها بعد النجاح (?next=اسم-صفحة.html) — صفحات من الموقع فقط
  var next = new URLSearchParams(location.search).get('next');
  var target = next && /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(next) ? next : 'specialty.html';

  // زرار العين: يظهر/يخفي كلمة المرور في كل خانات الباسورد
  form.querySelectorAll('input[type="password"]').forEach(function (inp) {
    var wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-eye'; b.textContent = '👁'; b.title = 'إظهار كلمة المرور';
    b.setAttribute('aria-label', 'إظهار كلمة المرور');
    b.addEventListener('click', function () {
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? '🙈' : '👁';
      b.title = show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور';
    });
    wrap.appendChild(b);
  });

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }

  // لو المستخدم مسجل دخول بالفعل، مفيش داعي يشوف الصفحة دي
  IA.ready.then(function (user) { if (user) location.replace(target); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errBox.classList.add('hidden');

    var data = { email: form.email.value.trim(), password: form.password.value };

    if (mode === 'register') {
      data.name = form.name.value.trim();
      if (!data.name) return showError('اكتب اسمك.');
    }
    if (!data.email) return showError('اكتب بريدك الإلكتروني.');
    if (!data.password) return showError('اكتب كلمة المرور.');
    if (mode === 'register') {
      if (data.password.length < 6) return showError('كلمة المرور لازم تكون 6 حروف على الأقل.');
      if (data.password !== form.password2.value) return showError('كلمتا المرور مش متطابقتين.');
    }

    btn.disabled = true;
    try {
      await IA.api('/' + mode, 'POST', data);
      location.href = target;
    } catch (err) {
      showError(err.message || 'تعذر الاتصال بالسيرفر. تأكد إنه شغّال.');
      btn.disabled = false;
    }
  });
})();