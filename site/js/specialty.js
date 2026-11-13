// specialty.js — بيعرض التخصصات من الباك إند، والضغط على كارت بيبدأ المقابلة
(function () {
  var list = document.getElementById('spec-list');
  var errBox = document.getElementById('spec-error');
  var ICONS = { software: '💻', data_ai: '🤖', marketing: '📣', accounting: '📊', hr: '🧑‍💼', sales_cs: '🤝' };

  IA.ready.then(async function (user) {
    if (!user) return;                       // main.js بيحوّله لصفحة الدخول
    document.getElementById('hello').textContent = 'أهلًا ' + user.name + ' 👋 اختار تخصصك';
    try {
      var d = await IA.api('/specialties');
      list.innerHTML = d.specialties.map(function (s) {
        return '<a class="card spec-card" href="interview.html?spec=' + encodeURIComponent(s.id) + '">' +
          '<div class="icon">' + (ICONS[s.id] || '🎯') + '</div>' +
          '<h3>' + IA.esc(s.name) + '</h3><p>' + IA.esc(s.desc) + '</p></a>';
      }).join('');
    } catch (e) {
      errBox.textContent = e.message || 'تعذر الاتصال بالسيرفر. تأكد إنه شغّال.';
      errBox.classList.remove('hidden');
    }
  });
})();