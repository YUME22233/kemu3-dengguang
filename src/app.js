/* ==========================================================================
   科目三 · 夜间灯光模拟考试 — 交互与考试流程
   ========================================================================== */
(function () {
  'use strict';

  var core = window.LightCore;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var SETTINGS_KEY = 's3lights.settings.v1';
  var DEFAULTS = {
    sceneCount: 4,
    timeLimit: 5,
    voice: true,
    sound: true,
    strict: false,
    hint: false,
    voiceURI: ''
  };

  /* ---------------------------------------------------------------- 状态 */

  var settings = loadSettings();
  var state = {
    view: 'home',
    light: core.initialState(),
    session: null,
    demoIndex: 0,
    demoTimer: 0,
    timerRaf: 0,
    pulseTimer: 0,
    toastTimer: 0,
    voices: [],
    zhVoices: [],
    voice: null,
    speechResolve: null,
    audio: null
  };

  var el = {};

  /* ---------------------------------------------------------------- 工具 */

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULTS);
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function setUse(button, id) {
    var use = button && button.querySelector('use');
    if (use) use.setAttribute('href', id);
  }

  /* ---------------------------------------------------------------- 音效 */

  function audioCtx() {
    if (!settings.sound) return null;
    if (!state.audio) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { state.audio = new Ctx(); } catch (e) { return null; }
    }
    if (state.audio.state === 'suspended') state.audio.resume().catch(function () {});
    return state.audio;
  }

  function tone(freq, dur, type, vol, delay) {
    var ctx = audioCtx();
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.04), t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  var sfx = {
    click: function () {
      tone(1350, 0.035, 'square', 0.016);
      tone(760, 0.045, 'triangle', 0.02, 0.012);
    },
    knob: function () {
      tone(320, 0.055, 'triangle', 0.028);
      tone(210, 0.06, 'sine', 0.024, 0.02);
    },
    ok: function () {
      tone(680, 0.13, 'sine', 0.035);
      tone(1020, 0.2, 'sine', 0.032, 0.09);
    },
    bad: function () {
      tone(190, 0.22, 'sawtooth', 0.022);
      tone(126, 0.3, 'sawtooth', 0.02, 0.11);
    }
  };

  /* ---------------------------------------------------------------- 语音 */

  function pickBestVoice(list) {
    if (!list.length) return null;
    var prefs = ['Xiaoxiao', 'Yunxi', 'Yunyang', 'Huihui', 'Tingting', 'Yaoyao', 'Kangkang', 'Natural', 'Chinese'];
    for (var i = 0; i < prefs.length; i++) {
      var hit = list.find(function (v) { return v.name.toLowerCase().indexOf(prefs[i].toLowerCase()) !== -1; });
      if (hit) return hit;
    }
    var local = list.find(function (v) { return v.localService; });
    return local || list[0];
  }

  function refreshVoices() {
    if (!('speechSynthesis' in window)) {
      state.zhVoices = [];
      state.voice = null;
      updateVoiceUI();
      return;
    }
    var all = [];
    try { all = window.speechSynthesis.getVoices() || []; } catch (e) { all = []; }
    state.zhVoices = all.filter(function (v) {
      return /^zh/i.test(v.lang) || /chinese|中文|xiaoxiao|huihui|yaoyao|tingting|yunxi|yunyang/i.test(v.name);
    });
    if (settings.voiceURI) {
      state.voice = state.zhVoices.find(function (v) { return v.voiceURI === settings.voiceURI; }) || pickBestVoice(state.zhVoices);
    } else {
      state.voice = pickBestVoice(state.zhVoices);
    }
    renderVoiceSelect();
    updateVoiceUI();
  }

  function renderVoiceSelect() {
    if (!el.voiceSelect) return;
    el.voiceSelect.innerHTML = '';
    if (!state.zhVoices.length) {
      var opt = document.createElement('option');
      opt.textContent = '未检测到中文语音';
      opt.value = '';
      el.voiceSelect.appendChild(opt);
      el.voiceSelect.disabled = true;
      return;
    }
    el.voiceSelect.disabled = false;
    state.zhVoices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = v.name + (v.localService ? '' : ' · 在线');
      if (state.voice && v.voiceURI === state.voice.voiceURI) o.selected = true;
      el.voiceSelect.appendChild(o);
    });
  }

  function updateVoiceUI() {
    if (!el.voicePill) return;
    var text = el.voicePillText;
    el.voicePill.classList.remove('is-ready', 'is-missing');
    if (!settings.voice) {
      text.textContent = '语音已关闭';
      return;
    }
    if (state.voice) {
      el.voicePill.classList.add('is-ready');
      text.textContent = shortVoiceName(state.voice.name);
    } else {
      el.voicePill.classList.add('is-missing');
      text.textContent = '无中文语音';
    }
  }

  function shortVoiceName(name) {
    var clean = String(name).replace(/^Microsoft\s+/i, '').replace(/\s*-\s*Chinese.*$/i, '').replace(/\s*\(.*\)$/, '');
    return clean.length > 14 ? clean.slice(0, 14) + '…' : clean;
  }

  function speak(text) {
    return new Promise(function (resolve) {
      if (!settings.voice || !state.voice || !('speechSynthesis' in window)) {
        setTimeout(resolve, 320);
        return;
      }
      var done = false;
      var timer = 0;
      var finish = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (state.speechResolve === finish) state.speechResolve = null;
        resolve();
      };
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.voice = state.voice;
        u.rate = 0.94;
        u.pitch = 1;
        u.volume = 1;
        u.onend = finish;
        u.onerror = finish;
        state.speechResolve = finish;
        timer = setTimeout(finish, Math.min(16000, 1800 + text.length * 230));
        window.speechSynthesis.speak(u);
      } catch (e) {
        finish();
      }
    });
  }

  function cancelSpeech() {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (state.speechResolve) {
      var fn = state.speechResolve;
      state.speechResolve = null;
      fn();
    }
  }

  /* ---------------------------------------------------------------- 灯光渲染 */

  function renderLights() {
    var s = state.light;
    el.scene.dataset.main = String(s.main);
    el.scene.dataset.beam = s.beam;
    el.scene.dataset.fog = s.fog ? '1' : '0';
    el.scene.dataset.hazard = s.hazard ? '1' : '0';

    var flags = {
      position: s.main >= 1,
      low: s.main === 2 && s.beam === 'low',
      high: s.main === 2 && s.beam === 'high',
      fog: s.fog,
      hazard: s.hazard
    };
    $$('.telltale', el.telltales).forEach(function (node) {
      node.classList.toggle('is-on', !!flags[node.dataset.t]);
    });

    el.stateCaption.innerHTML = '当前灯光 <b class="' + (s.main > 0 ? 'is-on' : '') + '">' + esc(core.stateText(s)) + '</b>';

    var angle = s.main === 0 ? -62 : s.main === 1 ? 0 : 62;
    el.knobFace.style.setProperty('--angle', angle + 'deg');
    el.knob.classList.toggle('is-on', s.main > 0);
    el.knob.setAttribute('aria-label', '旋转灯光总开关，当前为' + (s.main === 0 ? '关闭' : s.main === 1 ? '示宽灯' : '前照灯'));
    $$('.klabel').forEach(function (b) {
      b.classList.toggle('is-active', Number(b.dataset.main) === s.main);
    });

    el.lowBtn.classList.toggle('is-active', s.main === 2 && s.beam === 'low');
    el.highBtn.classList.toggle('is-active', s.main === 2 && s.beam === 'high');
    el.lowBtn.setAttribute('aria-disabled', String(s.main !== 2));
    el.highBtn.setAttribute('aria-disabled', String(s.main !== 2));
    el.flashBtn.setAttribute('aria-disabled', String(s.main !== 2));

    el.fogBtn.classList.toggle('is-on', s.fog);
    el.fogBtn.setAttribute('aria-pressed', String(s.fog));
    el.fogBtn.setAttribute('aria-disabled', String(s.main === 0));

    el.hazardBtn.classList.toggle('is-on', s.hazard);
    el.hazardBtn.setAttribute('aria-pressed', String(s.hazard));
  }

  function pulseBeam() {
    el.scene.classList.add('is-flashing');
    clearTimeout(state.pulseTimer);
    state.pulseTimer = setTimeout(function () { el.scene.classList.remove('is-flashing'); }, 190);
  }

  /* ---------------------------------------------------------------- 首页演示 */

  var DEMO_STATES = [
    { main: 2, beam: 'low' },
    { main: 2, beam: 'high' },
    { main: 1, hazard: true },
    { main: 2, beam: 'low', fog: true, hazard: true }
  ];

  function startDemo() {
    stopDemo();
    if (state.view !== 'home') return;
    state.demoIndex = 0;
    applyDemoState();
    state.demoTimer = setInterval(function () {
      state.demoIndex = (state.demoIndex + 1) % DEMO_STATES.length;
      applyDemoState();
    }, 3400);
  }

  function stopDemo() {
    if (state.demoTimer) clearInterval(state.demoTimer);
    state.demoTimer = 0;
  }

  function applyDemoState() {
    var d = DEMO_STATES[state.demoIndex];
    state.light = {
      main: d.main,
      beam: d.beam || 'low',
      fog: !!d.fog,
      hazard: !!d.hazard,
      flashes: 0
    };
    renderLights();
    el.stageBadge.hidden = false;
    el.stageBadge.innerHTML = '<i></i>夜间灯光演示';
  }

  /* ---------------------------------------------------------------- 视图切换 */

  function enterHome() {
    stopDemo();
    cancelSpeech();
    cancelAnimationFrame(state.timerRaf);
    if (state.session) clearTimeout(state.session.advanceTimer);
    state.session = null;
    state.view = 'home';
    document.body.dataset.view = 'home';
    el.homePanel.hidden = false;
    el.examPanel.hidden = true;
    el.hud.hidden = true;
    el.exitBtn.hidden = true;
    el.resultOverlay.hidden = true;
    el.bankOverlay.hidden = true;
    el.confirmOverlay.hidden = true;
    hideFeedback();
    el.footStatus.textContent = '按真实考试流程判分 · 灯光操作错误即不合格';
    startDemo();
  }

  function startExam(explicitQuestions) {
    stopDemo();
    cancelSpeech();
    cancelAnimationFrame(state.timerRaf);
    if (state.session) clearTimeout(state.session.advanceTimer);
    hideFeedback();

    state.view = 'exam';
    document.body.dataset.view = 'exam';
    el.homePanel.hidden = true;
    el.examPanel.hidden = false;
    el.hud.hidden = false;
    el.exitBtn.hidden = false;
    el.resultOverlay.hidden = true;
    el.stageBadge.hidden = true;
    el.consoleText.textContent = '提示：听到指令后再操作，倒计时结束前完成';

    state.light = core.initialState();
    renderLights();

    var questions = explicitQuestions || core.createExam({ sceneCount: settings.sceneCount });
    state.session = {
      questions: questions,
      index: -1,
      results: [],
      phase: 'idle',
      qToken: 0,
      startedAt: performance.now(),
      qStart: 0,
      deadline: 0,
      advanceTimer: 0
    };

    el.examMetaCount.textContent = questions.length + ' 项';
    el.examMetaTime.textContent = settings.timeLimit + ' 秒';
    buildProgress(questions.length);
    setPhase('准备中', '');
    nextQuestion();
  }

  /* ---------------------------------------------------------------- 考试流程 */

  function currentQuestion() {
    var sess = state.session;
    return sess ? sess.questions[sess.index] : null;
  }

  function nextQuestion() {
    var sess = state.session;
    if (!sess) return;
    if (sess.index + 1 >= sess.questions.length) {
      finishExam();
      return;
    }
    sess.index += 1;
    sess.qToken += 1;
    var token = sess.qToken;
    var q = sess.questions[sess.index];

    sess.phase = 'speaking';
    sess.qStart = 0;
    sess.deadline = 0;
    state.light = Object.assign({}, state.light, { flashes: 0 });
    renderLights();

    hideFeedback();
    el.instrText.textContent = q.text;
    el.instrKicker.classList.add('is-speaking');
    $('span', el.instrKicker).textContent = '语音播报';
    el.instrSub.textContent = '正在播报，请听清指令…';
    el.skipBtn.hidden = false;
    el.timer.hidden = false;
    el.timer.classList.add('is-speaking');
    el.timer.classList.remove('is-urgent');
    el.timerCircle.style.strokeDashoffset = '0';
    el.timerNum.textContent = String(settings.timeLimit);
    setPhase('语音播报', '');
    setProgress();
    el.consoleText.textContent = '提示：听到指令后再操作，倒计时结束前完成';

    var intro = sess.index === 0
      ? '下面将进行夜间灯光模拟考试，请按语音指令在五秒内完成操作。'
      : '';
    runSpeech(intro + q.text, token);
  }

  function runSpeech(text, token) {
    if (!settings.voice || !state.voice) {
      wait(480).then(function () {
        if (isCurrentQuestion(token) && state.session.phase === 'speaking') beginAnswering();
      });
      return;
    }
    speak(text).then(function () {
      if (isCurrentQuestion(token) && state.session.phase === 'speaking') beginAnswering();
    });
  }

  function isCurrentQuestion(token) {
    return !!state.session && state.session.qToken === token;
  }

  function beginAnswering() {
    var sess = state.session;
    if (!sess || sess.phase !== 'speaking') return;
    sess.phase = 'answering';
    sess.qStart = performance.now();
    sess.deadline = sess.qStart + settings.timeLimit * 1000;

    el.skipBtn.hidden = true;
    el.timer.classList.remove('is-speaking', 'is-urgent');
    el.instrKicker.classList.remove('is-speaking');
    $('span', el.instrKicker).textContent = '语音指令';
    var q = currentQuestion();
    if (settings.hint) {
      el.instrSub.innerHTML = '参考操作：<b>' + esc(q.op) + '</b> · 限时 ' + settings.timeLimit + ' 秒';
    } else {
      el.instrSub.innerHTML = '请在 <b>' + settings.timeLimit + '</b> 秒内完成灯光操作';
    }
    setPhase('计时中', 'is-live');
    el.timerNum.textContent = settings.timeLimit.toFixed(1);
    tickTimer();

    var token = sess.qToken;
    setTimeout(function () {
      var s = state.session;
      if (!s || s.qToken !== token || s.phase !== 'answering') return;
      if (core.judge(currentQuestion(), state.light).pass) {
        completeQuestion(true);
      }
    }, 360);
  }

  function tickTimer() {
    cancelAnimationFrame(state.timerRaf);
    var loop = function () {
      var sess = state.session;
      if (!sess || sess.phase !== 'answering') return;
      var total = settings.timeLimit * 1000;
      var left = Math.max(0, sess.deadline - performance.now());
      var frac = total > 0 ? left / total : 0;
      el.timerCircle.style.strokeDashoffset = String(257.6 * (1 - frac));
      el.timerNum.textContent = (left / 1000).toFixed(1);
      el.phaseChip.textContent = '计时中 ' + (left / 1000).toFixed(1) + 's';
      el.timer.classList.toggle('is-urgent', left <= 2000);
      if (left <= 0) {
        completeQuestion(false, '超时未完成操作', true);
        return;
      }
      state.timerRaf = requestAnimationFrame(loop);
    };
    state.timerRaf = requestAnimationFrame(loop);
  }

  function completeQuestion(pass, reason, timeout) {
    var sess = state.session;
    if (!sess || sess.phase !== 'answering') return;
    sess.phase = 'feedback';
    cancelAnimationFrame(state.timerRaf);
    var q = currentQuestion();
    var judged = core.judge(q, state.light);
    var elapsed = timeout ? settings.timeLimit : Math.max(0.1, (performance.now() - sess.qStart) / 1000);
    var ok = !!pass;

    sess.results.push({
      q: q,
      pass: ok,
      elapsed: elapsed,
      stateText: core.stateText(state.light),
      reason: ok ? '' : (reason || judged.reason || '操作不符合要求'),
      timeout: !!timeout
    });

    if (timeout) el.timerNum.textContent = '0.0';
    el.timer.classList.remove('is-urgent');
    el.skipBtn.hidden = true;
    markDot(sess.index, ok);
    setPhase(ok ? '正确' : '错误', ok ? 'is-live' : 'is-bad');

    if (ok) {
      sfx.ok();
    } else {
      sfx.bad();
    }

    if (ok) {
      showFeedback('ok', '操作正确', q.op);
      el.consoleText.textContent = '刚刚：' + q.op;
    } else if (settings.strict) {
      showFeedback('neutral', '已记录', '结果将在考试结束后统一公布');
      el.consoleText.textContent = '刚刚：操作已记录';
    } else {
      showFeedback('bad', timeout ? '超时未完成' : '操作错误', '正确操作：' + q.op);
      el.consoleText.textContent = '正确操作：' + q.op;
    }

    var delay = ok ? 1050 : settings.strict ? 850 : 1900;
    clearTimeout(sess.advanceTimer);
    sess.advanceTimer = setTimeout(function () {
      if (state.session === sess) nextQuestion();
    }, delay);
  }

  function finishExam() {
    var sess = state.session;
    if (!sess) return;
    sess.phase = 'done';
    cancelAnimationFrame(state.timerRaf);
    cancelSpeech();
    hideFeedback();
    setPhase('已结束', '');

    var stats = core.score(sess.results);
    var duration = performance.now() - sess.startedAt;
    renderResult(sess, stats, duration);
    el.resultOverlay.hidden = false;
    el.hud.hidden = true;
    el.footStatus.textContent = '考试结束 · ' + (stats.passed ? '合格' : '不合格');

    if (settings.voice && state.voice) {
      speak(stats.passed ? '考试结束，全部操作正确，考试合格。' : '考试结束，考试不合格，请再练习一次。');
    }
  }

  function setPhase(text, cls) {
    el.phaseChip.textContent = text;
    el.phaseChip.className = 'phase-chip' + (cls ? ' ' + cls : '');
  }

  function buildProgress(count) {
    el.progressDots.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var d = document.createElement('span');
      d.className = 'dot';
      el.progressDots.appendChild(d);
    }
  }

  function setProgress() {
    var sess = state.session;
    if (!sess) return;
    var dots = $$('.dot', el.progressDots);
    dots.forEach(function (d, i) { d.classList.toggle('is-now', i === sess.index); });
    el.progressText.textContent = '第 ' + (sess.index + 1) + ' / ' + sess.questions.length + ' 项';
    el.footStatus.textContent = '第 ' + (sess.index + 1) + ' / ' + sess.questions.length + ' 项 · 每题限时 ' + settings.timeLimit + ' 秒';
  }

  function markDot(index, ok) {
    var dots = $$('.dot', el.progressDots);
    var d = dots[index];
    if (!d) return;
    d.classList.remove('is-now');
    d.classList.add(ok ? 'is-done' : 'is-bad');
  }

  /* ---------------------------------------------------------------- 反馈 */

  function showFeedback(kind, title, sub) {
    el.feedback.dataset.kind = kind;
    var icon = kind === 'ok' ? '#i-check' : kind === 'bad' ? '#i-x' : '#i-clock';
    setUse(el.feedback.querySelector('.fb-icon'), icon);
    el.feedback.querySelector('.fb-text strong').textContent = title;
    el.feedback.querySelector('.fb-text span').textContent = sub;
    el.feedback.classList.add('is-show');
  }

  function hideFeedback() {
    el.feedback.classList.remove('is-show');
  }

  function toast(msg, warn) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('is-warn', !!warn);
    el.toast.classList.add('is-show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.toast.classList.remove('is-show'); }, 2200);
  }

  /* ---------------------------------------------------------------- 操作 */

  function canOperate() {
    if (!state.session) return false;
    if (state.session.phase === 'answering') return true;
    if (state.session.phase === 'speaking') {
      toast('请等语音播报结束后再操作');
      return false;
    }
    return false;
  }

  function setLight(next, label, sound) {
    if (!next) return;
    var prev = state.light;
    if (prev.main === next.main && prev.beam === next.beam && prev.fog === next.fog && prev.hazard === next.hazard) return;
    state.light = next;
    renderLights();
    if (sound !== false) sfx.click();
    if (label) el.consoleText.textContent = '刚刚：' + label;
    afterAction();
  }

  function actMain(value) {
    if (!canOperate()) return;
    var next = core.setMain(state.light, value);
    if (next.main === state.light.main) return;
    sfx.knob();
    setLight(next, value === 0 ? '关闭灯光' : value === 1 ? '开启示宽灯' : '开启前照灯', false);
  }

  function actBeam(beam) {
    if (!canOperate()) return;
    if (state.light.main !== 2) {
      toast('请先开启前照灯');
      return;
    }
    var next = core.setBeam(state.light, beam);
    if (next.beam === state.light.beam) return;
    setLight(next, beam === 'high' ? '切换远光灯' : '切换近光灯');
  }

  function actFlash() {
    if (!canOperate()) return;
    if (state.light.main !== 2) {
      toast('请先开启前照灯');
      return;
    }
    state.light = core.flash(state.light);
    renderLights();
    pulseBeam();
    sfx.click();
    el.consoleText.textContent = '刚刚：交替远近光（' + state.light.flashes + ' 次）';
    afterAction();
  }

  function actFog() {
    if (!canOperate()) return;
    if (state.light.main === 0) {
      toast('请先开启示宽灯或前照灯');
      return;
    }
    var next = core.toggleFog(state.light);
    setLight(next, next.fog ? '开启雾灯' : '关闭雾灯');
  }

  function actHazard() {
    if (!canOperate()) return;
    var next = core.toggleHazard(state.light);
    setLight(next, next.hazard ? '开启危险报警闪光灯' : '关闭危险报警闪光灯');
  }

  function afterAction() {
    var sess = state.session;
    if (!sess || sess.phase !== 'answering') return;
    var q = currentQuestion();
    if (!q) return;
    if (core.judge(q, state.light).pass) completeQuestion(true);
  }

  /* ---------------------------------------------------------------- 成绩 */

  function renderResult(sess, stats, duration) {
    el.scoreRing.style.setProperty('--pct', String(stats.points));
    el.scoreRing.style.setProperty('--ring', stats.passed ? 'var(--green)' : 'var(--red)');
    el.scoreNum.textContent = String(stats.points);

    el.verdict.textContent = stats.passed ? '合格' : '不合格';
    el.verdict.classList.toggle('is-bad', !stats.passed);
    el.resultTitle.textContent = stats.passed ? '灯光考试通过' : '灯光考试未通过';
    el.resultSub.textContent = stats.passed
      ? '全部 ' + stats.total + ' 项操作正确，可以上车考试了。'
      : '有 ' + stats.wrong + ' 项操作错误。真实考试中任何一项错误都会判定不合格。';

    el.statCorrect.textContent = stats.correct + ' / ' + stats.total;
    el.statTime.textContent = stats.avgTime.toFixed(1) + ' s';
    el.statTotal.textContent = formatClock(duration);

    el.reviewList.innerHTML = sess.results.map(function (r, i) {
      var ok = r.pass;
      return '<div class="review-row ' + (ok ? '' : 'is-bad') + '">' +
        '<div class="rv-num">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="rv-main">' +
          '<p>' + esc(r.q.text) + '</p>' +
          '<div class="rv-meta">你的操作：<b>' + esc(r.stateText) + '</b>' +
            (ok ? '' : '　正确操作：<b>' + esc(r.q.op) + '</b>') +
          '</div>' +
          (ok ? '' : '<div class="rv-tip">' + esc(r.q.tip) + '</div>') +
        '</div>' +
        (r.elapsed ? '<div class="rv-time">' + r.elapsed.toFixed(1) + 's</div>' : '') +
        '<div class="rv-tag"><svg><use href="' + (ok ? '#i-check' : '#i-x') + '"/></svg></div>' +
      '</div>';
    }).join('');

    var wrong = getWrongQuestions(sess.results);
    el.wrongBtn.disabled = wrong.length === 0;
    el.wrongBtn.title = wrong.length ? '' : '本次全部正确，没有错题';
  }

  function getWrongQuestions(results) {
    var seen = {};
    var out = [];
    results.forEach(function (r) {
      if (r.pass) return;
      if (seen[r.q.id]) return;
      seen[r.q.id] = true;
      out.push(r.q);
    });
    return out;
  }

  function closeResult() {
    el.resultOverlay.hidden = true;
    enterHome();
  }

  function practiceWrong() {
    if (!state.session) return;
    var wrong = getWrongQuestions(state.session.results);
    if (!wrong.length) return;
    var hasHeadlamp = wrong.some(function (q) { return q.id === 'headlamp'; });
    var questions = hasHeadlamp ? wrong.slice() : [core.HEADLAMP].concat(wrong);
    el.resultOverlay.hidden = true;
    startExam(questions);
  }

  /* ---------------------------------------------------------------- 题库 */

  function buildBank() {
    var all = [core.HEADLAMP].concat(core.SCENES);
    el.bankList.innerHTML = all.map(function (q, i) {
      return '<article class="bank-item">' +
        '<div class="bi-num">' + String(i + 1).padStart(2, '0') + '</div>' +
        '<div class="bi-body">' +
          '<h4>' + esc(q.text) + '</h4>' +
          '<p class="bi-op"><b>正确操作：</b>' + esc(q.op) + '</p>' +
          '<p class="bi-tip">' + esc(q.tip) + '</p>' +
        '</div>' +
        '<button class="bi-speak" type="button" data-text="' + esc(q.text) + '" title="试听语音">' +
          '<svg><use href="#i-speaker"/></svg>' +
        '</button>' +
      '</article>';
    }).join('');
  }

  function openBank(tab) {
    if (state.session && state.session.phase !== 'done' && state.view === 'exam') {
      toast('考试进行中，暂时无法查看题库');
      return;
    }
    el.bankOverlay.hidden = false;
    switchTab(tab || 'bank');
  }

  function switchTab(name) {
    $$('.tab').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    el.bankPane.hidden = name !== 'bank';
    el.rulesPane.hidden = name !== 'rules';
  }

  /* ---------------------------------------------------------------- 设置 */

  function syncSettingsUI() {
    $$('[data-setting]').forEach(function (group) {
      var key = group.dataset.setting;
      $$('button', group).forEach(function (b) {
        b.classList.toggle('is-active', Number(b.dataset.value) === Number(settings[key]));
      });
    });
    el.voiceToggle.checked = !!settings.voice;
    el.soundToggle.checked = !!settings.sound;
    el.strictToggle.checked = !!settings.strict;
    el.hintToggle.checked = !!settings.hint;
    el.soundBtn.setAttribute('aria-pressed', String(!!settings.sound));
    setUse(el.soundBtn, settings.sound ? '#i-volume' : '#i-mute');
    el.soundBtn.classList.toggle('is-off', !settings.sound);
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    syncSettingsUI();
    if (key === 'voice') updateVoiceUI();
  }

  /* ---------------------------------------------------------------- 初始化图形 */

  function buildStars() {
    var seed = 20261107;
    var rnd = function () {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 86; i++) {
      var c = document.createElementNS(SVG_NS, 'circle');
      var x = rnd() * 1000;
      var y = rnd() * 430;
      var r = 0.5 + rnd() * 1.5;
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
      c.setAttribute('r', r.toFixed(2));
      c.setAttribute('opacity', (0.25 + rnd() * 0.6).toFixed(2));
      c.style.animationDelay = (rnd() * 4.5).toFixed(2) + 's';
      frag.appendChild(c);
    }
    el.stars.appendChild(frag);
  }

  function buildCityWindows() {
    var seed = 7719;
    var rnd = function () {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    var frag = document.createDocumentFragment();
    var colors = ['#ffcf7a', '#ffdda6', '#8fd7ff', '#ffe9c2'];
    for (var i = 0; i < 110; i++) {
      var x = rnd() * 520;
      var y = 452 + rnd() * 56;
      var r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x.toFixed(1));
      r.setAttribute('y', y.toFixed(1));
      r.setAttribute('width', (1.4 + rnd() * 2.4).toFixed(1));
      r.setAttribute('height', (1.6 + rnd() * 2.6).toFixed(1));
      r.setAttribute('fill', colors[Math.floor(rnd() * colors.length)]);
      r.setAttribute('opacity', (0.15 + rnd() * 0.5).toFixed(2));
      frag.appendChild(r);
    }
    el.cityWindows.appendChild(frag);
  }

  function buildKnobTicks() {
    var frag = document.createDocumentFragment();
    for (var deg = -75; deg <= 75; deg += 15) {
      var s = document.createElement('span');
      s.style.transform = 'rotate(' + deg + 'deg) translateY(-82px)';
      if (deg === -60 || deg === 0 || deg === 60) s.className = 'is-major';
      frag.appendChild(s);
    }
    el.knobTicks.appendChild(frag);
  }

  /* ---------------------------------------------------------------- 事件绑定 */

  function cacheDom() {
    el.scene = $('#scene');
    el.stage = $('#stage');
    el.homePanel = $('#homePanel');
    el.examPanel = $('#examPanel');
    el.hud = $('#hud');
    el.stageBadge = $('#stageBadge');
    el.voicePill = $('#voicePill');
    el.voicePillText = $('#voicePillText');
    el.bankBtn = $('#bankBtn');
    el.helpBtn = $('#helpBtn');
    el.soundBtn = $('#soundBtn');
    el.fullBtn = $('#fullBtn');
    el.exitBtn = $('#exitBtn');
    el.startBtn = $('#startBtn');
    el.bankBtn2 = $('#bankBtn2');
    el.knob = $('#knob');
    el.knobFace = $('#knobFace');
    el.knobTicks = $('#knobTicks');
    el.lowBtn = $('#lowBtn');
    el.highBtn = $('#highBtn');
    el.flashBtn = $('#flashBtn');
    el.fogBtn = $('#fogBtn');
    el.hazardBtn = $('#hazardBtn');
    el.phaseChip = $('#phaseChip');
    el.consoleText = $('#consoleTip span');
    el.examMetaCount = $('#examMetaCount');
    el.examMetaTime = $('#examMetaTime');
    el.progressDots = $('#progressDots');
    el.progressText = $('#progressText');
    el.skipBtn = $('#skipBtn');
    el.instrText = $('#instrText');
    el.instrSub = $('#instrSub');
    el.instrKicker = $('#instrKicker');
    el.timer = $('#timer');
    el.timerCircle = $('#timerCircle');
    el.timerNum = $('#timerNum');
    el.telltales = $('#telltales');
    el.stateCaption = $('#stateCaption');
    el.feedback = $('#feedback');
    el.resultOverlay = $('#resultOverlay');
    el.resultClose = $('#resultClose');
    el.scoreRing = $('#scoreRing');
    el.scoreNum = $('#scoreNum');
    el.verdict = $('#verdict');
    el.resultTitle = $('#resultTitle');
    el.resultSub = $('#resultSub');
    el.statCorrect = $('#statCorrect');
    el.statTime = $('#statTime');
    el.statTotal = $('#statTotal');
    el.reviewList = $('#reviewList');
    el.againBtn = $('#againBtn');
    el.wrongBtn = $('#wrongBtn');
    el.homeBtn = $('#homeBtn');
    el.bankOverlay = $('#bankOverlay');
    el.bankClose = $('#bankClose');
    el.bankList = $('#bankList');
    el.bankPane = $('#bankPane');
    el.rulesPane = $('#rulesPane');
    el.confirmOverlay = $('#confirmOverlay');
    el.confirmCancel = $('#confirmCancel');
    el.confirmExit = $('#confirmExit');
    el.toast = $('#toast');
    el.footStatus = $('#footStatus');
    el.voiceToggle = $('#voiceToggle');
    el.soundToggle = $('#soundToggle');
    el.strictToggle = $('#strictToggle');
    el.hintToggle = $('#hintToggle');
    el.voiceSelect = $('#voiceSelect');
    el.stars = $('#stars');
    el.cityWindows = $('#cityWindows');
  }

  function bindEvents() {
    el.startBtn.addEventListener('click', function () { startExam(); });
    el.bankBtn.addEventListener('click', function () { openBank('bank'); });
    el.bankBtn2.addEventListener('click', function () { openBank('bank'); });
    el.helpBtn.addEventListener('click', function () { openBank('rules'); });
    el.bankClose.addEventListener('click', function () { el.bankOverlay.hidden = true; });
    el.bankOverlay.addEventListener('click', function (e) {
      if (e.target === el.bankOverlay) el.bankOverlay.hidden = true;
    });

    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });

    el.bankList.addEventListener('click', function (e) {
      var btn = e.target.closest('.bi-speak');
      if (!btn) return;
      if (!state.voice) { toast('未检测到中文语音', true); return; }
      cancelSpeech();
      speak(btn.dataset.text);
    });

    el.exitBtn.addEventListener('click', function () {
      cancelSpeech();
      el.confirmOverlay.hidden = false;
    });
    el.confirmCancel.addEventListener('click', function () {
      el.confirmOverlay.hidden = true;
    });
    el.confirmExit.addEventListener('click', function () {
      el.confirmOverlay.hidden = true;
      enterHome();
    });
    el.confirmOverlay.addEventListener('click', function (e) {
      if (e.target === el.confirmOverlay) el.confirmOverlay.hidden = true;
    });

    el.resultClose.addEventListener('click', closeResult);
    el.homeBtn.addEventListener('click', closeResult);
    el.againBtn.addEventListener('click', function () {
      el.resultOverlay.hidden = true;
      startExam();
    });
    el.wrongBtn.addEventListener('click', practiceWrong);
    el.resultOverlay.addEventListener('click', function (e) {
      if (e.target === el.resultOverlay) closeResult();
    });

    el.skipBtn.addEventListener('click', function () {
      var sess = state.session;
      if (!sess || sess.phase !== 'speaking') return;
      sess.qToken += 1;
      cancelSpeech();
      beginAnswering();
    });

    el.knob.addEventListener('click', function () {
      if (!canOperate()) return;
      var next = state.light.main >= 2 ? 0 : state.light.main + 1;
      actMain(next);
    });
    $$('.klabel').forEach(function (b) {
      b.addEventListener('click', function () { actMain(Number(b.dataset.main)); });
    });
    el.lowBtn.addEventListener('click', function () { actBeam('low'); });
    el.highBtn.addEventListener('click', function () { actBeam('high'); });
    el.flashBtn.addEventListener('click', actFlash);
    el.fogBtn.addEventListener('click', actFog);
    el.hazardBtn.addEventListener('click', actHazard);

    $$('[data-setting]').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-value]');
        if (!btn) return;
        var key = group.dataset.setting;
        updateSetting(key, Number(btn.dataset.value));
        if (state.view === 'home') {
          el.footStatus.textContent = '设置已保存 · 每题限时 ' + settings.timeLimit + ' 秒';
        }
      });
    });

    el.voiceToggle.addEventListener('change', function () {
      updateSetting('voice', el.voiceToggle.checked);
      if (settings.voice && state.voice) speak('语音播报已开启');
    });
    el.soundToggle.addEventListener('change', function () {
      updateSetting('sound', el.soundToggle.checked);
      if (settings.sound) sfx.click();
    });
    el.strictToggle.addEventListener('change', function () { updateSetting('strict', el.strictToggle.checked); });
    el.hintToggle.addEventListener('change', function () { updateSetting('hint', el.hintToggle.checked); });

    el.voiceSelect.addEventListener('change', function () {
      settings.voiceURI = el.voiceSelect.value;
      saveSettings();
      state.voice = state.zhVoices.find(function (v) { return v.voiceURI === settings.voiceURI; }) || state.voice;
      updateVoiceUI();
      sfx.click();
      if (state.voice) speak('已切换语音');
    });

    el.voicePill.addEventListener('click', function () {
      if (state.session && state.session.phase !== 'done') {
        toast('考试中请专注听语音指令');
        return;
      }
      if (!settings.voice) { toast('语音播报已关闭，可在首页设置中开启', true); return; }
      if (!state.voice) { toast('未检测到中文语音，将只显示文字指令', true); return; }
      cancelSpeech();
      speak('夜间灯光模拟考试，请开启前照灯。');
    });

    el.soundBtn.addEventListener('click', function () {
      updateSetting('sound', !settings.sound);
      if (settings.sound) sfx.click();
      toast(settings.sound ? '操作音效已开启' : '操作音效已关闭');
    });

    el.fullBtn.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function () {
          toast('当前浏览器不支持全屏', true);
        });
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
    });

    document.addEventListener('keydown', onKeydown);

    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }

    window.addEventListener('beforeunload', function () {
      cancelSpeech();
    });
  }

  function onKeydown(e) {
    var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if (e.key === 'Escape') {
      if (!el.confirmOverlay.hidden) { el.confirmOverlay.hidden = true; return; }
      if (!el.bankOverlay.hidden) { el.bankOverlay.hidden = true; return; }
      if (!el.resultOverlay.hidden) { closeResult(); return; }
      if (state.view === 'exam' && state.session) {
        cancelSpeech();
        el.confirmOverlay.hidden = false;
      }
      return;
    }

    if (!el.resultOverlay.hidden) {
      if (e.key === 'Enter') { el.againBtn.click(); }
      return;
    }
    if (!el.bankOverlay.hidden || !el.confirmOverlay.hidden) return;

    if (e.key === 'Enter') {
      if (state.view === 'home') startExam();
      return;
    }
    if (state.view !== 'exam' || !state.session) return;

    if (e.code === 'Space') {
      e.preventDefault();
      actFlash();
      return;
    }

    var key = e.key.toLowerCase();
    if (key === '0' || key === '1' || key === '2') {
      e.preventDefault();
      actMain(Number(key));
      return;
    }
    if (key === 'q') { e.preventDefault(); actBeam('low'); return; }
    if (key === 'w') { e.preventDefault(); actBeam('high'); return; }
    if (key === 'e') { e.preventDefault(); actFlash(); return; }
    if (key === 'f') { e.preventDefault(); actFog(); return; }
    if (key === 'h') { e.preventDefault(); actHazard(); }
  }

  /* ---------------------------------------------------------------- 启动 */

  function init() {
    cacheDom();
    buildStars();
    buildCityWindows();
    buildKnobTicks();
    buildBank();
    syncSettingsUI();
    bindEvents();

    state.light = core.initialState();
    renderLights();
    state.view = 'home';
    startDemo();
    refreshVoices();
    setTimeout(refreshVoices, 400);
    setTimeout(refreshVoices, 1400);

    // 便于自动化测试与调试
    window.__lights = {
      core: core,
      app: {
        state: state,
        settings: settings,
        startExam: startExam,
        enterHome: enterHome,
        actMain: actMain,
        actBeam: actBeam,
        actFlash: actFlash,
        actFog: actFog,
        actHazard: actHazard,
        finishExam: finishExam,
        beginAnswering: beginAnswering,
        skipSpeech: function () { el.skipBtn.click(); },
        renderLights: renderLights
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
