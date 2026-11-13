// interview.js — المقابلة: كاميرا + تحليل داخل المتصفح (MediaPipe) + تفريغ صوتي + منع الغش
(function () {
  var CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var FACE_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  var POSE_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  var root = document.getElementById('app');
  var specId = new URLSearchParams(location.search).get('spec');
  if (!specId) { location.replace('specialty.html'); return; }

  var $ = function (s) { return document.querySelector(s); };
  var esc = IA.esc;
  var clamp = function (x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, x)); };
  var FILLERS = new Set(['امم', 'اممم', 'ممم', 'اه', 'آه', 'ايه', 'إيه', 'يعني', 'um', 'umm', 'uh', 'uhh', 'like']);
  var countFillers = function (t) { return (t.toLowerCase().match(/[\w؀-ۿ']+/g) || []).filter(function (w) { return FILLERS.has(w); }).length; };
  var median = function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; };

  // ---------- نماذج التحليل (بتتحمّل أول مرة من الإنترنت)
  var D = { face: null, pose: null };
  async function initModels() {
    if (D.face) return;
    var v = await import(CDN + '/vision_bundle.mjs');
    var fs = await v.FilesetResolver.forVisionTasks(CDN + '/wasm');
    var mkFace = function (d) {
      return v.FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: FACE_URL, delegate: d },
        runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true });
    };
    try { D.face = await mkFace('GPU'); } catch (e) { D.face = await mkFace('CPU'); }
    try {
      D.pose = await v.PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: POSE_URL, delegate: 'GPU' },
        runningMode: 'VIDEO', numPoses: 1 });
    } catch (e) { D.pose = null; }
  }

  // ---------- قياسات الإطار الواحد
  function headPose(lm) {
    var L = lm[234], R = lm[454], N = lm[1], T = lm[10], B = lm[152];
    return { yaw: (N.x - L.x) / (R.x - L.x) - 0.5, pitch: (N.y - T.y) / (B.y - T.y), fw: R.x - L.x, N: N };
  }
  function poseInfo(p) {
    var lm = p.landmarks && p.landmarks[0];
    if (!lm) return null;
    var ls = lm[11], rs = lm[12], nose = lm[0];
    var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    if (sw < 0.05) return null;
    var midY = (ls.y + rs.y) / 2;
    var wd = [lm[15], lm[16]].filter(function (w) { return (w.visibility == null ? 1 : w.visibility) > 0.5; })
      .map(function (w) { return Math.hypot(w.x - nose.x, w.y - nose.y) / sw; });
    return { tilt: Math.abs(ls.y - rs.y) / sw, slouch: (midY - nose.y) / sw, hand: wd.length ? Math.min.apply(null, wd) < 0.7 : false };
  }
  function newTracker() {
    return { t0: performance.now(), frames: 0, eye: 0, missing: 0, blinks: 0, blinkOn: false, lastEye: true, motionSum: 0, motionN: 0,
      lastNose: null, tension: 0, smile: 0, poseN: 0, poseSum: 0, hand: 0 };
  }
  function processFrame(tr, face, base) {
    tr.frames++;
    var n = face.faceLandmarks.length;
    var res = { eye: false, missing: false, multi: n > 1 };
    if (n === 0) { tr.missing++; res.missing = true; return res; }
    var lm = face.faceLandmarks[0], bs = {};
    ((face.faceBlendshapes[0] || {}).categories || []).forEach(function (c) { bs[c.categoryName] = c.score; });
    var g = function (k) { return bs[k] || 0; };
    var hp = headPose(lm);
    var blinkV = (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2;
    if (blinkV > 0.5) { if (!tr.blinkOn) tr.blinks++; tr.blinkOn = true; } else tr.blinkOn = false;
    var lookH = Math.max((g('eyeLookOutLeft') + g('eyeLookInRight')) / 2, (g('eyeLookInLeft') + g('eyeLookOutRight')) / 2);
    var down = (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2, up = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2;
    var eye = lookH < 0.45 && down < 0.4 && up < 0.55 && Math.abs(hp.yaw - base.yaw) < 0.1 && Math.abs(hp.pitch - base.pitch) < 0.09;
    if (blinkV > 0.5) eye = tr.lastEye;          // الرمش يرفع قيم النظر للأسفل فنتجاهله
    tr.lastEye = eye; res.eye = eye;
    if (eye) tr.eye++;
    if (tr.lastNose) { tr.motionSum += Math.hypot(hp.N.x - tr.lastNose.x, hp.N.y - tr.lastNose.y) / hp.fw; tr.motionN++; }
    tr.lastNose = { x: hp.N.x, y: hp.N.y };
    tr.tension += (g('browDownLeft') + g('browDownRight') + g('mouthPressLeft') + g('mouthPressRight') +
      g('mouthFrownLeft') + g('mouthFrownRight') + g('eyeSquintLeft') + g('eyeSquintRight')) / 8;
    if ((g('mouthSmileLeft') + g('mouthSmileRight')) / 2 > 0.3) tr.smile++;
    return res;
  }
  function processPose(tr, pose, base) {
    var p = poseInfo(pose);
    if (!p) return;
    tr.poseN++;
    var slouch = base.slouch != null && p.slouch < base.slouch * 0.7;
    if (p.hand) tr.hand++;
    tr.poseSum += 100 - Math.min(30, p.tilt / 0.12 * 30) - (p.hand ? 25 : 0) - (slouch ? 25 : 0);
  }
  function snapshot(tr) {
    var sec = (performance.now() - tr.t0) / 1000, f = Math.max(1, tr.frames), fp = Math.max(1, tr.frames - tr.missing);
    return {
      eye_ratio: tr.eye / f, face_missing_ratio: tr.missing / f,
      blink_rate: sec > 5 ? tr.blinks / sec * 60 : 15,
      head_motion: clamp((tr.motionSum / Math.max(1, tr.motionN)) / 0.02) * 100,
      tension: tr.tension / fp, smile_ratio: tr.smile / f,
      posture: tr.poseN ? tr.poseSum / tr.poseN : null, hand_touch_ratio: tr.poseN ? tr.hand / tr.poseN : 0
    };
  }
  function nervousness(m, sp) {
    var blink = clamp((m.blink_rate - 20) / 25), motion = m.head_motion / 100, tension = clamp(m.tension * 2.5);
    var away = clamp(1 - m.eye_ratio), hand = clamp(m.hand_touch_ratio * 3);
    var speech = sp ? clamp(sp.fillerRate / 10) * 0.6 + (sp.wpm > 180 ? 0.4 : 0) : 0;
    return 100 * (0.2 * blink + 0.2 * motion + 0.2 * tension + 0.15 * away + 0.1 * hand + 0.15 * speech);
  }

  // ---------- المحاور الافتراضي (شخصية متحركة بتتكلم)
  var PERSONAS = {
    sara:  { name: 'سارة', role: 'محاورة التوظيف', female: true,  hair: '#2b2140' },
    ahmed: { name: 'أحمد', role: 'محاور التوظيف', female: false, hair: '#2a2a35' }
  };

  function avatarSVG(p) {
    var skin = '#f1c9a5', h = p.hair;
    var hairBack = p.female
      ? '<path d="M48 92 C42 40 70 20 100 20 C130 20 158 40 152 92 L162 176 C142 190 122 164 100 164 C78 164 58 190 38 176 Z" fill="' + h + '"/>'
      : '';
    var hairFront = p.female
      ? '<path d="M53 84 C50 40 80 28 100 28 C122 28 152 42 147 84 C130 62 112 52 100 50 C84 54 66 64 53 84 Z" fill="' + h + '"/>'
      : '<path d="M52 82 C47 36 78 22 100 22 C124 22 153 36 148 82 C142 58 126 44 100 44 C76 44 58 58 52 82 Z" fill="' + h + '"/>';
    var tie = p.female
      ? '<path d="M82 164 L100 190 L118 164" fill="none" stroke="#f5d27a" stroke-width="3" stroke-linecap="round"/><circle cx="100" cy="194" r="4" fill="#f5d27a"/>'
      : '<path d="M95 176 L105 176 L108 214 L100 224 L92 214 Z" fill="#d4af37"/>';
    var earrings = p.female ? '<circle cx="54" cy="106" r="3.2" fill="#f5d27a"/><circle cx="146" cy="106" r="3.2" fill="#f5d27a"/>' : '';
    return '<svg class="av-svg" viewBox="0 0 200 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + p.name + '">' +
      hairBack +
      '<path d="M16 230 C16 182 50 162 100 162 C150 162 184 182 184 230 Z" fill="#2f3340"/>' +
      '<path d="M76 162 L100 204 L124 162 Z" fill="#ffffff"/>' + tie +
      '<rect x="86" y="128" width="28" height="38" rx="10" fill="' + skin + '"/>' +
      '<g class="av-head">' +
        '<ellipse cx="54" cy="92" rx="7" ry="11" fill="' + skin + '"/><ellipse cx="146" cy="92" rx="7" ry="11" fill="' + skin + '"/>' + earrings +
        '<ellipse cx="100" cy="88" rx="46" ry="54" fill="' + skin + '"/>' + hairFront +
        '<path d="M68 74 Q80 67 93 73" stroke="' + h + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<path d="M107 73 Q120 67 132 74" stroke="' + h + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="80" cy="88" rx="9" ry="6" fill="#fff"/><ellipse cx="120" cy="88" rx="9" ry="6" fill="#fff"/>' +
        '<circle cx="80" cy="88" r="3.8" fill="#2a2230"/><circle cx="120" cy="88" r="3.8" fill="#2a2230"/>' +
        '<circle cx="81.4" cy="86.6" r="1.1" fill="#fff"/><circle cx="121.4" cy="86.6" r="1.1" fill="#fff"/>' +
        '<ellipse class="av-lid" cx="80" cy="87" rx="10.5" ry="7.5" fill="' + skin + '"/><ellipse class="av-lid" cx="120" cy="87" rx="10.5" ry="7.5" fill="' + skin + '"/>' +
        '<path d="M100 94 Q95 108 100 111 Q105 111 104 108" stroke="#d6a27d" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
        '<circle cx="68" cy="108" r="8" fill="#f2a6a0" opacity=".28"/><circle cx="132" cy="108" r="8" fill="#f2a6a0" opacity=".28"/>' +
        '<path d="M86 122 Q100 132 114 122" stroke="#b5524c" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse class="av-mouth" cx="100" cy="125" rx="9.5" ry="7" fill="#7a2b33"/>' +
      '</g></svg>';
  }

  // ---------- نطق المصطلحات الإنجليزي: بنكتبها بحروف عربي قبل ما الصوت ينطقها
  var SAY = {
    'Machine Learning': 'ماشين ليرنينج', 'performance marketing': 'بيرفورمانس ماركتنج', 'brand awareness': 'براند أويرنس',
    'integration test': 'إنتجريشن تِست', 'unit test': 'يونِت تِست', 'code review': 'كود ريفيو', 'data leakage': 'داتا ليكيدج',
    'sales funnel': 'سيلز فانل', 'HR metrics': 'إتش آر ميتريكس', 'unsupervised': 'أنسوبرڤايزد', 'supervised': 'سوبرڤايزد',
    'overfitting': 'أوفر فيتينج', 'production': 'بروداكشن', 'onboarding': 'أون بورديج', 'workflow': 'ورك فلو', 'precision': 'بريسيجن',
    'GraphQL': 'جراف كيو إل', 'NoSQL': 'نو إس كيو إل', 'SQL': 'إس كيو إل', 'REST': 'ريست', 'API': 'إيه بي آي', 'SOLID': 'سوليد',
    'Git': 'جيت', 'bug': 'باج', 'recall': 'ريكول', 'SEO': 'إس إي أو', 'SEM': 'إس إي إم', 'KPIs': 'كي بي آيز', 'CAC': 'سي إيه سي',
    'IFRS': 'آي إف آر إس', 'CRM': 'سي آر إم', 'CSAT': 'سي سات', 'Backend': 'باك إند', 'Frontend': 'فرونت إند', 'Full-stack': 'فول ستاك'
  };
  var SAY_RE = new RegExp('\\b(' + Object.keys(SAY).sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return k.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); }).join('|') + ')\\b', 'gi');
  function say(t) {
    var low = {}; Object.keys(SAY).forEach(function (k) { low[k.toLowerCase()] = SAY[k]; });
    return t.replace(SAY_RE, function (m) { return low[m.toLowerCase()] || m; }).replace(/الـ\s*/g, '').replace(/ـ/g, '');
  }

  // ---------- صوت المحاور (متصفح Chrome بيقرأ الأسئلة بصوت عربي)
  function pickVoice(female) {
    if (!window.speechSynthesis) return null;
    var all = speechSynthesis.getVoices();
    if (S.voiceName && S.voiceName !== 'auto') {
      var chosen = all.find(function (v) { return v.name === S.voiceName; });
      if (chosen) return chosen;
    }
    var vs = all.filter(function (v) { return /^ar/i.test(v.lang); });
    if (!vs.length) return null;
    var hint = female ? /salma|hoda|zariyah|laila|layla|amina|fatima|noor/i : /shakir|naayf|hamed|maged|tarik|omar|ahmed/i;
    var pref = vs.filter(function (v) { return hint.test(v.name); });
    var pool = (pref.length ? pref : vs).slice();
    var score = function (v) { return (/natural/i.test(v.name) ? 4 : 0) + (/online/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0) + (/EG/i.test(v.lang) ? 1 : 0); };
    pool.sort(function (a, b) { return score(b) - score(a); });
    return pool[0];
  }

  function setAvatarSpeaking(on) {
    var w = $('#avatarWrap'); if (w) w.classList.toggle('speaking', on);
    refreshAv();
  }
  // المحاور بيتفاعل: بيتكلم، أو بيسمعك (بيهز راسه ومؤشر الصوت بيتحرك)، أو منتظر دورك
  function refreshAv() {
    var listening = S.active && !S.speaking && (performance.now() - S.lastVoice < 1300);
    var w = $('#avatarWrap'); if (w) w.classList.toggle('listening', listening);
    var c = $('#chipAv');
    if (c) {
      c.className = 'chip ' + (S.speaking ? 'mid' : listening ? 'ok' : '');
      c.textContent = S.speaking ? '🎙 المحاور بيسأل...' : listening ? '👂 المحاور بيسمعك' : '👂 دورك تجاوب';
    }
  }
  // مؤشر صوت الميكروفون: بيحدد إنك بتتكلم فعلًا
  async function startMic() {
    try {
      S.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      var AC = window.AudioContext || window.webkitAudioContext;
      S.ac = new AC(); var src = S.ac.createMediaStreamSource(S.micStream);
      S.an = S.ac.createAnalyser(); S.an.fftSize = 512; src.connect(S.an); S.buf = new Uint8Array(S.an.fftSize);
    } catch (e) { S.an = null; }
    S.micTimer = setInterval(micTick, 100);
  }
  function micTick() {
    var lvl = 0;
    if (S.an) {
      S.an.getByteTimeDomainData(S.buf);
      var sum = 0; for (var i = 0; i < S.buf.length; i++) { var x = (S.buf[i] - 128) / 128; sum += x * x; }
      lvl = clamp(Math.sqrt(sum / S.buf.length) * 8);
    }
    if (!S.speaking && lvl > 0.12) S.lastVoice = performance.now();
    var bars = document.querySelectorAll('#mic i'), k = [0.6, 0.9, 1, 0.8, 0.5];
    for (var j = 0; j < bars.length; j++) bars[j].style.height = (4 + (S.speaking ? 0 : lvl) * 26 * k[j]) + 'px';
    refreshAv();
  }


  // بتوقف أي كلام شغّال (صوت السيرفر أو صوت المتصفح)
  function stopSpeech() {
    try { if (S.audio) { S.audio.onended = S.audio.onerror = S.audio.onplaying = null; S.audio.pause(); S.audio = null; } } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  }

  // بتنطق النص؛ freeze=true معناها إن وقت السؤال مبيبدأش إلا بعد ما المحاور يخلّص كلام
  // الأول بنجرّب صوت السيرفر المصري الطبيعي (edge-tts)، ولو مش متاح بنرجع لصوت المتصفح
  function speak(text, freeze, done) {
    var token = ++S.speakToken, t1, t2;
    function finish() {
      if (token !== S.speakToken) return;
      clearTimeout(t1); clearTimeout(t2);
      S.speaking = false; S.freeze = false; S.finalText = '';
      setAvatarSpeaking(false);
      if (done) done();
    }
    stopSpeech();
    if (!S.voiceOn) { S.speaking = false; S.freeze = false; setAvatarSpeaking(false); if (done) done(); return; }
    S.speaking = true; S.freeze = !!freeze;
    t2 = setTimeout(finish, 45000);                                  // حد أقصى

    function browserVoice() {
      if (token !== S.speakToken) return;
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { finish(); return; }
      var u = new SpeechSynthesisUtterance(say(text)), started = false;
      u.lang = 'ar-SA'; u.rate = 0.9;
      var v = pickVoice(PERSONAS[S.persona].female);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.onstart = function () { started = true; if (token === S.speakToken) setAvatarSpeaking(true); };
      u.onend = finish; u.onerror = finish;
      t1 = setTimeout(function () { if (!started) { try { speechSynthesis.cancel(); } catch (e) {} finish(); } }, 2500);
      try { speechSynthesis.speak(u); } catch (e) { finish(); }
    }

    if (S.ttsOK === false) return browserVoice();
    var a = new Audio('/api/tts?v=' + (PERSONAS[S.persona].female ? 'f' : 'm') + '&text=' + encodeURIComponent(say(text)));
    S.audio = a;
    a.onplaying = function () { S.ttsOK = true; if (token === S.speakToken) setAvatarSpeaking(true); };
    a.onended = finish;
    a.onerror = function () { if (token !== S.speakToken) return; S.ttsOK = false; S.audio = null; browserVoice(); };
    var p = a.play(); if (p && p.catch) p.catch(function () { if (token !== S.speakToken) return; S.ttsOK = false; S.audio = null; browserVoice(); });
  }

  // ---------- حالة المقابلة
  var S = { stream: null, video: null, loop: null, timer: null, rec: null, listening: false, speechOK: false,
    base: { yaw: 0, pitch: 0.55, slouch: null }, calib: null, active: false, viol: [], pending: [], tickN: 0,
    awaySince: 0, awayFlag: false, multiSince: 0, multiFlag: false, finalText: '', lang: 'ar-EG',
    persona: 'sara', voiceName: 'auto', lastVoice: 0, micStream: null, ac: null, an: null, buf: null, micTimer: null, voiceOn: true, speaking: false, freeze: false, speakToken: 0 };
  var onVis = null;

  // ---------- شاشة التجهيز
  async function setup() {
    var spec;
    try {
      var d = await IA.api('/specialties');
      var f = d.specialties.find(function (s) { return s.id === specId; });
      if (!f) { location.replace('specialty.html'); return; }
      spec = f.name;
    } catch (e) {
      root.innerHTML = '<div class="card"><div class="alert error">' + esc(e.message || 'تعذر الاتصال بالسيرفر. تأكد إنه شغّال.') + '</div></div>';
      return;
    }
    root.innerHTML = '<div class="card"><h2>مقابلة ' + esc(spec) + '</h2>' +
      '<ul class="iv-list">' +
      '<li>10 أسئلة، وكل سؤال من 60 إلى 90 ثانية (إجمالي 10–15 دقيقة).</li>' +
      '<li><b>بُص على عدسة الكاميرا</b> طول المقابلة. النظر بعيدًا أو الخروج من الصفحة يُسجَّل مخالفة، و5 مخالفات تُنهي المقابلة.</li>' +
      '<li>ظبّط الكاميرا في مستوى العين، وإضاءة على وشك، وكتفيك ظاهرين.</li>' +
      '<li>استخدم Google Chrome عشان يشتغل التفريغ الصوتي.</li>' +
      '<li>الفيديو بيتحلل في جهازك فقط ومش بيترفع لأي مكان.</li></ul>' +
      '<div class="field"><label for="persona">اختار المحاور</label><select id="persona"><option value="sara">سارة (محاورة)</option><option value="ahmed">أحمد (محاور)</option></select></div>' +
      '<div class="avatar-preview"><div class="avatar-wrap small" id="avatarWrap"></div><div class="bubble" id="prevTxt"></div></div>' +
      '<div class="field"><label for="voice">صوت المحاور</label><select id="voice"><option value="auto">تلقائي (أفضل صوت عربي متاح)</option></select>' +
      '<p class="muted" style="font-size:.85rem;margin-top:4px">لو نطق الصوت مش واضح، جرّبي صوت تاني من القايمة. القايمة بتعرض الأصوات المتاحة في متصفحك (Microsoft Edge غالبًا فيه أصوات عربي طبيعية أكتر).</p>' +
      '<button class="btn ghost small" id="bTestVoice" type="button" style="margin-top:6px">🔊 جرّبي الصوت</button></div>' +
      '<div class="field"><label for="lang">لغة إجابتك</label><select id="lang"><option value="ar-EG">العربية (مصر)</option><option value="en-US">English</option></select></div>' +
      '<div class="camera"><video id="cam" autoplay muted playsinline></video><div id="st" class="muted">اضغط لتشغيل الكاميرا وفحصها.</div></div>' +
      '<div class="btn-row"><button class="btn" id="bCam">📷 تشغيل الكاميرا والمعايرة</button> <button class="btn" id="bStart" disabled>▶ ابدأ المقابلة</button></div></div>';
    S.video = $('#cam');
    function preview() {
      var p = PERSONAS[$('#persona').value];
      $('#avatarWrap').innerHTML = avatarSVG(p); S.persona = $('#persona').value;
      $('#prevTxt').textContent = 'أهلًا بك يا ' + (IA.user ? IA.user.name : '') + '! أنا ' + p.name + ' وسأكون محاورك اليوم 👋 سأطرح عليك 10 أسئلة، وستجيب عنها بصوتك.';
    }
    $('#persona').onchange = preview; preview();
    function fillVoices() {
      if (!window.speechSynthesis) return;
      var sel = $('#voice'); if (!sel) return;
      var keep = sel.value, vs = speechSynthesis.getVoices().filter(function (v) { return /^ar/i.test(v.lang); });
      sel.innerHTML = '<option value="auto">تلقائي (أفضل صوت عربي متاح)</option>' +
        vs.map(function (v) { return '<option value="' + esc(v.name) + '">' + esc(v.name) + ' (' + esc(v.lang) + ')</option>'; }).join('');
      var saved = ''; try { saved = localStorage.getItem('ia_voice') || ''; } catch (e) {}
      sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === (keep !== 'auto' ? keep : saved); }) ? (keep !== 'auto' ? keep : saved) : 'auto';
      S.voiceName = sel.value;
    }
    fillVoices();
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;
    $('#voice').onchange = function () { S.voiceName = this.value; try { localStorage.setItem('ia_voice', this.value); } catch (e) {} };
    $('#bTestVoice').onclick = function () {
      S.voiceOn = true; S.voiceName = $('#voice').value;
      speak('أهلًا بك يا ' + (IA.user ? IA.user.name : '') + '، أنا ' + PERSONAS[S.persona].name + ' محاورك اليوم. حدّثنا عن نفسك وخبراتك في دقيقة. وما الفرق بين REST وGraphQL؟', false);
    };
    $('#bCam').onclick = prepare;
    $('#bStart').onclick = start;
  }

  async function prepare() {
    var st = $('#st'), b = $('#bCam'); b.disabled = true;
    try {
      st.textContent = 'جاري تشغيل الكاميرا...';
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      S.video.srcObject = S.stream; await S.video.play();
      st.textContent = 'جاري تحميل نماذج التحليل (أول مرة قد تاخد نص دقيقة)...';
      await initModels();
      S.loop = setInterval(tick, 100);
      S.calib = { yaw: [], pitch: [], slouch: [], faces: 0 };
      for (var i = 3; i > 0; i--) { st.textContent = 'بُص على عدسة الكاميرا... ' + i; await new Promise(function (r) { setTimeout(r, 1000); }); }
      var c = S.calib; S.calib = null;
      if (c.faces < 15) { st.textContent = 'ما قدرناش نشوف وشك بوضوح. حسّن الإضاءة وجرّب تاني.'; b.disabled = false; return; }
      S.base.yaw = median(c.yaw); S.base.pitch = median(c.pitch); S.base.slouch = c.slouch.length ? median(c.slouch) : null;
      st.textContent = '✅ تمت المعايرة. ' + (D.pose ? '' : '(تحليل الجسم غير متاح على جهازك)');
      S.video.classList.add('ok'); $('#bStart').disabled = false;
    } catch (e) {
      st.innerHTML = '<span class="bad">تعذر التشغيل: ' + esc(e.message || e) + '. اتأكد من السماح بالكاميرا ومن الاتصال بالإنترنت (لتحميل النماذج).</span>';
      b.disabled = false;
    }
  }

  // ---------- حلقة التحليل (10 مرات في الثانية)
  function tick() {
    var v = S.video;
    if (!v || v.readyState < 2 || !D.face) return;
    var ts = performance.now(), face;
    try { face = D.face.detectForVideo(v, ts); } catch (e) { return; }
    S.tickN++;
    var pose = null;
    if (D.pose && S.tickN % 3 === 0) { try { pose = D.pose.detectForVideo(v, ts); } catch (e) {} }
    if (S.calib) {                                   // أثناء المعايرة
      if (face.faceLandmarks.length === 1) {
        var hp = headPose(face.faceLandmarks[0]); S.calib.faces++; S.calib.yaw.push(hp.yaw); S.calib.pitch.push(hp.pitch);
      }
      if (pose) { var p = poseInfo(pose); if (p) S.calib.slouch.push(p.slouch); }
      return;
    }
    if (!S.active) return;
    var r = processFrame(S.tr, face, S.base);
    if (pose) processPose(S.tr, pose, S.base);
    guard(r, ts);
    var cam = $('#cam');
    if (cam) { cam.classList.toggle('ok', !r.missing && r.eye); cam.classList.toggle('off', r.missing || !r.eye); }
    var mp = $('#mainPanel'); if (mp) { mp.classList.toggle('eye-ok', !r.missing && r.eye); mp.classList.toggle('eye-off', r.missing || !r.eye); }
    var ce = $('#chipEye');
    if (ce) { ce.className = 'chip ' + (r.eye ? 'ok' : 'bad'); ce.textContent = r.missing ? '👁 الوش مش ظاهر' : r.eye ? '👁 بتبص للكاميرا ✓' : '👁 بُص للكاميرا!'; }
  }

  // ---------- منع الغش: النظر بعيدًا / وش مش ظاهر / أكتر من شخص / الخروج من الصفحة
  function guard(r, ts) {
    if (r.multi) {
      if (!S.multiSince) S.multiSince = ts;
      if (ts - S.multiSince > 1500 && !S.multiFlag) { S.multiFlag = true; violate('multiple_faces', 'تم رصد أكثر من شخص أمام الكاميرا'); }
    } else { S.multiSince = 0; S.multiFlag = false; }
    if (r.missing || !r.eye) {
      if (!S.awaySince) S.awaySince = ts;
      var d = ts - S.awaySince;
      if (d > 1200) showWarn(r.missing ? 'وشك مش ظاهر في الكاميرا!' : 'ركّز بعينك على الكاميرا 👁');
      if (d > 2500 && !S.awayFlag) { S.awayFlag = true; violate(r.missing ? 'no_face' : 'look_away', r.missing ? 'الوجه غير ظاهر في الكاميرا' : 'النظر بعيدًا عن الكاميرا'); }
    } else { S.awaySince = 0; S.awayFlag = false; hideWarn(); }
  }
  function showWarn(t) { var w = $('#warn'); if (w) { w.textContent = t + ' (مخالفات: ' + S.viol.length + '/' + S.maxV + ')'; w.classList.remove('hidden'); } }
  function hideWarn() { var w = $('#warn'); if (w) w.classList.add('hidden'); }
  function violate(type, msg) {
    S.viol.push({ type: type, msg: msg, q: S.qIdx + 1, t: Math.round((performance.now() - S.t0) / 1000) });
    var c = $('#chipViol'); if (c) { c.textContent = '⚠ مخالفات ' + S.viol.length + '/' + S.maxV; c.className = 'chip bad'; }
    if (S.viol.length >= S.maxV) finish(true);
  }

  // ---------- التفريغ الصوتي (Chrome)
  function startSpeech() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { S.speechOK = false; return; }
    S.speechOK = true; S.listening = true;
    var rec = S.rec = new SR(); rec.lang = S.lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (e) {
      if (S.speaking) return;                 // متسمعش صوت المحاور نفسه
      S.lastVoice = performance.now();
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) S.finalText += ' ' + r[0].transcript; else interim += r[0].transcript;
      }
      var l = $('#live'); if (l) l.textContent = (S.finalText + ' ' + interim).trim() || '...';
    };
    rec.onend = function () { if (S.listening) { try { rec.start(); } catch (e) {} } };
    rec.onerror = function (e) { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.speechOK = false; S.listening = false; } };
    try { rec.start(); } catch (e) {}
  }

  // ---------- بدء المقابلة
  async function start() {
    $('#bStart').disabled = true;
    S.lang = $('#lang').value; S.persona = $('#persona').value;
    var P = PERSONAS[S.persona], d;
    try { d = await IA.api('/interviews', 'POST', { specialty: specId }); }
    catch (e) { alert(e.message); $('#bStart').disabled = false; return; }
    S.id = d.id; S.qs = d.questions; S.minS = d.min_sec; S.maxS = d.max_sec; S.maxV = d.max_violations; S.qIdx = 0; S.t0 = performance.now();
    var cam = S.video;
    root.innerHTML = '<div class="iv-top"><span class="iv-tag" id="qn"></span><span class="iv-tag" id="tot"></span><span class="iv-tag" id="qt"></span></div>' +
      '<div class="stage solo">' +
        '<div class="panel avatar-panel" id="mainPanel"><div id="vhold"></div><div class="avatar-wrap big" id="avatarWrap">' + avatarSVG(P) + '</div>' +
          '<div class="avatar-name">' + P.name + ' <span class="muted">— ' + P.role + '</span></div>' +
          '<div class="mic-meter" id="mic" title="مستوى صوتك"><i></i><i></i><i></i><i></i><i></i></div>' +
          '<div class="bubble" id="qtext"></div>' +
          '<div class="chips"><span class="chip" id="chipAv">🎙 ...</span><span class="chip" id="chipEye">👁 ...</span><span class="chip" id="chipNerv">🙂 ...</span><span class="chip" id="chipViol">مخالفات 0/' + S.maxV + '</span></div>' +
          '<div class="btn-row"><button class="btn ghost small" id="bReplay">🔊 أعد السؤال</button> <button class="btn ghost small" id="bVoice">🔇 كتم صوت المحاور</button></div></div>' +
      '</div>' +
      '<div class="card"><div class="progress"><i id="pb"></i></div>' +
      '<div class="live" id="live">...</div>' +
      '<div class="btn-row"><button class="btn" id="bNext" disabled></button> <button class="btn ghost" id="bEnd">إنهاء المقابلة</button></div></div>' +
      '<div class="warn-overlay hidden" id="warn"></div>';
    $('#vhold').replaceWith(cam); cam.id = 'cam'; cam.className = 'cam-hidden'; cam.play().catch(function () {});
    onVis = function () { if (document.hidden && S.active) violate('tab_switch', 'الخروج من صفحة المقابلة'); };
    document.addEventListener('visibilitychange', onVis);
    $('#bNext').onclick = function () { advance(); };
    $('#bReplay').onclick = function () { speak(S.qs[S.qIdx], false); };
    $('#bVoice').onclick = function () {
      S.voiceOn = !S.voiceOn;
      this.textContent = S.voiceOn ? '🔇 كتم صوت المحاور' : '🔊 تشغيل صوت المحاور';
      if (!S.voiceOn) { S.speakToken++; stopSpeech(); S.speaking = false; S.freeze = false; S.qStart = performance.now(); setAvatarSpeaking(false); }
    };
    $('#bEnd').onclick = function () { if (confirm('هتنهي المقابلة دلوقتي؟')) finish(false); };
    S.voiceName = ($('#voice') || {}).value || S.voiceName;
    startSpeech(); startMic();
    if (!S.speechOK) $('#live').textContent = 'التفريغ الصوتي غير مدعوم في هذا المتصفح (استخدم Chrome)، ولن يتم تقييم المحتوى.';
    var ph = document.querySelector('.page-head'); if (ph) ph.classList.add('hidden');
    window.scrollTo(0, 0);
    S.timer = setInterval(uiTick, 250);
    showQuestion();
  }

  function showQuestion() {
    S.finalText = ''; S.tr = newTracker(); S.qStart = performance.now(); S.ending = false; S.awaySince = 0; S.awayFlag = false; S.active = true;
    $('#qn').textContent = 'السؤال ' + (S.qIdx + 1) + ' من ' + S.qs.length;
    $('#qtext').textContent = S.qs[S.qIdx];
    $('#pb').style.width = (S.qIdx / S.qs.length * 100) + '%';
    var P = PERSONAS[S.persona], last = S.qIdx === S.qs.length - 1;
    var intro = S.qIdx === 0 ? 'أهلًا بك يا ' + (IA.user ? IA.user.name : '') + '، أنا ' + P.name + ' وسأكون محاورتك اليوم. هيا نبدأ. ' : last ? 'هذا هو السؤال الأخير. ' : '';
    if (S.speechOK) $('#live').textContent = 'المحاور بيسأل... استنى لحد ما يخلّص';
    speak(intro + S.qs[S.qIdx], true, function () {
      S.qStart = performance.now();               // الوقت بيبدأ بعد ما المحاور يخلّص كلام
      if (S.speechOK) { var l = $('#live'); if (l) l.textContent = 'تحدّث الآن...'; }
    });
  }

  // التايمر وزرار "التالي" (بيتفتح بعد 60 ثانية، والسؤال بيتغيّر لوحده عند 90)
  function uiTick() {
    if (!S.active) return;
    if (S.freeze) S.qStart = performance.now();      // المحاور بيسأل: الوقت لسه ما بدأش
    var el = (performance.now() - S.qStart) / 1000, tot = (performance.now() - S.t0) / 1000;
    $('#qt').textContent = '⏱ ' + Math.max(0, Math.ceil(S.maxS - el)) + ' ث';
    $('#tot').textContent = 'الإجمالي ' + Math.floor(tot / 60) + ':' + String(Math.floor(tot % 60)).padStart(2, '0');
    var b = $('#bNext'), last = S.qIdx === S.qs.length - 1, txt = last ? 'إنهاء وعرض النتيجة' : 'السؤال التالي';
    b.disabled = el < S.minS; b.textContent = el < S.minS ? txt + ' (بعد ' + Math.ceil(S.minS - el) + ' ث)' : txt;
    if (el >= S.maxS) advance();
    if (Math.floor(el * 4) % 8 === 0) {              // تحديث مؤشر التوتر كل ثانيتين تقريبًا
      var m = snapshot(S.tr), words = S.finalText.trim() ? S.finalText.trim().split(/\s+/).length : 0;
      var nv = nervousness(m, { fillerRate: words ? countFillers(S.finalText) / words * 100 : 0, wpm: words && el > 10 ? words / (el / 60) : 0 });
      var c = $('#chipNerv');
      if (c && el > 8) { c.className = 'chip ' + (nv < 30 ? 'ok' : nv < 50 ? 'mid' : 'bad'); c.textContent = nv < 30 ? '🙂 هادئ' : nv < 50 ? '😐 متوتر قليلًا' : '😬 متوتر'; }
    }
  }

  // حفظ إجابة السؤال في الباك إند
  function collect() {
    var dur = (performance.now() - S.qStart) / 1000, text = S.finalText.trim();
    var m = snapshot(S.tr), words = text ? text.split(/\s+/).length : 0;
    m.nervousness = Math.round(nervousness(m, { fillerRate: words ? countFillers(text) / words * 100 : 0, wpm: words && dur > 0 ? words / (dur / 60) : 0 }));
    m.speech_ok = S.speechOK;
    S.pending.push(IA.api('/interviews/' + S.id + '/answer', 'POST',
      { idx: S.qIdx, transcript: text, duration: Math.round(dur), metrics: m }).catch(function () {}));
  }
  function advance() {
    if (!S.active || S.ending) return;
    S.ending = true; collect();
    if (S.qIdx + 1 < S.qs.length) { S.qIdx++; showQuestion(); } else finish(false, true);
  }

  // إنهاء المقابلة وطلب التقرير
  async function finish(terminated, collected) {
    if (S.finishing) return; S.finishing = true;
    if (S.active && !collected && !S.ending) collect();
    S.active = false; stop();
    root.innerHTML = '<div class="card center"><h2>⏳ جاري تحليل مقابلتك...</h2><p class="muted">ثواني ونطلعلك النتيجة.</p></div>';
    try {
      await Promise.all(S.pending);
      await IA.api('/interviews/' + S.id + '/finish', 'POST', { violations: S.viol, terminated: !!terminated });
      location.href = 'report.html?id=' + S.id;
    } catch (e) { root.innerHTML = '<div class="card"><div class="alert error">' + esc(e.message) + '</div></div>'; }
  }
  function stop() {
    S.active = false; S.listening = false;
    clearInterval(S.loop); clearInterval(S.timer);
    try { if (S.rec) S.rec.stop(); } catch (e) {}
    S.speakToken++; stopSpeech();
    clearInterval(S.micTimer);
    if (S.micStream) S.micStream.getTracks().forEach(function (t) { t.stop(); });
    try { if (S.ac) S.ac.close(); } catch (e) {}
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    if (onVis) document.removeEventListener('visibilitychange', onVis);
  }

  IA.ready.then(function (user) { if (user) setup(); });
})();