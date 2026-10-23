/* ------------------------------------------------------------------ *
 * 计时器 Timer
 * 秒表 / 倒计时 / 番茄钟 —— 纯前端，无依赖
 * ------------------------------------------------------------------ */
(() => {
  'use strict';

  /* ── 基础工具 ─────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'timer-app-v1';
  const RING_R = 148;
  const CIRCUMFERENCE = 2 * Math.PI * RING_R;

  const pad = (n, len = 2) => String(n).padStart(len, '0');

  function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function fmtStopwatch(ms) {
    const v = Math.max(0, ms);
    const cs = Math.floor(v / 10) % 100;
    const totalSec = Math.floor(v / 1000);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return h > 0
      ? `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`
      : `${pad(m)}:${pad(s)}.${pad(cs)}`;
  }

  function fmtCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return h > 0
      ? `${pad(h)}:${pad(m)}:${pad(s)}`
      : `${pad(m)}:${pad(s)}`;
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  /* ── 元素 ─────────────────────────────────────────────────── */
  const els = {
    swTime: $('swTime'),
    swStart: $('swStart'),
    swLap: $('swLap'),
    swReset: $('swReset'),
    lapsWrap: $('lapsWrap'),
    lapList: $('lapList'),

    cdTime: $('cdTime'),
    cdStatus: $('cdStatus'),
    cdRing: $('cdRing'),
    cdPresets: $('cdPresets'),
    cdH: $('cdH'),
    cdM: $('cdM'),
    cdS: $('cdS'),
    cdApply: $('cdApply'),
    cdStart: $('cdStart'),
    cdReset: $('cdReset'),

    pmPhase: $('pmPhase'),
    pmTime: $('pmTime'),
    pmStatus: $('pmStatus'),
    pmRing: $('pmRing'),
    pmWork: $('pmWork'),
    pmShort: $('pmShort'),
    pmLong: $('pmLong'),
    pmAuto: $('pmAuto'),
    pmStart: $('pmStart'),
    pmSkip: $('pmSkip'),
    pmReset: $('pmReset'),

    soundBtn: $('soundBtn'),
    notifyBtn: $('notifyBtn'),
    toast: $('toast'),
  };

  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.panel'));

  /* ── 状态 ─────────────────────────────────────────────────── */
  const state = { mode: 'stopwatch' };
  const settings = { sound: true, notify: false };

  const sw = {
    running: false,
    accumulated: 0,   // 已累计毫秒
    startedAt: 0,     // 本轮开始的绝对时间戳
    laps: [],         // { total, split }
  };

  const cd = {
    total: 25 * 60000,
    remaining: 25 * 60000,
    running: false,
    endAt: 0,
    finished: false,
  };

  const PHASE_LABEL = { work: '专注', short: '短休息', long: '长休息' };

  const pomo = {
    phase: 'work',
    round: 1,
    completed: 0,
    durations: { work: 25, short: 5, long: 15 },
    total: 25 * 60000,
    remaining: 25 * 60000,
    running: false,
    endAt: 0,
    autoNext: true,
  };

  let lapsDirty = true;
  let audioCtx = null;
  let rafId = 0;
  let checkerId = 0;
  let persistTimer = 0;
  let toastTimer = 0;

  /* ── 声音 ─────────────────────────────────────────────────── */
  function unlockAudio() {
    if (!settings.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* 忽略 */ }
  }

  function beep(count = 3) {
    if (!settings.sound) return;
    unlockAudio();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      for (let i = 0; i < count; i++) {
        const t = now + i * 0.42;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.exponentialRampToValueAtTime(1240, t + 0.14);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      }
    } catch (_) { /* 忽略 */ }
  }

  /* ── 通知 / Toast ─────────────────────────────────────────── */
  function notify(title, body) {
    if (!settings.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, { body, tag: 'timer-app', silent: true });
    } catch (_) { /* 忽略 */ }
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function syncSoundButton() {
    els.soundBtn.setAttribute('aria-pressed', String(settings.sound));
    els.soundBtn.textContent = settings.sound ? '🔊' : '🔇';
    els.soundBtn.title = settings.sound ? '提示音：开' : '提示音：关';
  }

  function syncNotifyButton() {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    const on = settings.notify && granted;
    els.notifyBtn.setAttribute('aria-pressed', String(on));
    els.notifyBtn.textContent = on ? '🔔' : '🔕';
    els.notifyBtn.title = on ? '桌面通知：开' : '桌面通知：关';
  }

  async function toggleNotifications() {
    if (!('Notification' in window)) {
      toast('当前浏览器不支持桌面通知');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('通知权限已被拒绝，请在浏览器设置中开启');
      return;
    }
    if (Notification.permission === 'default') {
      try {
        const perm = await Notification.requestPermission();
        settings.notify = perm === 'granted';
        toast(perm === 'granted' ? '已开启桌面通知' : '未获得通知权限');
      } catch (_) {
        settings.notify = false;
      }
    } else {
      settings.notify = !settings.notify;
      toast(settings.notify ? '已开启桌面通知' : '已关闭桌面通知');
    }
    syncNotifyButton();
    persist();
  }

  /* ── 秒表 ─────────────────────────────────────────────────── */
  function swElapsed() {
    return sw.accumulated + (sw.running ? Date.now() - sw.startedAt : 0);
  }

  function toggleStopwatch() {
    if (sw.running) {
      sw.accumulated = swElapsed();
      sw.running = false;
      sw.startedAt = 0;
    } else {
      sw.startedAt = Date.now();
      sw.running = true;
      unlockAudio();
    }
    render();
    persist();
    kick();
  }

  function resetStopwatch() {
    sw.running = false;
    sw.accumulated = 0;
    sw.startedAt = 0;
    sw.laps = [];
    lapsDirty = true;
    render();
    persist();
  }

  function addLap() {
    if (!sw.running) return;
    const total = swElapsed();
    const prev = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
    sw.laps.push({ total, split: total - prev });
    lapsDirty = true;
    render();
    persist();
  }

  function renderLaps() {
    els.lapList.textContent = '';
    els.lapsWrap.hidden = sw.laps.length === 0;
    if (!sw.laps.length) return;

    let fastest = null;
    let slowest = null;
    if (sw.laps.length >= 2) {
      let min = Infinity;
      let max = -Infinity;
      for (const lap of sw.laps) {
        if (lap.split < min) { min = lap.split; fastest = lap; }
        if (lap.split > max) { max = lap.split; slowest = lap; }
      }
      if (fastest === slowest) fastest = slowest = null;
    }

    sw.laps.forEach((lap, i) => {
      const li = document.createElement('li');
      li.className = 'lap-row';
      if (lap === fastest) li.classList.add('fastest');
      if (lap === slowest) li.classList.add('slowest');

      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(i + 1);

      const split = document.createElement('span');
      split.className = 'split';
      split.textContent = fmtStopwatch(lap.split);

      const total = document.createElement('span');
      total.className = 'total';
      total.textContent = fmtStopwatch(lap.total);

      li.append(idx, split, total);
      els.lapList.appendChild(li);
    });

    els.lapList.scrollTop = els.lapList.scrollHeight;
  }

  function renderStopwatch() {
    const elapsed = swElapsed();
    setText(els.swTime, fmtStopwatch(elapsed));
    setText(els.swStart, sw.running ? '暂停' : elapsed > 0 ? '继续' : '开始');
    els.swLap.disabled = !sw.running;
    els.swReset.disabled = !sw.running && sw.accumulated === 0 && sw.laps.length === 0;
    if (lapsDirty) {
      renderLaps();
      lapsDirty = false;
    }
  }

  /* ── 倒计时 ───────────────────────────────────────────────── */
  function cdRemaining() {
    return cd.running ? Math.max(0, cd.endAt - Date.now()) : cd.remaining;
  }

  function setCountdownTotal(ms) {
    cd.total = Math.max(1000, ms);
    cd.remaining = cd.total;
    cd.running = false;
    cd.endAt = 0;
    cd.finished = false;
    syncPresetUI();
    render();
    persist();
  }

  function toggleCountdown() {
    if (cd.running) {
      cd.remaining = cdRemaining();
      cd.running = false;
      cd.endAt = 0;
    } else {
      if (cd.finished || cd.remaining <= 0) cd.remaining = cd.total;
      if (cd.remaining <= 0) return;
      cd.finished = false;
      cd.endAt = Date.now() + cd.remaining;
      cd.running = true;
      unlockAudio();
    }
    render();
    persist();
    kick();
  }

  function resetCountdown() {
    cd.running = false;
    cd.endAt = 0;
    cd.remaining = cd.total;
    cd.finished = false;
    render();
    persist();
  }

  function applyCustomCountdown() {
    const h = clampInt(els.cdH.value, 0, 99, 0);
    const m = clampInt(els.cdM.value, 0, 59, 0);
    const s = clampInt(els.cdS.value, 0, 59, 0);
    els.cdH.value = h;
    els.cdM.value = m;
    els.cdS.value = s;

    const ms = ((h * 60 + m) * 60 + s) * 1000;
    if (ms < 1000) {
      toast('至少需要 1 秒');
      return;
    }
    setCountdownTotal(ms);
    toast('已设定倒计时时长');
  }

  function syncPresetUI() {
    els.cdPresets.querySelectorAll('button[data-min]').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.min) * 60000 === cd.total);
    });
  }

  function syncCdInputs() {
    const totalSec = Math.round(cd.total / 1000);
    els.cdH.value = Math.floor(totalSec / 3600);
    els.cdM.value = Math.floor((totalSec % 3600) / 60);
    els.cdS.value = totalSec % 60;
  }

  function finishCountdown() {
    cd.running = false;
    cd.endAt = 0;
    cd.remaining = 0;
    cd.finished = true;
    beep(3);
    notify('倒计时结束', '设定的时间已到');
    toast('时间到！');
    flashDone('panel-countdown');
    render();
    persist();
  }

  function renderCountdown() {
    const rem = cdRemaining();
    const ratio = cd.total > 0 ? rem / cd.total : 0;
    setText(els.cdTime, fmtCountdown(rem));
    setText(
      els.cdStart,
      cd.running ? '暂停' : cd.finished ? '重新开始' : cd.remaining < cd.total ? '继续' : '开始'
    );
    els.cdReset.disabled = !cd.running && !cd.finished && cd.remaining === cd.total;
    setText(
      els.cdStatus,
      cd.running ? '计时中…' : cd.finished ? '时间到！' : cd.remaining < cd.total ? '已暂停' : '准备开始'
    );
    setRing(els.cdRing, ratio);
  }

  /* ── 番茄钟 ───────────────────────────────────────────────── */
  function phaseDuration(phase) {
    return pomo.durations[phase] * 60000;
  }

  function pomoRemaining() {
    return pomo.running ? Math.max(0, pomo.endAt - Date.now()) : pomo.remaining;
  }

  function togglePomodoro() {
    if (pomo.running) {
      pomo.remaining = pomoRemaining();
      pomo.running = false;
      pomo.endAt = 0;
    } else {
      if (pomo.remaining <= 0) pomo.remaining = pomo.total;
      pomo.endAt = Date.now() + pomo.remaining;
      pomo.running = true;
      unlockAudio();
    }
    render();
    persist();
    kick();
  }

  /**
   * 进入下一个阶段。
   * @param {boolean} autostart 是否立即开始下一阶段
   * @param {boolean} countWork 跳过时不计入已完成轮数
   */
  function advancePomodoro({ autostart = false, countWork = true } = {}) {
    if (pomo.phase === 'work') {
      if (countWork) pomo.completed += 1;
      const longBreak = countWork && pomo.completed > 0 && pomo.completed % 4 === 0;
      pomo.phase = longBreak ? 'long' : 'short';
    } else {
      pomo.phase = 'work';
      pomo.round += 1;
    }
    pomo.total = phaseDuration(pomo.phase);
    pomo.remaining = pomo.total;
    pomo.running = false;
    pomo.endAt = 0;

    if (autostart) {
      pomo.running = true;
      pomo.endAt = Date.now() + pomo.remaining;
    }
  }

  function finishPomodoroPhase() {
    const wasWork = pomo.phase === 'work';
    const roundDone = pomo.round;
    advancePomodoro({ autostart: pomo.autoNext, countWork: true });

    beep(wasWork ? 3 : 2);
    if (wasWork) {
      notify('专注结束', `第 ${roundDone} 轮完成，休息一下`);
      toast('专注结束，休息一下 ☕');
    } else {
      notify('休息结束', '开始新的一轮专注');
      toast('休息结束，继续专注 💪');
    }

    flashDone('panel-pomodoro');
    render();
    persist();
    kick();
  }

  function skipPomodoro() {
    pomo.running = false;
    pomo.endAt = 0;
    advancePomodoro({ autostart: false, countWork: false });
    toast(`已跳过，下一段：${PHASE_LABEL[pomo.phase]}`);
    render();
    persist();
  }

  function resetPomodoro() {
    pomo.phase = 'work';
    pomo.round = 1;
    pomo.completed = 0;
    pomo.total = phaseDuration('work');
    pomo.remaining = pomo.total;
    pomo.running = false;
    pomo.endAt = 0;
    render();
    persist();
  }

  function applyPomoDurations() {
    pomo.durations = {
      work: clampInt(els.pmWork.value, 1, 120, 25),
      short: clampInt(els.pmShort.value, 1, 60, 5),
      long: clampInt(els.pmLong.value, 1, 60, 15),
    };
    els.pmWork.value = pomo.durations.work;
    els.pmShort.value = pomo.durations.short;
    els.pmLong.value = pomo.durations.long;

    // 未开始计时时，当前阶段立即应用新时长
    if (!pomo.running && pomo.remaining === pomo.total) {
      pomo.total = phaseDuration(pomo.phase);
      pomo.remaining = pomo.total;
    }
    render();
    persist();
  }

  function renderPomodoro() {
    const rem = pomoRemaining();
    const ratio = pomo.total > 0 ? rem / pomo.total : 0;
    const status = pomo.running
      ? '计时中…'
      : rem <= 0
        ? '本段结束'
        : pomo.remaining < pomo.total
          ? '已暂停'
          : '准备开始';

    setText(els.pmPhase, PHASE_LABEL[pomo.phase]);
    setText(els.pmTime, fmtCountdown(rem));
    setText(els.pmStatus, `第 ${pomo.round} 轮 · ${status}`);
    setText(els.pmStart, pomo.running ? '暂停' : pomo.remaining < pomo.total ? '继续' : '开始');
    setRing(els.pmRing, ratio);
  }

  /* ── 渲染调度 ─────────────────────────────────────────────── */
  function setRing(el, ratio) {
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    el.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - clamped));
  }

  function updateTitle() {
    let text = '计时器 · Timer';
    if (cd.running) text = `${fmtCountdown(cdRemaining())} · 倒计时`;
    else if (pomo.running) text = `${fmtCountdown(pomoRemaining())} · ${PHASE_LABEL[pomo.phase]}`;
    else if (sw.running) text = `${fmtStopwatch(swElapsed())} · 秒表`;
    if (document.title !== text) document.title = text;
  }

  function render() {
    updateTitle();
    if (state.mode === 'stopwatch') renderStopwatch();
    else if (state.mode === 'countdown') renderCountdown();
    else renderPomodoro();
  }

  function flashDone(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.classList.remove('is-done');
    void panel.offsetWidth; // 重启动画
    panel.classList.add('is-done');
    setTimeout(() => panel.classList.remove('is-done'), 3400);
  }

  function checkCompletions() {
    if (cd.running && Date.now() >= cd.endAt) finishCountdown();
    if (pomo.running && Date.now() >= pomo.endAt) finishPomodoroPhase();
  }

  function anyRunning() {
    return sw.running || cd.running || pomo.running;
  }

  function tick() {
    rafId = 0;
    checkCompletions();
    render();
    if (!rafId && anyRunning()) rafId = requestAnimationFrame(tick);
  }

  function ensureChecker() {
    if (checkerId) return;
    checkerId = setInterval(() => {
      if (!(cd.running || pomo.running)) {
        clearInterval(checkerId);
        checkerId = 0;
        return;
      }
      checkCompletions();
      if (document.hidden) render();
    }, 250);
  }

  function kick() {
    if (!rafId && anyRunning()) rafId = requestAnimationFrame(tick);
    if (cd.running || pomo.running) ensureChecker();
  }

  /* ── 模式切换 ─────────────────────────────────────────────── */
  function switchMode(mode) {
    if (!['stopwatch', 'countdown', 'pomodoro'].includes(mode)) return;
    state.mode = mode;
    document.body.dataset.mode = mode;

    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.id === `panel-${mode}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });

    render();
    persist();
  }

  /* ── 持久化 ───────────────────────────────────────────────── */
  function persistNow() {
    const data = {
      v: 1,
      mode: state.mode,
      settings: { sound: settings.sound, notify: settings.notify },
      sw: {
        running: sw.running,
        accumulated: sw.accumulated,
        startedAt: sw.startedAt,
        laps: sw.laps,
      },
      cd: {
        total: cd.total,
        remaining: cd.running ? Math.max(0, cd.endAt - Date.now()) : cd.remaining,
        running: cd.running,
        endAt: cd.running ? cd.endAt : 0,
        finished: cd.finished,
      },
      pomo: { ...pomo, durations: { ...pomo.durations } },
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (_) { /* 隐私模式等场景忽略 */ }
  }

  function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      persistNow();
    }, 200);
  }

  function restore() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (_) {
      return;
    }
    if (!data || data.v !== 1) return;

    if (data.settings && typeof data.settings === 'object') {
      settings.sound = data.settings.sound !== false;
      settings.notify = !!data.settings.notify;
    }
    if (['stopwatch', 'countdown', 'pomodoro'].includes(data.mode)) {
      state.mode = data.mode;
    }

    if (data.sw && typeof data.sw === 'object') {
      sw.running = !!data.sw.running;
      sw.accumulated = Math.max(0, Number(data.sw.accumulated) || 0);
      sw.startedAt = Number(data.sw.startedAt) || 0;
      sw.laps = Array.isArray(data.sw.laps)
        ? data.sw.laps.filter(
            (lap) => lap && typeof lap.total === 'number' && typeof lap.split === 'number'
          )
        : [];
      if (sw.running && !sw.startedAt) sw.running = false;
      lapsDirty = true;
    }

    if (data.cd && typeof data.cd === 'object') {
      cd.total = Math.max(1000, Number(data.cd.total) || 25 * 60000);
      cd.remaining = Math.max(0, Number(data.cd.remaining) || 0);
      cd.finished = !!data.cd.finished;
      cd.running = !!data.cd.running;
      cd.endAt = Number(data.cd.endAt) || 0;

      if (cd.running) {
        if (!cd.endAt) {
          cd.running = false;
        } else {
          cd.remaining = Math.max(0, cd.endAt - Date.now());
          if (cd.remaining <= 0) {
            cd.running = false;
            cd.finished = true;
          }
        }
      }
      if (!cd.running && !cd.finished && cd.remaining <= 0) cd.remaining = cd.total;
    }

    if (data.pomo && typeof data.pomo === 'object') {
      const d = data.pomo.durations || {};
      pomo.durations = {
        work: clampInt(d.work, 1, 120, 25),
        short: clampInt(d.short, 1, 60, 5),
        long: clampInt(d.long, 1, 60, 15),
      };
      pomo.phase = ['work', 'short', 'long'].includes(data.pomo.phase)
        ? data.pomo.phase
        : 'work';
      pomo.round = Math.max(1, Number(data.pomo.round) || 1);
      pomo.completed = Math.max(0, Number(data.pomo.completed) || 0);
      pomo.autoNext = data.pomo.autoNext !== false;
      pomo.total = phaseDuration(pomo.phase);
      pomo.remaining = Math.max(0, Number(data.pomo.remaining) || 0);
      pomo.running = !!data.pomo.running;
      pomo.endAt = Number(data.pomo.endAt) || 0;

      if (pomo.running) {
        if (!pomo.endAt) {
          pomo.running = false;
        } else {
          pomo.remaining = Math.max(0, pomo.endAt - Date.now());
          if (pomo.remaining <= 0) {
            pomo.running = false;
            pomo.remaining = 0;
            advancePomodoro({ autostart: false, countWork: true });
          }
        }
      }
      if (!pomo.running && pomo.remaining <= 0) pomo.remaining = pomo.total;
    }
  }

  function syncUI() {
    document.body.dataset.mode = state.mode;

    tabs.forEach((tab) => {
      const active = tab.dataset.mode === state.mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      const active = panel.id === `panel-${state.mode}`;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });

    syncSoundButton();
    syncNotifyButton();
    syncPresetUI();
    syncCdInputs();

    els.pmWork.value = pomo.durations.work;
    els.pmShort.value = pomo.durations.short;
    els.pmLong.value = pomo.durations.long;
    els.pmAuto.checked = pomo.autoNext;

    render();
  }

  /* ── 事件绑定 ─────────────────────────────────────────────── */
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // 方向键切换标签页
  tabs.forEach((tab, index) => {
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + dir + tabs.length) % tabs.length];
      switchMode(next.dataset.mode);
      next.focus();
    });
  });

  els.swStart.addEventListener('click', toggleStopwatch);
  els.swLap.addEventListener('click', addLap);
  els.swReset.addEventListener('click', resetStopwatch);

  els.cdStart.addEventListener('click', toggleCountdown);
  els.cdReset.addEventListener('click', resetCountdown);
  els.cdApply.addEventListener('click', applyCustomCountdown);

  els.cdPresets.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-min]');
    if (!btn) return;
    const min = Number(btn.dataset.min);
    if (!Number.isFinite(min)) return;
    setCountdownTotal(min * 60000);
    els.cdH.value = Math.floor(min / 60);
    els.cdM.value = min % 60;
    els.cdS.value = 0;
    toast(`倒计时设为 ${min} 分钟`);
  });

  [els.cdH, els.cdM, els.cdS].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustomCountdown();
      }
    });
  });

  els.pmStart.addEventListener('click', togglePomodoro);
  els.pmSkip.addEventListener('click', skipPomodoro);
  els.pmReset.addEventListener('click', resetPomodoro);

  [els.pmWork, els.pmShort, els.pmLong].forEach((input) => {
    input.addEventListener('change', applyPomoDurations);
  });

  els.pmAuto.addEventListener('change', () => {
    pomo.autoNext = els.pmAuto.checked;
    persist();
  });

  els.soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    if (settings.sound) {
      unlockAudio();
      beep(1);
    }
    syncSoundButton();
    persist();
  });

  els.notifyBtn.addEventListener('click', toggleNotifications);

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

    const key = (e.key || '').toLowerCase();
    const isSpace = e.code === 'Space' || key === ' ' || key === 'spacebar';

    if (isSpace) {
      if (tag === 'button') return; // 让聚焦的按钮自己响应空格
      e.preventDefault();
      if (state.mode === 'stopwatch') toggleStopwatch();
      else if (state.mode === 'countdown') toggleCountdown();
      else togglePomodoro();
      return;
    }

    if (key === 'l' && state.mode === 'stopwatch') {
      addLap();
    } else if (key === 's' && state.mode === 'pomodoro') {
      skipPomodoro();
    } else if (key === 'r') {
      if (state.mode === 'stopwatch') resetStopwatch();
      else if (state.mode === 'countdown') resetCountdown();
      else resetPomodoro();
    } else if (key === '1') {
      switchMode('stopwatch');
    } else if (key === '2') {
      switchMode('countdown');
    } else if (key === '3') {
      switchMode('pomodoro');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persistNow();
    } else {
      checkCompletions();
      render();
      kick();
    }
  });

  window.addEventListener('pagehide', persistNow);

  document.addEventListener(
    'pointerdown',
    () => {
      if (settings.sound) unlockAudio();
    },
    { once: true }
  );

  /* ── 启动 ─────────────────────────────────────────────────── */
  [els.cdRing, els.pmRing].forEach((ring) => {
    ring.style.strokeDasharray = String(CIRCUMFERENCE);
    ring.style.strokeDashoffset = '0';
  });

  restore();

  // 支持 ?mode=countdown 深链接
  try {
    const modeParam = new URLSearchParams(window.location.search).get('mode');
    if (['stopwatch', 'countdown', 'pomodoro'].includes(modeParam)) {
      state.mode = modeParam;
    }
  } catch (_) { /* 忽略 */ }

  syncUI();
  kick();
})();
