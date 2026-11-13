// صفحة التقرير: بتعرض نسبة النجاح وتفاصيل الأداء وطرق التحسين
(function () {
  var box = document.getElementById('report');
  var id = new URLSearchParams(location.search).get('id');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function fail(msg) { box.innerHTML = '<div class="card rp-box"><p class="rp-bad">' + esc(msg) + '</p><p><a class="btn" href="specialty.html">ابدأ مقابلة جديدة</a></p></div>'; }
  if (!/^\d+$/.test(id || '')) { fail('رابط التقرير غير صحيح.'); return; }

  fetch('/api/interviews/' + id, { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) { location.replace('login.html?next=specialty.html'); return null; }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'حصل خطأ'); return d; });
    })
    .then(function (d) {
      if (!d) return;
      if (!d.report) { fail('المقابلة دي لسه ما اتحللتش.'); return; }
      render(d.report);
    })
    .catch(function (e) { fail(e.message || 'تعذر الاتصال بالسيرفر.'); });

  function bar(label, v) {
    if (v == null) return '';
    return '<div class="rp-row"><span>' + label + '</span><div class="rp-bar"><i style="width:' + Number(v) + '%"></i></div><b>' + Number(v) + '%</b></div>';
  }

  function render(r) {
    var b = r.break// report.js — بيعرض نسبة النجاح وتفاصيل الأداء وطرق التحسين
(function () {
  var box = document.getElementById('report');
  var id = new URLSearchParams(location.search).get('id');
  var esc = IA.esc;

  function fail(msg) {
    box.innerHTML = '<div class="card center"><div class="alert error">' + esc(msg) + '</div>' +
      '<a class="btn" href="specialty.html">ابدأ مقابلة جديدة</a></div>';
  }

  function bar(label, v) {
    if (v == null) return '';
    v = Number(v);
    return '<div class="meter"><span>' + label + '</span><div class="bar"><i style="width:' + v + '%"></i></div><b>' + v + '%</b></div>';
  }

  function render(r) {
    var b = r.breakdown, s = r.stats, pct = Number(r.success_pct);
    var color = pct >= 75 ? '#16a34a' : pct >= 55 ? '#d97706' : '#dc2626';
    var h = '';

    // 1) النسبة الكبيرة
    h += '<div class="card center"><p class="muted">نتيجة مقابلة ' + esc(r.specialty) + '</p>' +
      '<div class="score-ring" style="--p:' + pct + ';--c:' + color + '"><span>' + pct + '%</span></div>' +
      '<h2>' + esc(r.verdict) + '</h2>' +
      (r.terminated ? '<p class="bad">انتهت المقابلة بدري بسبب تكرار المخالفات.</p>' : '') + '</div>';

    // 2) تفاصيل الأداء
    h += '<div class="card"><h3>تفاصيل الأداء</h3>' +
      bar('المحتوى', b.content) + bar('التواصل البصري', b.eye_contact) + bar('الهدوء', b.calm) +
      bar('الكلام', b.speech) + bar('لغة الجسد', b.posture) +
      '<p class="muted">أسئلة مجابة ' + s.answered + '/' + s.total + ' · مدة ' + s.total_minutes + ' دقيقة · تواصل بصري ' + s.eye_contact_pct +
      '% · توتر ' + s.avg_nervousness + '% · رمش ' + s.blink_rate + '/د · ' + (s.wpm == null ? '-' : s.wpm) + ' كلمة/د · حشو ' +
      (s.filler_rate == null ? '-' : s.filler_rate) + '% · مخالفات ' + s.violations +
      (s.ai_content ? '' : '<br>تقييم المحتوى تقديري (قواعد مبسطة).') + '</p></div>';

    // 3) نقاط القوة
    if (r.strengths.length) {
      h += '<div class="card"><h3 class="good">✅ نقاط القوة</h3><ul class="list">' +
        r.strengths.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }

    // 4) طرق التحسين
    h += '<div class="card"><h3>🛠️ طرق التحسين</h3><ul class="list">' +
      r.tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';

    // 5) تفصيل كل سؤال
    h += '<div class="card"><h3>تفصيل الأسئلة</h3><div class="table-wrap"><table class="table">' +
      '<tr><th>السؤال</th><th>الدرجة</th><th>نظر</th><th>توتر</th><th>ملاحظة</th></tr>' +
      r.per_question.map(function (p) {
        return '<tr><td>' + esc(p.q) + '</td><td>' + (p.score == null ? '-' : p.score) + '</td><td>' + p.eye + '%</td><td>' +
          p.nervousness + '%</td><td>' + esc(p.feedback) + '</td></tr>';
      }).join('') + '</table></div></div>';

    // 6) المخالفات
    if (r.violations.length) {
      h += '<div class="card"><h3>⚠️ المخالفات</h3><ul class="list">' +
        r.violations.map(function (v) { return '<li>سؤال ' + esc(v.q) + ' — ' + esc(v.msg) + '</li>'; }).join('') + '</ul></div>';
    }

    h += '<p class="center"><a class="btn" href="specialty.html">مقابلة جديدة</a> <a class="btn ghost" href="history.html">سجل مقابلاتي</a></p>';
    box.innerHTML = h;
  }

  IA.ready.then(async function (user) {
    if (!user) return;
    if (!/^\d+$/.test(id || '')) { fail('رابط التقرير غير صحيح.'); return; }
    try {
      var d = await IA.api('/interviews/' + id);
      if (!d.report) { fail('المقابلة دي لسه ما اتحللتش.'); return; }
      render(d.report);
    } catch (e) { fail(e.message || 'تعذر الاتصال بالسيرفر.'); }
  });
})();down, s = r.stats, pct = Number(r.success_pct);
    var color = pct >= 75 ? '#18a874' : pct >= 55 ? '#f5a524' : '#e5484d';
    var h = '';
    h += '<div class="card rp-box rp-center"><p class="rp-muted">نتيجة مقابلة ' + esc(r.specialty) + '</p>' +
      '<div class="rp-ring" style="--p:' + pct + ';--c:' + color + '"><span>' + pct + '%</span></div>' +
      '<h2>' + esc(r.verdict) + '</h2>' +
      (r.terminated ? '<p class="rp-bad">انتهت المقابلة بدري بسبب تكرار المخالفات.</p>' : '') + '</div>';

    h += '<div class="card rp-box"><h3>تفاصيل الأداء</h3>' +
      bar('المحتوى', b.content) + bar('التواصل البصري', b.eye_contact) + bar('الهدوء', b.calm) + bar('الكلام', b.speech) + bar('لغة الجسد', b.posture) +
      '<p class="rp-muted">أسئلة مجابة ' + s.answered + '/' + s.total + ' · مدة ' + s.total_minutes + ' دقيقة · تواصل بصري ' + s.eye_contact_pct + '% · توتر ' + s.avg_nervousness +
      '% · رمش ' + s.blink_rate + '/د · ' + (s.wpm == null ? '-' : s.wpm) + ' كلمة/د · حشو ' + (s.filler_rate == null ? '-' : s.filler_rate) + '% · مخالفات ' + s.violations +
      (s.ai_content ? '' : '<br>تقييم المحتوى تقديري (قواعد مبسطة). فعّل ANTHROPIC_API_KEY في السيرفر لتقييم أدق بالذكاء الاصطناعي.') + '</p></div>';

    if (r.strengths.length) {
      h += '<div class="card rp-box"><h3 class="rp-good">✅ نقاط القوة</h3><ul class="rp-list">' +
        r.strengths.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '<div class="card rp-box"><h3>🛠️ طرق التحسين</h3><ul class="rp-list">' +
      r.tips.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';

    h += '<div class="card rp-box"><h3>تفصيل الأسئلة</h3><div class="rp-scroll"><table class="rp-table"><tr><th>السؤال</th><th>الدرجة</th><th>نظر</th><th>توتر</th><th>ملاحظة</th></tr>' +
      r.per_question.map(function (p) {
        return '<tr><td>' + esc(p.q) + '</td><td>' + (p.score == null ? '-' : p.score) + '</td><td>' + p.eye + '%</td><td>' + p.nervousness + '%</td><td>' + esc(p.feedback) + '</td></tr>';
      }).join('') + '</table></div></div>';

    if (r.violations.length) {
      h += '<div class="card rp-box"><h3>⚠️ المخالفات</h3><ul class="rp-list">' +
        r.violations.map(function (v) { return '<li>سؤال ' + esc(v.q) + ' — ' + esc(v.msg) + '</li>'; }).join('') + '</ul></div>';
    }
    h += '<p class="rp-center"><a class="btn" href="specialty.html">مقابلة جديدة</a></p>';
    box.innerHTML = h;
  }
})();