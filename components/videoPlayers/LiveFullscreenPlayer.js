/*
 * LiveFullscreenPlayer
 * --------------------
 * Player de canais ao vivo em tela cheia.
 *
 * Na TV Samsung usa o AVPlay (webapis.avplay), o player de hardware do Tizen.
 * O <video> do Tizen 5.x toca HLS ao vivo so com audio (tela preta), enquanto
 * o AVPlay decodifica HLS/TS normalmente. No navegador do PC cai para <video>
 * + hls.js.
 *
 * O AVPlay desenha o video num plano ATRAS da pagina: enquanto o player esta
 * aberto, a pagina inteira fica transparente e so a barra de informacoes
 * aparece por cima.
 *
 * Teclas: Cima/Baixo ou CH+/CH- trocam de canal, Enter/Info mostram a barra,
 * Voltar/Esc fecham. Play/Pause/Stop do controle tambem funcionam.
 *
 * Uso: LiveFullscreenPlayer.open({ streams, index, canPlay, onChannelChange, onClose })
 *
 * Compativel com Chromium 47+ (sem optional chaining, catch sem variavel etc.).
 */
var LiveFullscreenPlayer = (function () {
  var KEY = {
    UP: 38,
    DOWN: 40,
    LEFT: 37,
    RIGHT: 39,
    ENTER: 13,
    BACK: 10009,
    ESC: 27,
    BACKSPACE: 8,
    CH_UP: 427,
    CH_DOWN: 428,
    INFO: 457,
    PLAY: 415,
    PAUSE: 19,
    PLAY_PAUSE: 10252,
    STOP: 413,
  };

  var state = null; // { streams, index, canPlay, onChannelChange, onClose, ... }
  var root = null;
  var infoTimer = null;
  var switchTimer = null;
  var playToken = 0;
  var savedStyles = null;
  var htmlVideo = null;
  var hls = null;

  function hasAvplay() {
    return (
      typeof webapis !== "undefined" &&
      webapis &&
      webapis.avplay &&
      typeof webapis.avplay.open === "function"
    );
  }

  function buildUrl(stream, ext) {
    var data = JSON.parse(localStorage.getItem("currentPlaylistData") || "{}");
    var si = data.server_info || {};
    var ui = data.user_info || {};
    return (
      (si.server_protocol || "http") +
      "://" +
      si.url +
      ":" +
      si.port +
      "/live/" +
      ui.username +
      "/" +
      ui.password +
      "/" +
      stream.stream_id +
      "." +
      ext
    );
  }

  // Formato escolhido em Settings -> Stream Format, depois o alternativo
  function formatsToTry() {
    var fmt = "m3u8";
    try {
      var name = JSON.parse(localStorage.getItem("selectedPlaylist") || "{}")
        .playlistName;
      var list = JSON.parse(localStorage.getItem("playlistsData") || "[]");
      for (var i = 0; i < list.length; i++) {
        if (list[i].playlistName === name && list[i].streamFormat) {
          fmt = String(list[i].streamFormat).toLowerCase();
        }
      }
    } catch (e) {}
    return fmt === "ts" ? ["ts", "m3u8"] : ["m3u8", "ts"];
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function decode(s) {
    try {
      return typeof decodeBase64 === "function" ? decodeBase64(s) : s;
    } catch (e) {
      return s;
    }
  }

  function fmtTime(ts) {
    var n = parseInt(ts, 10);
    var d = isNaN(n) ? new Date(ts) : new Date(String(ts).length <= 10 ? n * 1000 : n);
    if (isNaN(d.getTime())) return "";
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // ---------------------------------------------------------------- UI ----

  function injectStyles() {
    if (document.getElementById("lfp-styles")) return;
    var css =
      "#lfp-root{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;background:transparent;font-family:Poppins,sans-serif;color:#fff;overflow:hidden}" +
      "#lfp-root.lfp-html5{background:#000}" +
      "#lfp-av{position:absolute;left:0;top:0;width:100%;height:100%}" +
      "#lfp-video{position:absolute;left:0;top:0;width:100%;height:100%;background:#000;object-fit:contain}" +
      "#lfp-info{position:absolute;left:0;right:0;bottom:0;padding:28px 48px 36px;background:linear-gradient(to top,rgba(0,0,0,.92),rgba(0,0,0,.6) 70%,rgba(0,0,0,0));display:flex;align-items:center;transition:opacity .4s ease}" +
      "#lfp-info.lfp-hidden{opacity:0}" +
      "#lfp-logo{width:110px;height:110px;object-fit:contain;background:rgba(255,255,255,.08);border-radius:14px;padding:8px;flex-shrink:0;margin-right:28px}" +
      "#lfp-text{flex:1;min-width:0;margin-right:28px}" +
      "#lfp-name{font-size:40px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#lfp-num{color:#f5c518;margin-right:16px}" +
      "#lfp-now{font-size:26px;margin-top:6px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#lfp-next{font-size:22px;margin-top:2px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#lfp-hint{font-size:20px;color:#888;text-align:right;line-height:1.6;flex-shrink:0}" +
      "#lfp-status{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font-size:30px;text-shadow:0 2px 8px #000}" +
      "#lfp-status.lfp-hidden{display:none}" +
      ".lfp-spinner{width:70px;height:70px;margin:0 auto 18px;border:7px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:lfp-spin 1s linear infinite}" +
      "@keyframes lfp-spin{to{transform:rotate(360deg)}}";
    var style = document.createElement("style");
    style.id = "lfp-styles";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function buildDom() {
    injectStyles();
    root = document.createElement("div");
    root.id = "lfp-root";
    root.innerHTML =
      (hasAvplay()
        ? '<object id="lfp-av" type="application/avplayer"></object>'
        : '<video id="lfp-video" autoplay playsinline></video>') +
      '<div id="lfp-status" class="lfp-hidden"></div>' +
      '<div id="lfp-info">' +
      '  <img id="lfp-logo" alt="">' +
      '  <div id="lfp-text">' +
      '    <div id="lfp-name"></div>' +
      '    <div id="lfp-now"></div>' +
      '    <div id="lfp-next"></div>' +
      "  </div>" +
      '  <div id="lfp-hint">&#9650;&#9660; / CH&plusmn; trocar canal<br>VOLTAR sair</div>' +
      "</div>";
    if (!hasAvplay()) root.className = "lfp-html5";
    document.body.appendChild(root);
    htmlVideo = document.getElementById("lfp-video");
  }

  // Deixa a pagina transparente para o plano de video do AVPlay aparecer
  function hidePage() {
    var nav = document.getElementById("navbar-root");
    var app = document.getElementById("main-app-container");
    savedStyles = {
      htmlBg: document.documentElement.style.background,
      bodyBg: document.body.style.background,
      navVis: nav ? nav.style.visibility : "",
      appVis: app ? app.style.visibility : "",
    };
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    if (nav) nav.style.visibility = "hidden";
    if (app) app.style.visibility = "hidden";
  }

  function restorePage() {
    if (!savedStyles) return;
    var nav = document.getElementById("navbar-root");
    var app = document.getElementById("main-app-container");
    document.documentElement.style.background = savedStyles.htmlBg;
    document.body.style.background = savedStyles.bodyBg;
    if (nav) nav.style.visibility = savedStyles.navVis;
    if (app) app.style.visibility = savedStyles.appVis;
    savedStyles = null;
  }

  function setStatus(kind, text) {
    var el = document.getElementById("lfp-status");
    if (!el) return;
    if (!kind) {
      el.className = "lfp-hidden";
      el.innerHTML = "";
      return;
    }
    el.className = "";
    el.innerHTML =
      (kind === "loading" ? '<div class="lfp-spinner"></div>' : "&#9888;&#65039;<br>") +
      escapeHtml(text || "");
  }

  function showInfo(stream) {
    var info = document.getElementById("lfp-info");
    if (!info) return;
    var num = state ? state.index + 1 : "";
    document.getElementById("lfp-name").innerHTML =
      '<span id="lfp-num">' + num + "</span>" + escapeHtml(stream.name);
    var logo = document.getElementById("lfp-logo");
    logo.style.visibility = stream.stream_icon ? "visible" : "hidden";
    if (stream.stream_icon) logo.src = stream.stream_icon;
    info.className = "";
    clearTimeout(infoTimer);
    infoTimer = setTimeout(function () {
      info.className = "lfp-hidden";
    }, 5000);
  }

  function loadEpg(stream, token) {
    var nowEl = document.getElementById("lfp-now");
    var nextEl = document.getElementById("lfp-next");
    nowEl.textContent = "";
    nextEl.textContent = "";
    if (typeof getLiveStreamEpg !== "function") return;
    getLiveStreamEpg(stream.stream_id).then(function (data) {
      if (token !== playToken || !document.getElementById("lfp-now")) return;
      var list = data && data.epg_listings ? data.epg_listings : [];
      var nowSec = Date.now() / 1000;
      var cur = -1;
      for (var i = 0; i < list.length; i++) {
        var st = parseInt(list[i].start_timestamp, 10);
        var en = parseInt(list[i].stop_timestamp, 10);
        if (!isNaN(st) && !isNaN(en) && st <= nowSec && nowSec < en) {
          cur = i;
          break;
        }
      }
      if (cur < 0 && list.length) cur = 0;
      if (cur >= 0) {
        var a = list[cur];
        nowEl.textContent =
          "Agora " + fmtTime(a.start_timestamp || a.start) + " - " + fmtTime(a.stop_timestamp || a.end) + "  " + decode(a.title);
        if (list[cur + 1]) {
          var b = list[cur + 1];
          nextEl.textContent = "A seguir " + fmtTime(b.start_timestamp || b.start) + "  " + decode(b.title);
        }
      }
    });
  }

  // ------------------------------------------------------------ PLAYER ----

  function stopPlayback() {
    if (hasAvplay()) {
      try {
        var st = webapis.avplay.getState();
        if (st !== "NONE" && st !== "IDLE") webapis.avplay.stop();
      } catch (e) {}
      try {
        webapis.avplay.close();
      } catch (e) {}
    }
    if (hls) {
      try {
        hls.destroy();
      } catch (e) {}
      hls = null;
    }
    if (htmlVideo) {
      try {
        htmlVideo.pause();
        htmlVideo.removeAttribute("src");
        htmlVideo.load();
      } catch (e) {}
    }
  }

  function playAvplay(url, token, onFail) {
    var av = webapis.avplay;
    try {
      av.open(url);
      av.setListener({
        onbufferingstart: function () {
          if (token === playToken) setStatus("loading", "Carregando...");
        },
        onbufferingprogress: function () {},
        onbufferingcomplete: function () {
          if (token === playToken) setStatus(null);
        },
        onstreamcompleted: function () {
          if (token === playToken) setStatus("error", "Transmissao encerrada");
        },
        onerror: function (err) {
          if (token === playToken) onFail("AVPlay: " + err);
        },
        onevent: function () {},
        oncurrentplaytime: function () {},
      });
      // Coordenadas do AVPlay sao sempre na base 1920x1080
      av.setDisplayRect(0, 0, 1920, 1080);
      try {
        av.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
      } catch (e) {}
      try {
        av.setStreamingProperty("ADAPTIVE_INFO", "STARTBITRATE=HIGHEST");
      } catch (e) {}
      av.prepareAsync(
        function () {
          if (token !== playToken) return;
          try {
            av.play();
            setStatus(null);
          } catch (e) {
            onFail("play: " + e.message);
          }
        },
        function (err) {
          if (token === playToken) onFail("prepare: " + (err && err.name ? err.name : err));
        }
      );
    } catch (e) {
      onFail("open: " + e.message);
    }
  }

  function playHtml5(url, token, onFail) {
    if (!htmlVideo) return onFail("sem elemento de video");
    htmlVideo.onplaying = function () {
      if (token === playToken) setStatus(null);
    };
    htmlVideo.onwaiting = function () {
      if (token === playToken) setStatus("loading", "Carregando...");
    };
    htmlVideo.onerror = function () {
      if (token === playToken) onFail("video error");
    };
    var isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls && typeof Hls !== "undefined" && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.on(Hls.Events.ERROR, function (ev, data) {
        if (data && data.fatal && token === playToken) onFail("hls.js: " + data.details);
      });
      hls.loadSource(url);
      hls.attachMedia(htmlVideo);
    } else {
      htmlVideo.src = url;
    }
    var p = htmlVideo.play();
    if (p && p.catch) p.catch(function () {});
  }

  function playCurrent() {
    var stream = state.streams[state.index];
    if (!stream) return;
    var token = ++playToken;
    stopPlayback();
    showInfo(stream);
    loadEpg(stream, token);
    setStatus("loading", "Carregando " + (stream.name || "") + "...");

    var formats = formatsToTry();
    var attempt = 0;
    var tryNext = function (reason) {
      if (token !== playToken) return;
      if (reason) console.warn("[LiveFullscreenPlayer] falhou:", reason);
      if (attempt >= formats.length) {
        setStatus("error", "Nao foi possivel reproduzir este canal");
        var info = document.getElementById("lfp-info");
        if (info) info.className = "";
        return;
      }
      var url = buildUrl(stream, formats[attempt++]);
      stopPlayback();
      if (hasAvplay()) playAvplay(url, token, tryNext);
      else playHtml5(url, token, tryNext);
    };
    tryNext();

    if (typeof state.onChannelChange === "function") {
      try {
        state.onChannelChange(stream, state.index);
      } catch (e) {}
    }
  }

  function togglePause() {
    if (hasAvplay()) {
      try {
        var st = webapis.avplay.getState();
        if (st === "PLAYING") webapis.avplay.pause();
        else if (st === "PAUSED") webapis.avplay.play();
      } catch (e) {}
    } else if (htmlVideo) {
      if (htmlVideo.paused) htmlVideo.play();
      else htmlVideo.pause();
    }
  }

  // Troca de canal com pequeno atraso: varios toques seguidos so carregam o ultimo
  function step(dir) {
    var n = state.streams.length;
    if (n < 2) return;
    var i = state.index;
    for (var tries = 0; tries < n; tries++) {
      i = (i + dir + n) % n;
      if (!state.canPlay || state.canPlay(state.streams[i])) break;
    }
    if (i === state.index) return;
    state.index = i;
    showInfo(state.streams[i]);
    clearTimeout(switchTimer);
    switchTimer = setTimeout(playCurrent, 450);
  }

  // ------------------------------------------------------------- TECLAS ---

  function onKey(e) {
    if (!state) return;
    var k = e.keyCode;
    var handled = true;
    if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE || e.key === "XF86Back") {
      close();
    } else if (k === KEY.UP || k === KEY.CH_UP || k === KEY.RIGHT) {
      step(1); // proximo canal
    } else if (k === KEY.DOWN || k === KEY.CH_DOWN || k === KEY.LEFT) {
      step(-1); // canal anterior
    } else if (k === KEY.ENTER || k === KEY.INFO) {
      showInfo(state.streams[state.index]);
    } else if (k === KEY.PLAY_PAUSE || k === KEY.PLAY || k === KEY.PAUSE) {
      togglePause();
    } else if (k === KEY.STOP) {
      close();
    } else {
      handled = false; // volume, mute etc. ficam com a TV
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }
  }

  function swallow(e) {
    if (!state) return;
    var k = e.keyCode;
    if (k === 447 || k === 448 || k === 449) return; // volume/mute
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  // ----------------------------------------------------------- PUBLICO ----

  function open(opts) {
    if (!opts || !opts.streams || !opts.streams.length) return;
    if (state) close(true);
    state = {
      streams: opts.streams.slice(),
      index: Math.max(0, Math.min(opts.index || 0, opts.streams.length - 1)),
      canPlay: opts.canPlay || null,
      onChannelChange: opts.onChannelChange || null,
      onClose: opts.onClose || null,
    };
    // Para qualquer player do preview que esteja tocando
    try {
      if (window.livePlayer && window.livePlayer.dispose) window.livePlayer.dispose();
    } catch (e) {}
    window.livePlayer = null;

    buildDom();
    hidePage();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    playCurrent();
  }

  function close(silent) {
    if (!state) return;
    var s = state;
    playToken++;
    clearTimeout(infoTimer);
    clearTimeout(switchTimer);
    stopPlayback();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", swallow, true);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    htmlVideo = null;
    restorePage();
    state = null;
    if (!silent && typeof s.onClose === "function") {
      try {
        s.onClose(s.streams[s.index], s.index);
      } catch (e) {}
    }
  }

  return {
    open: open,
    close: close,
    isOpen: function () {
      return !!state;
    },
  };
})();

window.LiveFullscreenPlayer = LiveFullscreenPlayer;
