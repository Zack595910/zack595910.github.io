/* =====================================================================
 * EZNT - Ecosystem Native Technology
 * EznK Architecture | Level 1 - Platform Layer
 *
 *   File    : js/platform/media.js
 *   Module  : EznK.Platform.Media  (alias: EZNT.Media)
 *   Layer   : L1 平台层
 *
 * ---------------------------------------------------------------------
 * 职责 (RESPONSIBILITY)
 * ---------------------------------------------------------------------
 *   The single media entry point of EZNT: camera, microphone, screen
 *   capture, speech, printing and audio signals.
 *
 *   Every device stream acquired here is OWNED and RELEASABLE (hard rule
 *   #6). The device manager, KD store, mmc and legacy camera API all
 *   resolve their hardware through this module.
 *
 *   Provides:
 *     - getUserMedia(constraints)      -> {status, value: {stream, id}}
 *     - camera(opts) / mic(opts)       -> preset constraints
 *     - stopStream(id) / stopAll()     -> releases tracks
 *     - grabFrame(streamOrId)          -> {status, value: canvas}
 *     - capturePhoto(streamOrId, opts) -> {status, value: dataURL}
 *     - startRecording / stopRecording  -> audio Blob
 *     - captureScreen()                -> screen stream (getDisplayMedia)
 *     - speak(text, opts) / stopSpeech()
 *     - print(html) / printNode(node)
 *     - beep(freq, ms)                 -> WebAudio signal
 *     - listDevices()                  -> inputs/outputs
 *     - dispose()
 *
 *   Permission and hardware failures return EACCES / ENOSYS / EBUSY with
 *   a readable reason; they never reject.
 *
 * ---------------------------------------------------------------------
 * 硬规矩
 * ============================================================== */

