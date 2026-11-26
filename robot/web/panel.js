// Robot Radyo: Valetudo sayfasının sağ kenarına Samsung Edge tarzı radyo paneli ekler.
// Kenardaki tutamaçta ses +/− ve sessiz düğmeleri var; tutamacı sola çekince (ya da üstüne dokununca) tam panel açılır.
// Radyolar radio-browser.info dizininden aranıp favorilere eklenir. Arayüz 15 dilde; metinler i18n.js dosyasında.
(() => {
  if (window.__robotRadyo) return;
  window.__robotRadyo = true;

  // Dil dosyası normalde panelden önce yüklenir; yüklenmemişse şimdi yükle
  if (window.__robotRadyoI18n) start();
  else {
    const s = document.createElement('script');
    s.src = '/robot-radyo/i18n.js';
    s.onload = s.onerror = () => start();
    (document.head || document.documentElement).appendChild(s);
  }

  function start() {
    const I = window.__robotRadyoI18n || { names: { en: 'English' }, en: {} };
    const API = '/robot-radyo/api';
    const LANGS = Object.keys(I.names).filter((l) => I[l]);
    const ls = {
      get(k, d) { try { const v = localStorage.getItem('robotRadyo.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { localStorage.setItem('robotRadyo.' + k, JSON.stringify(v)); } catch { /* */ } },
    };
    function pickLang() {
      const saved = ls.get('lang', null);
      if (saved && LANGS.includes(saved)) return saved;
      for (const l of navigator.languages || [navigator.language || 'en']) {
        const c = String(l || '').slice(0, 2).toLowerCase();
        if (LANGS.includes(c)) return c;
      }
      return 'en';
    }
    let LANG = 'en', D = {}, T = {};
    function setLang(l) {
      LANG = LANGS.includes(l) ? l : 'en';
      D = Object.assign({}, I.en, I[LANG]);
      T = new Proxy(D, { get: (o, k) => (k in o ? o[k] : String(k)) }); // eksik metin olursa boş kalmasın
    }
    setLang(pickLang());
    const fmt = (s, n) => String(s).replace('{n}', n);
    const errText = (e) => (e.status === 401 ? T.login : e.status === 503 ? T.unreachable : (e.kod && ('e_' + e.kod) in D ? D['e_' + e.kod] : e.message));

    const GENRES = ['', 'pop', 'rock', 'jazz', 'classical', 'blues', 'news', 'oldies', 'chillout', 'dance', 'electronic', 'folk', '80s', '90s', 'lounge', 'religious', 'sports'];
    // Hazır listedeki grupların metin anahtarları: grup adları panelin diline göre gösterilir
    const GROUP_TEXT = { populer: 'populer', dil: 'dil', yabanci: 'yabanci', pop: 'grp_pop', rock: 'grp_rock', nostalji: 'grp_nostalji',
      sakin: 'grp_sakin', yerel: 'grp_yerel', caz: 'grp_caz', haber: 'grp_haber', dini: 'grp_dini' };
    const groupLabels = () => Object.fromEntries(Object.entries(GROUP_TEXT).map(([k, t]) => [k, T[t]]));
    const LANG_COUNTRY = { tr: 'TR', en: 'US', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', pl: 'PL', pt: 'BR', ru: 'RU', uk: 'UA', ar: 'EG', zh: 'CN', ja: 'JP', ko: 'KR',
      sv: 'SE', da: 'DK', fi: 'FI', el: 'GR', cs: 'CZ', hu: 'HU', ro: 'RO', he: 'IL' };

    const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const ICON = {
      plus: svg('<path d="M12 5v14M5 12h14"/>'),
      minus: svg('<path d="M5 12h14"/>'),
      speaker: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
      mute: svg('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>'),
      radio: svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 9-5"/><circle cx="8" cy="14" r="2"/><path d="M14 13h4M14 16h4"/>'),
      close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
      back: svg('<path d="M15 18l-6-6 6-6"/>'),
      trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
      play: svg('<path d="M7 5v14l11-7z"/>'),
      star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
      globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    };

    const host = document.createElement('div');
    host.id = 'robot-radyo';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", "Noto Sans CJK SC", sans-serif; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  svg { width: 18px; height: 18px; display: block; }
  [hidden] { display: none !important; }

  .handle { position: fixed; right: 0; top: var(--top, 42%); transform: translateY(-50%); z-index: 2147483000;
    width: 38px; padding: 6px 0; border-radius: 16px 0 0 16px; display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: rgba(24, 24, 36, .62); color: #fff; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    box-shadow: -4px 6px 22px rgba(0, 0, 0, .28); border: 1px solid rgba(255, 255, 255, .12); border-right: 0;
    transition: opacity .25s, transform .25s; user-select: none; -webkit-user-select: none; }
  .handle.hidden { opacity: 0; pointer-events: none; transform: translate(12px, -50%); }
  .handle.playing { box-shadow: -4px 6px 22px rgba(0, 0, 0, .28), inset 3px 0 0 #c084fc; }
  .grip { width: 38px; height: 46px; display: grid; place-items: center; touch-action: none; cursor: grab; position: relative; }
  .grip::before { content: ""; position: absolute; left: 6px; top: 50%; width: 3px; height: 22px; border-radius: 2px; background: rgba(255, 255, 255, .45); transform: translateY(-50%); }
  .eq { display: flex; gap: 2px; align-items: flex-end; height: 16px; }
  .eq i { width: 3px; height: 4px; border-radius: 2px; background: #fff; opacity: .85; }
  .playing .eq i { animation: eq 1s ease-in-out infinite; background: #e9d5ff; }
  .playing .eq i:nth-child(2) { animation-delay: -.3s; } .playing .eq i:nth-child(3) { animation-delay: -.6s; }
  @keyframes eq { 0%, 100% { height: 4px; } 50% { height: 16px; } }
  .hb { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; }
  .hb:active { background: rgba(255, 255, 255, .18); }
  .hb.on { color: #fca5a5; }
  .bubble { position: absolute; right: 44px; top: 50%; transform: translateY(-50%); background: rgba(24, 24, 36, .85); color: #fff;
    padding: 6px 10px; border-radius: 10px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap; }
  .bubble.show { opacity: 1; }

  .backdrop { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0, 0, 0, .3); opacity: 0; pointer-events: none; transition: opacity .25s; }
  .backdrop.show { opacity: 1; pointer-events: auto; }
  .panel { position: fixed; right: 0; top: 50%; z-index: 2147483002; width: min(360px, calc(100vw - 32px)); max-height: 90vh; overflow-y: auto;
    transform: translate(105%, -50%); transition: transform .28s cubic-bezier(.2, .8, .2, 1);
    background: rgba(17, 20, 34, .92); color: #f1f5f9; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
    border-radius: 24px 0 0 24px; border: 1px solid rgba(255, 255, 255, .1); border-right: 0; box-shadow: -10px 0 40px rgba(0, 0, 0, .4);
    padding: 16px 16px 18px; overscroll-behavior: contain; }
  .panel.open { transform: translate(0, -50%); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; touch-action: pan-y; }
  .title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; min-width: 0; }
  .title svg { width: 20px; height: 20px; color: #c084fc; flex: none; }
  .ib { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #cbd5e1; flex: none; }
  .ib:active { background: rgba(255, 255, 255, .12); }
  [dir=rtl] .ib.back svg { transform: scaleX(-1); }
  .now { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 16px; background: rgba(255, 255, 255, .06); margin-bottom: 12px; }
  .art { width: 52px; height: 52px; border-radius: 14px; flex: none; display: grid; place-items: center; background: linear-gradient(135deg, #7c3aed, #db2777); }
  .art .eq { height: 22px; } .art .eq i { width: 4px; }
  .playing .art .eq i { animation: eq2 1s ease-in-out infinite; }
  .playing .art .eq i:nth-child(2) { animation-delay: -.3s; } .playing .art .eq i:nth-child(3) { animation-delay: -.6s; }
  @keyframes eq2 { 0%, 100% { height: 5px; } 50% { height: 22px; } }
  .nt { min-width: 0; } .n1 { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .n2 { font-size: 13px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .n2.err { -webkit-line-clamp: 4; color: #fde68a; }
  .panel.busy .mainplay { opacity: .75; cursor: progress; }
  .grip:focus-visible, button:focus-visible, .sw:focus-visible { outline: 2px solid #c084fc; outline-offset: 2px; }
  .row.sub { margin-top: 10px; padding-top: 0; border-top: 0; }
  .row.sub span { font-size: 13px; color: #cbd5e1; padding-inline-start: 26px; }
  .row.sub.off { opacity: .45; }
  .sw.small { width: 40px; height: 24px; } .sw.small::after { width: 18px; height: 18px; } .sw.small.on::after { transform: translateX(16px); }
  @media (prefers-reduced-motion: reduce) { .eq i, .art .eq i { animation: none !important; } .panel, .handle, .backdrop { transition: none !important; } }
  label.f { display: block; font-size: 12px; color: #94a3b8; margin: 2px 2px 6px; text-transform: uppercase; letter-spacing: .06em; }
  select, input[type=text], input[type=url] { width: 100%; font: inherit; font-size: 15px; color: #f1f5f9; background: rgba(255, 255, 255, .08);
    border: 1px solid rgba(255, 255, 255, .12); border-radius: 12px; padding: 10px 12px; outline: none; min-width: 0; }
  input::placeholder { color: #94a3b8; }
  select option, select optgroup { color: #0f172a; background: #fff; }
  .selrow { display: flex; gap: 8px; align-items: center; }
  .rm { min-width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: rgba(255, 255, 255, .08); flex: none; color: #cbd5e1; font-size: 12px; }
  .rm.confirm { padding: 0 10px; background: #b91c1c; color: #fff; font-weight: 700; }
  .rm:disabled { opacity: .35; }
  .play { width: 100%; margin-top: 10px; padding: 12px; border-radius: 14px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #7c3aed, #db2777); }
  .play.stop { background: rgba(255, 255, 255, .12); }
  .play:disabled { opacity: .6; }
  .addbtn { width: 100%; margin-top: 8px; padding: 10px; border-radius: 12px; background: rgba(255, 255, 255, .06); color: #e9d5ff; font-weight: 600; border: 1px dashed rgba(192, 132, 252, .45); }
  .chk { font-size: 12px; color: #c4b5fd; margin: 6px 2px 0; }
  .welcome { padding: 14px; border-radius: 16px; margin-bottom: 4px; border: 1px solid rgba(192, 132, 252, .35);
    background: linear-gradient(135deg, rgba(124, 58, 237, .28), rgba(219, 39, 119, .2)); }
  .welcome h3 { margin: 0 0 6px; font-size: 16px; }
  .welcome p { margin: 0 0 10px; font-size: 13px; color: #e2e8f0; line-height: 1.45; }
  .vol { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .vb { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: rgba(255, 255, 255, .08); flex: none; }
  .vb.on { color: #fca5a5; }
  input[type=range] { flex: 1; accent-color: #c084fc; min-width: 0; }
  .vv { width: 44px; text-align: end; font-size: 13px; color: #94a3b8; font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, .08); }
  .row span { font-size: 14px; }
  .sw { width: 46px; height: 28px; border-radius: 999px; background: rgba(255, 255, 255, .18); position: relative; flex: none; transition: background .2s; }
  .sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .2s; }
  .sw.on { background: #7c3aed; } .sw.on::after { transform: translateX(18px); }
  .hint { font-size: 12px; color: #94a3b8; margin: 10px 2px 0; line-height: 1.45; }
  .langrow { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: #94a3b8; }
  .langrow svg { width: 16px; height: 16px; flex: none; }
  .langrow select { padding: 6px 10px; font-size: 14px; }
  .note { font-size: 13px; margin-top: 8px; min-height: 0; }
  .note.warn { color: #fde68a; } .note.ok { color: #86efac; }

  .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin: 0 0 10px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; padding: 6px 11px; border-radius: 999px; font-size: 13px; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .1); }
  .chip.on { background: rgba(124, 58, 237, .35); border-color: #a78bfa; color: #fff; font-weight: 600; }
  .grid2 { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 10px; }
  .results { max-height: 42vh; overflow-y: auto; border-radius: 14px; background: rgba(255, 255, 255, .04); overscroll-behavior: contain; }
  .res { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .res:last-child { border-bottom: 0; }
  .res.cur { background: rgba(124, 58, 237, .18); }
  .rt { flex: 1; min-width: 0; }
  .rn { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rmeta { font-size: 12px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rb { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(255, 255, 255, .08); flex: none; }
  .rb.fav.on { color: #fbbf24; }
  .rb.fav.on svg { fill: currentColor; }
  .empty { padding: 14px; font-size: 13px; color: #94a3b8; text-align: center; }
  details { margin-top: 12px; border-radius: 14px; background: rgba(255, 255, 255, .04); padding: 10px 12px; }
  summary { cursor: pointer; font-size: 14px; color: #e9d5ff; }
  details p { font-size: 13px; color: #cbd5e1; margin: 8px 0 0; line-height: 1.45; }
  .custom { display: grid; gap: 8px; margin-top: 10px; }
  .btnrow { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .btnrow .smallbtn { flex: 1 1 auto; }
  .smallbtn { padding: 9px 12px; border-radius: 12px; font-weight: 700; color: #fff; background: #7c3aed; }
  .smallbtn.alt { background: rgba(255, 255, 255, .12); }
  .smallbtn.danger { background: #b91c1c; }
  .smallbtn:disabled { opacity: .45; }
  .src { font-size: 11px; color: #64748b; margin-top: 10px; text-align: center; }
</style>

<div class="handle">
  <div class="grip" role="button" tabindex="0" aria-expanded="false"><div class="eq"><i></i><i></i><i></i></div></div>
  <button class="hb up">${ICON.plus}</button>
  <button class="hb down">${ICON.minus}</button>
  <button class="hb mute">${ICON.speaker}</button>
  <div class="bubble"></div>
</div>
<div class="backdrop"></div>
<aside class="panel" role="dialog">
  <section class="v-main">
    <div class="head"><div class="title">${ICON.radio}<span class="t-radio"></span></div><button class="ib x">${ICON.close}</button></div>
    <div class="now"><div class="art"><div class="eq"><i></i><i></i><i></i></div></div>
      <div class="nt"><div class="n1"></div><div class="n2"></div></div></div>
    <div class="welcome" hidden>
      <h3 class="t-wtitle"></h3>
      <p class="t-wtext"></p>
      <select class="wcountry"></select>
      <button class="play wmake"></button>
    </div>
    <div class="stationbox">
      <label class="f t-station" for="st"></label>
      <div class="selrow"><select id="st"></select><button class="rm del">${ICON.trash}</button></div>
      <div class="chk" hidden></div>
    </div>
    <button class="addbtn t-add"></button>
    <button class="play mainplay"></button>
    <div class="vol">
      <button class="vb pmute">${ICON.speaker}</button>
      <input type="range" min="0" max="100" step="1">
      <span class="vv">60%</span>
    </div>
    <div class="row"><span class="t-auto"></span><button class="sw auto" role="switch" aria-checked="false"></button></div>
    <div class="row sub"><span class="t-autosched"></span><button class="sw small sched" role="switch" aria-checked="false"></button></div>
    <p class="hint t-hint"></p>
    <div class="langrow">${ICON.globe}<select class="lang"></select></div>
    <div class="note m-note"></div>
  </section>

  <section class="v-add" hidden>
    <div class="head"><button class="ib back">${ICON.back}</button><div class="title t-addtitle" style="flex:1"></div><button class="ib x">${ICON.close}</button></div>
    <div class="grid2">
      <select class="country"></select>
      <input type="text" class="q" autocomplete="off">
    </div>
    <div class="chips genres"></div>
    <div class="results"><div class="empty t-loading"></div></div>
    <details class="ready">
      <summary class="t-ready"></summary>
      <p class="t-readytext"></p>
      <div class="btnrow"><button class="smallbtn radd"></button><button class="smallbtn alt rrep"></button></div>
    </details>
    <details>
      <summary class="t-custom"></summary>
      <div class="custom">
        <input type="text" class="cname">
        <input type="url" class="curl" inputmode="url">
        <button class="smallbtn cadd"></button>
      </div>
    </details>
    <div class="note a-note"></div>
    <div class="src t-src"></div>
  </section>
</aside>`;

    const $ = (s) => root.querySelector(s);
    const $$ = (s) => [...root.querySelectorAll(s)];
    const handle = $('.handle'), grip = $('.grip'), panel = $('.panel'), backdrop = $('.backdrop'), bubble = $('.bubble');
    const vMain = $('.v-main'), vAdd = $('.v-add');
    const sel = $('#st'), playBtn = $('.mainplay'), range = $('input[type=range]'), vv = $('.vv'), autoSw = $('.auto'), delBtn = $('.del');
    const countrySel = $('.country'), qInput = $('.q'), genresBox = $('.genres'), results = $('.results');
    const welcome = $('.welcome'), wCountry = $('.wcountry'), wMake = $('.wmake'), stationBox = $('.stationbox'), chk = $('.chk');
    const langSel = $('.lang'), mNote = $('.m-note'), aNote = $('.a-note'), rAdd = $('.radd'), rRep = $('.rrep');
    const schedSw = $('.sched'), schedRow = $('.row.sub');

    let st = null, favs = [], isOpen = false, busy = false, volTouched = 0, pollTimer = null, delArmed = null, repArmed = false;
    let countries = null, countriesLoading = null, genre = '', searchSeq = 0, building = false;

    // ---- metinler (dil değişince yeniden uygulanır) ----
    function applyTexts() {
      panel.dir = LANG === 'ar' ? 'rtl' : 'ltr';
      panel.lang = LANG;
      const txt = { '.t-radio': T.radio, '.t-station': T.station, '.t-add': T.addStations, '.t-auto': T.auto, '.t-autosched': T.autoSched, '.t-hint': T.hint,
        '.t-addtitle': T.addTitle, '.t-custom': T.customTitle, '.t-src': T.source, '.cadd': T.customAdd, '.t-wtitle': T.welcomeTitle,
        '.t-wtext': T.welcomeText, '.t-ready': T.readyList, '.t-readytext': T.readyListText, '.radd': T.addToMine };
      for (const [s, v] of Object.entries(txt)) $(s).textContent = v;
      $('.cname').placeholder = T.customName; $('.curl').placeholder = T.customUrl; qInput.placeholder = T.searchName;
      $('.up').title = T.volUp; $('.down').title = T.volDown; $('.mute').title = T.mute; $('.pmute').title = T.mute; delBtn.title = T.remove;
      grip.title = T.handle; grip.setAttribute('aria-label', T.handle); panel.setAttribute('aria-label', T.radio); range.setAttribute('aria-label', T.vol);
      autoSw.setAttribute('aria-label', T.auto); schedSw.setAttribute('aria-label', T.autoSched);
      $$('.x').forEach((b) => (b.title = T.close)); $('.back').title = T.back;
      langSel.setAttribute('aria-label', T.language); langSel.title = T.language;
      if (!building) wMake.textContent = T.makeList;
      disarmReplace();
      // tür düğmeleri
      genresBox.innerHTML = '';
      for (const tag of GENRES) {
        const c = document.createElement('button');
        c.className = 'chip' + (tag === genre ? ' on' : ''); c.textContent = T['c_' + (tag || 'all')]; c.dataset.tag = tag;
        c.onclick = () => { genre = tag; $$('.chip').forEach((x) => x.classList.toggle('on', x.dataset.tag === tag)); search(); };
        genresBox.appendChild(c);
      }
      // dil seçimi (her dil kendi adıyla)
      langSel.innerHTML = '';
      for (const l of LANGS) { const o = document.createElement('option'); o.value = l; o.textContent = I.names[l]; langSel.appendChild(o); }
      langSel.value = LANG;
      if (countries) fillCountries();
      if (!st) { $('.n1').textContent = T.off; $('.n2').textContent = T.pick; playBtn.textContent = T.play; }
      renderSelect();
      render();
    }

    const mount = () => { if (!host.isConnected) document.body.appendChild(host); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    setInterval(mount, 2000); // Valetudo sayfayı yeniden çizerse paneli geri ekle

    let top = ls.get('top', 42);
    const setTop = (v) => { top = Math.max(12, Math.min(88, v)); handle.style.setProperty('--top', top + '%'); };
    setTop(top);

    // ---- API ----
    async function api(p, body) {
      const r = await fetch(API + p, body === undefined ? { credentials: 'same-origin' }
        : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let d = null; try { d = await r.json(); } catch { /* */ }
      if (!r.ok) { const e = new Error((d && d.hata) || 'HTTP ' + r.status); e.status = r.status; e.kod = d && d.kod; throw e; }
      return d;
    }
    function note(el, text, kind = 'warn') {
      el.textContent = text || ''; el.className = `note ${el === aNote ? 'a-note' : 'm-note'} ${kind}`;
      clearTimeout(el._t); if (text && kind === 'ok') el._t = setTimeout(() => (el.textContent = ''), 3500);
    }

    // ---- favoriler ----
    async function loadFavs() {
      favs = await api('/radyolar');
      renderSelect();
    }
    function groupName(s) {
      if (s.grupKey && GROUP_TEXT[s.grupKey]) return T[GROUP_TEXT[s.grupKey]];
      return s.grup || T.favs;
    }
    function renderSelect() {
      const keep = sel.value;
      sel.innerHTML = '';
      const r = st && st.radyo;
      if (r && r.caliyor && r.onizleme) {
        const o = document.createElement('option'); o.value = '__onizleme'; o.textContent = `▶ ${r.istasyonAd} (${T.preview})`; sel.appendChild(o);
      }
      if (!favs.length) {
        const o = document.createElement('option'); o.value = ''; o.textContent = T.empty; o.disabled = true; sel.appendChild(o);
      }
      const groups = new Map();
      for (const s of favs) { const g = groupName(s); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
      for (const [g, items] of groups) {
        const og = document.createElement('optgroup'); og.label = g;
        for (const s of items) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.ad; og.appendChild(o); }
        sel.appendChild(og);
      }
      const want = r && r.caliyor && r.onizleme ? '__onizleme' : (r && r.istasyon) || keep;
      if ([...sel.options].some((o) => o.value === want)) sel.value = want;
      delBtn.disabled = !favs.some((f) => f.id === sel.value);
    }

    function render() {
      if (!st) return;
      const r = st.radyo, playing = r.caliyor;
      handle.classList.toggle('playing', playing);
      panel.classList.toggle('playing', playing);
      $('.n1').textContent = playing ? (r.istasyonAd || T.radio) + (r.onizleme ? ` (${T.preview})` : '') : T.off;
      const err = r.hata ? '⚠️ ' + (r.hataKod && ('e_' + r.hataKod) in D ? D['e_' + r.hataKod] : r.hata) : '';
      $('.n2').textContent = playing
        ? (r.kisik ? T.ducked : (st.sessiz ? T.muted : (r.baslik || (r.temizlikle ? T.cleaning : T.live))))
        : (err || T.pick);
      $('.n2').classList.toggle('err', !playing && Boolean(err));
      playBtn.textContent = playing ? T.stop : T.play;
      playBtn.classList.toggle('stop', playing);
      // İlk açılış: henüz liste yoksa ülke seçip hazır liste oluşturma kartı
      const firstRun = st.kurulum === false && !playing;
      welcome.hidden = !firstRun;
      stationBox.hidden = firstRun;
      playBtn.hidden = firstRun;
      if (firstRun) loadCountries();
      const pending = st.kontrolBekleyen || 0;
      chk.hidden = !pending;
      chk.textContent = pending ? '⏳ ' + fmt(T.checking, pending) : '';
      if (root.activeElement !== sel) renderSelect();
      if (Date.now() - volTouched > 1500) { range.value = st.ses; vv.textContent = st.ses + '%'; }
      for (const b of [$('.mute'), $('.pmute')]) { b.innerHTML = st.sessiz ? ICON.mute : ICON.speaker; b.classList.toggle('on', st.sessiz); }
      autoSw.classList.toggle('on', st.otomatik); autoSw.setAttribute('aria-checked', String(st.otomatik));
      const sched = Boolean(st.otomatikZamanli);
      schedSw.classList.toggle('on', sched); schedSw.setAttribute('aria-checked', String(sched));
      schedRow.hidden = st.otomatikZamanli === undefined; // eski sunucuda bu ayar yok
      schedRow.classList.toggle('off', !st.otomatik); schedSw.disabled = !st.otomatik;
      $$('.res').forEach((row) => row.classList.toggle('cur', playing && r.uuid === row.dataset.uuid));
    }

    async function refresh() {
      try {
        const before = st ? st.kontrolBekleyen || 0 : 0;
        st = await api('/durum');
        if ((st.kontrolBekleyen || 0) !== before) await loadFavs(); // denenen radyolar değişmiş olabilir
        render();
        if (mNote.classList.contains('warn')) note(mNote, '');
      } catch (e) { note(mNote, e.status === 401 ? T.login : T.unreachable); }
    }
    function schedule() {
      clearTimeout(pollTimer);
      const every = isOpen || (st && (st.radyo.caliyor || st.kontrolBekleyen > 0)) ? 3000 : 10000;
      pollTimer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, every);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

    async function act(fn, noteEl = mNote) {
      if (busy) return; busy = true; panel.classList.add('busy');
      try { const d = await fn(); if (d && d.radyo) { st = d; render(); } } catch (e) { note(noteEl, '⚠️ ' + errText(e)); }
      finally { busy = false; panel.classList.remove('busy'); }
    }

    // ---- ses ----
    function showBubble(text) { bubble.textContent = text; bubble.classList.add('show'); clearTimeout(bubble._t); bubble._t = setTimeout(() => bubble.classList.remove('show'), 1200); }
    function stepVolume(delta) {
      if (!st) return;
      const v = Math.max(0, Math.min(100, (st.sessiz ? 0 : st.ses) + delta));
      st.ses = v; st.sessiz = false; volTouched = Date.now(); render();
      showBubble(`${T.vol} ${v}%`);
      api('/ses', { ses: v }).then((d) => { st = d; }).catch(() => {});
    }
    function toggleMute() {
      if (!st) return;
      const m = !st.sessiz; st.sessiz = m; render(); showBubble(m ? T.muted : `${T.vol} ${st.ses}%`);
      api('/sessiz', { sessiz: m }).then((d) => { st = d; render(); }).catch(() => {});
    }
    $('.up').onclick = () => stepVolume(10);
    $('.down').onclick = () => stepVolume(-10);
    $('.mute').onclick = toggleMute;
    $('.pmute').onclick = toggleMute;
    let volTimer;
    range.oninput = () => {
      volTouched = Date.now(); vv.textContent = range.value + '%';
      clearTimeout(volTimer);
      volTimer = setTimeout(() => api('/ses', { ses: Number(range.value) }).then((d) => { st = d; render(); }).catch(() => {}), 120);
    };

    // ---- radyo ----
    playBtn.onclick = () => {
      // Durdur her zaman çalışır (yavaş bir başlatma sürerken bile)
      if (st && st.radyo.caliyor) {
        api('/radyo/dur', {}).then((d) => { st = d; render(); }).catch((e) => note(mNote, '⚠️ ' + errText(e)));
        return;
      }
      act(() => {
        if (sel.value === '__onizleme' && st && st.radyo.uuid) return api('/radyo/cal', { uuid: st.radyo.uuid, ad: st.radyo.istasyonAd });
        return sel.value ? api('/radyo/cal', { istasyon: sel.value }) : null;
      });
    };
    sel.onchange = () => {
      delBtn.disabled = !favs.some((f) => f.id === sel.value);
      disarmDelete();
      if (st && st.radyo.caliyor && sel.value && sel.value !== '__onizleme') act(() => api('/radyo/cal', { istasyon: sel.value }));
    };
    autoSw.onclick = () => act(() => api('/otomatik', { acik: !(st && st.otomatik) }));
    schedSw.onclick = () => { if (st && st.otomatik) act(() => api('/otomatik', { zamanli: !st.otomatikZamanli })); };
    langSel.onchange = () => { ls.set('lang', langSel.value); setLang(langSel.value); applyTexts(); if (!vAdd.hidden) search(); };

    function disarmDelete() { delArmed = null; delBtn.classList.remove('confirm'); delBtn.innerHTML = ICON.trash; }
    delBtn.onclick = async () => {
      const id = sel.value;
      if (!favs.some((f) => f.id === id)) return;
      if (delArmed !== id) {
        delArmed = id; delBtn.classList.add('confirm'); delBtn.textContent = T.removeConfirm;
        clearTimeout(delBtn._t); delBtn._t = setTimeout(disarmDelete, 3000);
        return;
      }
      disarmDelete();
      try { await api('/favori/sil', { id }); await loadFavs(); note(mNote, T.removed, 'ok'); } catch (e) { note(mNote, '⚠️ ' + errText(e)); }
    };

    // ---- ülkeler ----
    function defaultCountry() {
      if (st && st.ulke) return st.ulke;
      for (const l of navigator.languages || [navigator.language || '']) {
        const p = String(l || '').split('-');
        if (p[1] && /^[A-Za-z]{2}$/.test(p[1])) return p[1].toUpperCase();
      }
      return LANG_COUNTRY[String(navigator.language || LANG).slice(0, 2).toLowerCase()] || LANG_COUNTRY[LANG] || '';
    }
    function loadCountries() {
      if (countries) return Promise.resolve();
      if (!countriesLoading) {
        countriesLoading = api('/ulkeler').then((list) => { countries = list; fillCountries(); })
          .catch((e) => { countriesLoading = null; note(vAdd.hidden ? mNote : aNote, '⚠️ ' + errText(e)); });
      }
      return countriesLoading;
    }
    function fillCountries() {
      let dn = null;
      try { dn = new Intl.DisplayNames([LANG], { type: 'region' }); } catch { /* eski tarayıcı: dizindeki İngilizce ad */ }
      const name = (c) => { try { return (dn && dn.of(c.kod)) || c.ad; } catch { return c.ad; } };
      const list = countries.map((c) => ({ ...c, yerel: name(c) })).sort((a, b) => a.yerel.localeCompare(b.yerel, LANG));
      const keepA = countrySel.value, keepW = wCountry.value;
      countrySel.innerHTML = ''; wCountry.innerHTML = '';
      const all = document.createElement('option'); all.value = ''; all.textContent = T.allCountries; countrySel.appendChild(all);
      for (const c of list) {
        const o = document.createElement('option'); o.value = c.kod; o.textContent = `${c.yerel} (${c.sayi})`;
        countrySel.appendChild(o); wCountry.appendChild(o.cloneNode(true));
      }
      const d = defaultCountry();
      const has = (k) => list.some((c) => c.kod === k);
      countrySel.value = keepA && has(keepA) ? keepA : (countrySel.dataset.set ? keepA : (has(d) ? d : ''));
      countrySel.dataset.set = '1';
      wCountry.value = keepW && has(keepW) ? keepW : (has(d) ? d : list[0]?.kod || '');
      updateReady();
    }

    // ---- hazır liste (ilk açılış kartı ve "Radyo ekle" içindeki bölüm) ----
    async function makeList(ulke, mode, btn, noteEl) {
      if (!ulke || building) return;
      building = true; btn.disabled = true;
      const old = btn.textContent; btn.textContent = T.preparing;
      try {
        const d = await api('/baslangic', { ulke, dil: ls.get('lang', null) || navigator.language || LANG, lang: LANG, mod: mode, etiketler: groupLabels() });
        await loadFavs(); await refresh();
        if (noteEl === aNote) closeAdd();
        note(mNote, fmt(T.listReady, d.eklenen), 'ok');
        schedule();
      } catch (e) { note(noteEl, '⚠️ ' + errText(e)); }
      finally { building = false; btn.disabled = false; btn.textContent = old; if (btn === rRep) disarmReplace(); updateReady(); }
    }
    wMake.onclick = () => makeList(wCountry.value, 'degistir', wMake, mNote);
    function updateReady() { rAdd.disabled = rRep.disabled = !countrySel.value || building; }
    function disarmReplace() { repArmed = false; rRep.classList.remove('danger'); rRep.classList.add('alt'); rRep.textContent = T.replaceMine; clearTimeout(rRep._t); }
    rAdd.onclick = () => makeList(countrySel.value, 'ekle', rAdd, aNote);
    rRep.onclick = () => {
      if (!repArmed) { // listeyi silen işlem: önce onay
        repArmed = true; rRep.classList.remove('alt'); rRep.classList.add('danger'); rRep.textContent = T.replaceConfirm;
        clearTimeout(rRep._t); rRep._t = setTimeout(disarmReplace, 4000);
        return;
      }
      makeList(countrySel.value, 'degistir', rRep, aNote);
    };

    // ---- radyo ekleme (dizinde arama) ----
    async function openAdd() {
      vMain.hidden = true; vAdd.hidden = false; panel.scrollTop = 0; note(aNote, '');
      await loadCountries();
      search();
    }
    function closeAdd() { vAdd.hidden = true; vMain.hidden = false; panel.scrollTop = 0; disarmReplace(); }
    $('.t-add').onclick = openAdd;
    $('.back').onclick = closeAdd;
    countrySel.onchange = () => { api('/ulke', { ulke: countrySel.value }).catch(() => {}); if (st) st.ulke = countrySel.value; disarmReplace(); updateReady(); search(); };
    let qTimer;
    qInput.oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(search, 400); };

    async function search() {
      const seq = ++searchSeq;
      results.innerHTML = ''; const l = document.createElement('div'); l.className = 'empty'; l.textContent = T.loading; results.appendChild(l);
      const params = new URLSearchParams();
      if (countrySel.value) params.set('ulke', countrySel.value);
      if (genre) params.set('tur', genre);
      if (qInput.value.trim()) params.set('ad', qInput.value.trim());
      try {
        const list = await api('/ara?' + params);
        if (seq !== searchSeq) return;
        renderResults(list);
      } catch (e) {
        if (seq !== searchSeq) return;
        results.innerHTML = ''; const m = document.createElement('div'); m.className = 'empty'; m.textContent = '⚠️ ' + errText(e); results.appendChild(m);
      }
    }
    function renderResults(list) {
      results.innerHTML = '';
      if (!list.length) { const m = document.createElement('div'); m.className = 'empty'; m.textContent = T.noResults; results.appendChild(m); return; }
      for (const s of list) {
        const row = document.createElement('div'); row.className = 'res'; row.dataset.uuid = s.uuid;
        if (st && st.radyo.caliyor && st.radyo.uuid === s.uuid) row.classList.add('cur');
        const t = document.createElement('div'); t.className = 'rt';
        const n = document.createElement('div'); n.className = 'rn'; n.textContent = s.ad;
        const m = document.createElement('div'); m.className = 'rmeta';
        const codec = s.codec && s.codec.toUpperCase() !== 'UNKNOWN' ? `${s.codec}${s.bitrate ? ' ' + s.bitrate + 'k' : ''}` : '';
        m.textContent = [s.ulke, codec, s.etiketler].filter(Boolean).join(' · ');
        t.append(n, m);
        const p = document.createElement('button'); p.className = 'rb'; p.innerHTML = ICON.play; p.title = T.listen;
        p.onclick = () => act(() => api('/radyo/cal', { uuid: s.uuid, ad: s.ad }), aNote);
        const f = document.createElement('button'); f.className = 'rb fav' + (s.favori ? ' on' : ''); f.innerHTML = ICON.star; f.title = s.favori ? T.inFav : T.addFav;
        f.onclick = async () => {
          if (f.classList.contains('on')) return;
          try { await api('/favori/ekle', { uuid: s.uuid }); f.classList.add('on'); f.title = T.inFav; note(aNote, T.added, 'ok'); await loadFavs(); await refresh(); }
          catch (e) { note(aNote, '⚠️ ' + errText(e)); }
        };
        row.append(t, p, f);
        results.appendChild(row);
      }
    }
    $('.cadd').onclick = async () => {
      const ad = $('.cname').value.trim(), url = $('.curl').value.trim();
      try {
        await api('/favori/ekle-url', { ad, url });
        $('.cname').value = ''; $('.curl').value = '';
        note(aNote, T.added, 'ok'); await loadFavs(); await refresh();
      } catch (e) { note(aNote, '⚠️ ' + errText(e)); }
    };

    // ---- açma / kapama ve sürükleme ----
    function setProgress(p) {
      panel.style.transition = 'none';
      panel.style.transform = `translate(${(1 - p) * 105}%, -50%)`;
      backdrop.style.transition = 'none';
      backdrop.style.opacity = String(p);
    }
    function clearInline() { panel.style.transition = ''; panel.style.transform = ''; backdrop.style.transition = ''; backdrop.style.opacity = ''; }
    function open(fromKeyboard = false) {
      clearInline(); isOpen = true;
      panel.classList.add('open'); backdrop.classList.add('show'); handle.classList.add('hidden');
      grip.setAttribute('aria-expanded', 'true');
      refresh(); schedule();
      // Klavyeyle açıldıysa odağı panele taşı (dokunmatikte klavye açılmasın diye yalnızca bu durumda)
      if (fromKeyboard) setTimeout(() => { try { (vAdd.hidden ? (playBtn.hidden ? wMake : playBtn) : $('.back')).focus(); } catch { /* */ } }, 300);
    }
    function close() {
      clearInline(); isOpen = false; disarmDelete(); disarmReplace();
      panel.classList.remove('open'); backdrop.classList.remove('show'); handle.classList.remove('hidden');
      grip.setAttribute('aria-expanded', 'false');
      schedule();
    }
    // Klavyeyle açma: tutamaç odaktayken Enter ya da boşluk
    grip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(true); } });
    backdrop.onclick = close;
    $$('.x').forEach((b) => (b.onclick = close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });

    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, mode: null, top, w: panel.offsetWidth || 320, p: 0 };
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.mode && Math.hypot(dx, dy) > 8) drag.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (drag.mode === 'h') { drag.p = Math.max(0, Math.min(1, -dx / drag.w)); setProgress(drag.p); }
      else if (drag.mode === 'v') setTop(drag.top + (dy / innerHeight) * 100);
    });
    grip.addEventListener('pointerup', () => {
      if (!drag) return;
      if (!drag.mode) open();
      else if (drag.mode === 'h') { if (drag.p > 0.3) open(); else close(); }
      else ls.set('top', top);
      drag = null;
    });
    grip.addEventListener('pointercancel', () => { if (drag && drag.mode === 'h') close(); drag = null; });

    // Paneli sağa kaydırarak kapatma (yalnızca başlık/boş alandan)
    let swipe = null;
    panel.addEventListener('pointerdown', (e) => {
      if (e.target.closest('select, input, button, .results, details')) return;
      swipe = { x: e.clientX, w: panel.offsetWidth, dx: 0 };
    });
    panel.addEventListener('pointermove', (e) => {
      if (!swipe) return;
      swipe.dx = Math.max(0, e.clientX - swipe.x);
      if (swipe.dx > 6) setProgress(1 - swipe.dx / swipe.w);
    });
    const swipeEnd = () => { if (!swipe) return; if (swipe.dx > swipe.w * 0.3) close(); else if (swipe.dx > 6) open(); swipe = null; };
    panel.addEventListener('pointerup', swipeEnd);
    panel.addEventListener('pointercancel', swipeEnd);

    applyTexts();
    (async () => {
      try { await loadFavs(); } catch { /* liste yüklenemezse panel yine açılır */ }
      await refresh();
      schedule();
    })();
  }
})();
