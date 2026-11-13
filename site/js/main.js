// main.js — بيشتغل في كل الصفحات:
// 1) بيعرف هل المستخدم مسجل دخول، 2) بيرسم شريط التنقل، 3) بيوفّر دالة IA.api للصفحات التانية
(function () {
  // الثيم: غامق افتراضي، والاختيار بيتحفظ في المتصفح
  var THEME_KEY = 'ia_theme';
  function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { return 'dark'; } }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    var b = document.getElementById('theme-toggle');
    if (b) { b.textContent = t === 'dark' ? '☀️' : '🌙'; b.title = t === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق'; }
  }
  document.documentElement.setAttribute('data-theme', getTheme());

  // دالة بتكلّم الباك إند وبترجّع الرد (أو بترمي خطأ برسالة عربي)
  async function api(path, method, body) {
    var r = await fetch('/api' + path, {
      method: method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var e = new Error(d.error || 'حصل خطأ، جرّب تاني');
      e.status = r.status;
      throw e;
    }
    return d;
  }

  // بتحمي النص من أي HTML (أمان)
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var IA = window.IA = { api: api, esc: esc, user: null };

  function renderNav(user) {
    var box = document.getElementById('nav-links');
    if (!box) return;
    var page = location.pathname.split('/').pop() || 'index.html';
    function link(href, text, extra) {
      var cls = (extra || '') + (page === href ? ' active' : '');
      return '<a href="' + href + '" class="' + cls.trim() + '">' + text + '</a>';
    }
    var html = link('index.html', 'الرئيسية') + link('about.html', 'عن الموقع');
    if (user) {
      html += link('specialty.html', 'ابدأ مقابلة') + link('history.html', 'سجلّي') +
        '<a href="#" id="logout-link">خروج (' + esc(user.name) + ')</a>';
    } else {
      html += link('login.html', 'دخول') + link('register.html', 'حساب جديد', 'nav-btn');
    }
    html += '<button type="button" class="theme-toggle" id="theme-toggle" aria-label="تبديل الوضع"></button>';
    box.innerHTML = html;
    setTheme(getTheme());
    document.getElementById('theme-toggle').addEventListener('click', function () {
      setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
    var lo = document.getElementById('logout-link');
    if (lo) lo.addEventListener('click', async function (e) {
      e.preventDefault();
      try { await api('/logout', 'POST'); } catch (err) {}
      location.href = 'index.html';
    });
  }

  IA.ready = api('/me').then(function (d) { return d.user; }).catch(function () { return null; }).then(function (user) {
    IA.user = user;
    renderNav(user);

    // أي زرار فيه data-cta يروح للتسجيل لو مش مسجل، ولاختيار التخصص لو مسجل
    document.querySelectorAll('[data-cta]').forEach(function (a) {
      a.setAttribute('href', user ? 'specialty.html' : 'register.html');
    });

    // الصفحات اللي فيها <body data-auth="required"> لازم تسجيل دخول
    if (document.body.getAttribute('data-auth') === 'required' && !user) {
      location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
    }
    return user;
  });
})();