(function (root) {
    'use strict';

    var G = root || (typeof globalThis !== 'undefined' ? globalThis : this);

    if (G.EznK && G.EznK.Platform && G.EznK.Platform.Media &&
        G.EznK.Platform.Media.__isEZNTMedia === true) {
        return;
    }

    var CORE = (G.EznK && G.EznK.Platform && G.EznK.Platform.Core);
    if (!CORE) {
        throw new Error('[EznK/L1] platform/media.js requires platform/core.js to load first');
    }

    var S = CORE.STATUS;
    var ok = CORE.ok;
    var fail = CORE.fail;
    var asyncOk = CORE.asyncOk;
    var asyncFail = CORE.asyncFail;
    var LOG = CORE.createLogger('EznK/L1:media');

    var DOC = G.document || null;
    var NAV = (typeof G.navigator !== 'undefined' && G.navigator) ? G.navigator : null;

    /* =================================================================
     * 1. Stream registry (ownership)
     * ============================================================== */

    var streams = Object.create(null);
    var seq = 0;
    var disposed = false;

    function alive() {
        if (disposed) { return fail(S.EPOWEROFF, { reason: 'media disposed' }); }
        return ok(true);
    }

    function track(stream, kind, label) {
        seq += 1;
        var id = 'stream' + seq;
        streams[id] = {
            id: id,
            kind: kind,
            label: label || kind,
            stream: stream,
            createdAt: Date.now(),
            active: true
        };
        return id;
    }

    function resolveRef(ref) {
        if (!ref) { return null; }
        if (typeof ref === 'string') {
            var rec = streams[ref];
            return rec ? rec.stream : null;
        }
        if (typeof ref.getTracks === 'function') { return ref; }
        if (ref.stream && typeof ref.stream.getTracks === 'function') { return ref.stream; }
        return null;
    }

    function stopTracks(stream) {
        try {
            stream.getTracks().forEach(function (t) {
                try { t.stop(); } catch (_) { /* ignore */ }
            });
        } catch (_) { /* ignore */ }
    }

    /* =================================================================
     * 2. Camera / microphone
     * ============================================================== */

    /** getUserMedia(constraints, opts) -> Promise<{status, value:{stream,id}}>
     *  opts.timeout (default 15000ms): a permission prompt that never
     *  resolves must not hang the caller - it settles with EBUSY. */
    function getUserMedia(constraints, opts) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (!NAV || !NAV.mediaDevices || typeof NAV.mediaDevices.getUserMedia !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'getUserMedia is not available in this environment' });
        }
        if (!constraints || typeof constraints !== 'object') {
            return asyncFail(S.EINVAL, { reason: 'constraints object required' });
        }
        var o = opts || {};
        var timeout = (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : 15000;
        return new Promise(function (resolve) {
            var settled = false;
            var timer = G.setTimeout(function () {
                if (settled) { return; }
                settled = true;
                resolve(fail(S.EBUSY, { reason: 'media capture timed out (permission prompt unanswered)' }));
            }, timeout);
            function settle(r) {
                if (settled) { return; }
                settled = true;
                G.clearTimeout(timer);
                resolve(r);
            }
            try {
                NAV.mediaDevices.getUserMedia(constraints).then(function (stream) {
                    var id = track(stream, o.kind || 'stream', o.label);
                    stream.getTracks().forEach(function (t) {
                        t.addEventListener('ended', function () {
                            var rec = streams[id];
                            if (rec) { rec.active = false; }
                        });
                    });
                    settle(ok({ id: id, stream: stream, kind: o.kind || 'stream' }));
                }, function (err) {
                    var name = err && err.name ? err.name : 'Error';
                    var code = S.EIO;
                    if (name === 'NotAllowedError' || name === 'SecurityError') { code = S.EACCES; }
                    else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') { code = S.ENOENT; }
                    else if (name === 'NotReadableError' || name === 'TrackStartError') { code = S.EBUSY; }
                    else if (name === 'OverconstrainedError') { code = S.EINVAL; }
                    settle(fail(code, { reason: 'media capture failed: ' + name, deviceError: name }));
                });
            } catch (err) {
                settle(fail(S.EIO, { reason: 'getUserMedia threw: ' + (err && err.message) }));
            }
        });
    }

    /** camera(opts) -> Promise<{status, value:{stream,id}}> */
    function camera(opts) {
        var o = opts || {};
        return getUserMedia({
            audio: false,
            video: {
                width: o.width || { ideal: 640 },
                height: o.height || { ideal: 480 },
                facingMode: o.facingMode || 'user',
                deviceId: o.deviceId ? { exact: o.deviceId } : undefined
            }
        }, { kind: 'camera', label: o.label || 'camera', timeout: o.timeout });
    }

    /** mic(opts) -> Promise<{status, value:{stream,id}}> */
    function mic(opts) {
        var o = opts || {};
        return getUserMedia({
            audio: {
                echoCancellation: o.echoCancellation !== false,
                noiseSuppression: o.noiseSuppression !== false,
                autoGainControl: o.autoGainControl !== false,
                deviceId: o.deviceId ? { exact: o.deviceId } : undefined
            },
            video: false
        }, { kind: 'mic', label: o.label || 'microphone', timeout: o.timeout });
    }

    /** captureScreen(opts) -> Promise<{status, value:{stream,id}}> */
    function captureScreen(opts) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (!NAV || !NAV.mediaDevices || typeof NAV.mediaDevices.getDisplayMedia !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'getDisplayMedia is not available' });
        }
        var o = opts || {};
        var timeout = (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : 15000;
        return new Promise(function (resolve) {
            var settled = false;
            var timer = G.setTimeout(function () {
                if (settled) { return; }
                settled = true;
                resolve(fail(S.EBUSY, { reason: 'screen capture timed out' }));
            }, timeout);
            function settle(r) {
                if (settled) { return; }
                settled = true;
                G.clearTimeout(timer);
                resolve(r);
            }
            try {
                NAV.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (stream) {
                    var id = track(stream, 'screen', 'screen');
                    settle(ok({ id: id, stream: stream, kind: 'screen' }));
                }, function (err) {
                    var name = err && err.name ? err.name : 'Error';
                    settle(fail(name === 'NotAllowedError' ? S.EACCES : S.EIO,
                        { reason: 'screen capture failed: ' + name, deviceError: name }));
                });
            } catch (err) {
                settle(fail(S.EIO, { reason: 'getDisplayMedia threw: ' + (err && err.message) }));
            }
        });
    }

    /** stopStream(ref) -> { status, value: boolean } */
    function stopStream(ref) {
        var id = (typeof ref === 'string') ? ref : null;
        if (id) {
            var rec = streams[id];
            if (!rec) { return fail(S.ENOENT, { reason: 'unknown stream id' }); }
            stopTracks(rec.stream);
            rec.active = false;
            delete streams[id];
            return ok(true);
        }
        var s = resolveRef(ref);
        if (!s) { return fail(S.EINVAL, { reason: 'stopStream needs a stream id or MediaStream' }); }
        stopTracks(s);
        Object.keys(streams).forEach(function (k) {
            if (streams[k].stream === s) { delete streams[k]; }
        });
        return ok(true);
    }

    /** stopAll() -> { status, value: number } */
    function stopAll() {
        var ids = Object.keys(streams);
        ids.forEach(function (id) { stopStream(id); });
        return ok(ids.length);
    }

    /** listStreams() -> { status, value: [{id,kind,active}] } */
    function listStreams() {
        var out = [];
        Object.keys(streams).forEach(function (id) {
            out.push({ id: id, kind: streams[id].kind, active: streams[id].active });
        });
        return ok(out);
    }

    /* =================================================================
     * 3. Frames / photos / recording
     * ============================================================== */

    /** grabFrame(ref) -> Promise<{status, value: HTMLCanvasElement}> */
    function grabFrame(ref) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        var s = resolveRef(ref);
        if (!s) { return asyncFail(S.EINVAL, { reason: 'grabFrame needs a stream id or MediaStream' }); }
        var video = s.getVideoTracks && s.getVideoTracks()[0];
        if (!video) { return asyncFail(S.EBADF, { reason: 'stream has no video track' }); }
        if (!DOC) { return asyncFail(S.ENOSYS, { reason: 'no document' }); }
        return new Promise(function (resolve) {
            var el = DOC.createElement('video');
            el.muted = true;
            el.playsInline = true;
            el.srcObject = s;
            var done = false;
            function finish(code, value) {
                if (done) { return; }
                done = true;
                try { el.pause(); } catch (_) { /* ignore */ }
                el.srcObject = null;
                resolve(code === S.OK ? ok(value) : fail(code, { reason: 'frame capture failed' }));
            }
            el.onloadedmetadata = function () {
                var w = el.videoWidth || 640;
                var h = el.videoHeight || 480;
                var cv = DOC.createElement('canvas');
                cv.width = w;
                cv.height = h;
                var ctx = cv.getContext('2d');
                if (!ctx) { finish(S.ENOSYS); return; }
                try {
                    ctx.drawImage(el, 0, 0, w, h);
                } catch (err) {
                    finish(S.EIO);
                    return;
                }
                finish(S.OK, cv);
            };
            el.onerror = function () { finish(S.EIO); };
            el.play().catch(function () { finish(S.EIO); });
            G.setTimeout(function () { finish(S.EBUSY); }, 5000);
        });
    }

    /** capturePhoto(ref, opts) -> Promise<{status, value: dataURL}> */
    function capturePhoto(ref, opts) {
        var o = opts || {};
        return grabFrame(ref).then(function (r) {
            if (r.status !== S.OK) { return r; }
            try {
                return ok(r.value.toDataURL(o.type || 'image/png', o.quality || 0.92));
            } catch (err) {
                return fail(S.EIO, { reason: 'toDataURL failed (tainted canvas?)' });
            }
        });
    }

    /** startRecording(ref) -> Promise<{status, value: {id}}> */
    var recorders = Object.create(null);
    function startRecording(ref, opts) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (typeof G.MediaRecorder !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'MediaRecorder is not available' });
        }
        var s = resolveRef(ref);
        if (!s) { return asyncFail(S.EINVAL, { reason: 'startRecording needs a stream' }); }
        var o = opts || {};
        return new Promise(function (resolve) {
            var rec;
            try {
                rec = new G.MediaRecorder(s, o.mimeType ? { mimeType: o.mimeType } : undefined);
            } catch (err) {
                resolve(fail(S.EINVAL, { reason: 'MediaRecorder create failed: ' + err.message }));
                return;
            }
            var chunks = [];
            seq += 1;
            var id = 'rec' + seq;
            recorders[id] = { id: id, rec: rec, chunks: chunks, blob: null, done: false };
            rec.ondataavailable = function (ev) {
                if (ev.data && ev.data.size > 0) { chunks.push(ev.data); }
            };
            rec.onstop = function () {
                var r = recorders[id];
                if (!r) { return; }
                r.blob = new G.Blob(chunks, { type: rec.mimeType || 'audio/webm' });
                r.done = true;
            };
            try {
                rec.start();
            } catch (err) {
                resolve(fail(S.EBUSY, { reason: 'MediaRecorder start failed: ' + err.message }));
                return;
            }
            resolve(ok({ id: id, mimeType: rec.mimeType }));
        });
    }

    /** stopRecording(id) -> Promise<{status, value: Blob}> */
    function stopRecording(id) {
        var r = recorders[id];
        if (!r) { return asyncFail(S.ENOENT, { reason: 'unknown recording id' }); }
        return new Promise(function (resolve) {
            var settled = false;
            function settle() {
                if (settled) { return; }
                settled = true;
                var blob = recorders[id] ? recorders[id].blob : null;
                delete recorders[id];
                resolve(blob ? ok(blob) : fail(S.EIO, { reason: 'no audio recorded' }));
            }
            r.rec.onstop = function () {
                var self = recorders[id];
                if (self) { self.blob = new G.Blob(self.chunks, { type: r.rec.mimeType || 'audio/webm' }); }
                settle();
            };
            try { r.rec.stop(); } catch (_) { settle(); }
            G.setTimeout(settle, 2000);
        });
    }

    /* =================================================================
     * 4. Speech synthesis
     * ============================================================== */

    /** speak(text, opts) -> Promise<{status, value: true}> */
    function speak(text, opts) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (!G.speechSynthesis || typeof G.SpeechSynthesisUtterance !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'speech synthesis not available' });
        }
        if (typeof text !== 'string' || text.length === 0) {
            return asyncFail(S.EINVAL, { reason: 'text required' });
        }
        var o = opts || {};
        return new Promise(function (resolve) {
            var u = new G.SpeechSynthesisUtterance(text);
            if (o.lang) { u.lang = o.lang; }
            if (typeof o.rate === 'number') { u.rate = o.rate; }
            if (typeof o.pitch === 'number') { u.pitch = o.pitch; }
            if (typeof o.volume === 'number') { u.volume = o.volume; }
            u.onend = function () { resolve(ok(true)); };
            u.onerror = function (ev) {
                resolve(fail(S.EIO, { reason: 'speech error: ' + (ev && ev.error) }));
            };
            try {
                G.speechSynthesis.speak(u);
            } catch (err) {
                resolve(fail(S.EIO, { reason: 'speak() failed: ' + err.message }));
            }
        });
    }

    function stopSpeech() {
        if (G.speechSynthesis) {
            try { G.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
        }
        return ok(true);
    }

    /* =================================================================
     * 5. Printing
     * ============================================================== */

    var printFrames = [];

    /**
     * print(html) -> Promise<{status, value: true}>
     *   Renders html in a hidden iframe and invokes its print dialog.
     *   The iframe is tracked and removed after printing / on dispose.
     */
    function print(html) {
        var a = alive();
        if (a.status !== S.OK) { return Promise.resolve(a); }
        if (!DOC) { return asyncFail(S.ENOSYS, { reason: 'no document' }); }
        if (typeof html !== 'string') {
            return asyncFail(S.EINVAL, { reason: 'html string required' });
        }
        return new Promise(function (resolve) {
            var f = DOC.createElement('iframe');
            f.style.position = 'fixed';
            f.style.right = '0';
            f.style.bottom = '0';
            f.style.width = '0';
            f.style.height = '0';
            f.style.border = '0';
            f.setAttribute('aria-hidden', 'true');
            printFrames.push(f);
            f.onload = function () {
                try {
                    var w = f.contentWindow;
                    w.focus();
                    w.print();
                    G.setTimeout(function () {
                        try { f.remove(); } catch (_) { /* ignore */ }
                        var i = printFrames.indexOf(f);
                        if (i >= 0) { printFrames.splice(i, 1); }
                    }, 60000);
                    resolve(ok(true));
                } catch (err) {
                    resolve(fail(S.EIO, { reason: 'print failed: ' + err.message }));
                }
            };
            DOC.body.appendChild(f);
            var doc = f.contentWindow.document;
            doc.open();
            doc.write(html);
            doc.close();
        });
    }

    /** printNode(node) - prints an element's outerHTML. */
    function printNode(node) {
        if (!node || typeof node.outerHTML !== 'string') {
            return asyncFail(S.EINVAL, { reason: 'printNode needs an Element' });
        }
        return print('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
            node.outerHTML + '</body></html>');
    }

    /* =================================================================
     * 6. Audio signals
     * ============================================================== */

    var audioCtx = null;

    /** beep(freq, ms, opts) -> { status, value: true } */
    function beep(freq, ms, opts) {
        var a = alive();
        if (a.status !== S.OK) { return a; }
        var Ctor = G.AudioContext || G.webkitAudioContext;
        if (!Ctor) { return fail(S.ENOSYS, { reason: 'WebAudio not available' }); }
        if (typeof freq !== 'number' || freq <= 0) {
            return fail(S.EINVAL, { reason: 'freq must be a positive number' });
        }
        var duration = (typeof ms === 'number' && ms > 0) ? ms : 120;
        var o = opts || {};
        try {
            if (!audioCtx) { audioCtx = new Ctor(); }
            if (audioCtx.state === 'suspended' && audioCtx.resume) { audioCtx.resume(); }
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = o.type || 'sine';
            osc.frequency.value = freq;
            gain.gain.value = typeof o.volume === 'number' ? o.volume : 0.08;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            var now = audioCtx.currentTime;
            osc.start(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);
            osc.stop(now + duration / 1000);
            return ok(true);
        } catch (err) {
            return fail(S.EIO, { reason: 'beep failed: ' + err.message });
        }
    }

    /* =================================================================
     * 7. Device listing
     * ============================================================== */

    /** listDevices() -> Promise<{status, value: {video, audioIn, audioOut}}> */
    function listDevices() {
        if (!NAV || !NAV.mediaDevices || typeof NAV.mediaDevices.enumerateDevices !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'enumerateDevices unavailable' });
        }
        return NAV.mediaDevices.enumerateDevices().then(function (list) {
            var out = { video: [], audioIn: [], audioOut: [] };
            list.forEach(function (d) {
                var item = { deviceId: d.deviceId, label: d.label || '(unnamed)', groupId: d.groupId };
                if (d.kind === 'videoinput') { out.video.push(item); }
                else if (d.kind === 'audioinput') { out.audioIn.push(item); }
                else if (d.kind === 'audiooutput') { out.audioOut.push(item); }
            });
            return ok(out);
        }, function (err) {
            return fail(S.EIO, { reason: 'enumerateDevices failed: ' + (err && err.message) });
        });
    }

    /** hasPermission(name) -> Promise<{status, value:'granted'|'denied'|'prompt'}> */
    function hasPermission(name) {
        if (!NAV || !NAV.permissions || typeof NAV.permissions.query !== 'function') {
            return asyncFail(S.ENOSYS, { reason: 'permissions API unavailable' });
        }
        var n = name || 'camera';
        return NAV.permissions.query({ name: n }).then(function (res) {
            return ok(res.state);
        }, function (err) {
            return fail(S.EINVAL, { reason: 'permission query failed: ' + (err && err.message) });
        });
    }

    /* =================================================================
     * 8. Lifecycle
     * ============================================================== */

    function dispose() {
        stopAll();
        Object.keys(recorders).forEach(function (id) {
            try { recorders[id].rec.stop(); } catch (_) { /* ignore */ }
            delete recorders[id];
        });
        printFrames.forEach(function (f) {
            try { f.remove(); } catch (_) { /* ignore */ }
        });
        printFrames = [];
        if (audioCtx) {
            try { audioCtx.close(); } catch (_) { /* ignore */ }
            audioCtx = null;
        }
        stopSpeech();
        disposed = true;
        LOG.info('media disposed');
        return ok(true);
    }

    /* =================================================================
     * 9. Public handles
     * ============================================================== */

    var Media = {};
    Media.__isEZNTMedia = true;
    Media.version = '1.0.0';
    Media.STATUS = S;

    Media.getUserMedia = getUserMedia;
    Media.camera = camera;
    Media.mic = mic;
    Media.captureScreen = captureScreen;
    Media.stopStream = stopStream;
    Media.stopAll = stopAll;
    Media.listStreams = listStreams;
    Media.grabFrame = grabFrame;
    Media.capturePhoto = capturePhoto;
    Media.startRecording = startRecording;
    Media.stopRecording = stopRecording;
    Media.speak = speak;
    Media.stopSpeech = stopSpeech;
    Media.print = print;
    Media.printNode = printNode;
    Media.beep = beep;
    Media.listDevices = listDevices;
    Media.hasPermission = hasPermission;
    Media.dispose = dispose;

    CORE.attach('Media', Media);
    LOG.info('platform/media.js 已加载');

}(typeof globalThis !== 'undefined' ? globalThis : this));
