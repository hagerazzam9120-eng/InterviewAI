// history.js — بيعرض مقابلات المستخدم القديمة ونتايجها
(function () {
  var box = document.getElementById('history');
  var esc = IA.esc;

  // التاريخ بيتخزّن بتوقيت UTC، فنحوّله لتوقيت جهاز المستخدم
  function fmt(s) {
    var d = new Date(s + 'Z');
    return isNaN(d) ? esc(s) : d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  }

  IA.ready.then(async function (user) {
    if (!user) return;
    try {
      var d = await IA.api('/interviews');
      if (!d.interviews.length) {
        box.innerHTML = '<p class="center muted">لسه ما عملتش مقابلات.</p><p class="center"><a class="btn" href="specialty.html">ابدأ أول مقابلة</a></p>';
        return;
      }
      box.innerHTML = '<div class="table-wrap"><table class="table"><tr><th>التاريخ</th><th>التخصص</th><th>الحالة</th><th>النتيجة</th><th></th></tr>' +
        d.interviews.map(function (i) {
          var done = i.status === 'done';
          var cls = i.success_pct >= 75 ? 'good' : i.success_pct < 55 ? 'bad' : '';
          return '<tr><td>' + fmt(i.started) + '</td><td>' + esc(i.specialty_name) + '</td>' +
            '<td>' + (done ? 'مكتملة' : 'غير مكتملة') + '</td>' +
            '<td class="' + cls + '"><b>' + (i.success_pct == null ? '-' : i.success_pct + '%') + '</b></td>' +
            '<td>' + (done ? '<a href="report.html?id=' + Number(i.id) + '">عرض التقرير</a>' : '') + '</td></tr>';
        }).join('') + '</table></div>' +
        '<p class="center"><a class="btn" href="specialty.html">مقابلة جديدة</a></p>';
    } catch (e) {
      box.innerHTML = '<div class="alert error">' + esc(e.message || 'تعذر الاتصال بالسيرفر.') + '</div>';
    }
  });
})();