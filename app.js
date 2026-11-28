// Ontario DECA Practice. Accounts and test history are stored in the school's Supabase project.
(function () {
  'use strict'
  var MINUTES = 70
  var IDX = window.DECA_INDEX
  var LS = 'decaweb.v1', CFG = window.DECA_CFG, SB = 'decaweb.session'
  var $ = function (s) { return document.querySelector(s) }
  var main = $('#main'), bar = $('#bar'), topright = $('#topright')
  var st = load()
  var timerId = null, loaded = {}, test = null, popping = false
  function mark(v, id) { if (!popping) history.pushState({ v: v, id: id }, '') }
  window.addEventListener('popstate', function (ev) {
    var s = ev.state || { v: 'list' }; popping = true
    try {
      if (s.v === 'instr' && examById(s.id)) instructions(examById(s.id))
      else if (s.v === 'results' && st.results[s.id]) results(st.results[s.id])
      else if (s.v === 'login') showLogin()
      else if (s.v === 'account') showAccount()
      else if (s.v === 'admin' && st.user && st.user.admin) showAdmin()
      else showList()
    } finally { popping = false }
  })

  function load() {
    try { var s = JSON.parse(localStorage.getItem(LS)); if (s) return s } catch (e) {}
    return { user: { name: '', school: '' }, results: {}, hist: [], pending: [], active: null, study: false }
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)) } catch (e) {} }
  // ---------- server ----------
  function sess() { try { return JSON.parse(localStorage.getItem(SB)) } catch (e) { return null } }
  function setSess(x) { try { x ? localStorage.setItem(SB, JSON.stringify(x)) : localStorage.removeItem(SB) } catch (e) {} }
  function tokenReq(q, body) {
    return fetch(CFG.url + '/auth/v1/token?grant_type=' + q, { method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok || !j.access_token) throw { auth: true, msg: j.error_description || j.msg || 'Login failed' }; return j })
    })
  }
  function keep(j) { var x = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), uid: j.user && j.user.id || (sess() || {}).uid }; setSess(x); return x }
  function token() {
    var x = sess(); if (!x) return Promise.reject({ auth: true, msg: 'Not signed in' })
    if (x.expires_at - 60 > Date.now() / 1000) return Promise.resolve(x.access_token)
    return tokenReq('refresh_token', { refresh_token: x.refresh_token }).then(function (j) { return keep(j).access_token })
  }
  function rest(path, method, body) {
    return token().then(function (t) {
      return fetch(CFG.url + '/rest/v1/' + path, { method: method || 'GET', headers: { apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
        if (!r.ok) return r.text().then(function (m) { throw { msg: m } })
        return method === 'POST' ? null : r.json()
      })
    })
  }
  function rpc(name, body) {
    return token().then(function (t) {
      return fetch(CFG.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) {
        return r.text().then(function (m) {
          if (!r.ok) { var msg = m; try { msg = JSON.parse(m).message || m } catch (e) {} throw { msg: msg } }
          return m ? JSON.parse(m) : null
        })
      })
    })
  }
  function useAccount(uid) { LS = 'decaweb.u.' + uid; st = load() }
  function indexAttempts() {
    st.results = {}
    ;(st.hist || []).forEach(function (a) {
      var ex = IDX.exams.filter(function (e) { return e.name === a.name })[0] || examById(a.exam_id)
      if (ex) st.results[ex.id] = { id: ex.id, name: ex.name, ts: a.ts, score: a.score, total: a.total, ans: a.ans }
    })
  }
  function flushPending() {
    var p = st.pending || []; if (!p.length) return Promise.resolve()
    st.pending = []; save()
    return p.reduce(function (pr, rec) { return pr.then(function () { return rest('attempts', 'POST', rec).catch(function () { st.pending.push(rec); save() }) }) }, Promise.resolve())
  }
  function syncAll() {
    var x = sess(); if (!x) return Promise.reject({ auth: true })
    useAccount(x.uid)
    return rest('profiles?select=name,school,student_id,is_admin&id=eq.' + x.uid).then(function (p) { if (p[0]) st.user = { name: p[0].name, school: p[0].school, sid: p[0].student_id, admin: !!p[0].is_admin } }).then(flushPending).then(function () {
      return rest('attempts?select=id,exam_id,name,cluster,score,total,seconds,ans,items,taken_at&user_id=eq.' + x.uid + '&order=taken_at.desc&limit=300')
    }).then(function (rows) {
      st.hist = rows.reverse().map(function (a) { return { id: a.id, exam_id: a.exam_id, name: a.name, cluster: a.cluster, score: a.score, total: a.total, ans: a.ans, items: a.items, ts: Date.parse(a.taken_at) } })
      indexAttempts(); save()
    })
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
  function h(html) { main.innerHTML = html; window.scrollTo(0, 0) }
  function setBar(t, c) { bar.textContent = t; document.body.className = c || (t === 'Your Information and Test Selection' ? 'list' : ''); var lg = $('#leg'); if (!lg) { lg = document.createElement('div'); lg.id = 'leg'; bar.parentNode.insertBefore(lg, bar.nextSibling) } lg.innerHTML = ''; var li = $('#logoimg'); if (li) li.src = c === 'test' ? 'logo2.png' : 'logo.png' }
  var L = 'ABCDE'

  // ---------- data ----------
  function loadFile(file) {
    if (loaded[file]) return loaded[file]
    loaded[file] = new Promise(function (ok, bad) {
      var s = document.createElement('script')
      s.src = file; s.onload = ok; s.onerror = function () { bad(new Error('Could not load ' + file + ' (keep the data folder next to index.html)')) }
      document.head.appendChild(s)
    })
    return loaded[file]
  }
  function rowsOf(id) { return window.DECA_DATA && window.DECA_DATA[id] }
  function examById(id) { return IDX.exams.filter(function (e) { return e.id === id })[0] }
  function files(list) { var f = {}; list.forEach(function (e) { f[e.file] = 1 }); return Object.keys(f) }

  function logout() { setSess(null); st = { user: { name: '', school: '' }, results: {}, hist: [], pending: [], active: null }; LS = 'decaweb.v1'; showLogin() }

  // ---------- sign-on ----------
  function showLogin() {
    clearInterval(timerId); test = null; topright.innerHTML = ''; bar.textContent = ''; var lg = $('#leg'); if (lg) lg.innerHTML = ''
    document.body.className = 'login'; mark('login')
    h('<div class="lg-title">Ontario DECA Practice</div><div class="lg-wrap"><div class="lg-card">' +
      '<img src="logo2.png" alt="DECA" class="lg-logo">' +
      '<p><b>Practice Portal now open for all Ontario DECA delegates!</b></p>' +
      '<p>This is just for you to <b>PRACTICE</b>! Use the portal to Practice as many times as you wish!</p>' +
      '<ul><li>100 questions, ' + MINUTES + ' minutes time limit per test</li><li>can write as many times as you like <b>ANY</b> of the exams</li><li>can write at home or at school - NO RESTRICTIONS!</li></ul>' +
      '<p>You will be able to see if your answer is correct after answering each question.</p>' +
      '<p class="lg-red"><b>The RED shaded questions were answered incorrectly.</b></p>' +
      '<p><b>PLEASE NOTE:</b></p><ul><li>Questions answered incorrectly have an asterisk (<span class="red">*</span>) to their left and are highlighted in <span class="red">RED</span>.</li><li>The correct answer(s) have a double asterisk (<b class="green">**</b>) to their right and are highlighted in <span class="green">GREEN</span>.</li></ul>' +
      '</div><div class="lg-form"><h2>Sign-On</h2><input id="lg_id" placeholder="Enter Student ID" autocomplete="off"><input id="lg_pw" type="password" placeholder="Enter Password" autocomplete="off">' +
      '<label class="lg-show"><input type="checkbox" id="lg_sp"> Show Password</label><button id="lg_go">Login</button><div id="lg_msg" class="lg-msg"></div></div></div>')
    $('#lg_sp').onchange = function (e) { $('#lg_pw').type = e.target.checked ? 'text' : 'password' }
    var go = function () {
      var id = $('#lg_id').value.trim(), pw = $('#lg_pw').value, m = $('#lg_msg')
      if (!id || !pw) { m.textContent = 'Enter your Student ID and password.'; return }
      m.style.color = '#fff'; m.textContent = 'Signing in...'; $('#lg_go').disabled = true
      var email = id.indexOf('@') >= 0 ? id.toLowerCase() : id.toLowerCase() + CFG.domain
      tokenReq('password', { email: email, password: pw }).then(function (j) { keep(j); return syncAll() }).then(showList).catch(function (e) {
        $('#lg_go').disabled = false; m.style.color = '#ff6b6b'
        m.textContent = e && e.auth ? 'Incorrect Student ID or password.' : 'Could not reach the server. Check your internet connection and try again.'; setSess(null)
      })
    }
    $('#lg_go').onclick = go
    main.querySelectorAll('.lg-form input').forEach(function (i) { i.onkeydown = function (e) { if (e.key === 'Enter') go() } })
  }

  // ---------- list ----------
  var clusterOpen = {}
  function showList() {
    clearInterval(timerId); test = null; topright.innerHTML = (st.user && st.user.admin ? '<button id="adm" class="logout" style="margin-right:8px">Admin</button>' : '') + '<button id="acct" class="logout" style="margin-right:8px">My Account</button><button id="lo" class="logout">Log Out</button>'; mark('list')
    setBar('Your Information and Test Selection')
    var u = st.user, clusters = {}
    IDX.exams.forEach(function (e) { (clusters[e.cluster] = clusters[e.cluster] || []).push(e) })
    var names = Object.keys(clusters).sort()
    var html = '<div class="box"><h3>Your Information</h3><div class="body info">' +
      '<div><b>Name</b>' + esc(u.name) + '<b>School</b>' + esc(u.school) + '</div></div></div>' +
      '<div class="note2"><b>NOTE:</b> Once you click on a link to select a test, you will be taken to an instruction page before the test starts</div>'
    if (st.active) html += '<div class="note2" style="background:#fcf0cf;color:#6b5400;border-color:#f0e0a8">You have a test in progress: <b>' + esc(st.active.name) + '</b> <button id="resume">Resume</button> <button id="drop">Discard</button></div>'
    html += '<div class="box tl"><h3>Please select a test to take</h3><div class="body"><table class="tests">'
    names.forEach(function (c) {
      var list = clusters[c]
      html += '<tr><td class="cl" colspan="2"><a href="#" data-c="' + esc(c) + '">' + (clusterOpen[c] ? '&#9662; ' : '&#9656; ') + esc(c) + '</a></td></tr>'
      if (clusterOpen[c]) list.forEach(function (e) {
        var r = st.results[e.id]
        html += '<tr><td>' + esc(e.name) + (r ? ' <b>(Finished)</b>' : '') + '</td><td style="width:300px">' +
          (r ? '<button class="bb" data-e="' + e.id + '">Retake</button> <button data-r="' + e.id + '">Show Test Results</button>' : '<button data-e="' + e.id + '">Select</button>') + '</td></tr>'
      })
    })
    html += '</table></div></div>'
    h(html)
    $('#lo').onclick = logout
    $('#acct').onclick = showAccount
    if ($('#adm')) $('#adm').onclick = function () { showAdmin() }
    if (st.active) { $('#resume').onclick = resume; $('#drop').onclick = function () { st.active = null; save(); showList() } }
    main.querySelectorAll('[data-c]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); clusterOpen[a.dataset.c] = !clusterOpen[a.dataset.c]; var y = window.scrollY; showList(); window.scrollTo(0, y) } })
    main.querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { instructions(examById(b.dataset.e)) } })
    main.querySelectorAll('[data-r]').forEach(function (b) { b.onclick = function () { results(st.results[b.dataset.r]) } })
  }

  // ---------- instructions ----------
  function instructions(e) {
    setBar(e.name); topright.innerHTML = ''; if (!e.mixed) mark('instr', e.id)
    h('<div class="box"><h3>Test Instructions</h3><div class="body">You will have ' + MINUTES + ' minutes to complete the test.</div></div>' +
      '<div class="box" style="width:520px;max-width:100%;margin:12px auto"><h3>Start Test</h3><div class="body"><p style="text-align:center">Once you click on the START TEST button, the timer will be started!</p>' +
      '<div style="text-align:center"><button id="go" style="padding:8px 14px"><b>START TEST</b></button></div></div></div>' +
      '<p><a href="#" id="back">Back to Test List</a></p>')
    $('#back').onclick = function (ev) { ev.preventDefault(); showList() }
    $('#go').onclick = function () {
      var go = function (rows) { start(e, rows) }
      if (e.rows) go(e.rows)
      else loadFile(e.file).then(function () { go(rowsOf(e.id)) }, function (er) { alert(er.message) })
    }
  }

  // ---------- test ----------
  function start(e, rows) {
    test = { id: e.id, name: e.name, rows: rows, ans: rows.map(function () { return null }), cur: 0, max: 0, endAt: Date.now() + MINUTES * 60000, study: false, mixed: !!e.mixed }
    persist(); runTest()
  }
  function persist() { st.active = { id: test.id, name: test.name, rows: test.rows, ans: test.ans, cur: test.cur, max: test.max, left: test.left, endAt: test.endAt, study: test.study, mixed: test.mixed }; save() }
  function resume() { var a = st.active; test = { id: a.id, name: a.name, rows: a.rows, ans: a.ans, cur: a.cur, max: a.max || a.cur, left: a.left || {}, endAt: a.endAt, study: a.study, mixed: a.mixed }; runTest() }
  function fmt(ms) { var s = Math.max(0, Math.round(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(function (x) { return (x < 10 ? '0' : '') + x }).join(':') }
  function runTest() {
    setBar(test.name, 'test')
    var u = st.user.name.split(/\s+/), who = u.length > 1 ? u[u.length - 1] + ', ' + u.slice(0, -1).join(' ') : u[0]
    bar.innerHTML = '<button id="calcb" class="calcbtn" title="Calculator"><img src="calc.png" alt="calculator"></button><div class="bt">' + esc(test.name) + '<small>' + esc(who) + ' at ' + esc(st.user.school.replace(/\s*\(ON\)$/, '')) + '</small></div><img class="wifi" src="wifi.png" alt="">'
    $('#leg').innerHTML = legend()
    topright.innerHTML = '<button id="minb" class="minb">-</button><div class="timer" id="timerbox"><span id="tm"></span><small>Time Remaining</small></div>'
    $('#minb').onclick = function () { var t = $('#timerbox'); t.style.visibility = t.style.visibility === 'hidden' ? 'visible' : 'hidden' }
    $('#calcb').onclick = toggleCalc
    var tick = function () { var left = test.endAt - Date.now(); $('#tm').textContent = fmt(left); if (left <= 0) { clearInterval(timerId); submit(true) } }
    clearInterval(timerId); timerId = setInterval(tick, 1000); tick()
    question()
  }
  function legend() {
    return '<div class="legend"><div>Question has NOT been answered.<br><span class="dot n"></span></div><div>Answer has NOT been saved.<br><span class="dot u"></span></div><div>Answer HAS been saved.<br><span class="dot s"></span></div></div>'
  }
  function alertBox(extra) {
    return '<div class="alertr" id="alr"><span class="cls" id="alx">&times;</span><b>PLEASE NOTE:</b><ul><li>You may Not leave this page until the test Is complete. Doing so will submit your test.</li>' + (extra ? '<li>Unanswered questions have an asterisk (?) to their left and are highlighted in DARK RED.</li>' : '') + '</ul></div>'
  }
  function wireAlert() { var x = $('#alx'); if (x) x.onclick = function () { $('#alr').style.display = 'none' } }
  function qBlock(r, u, num, locked, skipped) {
    var bad = u != null && u !== r[3], done = u != null
    return '<div class="q' + (bad ? ' red' : '') + (skipped ? ' skip' : '') + '"><span class="dot ' + (done ? 's' : 'n') + '"></span>' + (bad ? '<span class="star">*</span> ' : skipped ? '? ' : '<span class="star"></span> ') + num + ' ' + esc(r[1]) + '</div>' +
      r[2].map(function (o, j) {
        var cls = done ? (j === r[3] ? ' green' : (j === u ? ' red' : '')) : ''
        return '<div class="opt' + cls + (skipped ? ' skip' : '') + '"><label><input type="radio" name="o" value="' + j + '"' + (j === u ? ' checked' : '') + (locked ? ' onclick="return false"' : '') + '>' + L[j] + '. ' + esc(o) + '</label>' + (done && j === r[3] ? '<span style="margin-left:40px"><b>**</b></span>' : '') + '</div>'
      }).join('') + (done ? expHtml(r) : '')
  }
  function question(keep) {
    var r = test.rows[test.cur], a = test.ans[test.cur], n = test.rows.length
    var back = false
    for (var k = 0; k <= test.max; k++) if (k !== test.cur && test.ans[k] == null) back = true
    var html = alertBox(true) +
      '<div class="navs">' + (back ? '<button id="prevu" style="left:14%">&lt;&lt; Previous Unanswered</button>' : '') + (test.cur > 0 ? '<button id="prev" style="left:5%">&lt;&lt; Prev</button>' : '') + '<button id="next" style="left:35.2%">Next &gt;&gt;</button>' + (back ? '<button id="nextu" style="left:47.8%">Next Unanswered &gt;&gt;</button>' : '') + '</div>' +
      '<div class="note"><b>PLEASE NOTE:</b><ul><li>Questions answered incorrectly have an asterisk (<span class="red">*</span>) to their left and are highlighted in <span class="red">RED</span>.</li><li>The correct answer(s) have a double asterisk (<span class="green">**</span>) to their right and are highlighted in <span class="green">GREEN</span>.</li></ul></div>' +
      qBlock(r, a, (test.cur + 1) + '.', false, a == null && !!(test.left && test.left[test.cur]))
    if (keep) { var y = window.scrollY; main.innerHTML = html; window.scrollTo(0, y) } else h(html)
    wireAlert()
    if ($('#prev')) $('#prev').onclick = function () { go(test.cur - 1) }
    $('#next').onclick = function () { test.cur + 1 >= n ? review() : go(test.cur + 1) }
    if (back) $('#prevu').onclick = function () { for (var k = 1; k <= n; k++) { var i = (test.cur - k + n) % n; if (i <= test.max && test.ans[i] == null) return go(i) } }
    if (back) $('#nextu').onclick = function () { for (var k = 1; k <= n; k++) { var i = (test.cur + k) % n; if (i <= test.max && test.ans[i] == null) return go(i) } }
    main.querySelectorAll('input[name=o]').forEach(function (inp) { inp.onchange = function () { test.ans[test.cur] = +inp.value; persist(); question(true) } })
  }
  function go(i) { if (test.ans[test.cur] == null) { test.left = test.left || {}; test.left[test.cur] = 1 } test.cur = Math.max(0, Math.min(test.rows.length - 1, i)); test.max = Math.max(test.max, test.cur); persist(); question() }
  function review() {
    var un = test.ans.filter(function (x) { return x == null }).length
    h(alertBox(false) +
      '<p>' + (un ? 'You have <b class="red">unanswered questions</b> on your test.' : 'All questions are answered.') + '</p>' +
      '<p style="font-size:24px">Please review all your answers.</p><p>You are unable to change your answers within the review. To change an answer, click on the underlined question.</p>' +
      '<p>When you are sure you are finished, click the <b>Submit Test</b> button ONLY ONCE to submit your test.</p><button id="sub" style="padding:8px 14px">Submit Test</button>' +
      '<div class="review">' + test.rows.map(function (r, i) {
        var a = test.ans[i]
        return '<div class="q ' + (a == null ? 'unans' : '') + '"><span class="dot ' + (a == null ? 'n' : 's') + '"></span> ' + (a == null ? '<span class="red">?</span> ' : '') + '<a data-i="' + i + '">' + (i + 1) + '. ' + esc(r[1]) + '</a></div>' +
          r[2].map(function (o, k) { return '<div class="opt"><input type="radio" onclick="return false"' + (a === k ? ' checked' : '') + '>' + L[k] + '. ' + esc(o) + '</div>' }).join('')
      }).join('') + '</div>' +
      '<p>If you have finished reviewing your answers, click the "Submit Test" button to submit your test.</p><button id="sub2" style="padding:8px 14px">Submit Test</button>')
    wireAlert()
    $('#sub').onclick = $('#sub2').onclick = function () { if (un && !confirm('You have ' + un + ' unanswered question(s). Submit anyway?')) return; submit(false) }
    main.querySelectorAll('[data-i]').forEach(function (a) { a.onclick = function () { go(+a.dataset.i) } })
  }
  function submit() {
    clearInterval(timerId); closeCalc()
    var score = 0
    test.rows.forEach(function (r, i) { if (test.ans[i] === r[3]) score++ })
    var res = { id: test.id, name: test.name, ts: Date.now(), score: score, total: test.rows.length, ans: test.ans, rows: test.mixed ? test.rows : null, mixed: test.mixed }
    st.results[test.id] = res
    var ex = examById(test.id), items = test.rows.map(function (r, i) { var ok = test.ans[i] === r[3]; return ok ? [r[5] || '', r[6] || '', r[7] || '', 1] : [r[5] || '', r[6] || '', r[7] || '', 0, r[0], r[1].slice(0, 140)] })
    var rec = { exam_id: test.id, name: test.name, cluster: ex ? ex.cluster : 'Mixed', score: score, total: test.rows.length, seconds: Math.round((MINUTES * 60000 - (test.endAt - Date.now())) / 1000), ans: test.ans, items: items }
    if (!st.hist) st.hist = []
    st.hist.push({ exam_id: rec.exam_id, name: rec.name, cluster: rec.cluster, score: score, total: rec.total, ans: test.ans, items: items, ts: Date.now() })
    rest('attempts', 'POST', rec).catch(function () { st.pending = (st.pending || []).concat([rec]); save() })
    st.active = null; save()
    results(res)
  }

  // ---------- results / explanation ----------
  function expHtml(r) {
    var code = r[5], text = r[6], area = r[7]
    return '<div class="exp"><div><b>Explanation:</b> ' + (r[4] ? esc(r[4]) : 'None listed in this exam key.') + '</div>' +
      '<div><b>PI:</b> ' + (code ? esc(code) : 'None listed') + (text ? ' - ' + esc(text) : '') + (area && !/^Area code/.test(area) ? ' (' + esc(area) + ')' : '') + '</div></div>'
  }
  function results(res) {
    clearInterval(timerId); topright.innerHTML = '<button id="home">Test list</button>'
    $('#home').onclick = showList; mark('results', res.id)
    setBar(res.name + ' - Results')
    var rows = res.rows || (rowsOf(res.id) || []), a = res.ans
    if (!rows.length) { var e = examById(res.id); if (e) return loadFile(e.file).then(function () { res.rows = null; results(res) }) }
    var html = '<p style="font-size:22px">Score: ' + res.score + ' / ' + res.total + ' (' + Math.round(100 * res.score / res.total) + '%)</p>' +
      '<div class="note"><b>PLEASE NOTE:</b><ul><li>Questions answered incorrectly have an asterisk (<span class="red">*</span>) to their left and are highlighted in <span class="red">RED</span>.</li>' +
      '<li>The correct answer(s) have a double asterisk (<b class="green">**</b>) to their right and are highlighted in <span class="green">GREEN</span>.</li></ul></div>'
    rows.forEach(function (r, i) { html += qBlock(r, a[i] == null ? -1 : a[i], (i + 1) + '.', true) })
    html += '<p><button id="dl">Download Report</button> <button id="retake">Retake</button></p>'
    h(html)
    $('#dl').onclick = function () { downloadReport(res, rows) }
    $('#retake').onclick = function () { var e = examById(res.id); if (e) instructions(e); else instructions({ id: res.id, name: res.name, rows: rows, n: rows.length, mixed: true }) }
  }

  // ---------- report / account ----------
  function download(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/html' })); a.download = name
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }
  var RCSS = '<style>body{font-family:Arial,Helvetica,sans-serif;margin:30px;color:#000}h1{font-size:22px}h2{font-size:18px;margin-top:26px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #666;padding:4px 6px;text-align:left;vertical-align:top;font-size:14px}.q{margin:16px 0 4px}.red{color:#e8291c}.green{color:#2f7d1f}.x{margin-left:30px;font-size:14px}</style>'
  function downloadReport(res, rows) {
    var a = res.ans, miss = [], byPi = {}
    rows.forEach(function (r, i) { if (a[i] !== r[3]) { miss.push(i); var k = r[5] || 'No PI'; byPi[k] = byPi[k] || { n: 0, t: r[6] || '' }; byPi[k].n++ } })
    var h2 = '<html><head><meta charset="utf-8"><title>Report</title>' + RCSS + '</head><body><h1>Ontario DECA Practice - Test Report</h1>' +
      '<p>' + esc(st.user.name) + ' - ' + esc(st.user.school) + '<br>' + esc(res.name) + '<br>' + new Date(res.ts || Date.now()).toLocaleString() + '</p>' +
      '<p><b>Score: ' + res.score + ' / ' + res.total + ' (' + Math.round(100 * res.score / res.total) + '%)</b> - Wrong: ' + miss.filter(function (i) { return a[i] != null }).length + ' - Unanswered: ' + miss.filter(function (i) { return a[i] == null }).length + '</p>'
    var keys = Object.keys(byPi).sort(function (x, y) { return byPi[y].n - byPi[x].n })
    if (keys.length) h2 += '<h2>Missed questions by PI</h2><table><tr><th>PI</th><th>Description</th><th>Missed</th></tr>' + keys.map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(byPi[k].t) + '</td><td>' + byPi[k].n + '</td></tr>' }).join('') + '</table>'
    h2 += '<h2>Questions answered incorrectly or left blank</h2>'
    miss.forEach(function (i) {
      var r = rows[i], u = a[i]
      h2 += '<div class="q"><b>' + (i + 1) + '.</b> ' + esc(r[1]) + '</div><div class="x red">Your answer: ' + (u == null ? '(none)' : L[u] + '. ' + esc(r[2][u])) + '</div><div class="x green">Correct answer: ' + L[r[3]] + '. ' + esc(r[2][r[3]]) + '</div>' +
        '<div class="x">Explanation: ' + esc(r[4] || 'None listed') + '</div><div class="x">PI: ' + esc(r[5] || 'None') + (r[6] ? ' - ' + esc(r[6]) : '') + '</div>'
    })
    if (!miss.length) h2 += '<p>Perfect score - nothing missed.</p>'
    download('DECA-report-' + res.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) + '.html', h2 + '</body></html>')
  }
  function agg() {
    var H = st.hist || [], pi = {}, ar = {}, cl = {}, qs = {}
    H.forEach(function (t) {
      var c = cl[t.cluster] = cl[t.cluster] || { s: 0, n: 0, t: 0 }; c.s += t.score; c.t += t.total; c.n++
      t.items.forEach(function (it) {
        var k = it[0] || 'No PI', p = pi[k] = pi[k] || { t: 0, w: 0, txt: it[1] }; p.t++; if (!it[3]) p.w++; if (!p.txt) p.txt = it[1]
        var a = it[2] || 'Other', q = ar[a] = ar[a] || { t: 0, w: 0 }; q.t++; if (!it[3]) q.w++
        if (!it[3] && it[4]) { var m = qs[it[4]] = qs[it[4]] || { n: 0, q: it[5] }; m.n++ }
      })
    })
    return { H: H, pi: pi, ar: ar, cl: cl, qs: qs }
  }
  function bars(rows, color) {
    return rows.map(function (r) { return '<div style="display:flex;align-items:center;margin:3px 0;font-size:14px"><div style="width:300px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(r.title || r.label) + '">' + esc(r.label) + '</div><div style="flex:1;background:#eee;height:16px;margin:0 8px"><div style="width:' + Math.max(0, Math.min(100, r.v)) + '%;height:16px;background:' + (r.color || color) + '"></div></div><div style="width:150px;flex:none">' + esc(r.right) + '</div></div>' }).join('')
  }

  // ---------- admin portal ----------
  var SCHOOL = 'A.B. Lucas S.S.'
  var adm = { tab: 'overview', q: '', f: 'all', k: 'name', dir: 1, sel: {}, rows: [], view: [], ov: null }
  function demoOn() { try { return localStorage.getItem('decaweb.demo') === '1' } catch (e) { return false } }
  function setDemo(v) { try { localStorage.setItem('decaweb.demo', v ? '1' : '0') } catch (e) {} }
  function ago(ts) { if (!ts) return 'never'; var d = Math.floor((Date.now() - Date.parse(ts)) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago' }
  function dur(s) { s = Math.round(s || 0); return Math.floor(s / 60) + 'm ' + (s % 60) + 's' }
  function hue(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x }
  function avatar(name, big) { var n = String(name || '?').trim(), p = n.split(/\s+/), t = ((p[0] || '')[0] || '') + ((p.length > 1 ? p[p.length - 1][0] : '') || ''), hh = hue(n); return '<span class="ad-av' + (big ? ' big' : '') + '" style="background:hsl(' + hh + ',60%,92%);color:hsl(' + hh + ',55%,32%)">' + esc(t.toUpperCase()) + '</span>' }
  function sStatus(r) {
    if (!r.tests) return r.last_sign_in ? ['Not started', 'gray'] : ['Invited', 'gray']
    var d = (Date.now() - Date.parse(r.last_test)) / 864e5
    return d < 7 ? ['Active', 'green'] : d < 21 ? ['Slipping', 'amber'] : ['Inactive', 'red']
  }
  function badge(r) { var s = sStatus(r); return '<span class="ad-badge ' + s[1] + '">' + s[0] + '</span>' }
  function copyText(t) { try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t) } catch (e) {} var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy') } catch (e) {} a.remove(); return Promise.resolve() }
  function toast(t) { var d = document.createElement('div'); d.className = 'ad-toast'; d.textContent = t; (main.querySelector('.ad-shell') || document.body).appendChild(d); setTimeout(function () { d.remove() }, 2600) }
  function adModal(o) {
    return new Promise(function (res) {
      var m = document.createElement('div'); m.className = 'ad-modal'
      m.innerHTML = '<div class="ad-dlg"><h3>' + esc(o.title) + '</h3>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + (o.input != null ? '<input id="ad_in" value="' + esc(o.input) + '">' : '') + '<div class="ad-act"><button class="ad-btn" id="ad_no">Cancel</button><button class="ad-btn ' + (o.danger ? 'danger' : 'pri') + '" id="ad_ok">' + esc(o.ok || 'OK') + '</button></div></div>'
      ;(main.querySelector('.ad-shell') || document.body).appendChild(m)
      var done = function (v) { m.remove(); res(v) }
      m.querySelector('#ad_no').onclick = function () { done(null) }
      m.querySelector('#ad_ok').onclick = function () { done(o.input != null ? m.querySelector('#ad_in').value : true) }
      m.onclick = function (e) { if (e.target === m) done(null) }
      var i = m.querySelector('#ad_in'); if (i) { i.focus(); i.select(); i.onkeydown = function (e) { if (e.key === 'Enter') m.querySelector('#ad_ok').click() } }
    })
  }
  var ICON = {
    overview: '<svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    students: '<svg viewBox="0 0 24 24"><path d="M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg>',
    add: '<svg viewBox="0 0 24 24"><path d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z"/></svg>'
  }
  function showAdmin(tab) {
    clearInterval(timerId); test = null; mark('admin'); setBar('Admin'); document.body.className = 'admin'; $('#leg').innerHTML = ''; topright.innerHTML = ''
    if (typeof tab === 'string') adm.tab = tab
    var nav = [['overview', 'Overview'], ['students', 'Students'], ['add', 'Add students']]
    h('<div class="ad-shell"><aside class="ad-side"><div class="ad-brand"><span class="ad-mark">D</span><div><b>DECA Practice</b><small>Admin</small></div></div><nav>' +
      nav.map(function (n) { return '<a href="#" data-t="' + n[0] + '">' + ICON[n[0]] + '<span>' + n[1] + '</span></a>' }).join('') + '</nav>' +
      '<div class="ad-foot"><a href="#" id="ad_stu">Student view</a><a href="#" id="ad_out">Log out</a></div></aside><section class="ad-main"><header class="ad-head"><div><h1 id="ad_h1"></h1><p id="ad_sub"></p></div><div><button class="ad-btn" id="ad_ref">Refresh</button></div></header><div id="ad_c"><div class="ad-load">Loading...</div></div></section></div>')
    main.querySelectorAll('[data-t]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); adm.tab = a.dataset.t; adDraw() } })
    $('#ad_stu').onclick = function (ev) { ev.preventDefault(); showList() }
    $('#ad_out').onclick = function (ev) { ev.preventDefault(); logout() }
    $('#ad_ref').onclick = function () { adLoad().then(adDraw).then(function () { toast('Refreshed') }) }
    adLoad().then(adDraw)
  }
  function adLoad() {
    return Promise.all([rpc('admin_overview'), rpc('admin_students2')]).then(function (r) { adm.ov = r[0]; adm.rows = r[1].filter(function (s) { return !s.is_admin }) }).catch(function (e) { var c = $('#ad_c'); if (c) c.innerHTML = '<div class="ad-card">Could not load: ' + esc(e && e.msg || 'network error') + '</div>'; throw e })
  }
  function adDraw() {
    if (!adm.ov) return
    var meta = { overview: ['Overview', 'How your students are doing across all practice exams'], students: ['Students', 'Everyone with an account, how active they are, and how they are scoring'], add: ['Add students', 'Create accounts so students can sign in and save their results'] }[adm.tab]
    $('#ad_h1').textContent = meta[0]; $('#ad_sub').textContent = meta[1]
    main.querySelectorAll('[data-t]').forEach(function (a) { a.classList.toggle('on', a.dataset.t === adm.tab) })
    window.scrollTo(0, 0)
    if (adm.tab === 'overview') adOverview(); else if (adm.tab === 'students') adStudents(); else adAdd()
  }
  // charts
  function chDaily(d) {
    var W = 640, H = 210, L = 30, B = 26, T = 10, mx = Math.max.apply(null, d.map(function (x) { return x.n }).concat([1]))
    if (mx < 4) mx = 4
    var bw = (W - L) / d.length, g = ''
    for (var i = 0; i <= 4; i++) { var y = T + (H - B - T) * i / 4; g += '<line x1="' + L + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#e8ecf4"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + Math.round(mx * (4 - i) / 4) + '</text>' }
    d.forEach(function (x, i) { var hh = (H - B - T) * x.n / mx, xx = L + i * bw + bw * .2; g += '<rect x="' + xx + '" y="' + (H - B - hh) + '" width="' + bw * .6 + '" height="' + Math.max(hh, x.n ? 2 : 0) + '" rx="4" fill="#2563eb"><title>' + x.d + ': ' + x.n + ' tests' + (x.n ? ', avg ' + x.avg + '%' : '') + '</title></rect>'; if (i % 2 === 1 || d.length < 8) g += '<text x="' + (xx + bw * .3) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#94a3b8">' + x.d.split(' ')[1] + '</text>' })
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ad-svg">' + g + '</svg>'
  }
  function chTrend(T) {
    var pts = T.slice().reverse().map(function (t) { return { v: Math.round(100 * t.score / t.total), t: t } })
    if (!pts.length) return '<div class="ad-empty">No tests yet</div>'
    var W = 520, H = 170, L = 30, B = 12, T0 = 10, n = pts.length, gx = function (i) { return n === 1 ? (L + W) / 2 : L + (W - L - 10) * i / (n - 1) }, gy = function (v) { return T0 + (H - B - T0) * (1 - v / 100) }, g = ''
    ;[0, 50, 100].forEach(function (v) { g += '<line x1="' + L + '" x2="' + W + '" y1="' + gy(v) + '" y2="' + gy(v) + '" stroke="#e8ecf4"/><text x="' + (L - 6) + '" y="' + (gy(v) + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + v + '</text>' })
    g += '<polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="' + pts.map(function (p, i) { return gx(i) + ',' + gy(p.v) }).join(' ') + '"/>'
    pts.forEach(function (p, i) { g += '<circle cx="' + gx(i) + '" cy="' + gy(p.v) + '" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"><title>' + esc(p.t.name) + ': ' + p.v + '% (' + new Date(p.t.taken_at).toLocaleDateString() + ')</title></circle>' })
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ad-svg">' + g + '</svg>'
  }
  function chDonut(seg) {
    var tot = seg.reduce(function (a, s) { return a + s.n }, 0), C = 2 * Math.PI * 52, off = 0
    var arcs = seg.map(function (s) { if (!s.n) return ''; var len = C * s.n / tot, r = '<circle r="52" cx="70" cy="70" fill="none" stroke="' + s.c + '" stroke-width="18" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 70 70)"><title>' + s.l + ': ' + s.n + '</title></circle>'; off += len; return r }).join('')
    return '<div class="ad-donut"><svg viewBox="0 0 140 140"><circle r="52" cx="70" cy="70" fill="none" stroke="#eef1f7" stroke-width="18"/>' + arcs + '<text x="70" y="68" text-anchor="middle" font-size="26" font-weight="700" fill="#0f172a">' + tot + '</text><text x="70" y="86" text-anchor="middle" font-size="11" fill="#64748b">students</text></svg><ul>' + seg.map(function (s) { return '<li><i style="background:' + s.c + '"></i>' + s.l + '<b>' + s.n + '</b></li>' }).join('') + '</ul></div>'
  }
  function hbars(rows) { return rows.length ? '<div class="ad-hb">' + rows.map(function (r) { return '<div class="ad-hr"><div class="ad-hl" title="' + esc(r.title || r.label) + '">' + esc(r.label) + '</div><div class="ad-ht"><div style="width:' + Math.max(2, Math.min(100, r.v)) + '%;background:' + r.c + '"></div></div><div class="ad-hv">' + esc(r.right) + '</div></div>' }).join('') + '</div>' : '<div class="ad-empty">Nothing to show yet</div>' }
  function heat(areas) { return areas.length ? '<div class="ad-heat">' + areas.map(function (a) { var p = Math.round(100 * (a.seen - a.wrong) / a.seen), hh = Math.round(p * 1.2); return '<div style="background:hsl(' + hh + ',75%,91%);color:hsl(' + hh + ',60%,26%)" title="' + esc(a.area) + ': ' + (a.seen - a.wrong) + ' right of ' + a.seen + '"><b>' + p + '%</b><span>' + esc(a.area) + '</span></div>' }).join('') + '</div>' : '<div class="ad-empty">Nothing to show yet</div>' }
  function card(title, body, sub, cls) { return '<div class="ad-card ' + (cls || '') + '"><div class="ad-ct"><h2>' + title + '</h2>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</div>' }
  function kpi(label, val, sub, tone) { return '<div class="ad-kpi"><span>' + label + '</span><b' + (tone ? ' class="' + tone + '"' : '') + '>' + val + '</b><small>' + sub + '</small></div>' }
  function table(head, rows) { return rows.length ? '<table class="ad-t"><thead><tr>' + head.map(function (x) { return '<th>' + x + '</th>' }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>' }).join('') + '</tr>' }).join('') + '</tbody></table>' : '<div class="ad-empty">Nothing to show yet</div>' }
  function adOverview() {
    var o = adm.ov, S = adm.rows, n = S.length || 1
    var cnt = { Active: 0, Slipping: 0, Inactive: 0, 'Not started': 0, Invited: 0 }
    S.forEach(function (r) { cnt[sStatus(r)[0]]++ })
    var html = '<div class="ad-kpis">' +
      kpi('Students', o.students, o.never_signed_in + ' haven\'t signed in yet') +
      kpi('Active this week', o.active7, Math.round(100 * o.active7 / n) + '% of students', o.active7 / n >= .5 ? 'good' : '') +
      kpi('Tests this week', o.tests7, o.tests + ' all time') +
      kpi('Average score', o.avg == null ? '-' : o.avg + '%', o.questions + ' questions answered', o.avg != null && o.avg >= 70 ? 'good' : o.avg != null && o.avg < 50 ? 'bad' : '') +
      kpi('Avg time per test', o.tests ? dur(o.avg_seconds) : '-', 'of 70 minutes') + '</div>'
    var ina = S.filter(function (s) { var t = sStatus(s)[0]; return t === 'Slipping' || t === 'Inactive' || t === 'Not started' || t === 'Invited' }).sort(function (a, b) { return (a.last_test ? Date.parse(a.last_test) : 0) - (b.last_test ? Date.parse(b.last_test) : 0) })
    var attn = ina.length ? '<ul class="ad-list">' + ina.slice(0, 7).map(function (s) { return '<li data-o="' + esc(s.email) + '">' + avatar(s.name) + '<div><b>' + esc(s.name) + '</b><small>' + (s.last_test ? 'Last test ' + ago(s.last_test) : (s.last_sign_in ? 'Signed in but no tests yet' : 'Has not signed in')) + '</small></div>' + badge(s) + '</li>' }).join('') + '</ul><button class="ad-btn" id="ad_cp">Copy ' + ina.length + ' email' + (ina.length > 1 ? 's' : '') + ' to remind them</button>' : '<div class="ad-empty">Everyone is on track</div>'
    var fun = [['Accounts', S.length, '#94a3b8'], ['Signed in', S.length - o.never_signed_in, '#60a5fa'], ['Took a test', S.length - o.never_tested, '#2563eb']]
    var dsum = (o.dist.b0 + o.dist.b50 + o.dist.b70 + o.dist.b85) || 1
    var segs = [['Under 50%', o.dist.b0, '#ef4444'], ['50-69%', o.dist.b50, '#f59e0b'], ['70-84%', o.dist.b70, '#22c55e'], ['85%+', o.dist.b85, '#2563eb']]
    var ar = o.areas.slice().sort(function (a, b) { return (a.seen - a.wrong) / a.seen - (b.seen - b.wrong) / b.seen })
    var low = o.exams.filter(function (e) { return e.n >= 2 }).sort(function (a, b) { return a.avg - b.avg }).slice(0, 6)
    html += '<div class="ad-grid g2">' +
      card('Tests per day', chDaily(o.daily), 'last 14 days') +
      card('Needs attention', attn, 'no test in 7+ days') + '</div>' +
      '<div class="ad-grid g3">' +
      card('Engagement', chDonut([{ l: 'Active', n: cnt.Active, c: '#22c55e' }, { l: 'Slipping', n: cnt.Slipping, c: '#f59e0b' }, { l: 'Inactive', n: cnt.Inactive, c: '#ef4444' }, { l: 'Not started', n: cnt['Not started'] + cnt.Invited, c: '#cbd5e1' }]), 'by last test') +
      card('Sign-up funnel', hbars(fun.map(function (f) { return { label: f[0], v: 100 * f[1] / n, right: f[1], c: f[2] } })), '') +
      card('Score spread', '<div class="ad-stack">' + segs.map(function (s) { return s[1] ? '<div style="flex:' + s[1] + ';background:' + s[2] + '" title="' + s[0] + ': ' + s[1] + '"></div>' : '' }).join('') + '</div><ul class="ad-leg">' + segs.map(function (s) { return '<li><i style="background:' + s[2] + '"></i>' + s[0] + '<b>' + s[1] + '</b></li>' }).join('') + '</ul>', 'all tests') + '</div>' +
      '<div class="ad-grid g2">' +
      card('Topic accuracy', heat(ar), 'weakest first') +
      card('Performance indicators missed most', hbars(o.pis.slice(0, 8).map(function (p) { return { label: (p.pi || 'No PI') + (p.txt ? ' - ' + p.txt : ''), title: p.pi + ' ' + p.txt, v: 100 * p.wrong / p.seen, right: p.wrong + '/' + p.seen + ' wrong', c: '#ef4444' } })), 'what to teach next') + '</div>' +
      '<div class="ad-grid g2">' +
      card('Questions missed most', o.qs.length ? '<ol class="ad-qs">' + o.qs.slice(0, 6).map(function (q) { return '<li><span>' + esc(q.q) + '...</span><b>' + q.n + 'x</b></li>' }).join('') + '</ol>' : '<div class="ad-empty">Nothing to show yet</div>', 'across all students') +
      card('Hardest exams', table(['Exam', 'Taken', 'Avg'], low.map(function (e) { return [esc(e.name), e.n, '<b>' + e.avg + '%</b>'] })), 'taken 2+ times') + '</div>' +
      '<div class="ad-grid g2">' +
      card('Top students', table(['Student', 'Tests', 'Avg'], o.top.map(function (t) { return [esc(t.name), t.n, '<b>' + t.avg + '%</b>'] })), '2+ tests') +
      card('Recent activity', table(['Student', 'Exam', 'Score', 'When'], o.recent.slice(0, 6).map(function (r) { var p = Math.round(100 * r.score / r.total); return [esc(r.student), esc(r.name), '<span class="ad-pct ' + (p >= 70 ? 'g' : p >= 50 ? 'a' : 'r') + '">' + p + '%</span>', ago(r.taken_at)] })), '') + '</div>'
    $('#ad_c').innerHTML = html
    main.querySelectorAll('[data-o]').forEach(function (li) { li.onclick = function () { adOpen(li.dataset.o) } })
    if ($('#ad_cp')) $('#ad_cp').onclick = function () { copyText(ina.map(function (s) { return s.email }).join(', ')).then(function () { toast('Emails copied') }) }
  }
  function adStudents() {
    var cnt = { all: adm.rows.length, Active: 0, Slipping: 0, Inactive: 0, Start: 0 }
    adm.rows.forEach(function (r) { var s = sStatus(r)[0]; if (s === 'Not started' || s === 'Invited') cnt.Start++; else cnt[s]++ })
    var chips = [['all', 'All', cnt.all], ['Active', 'Active', cnt.Active], ['Slipping', 'Slipping', cnt.Slipping], ['Inactive', 'Inactive', cnt.Inactive], ['Start', 'Not started', cnt.Start]]
    $('#ad_c').innerHTML = '<div class="ad-card flush"><div class="ad-tool"><input id="ad_q" class="ad-search" placeholder="Search students" value="' + esc(adm.q) + '"><div class="ad-chips">' +
      chips.map(function (c) { return '<button data-f="' + c[0] + '" class="' + (adm.f === c[0] ? 'on' : '') + '">' + c[1] + ' <span>' + c[2] + '</span></button>' }).join('') + '</div><button class="ad-btn" id="ad_csv">Export CSV</button></div>' +
      '<div id="ad_bulk" class="ad-bulk" hidden></div><div id="ad_tbl"></div></div>'
    $('#ad_q').oninput = function () { adm.q = this.value; adTable() }
    main.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { adm.f = b.dataset.f; main.querySelectorAll('[data-f]').forEach(function (x) { x.classList.toggle('on', x === b) }); adTable() } })
    $('#ad_csv').onclick = function () {
      var q = function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"' }
      download('students.csv', 'Name,Email,Status,Tests,Average %,Best %,Last test,Last sign in\n' + adm.view.map(function (r) { return [r.name, r.email, sStatus(r)[0], r.tests, r.avg, r.best, r.last_test || '', r.last_sign_in || ''].map(q).join(',') }).join('\n'), 'text/csv')
    }
    adTable()
  }
  function adBulk() {
    var l = Object.keys(adm.sel).filter(function (e) { return adm.sel[e] }), b = $('#ad_bulk'); if (!b) return
    b.hidden = !l.length
    if (!l.length) return
    b.innerHTML = '<b>' + l.length + ' selected</b><button class="ad-btn" id="b_cp">Copy emails</button><button class="ad-btn" id="b_pw">Reset password</button><button class="ad-btn danger" id="b_rm">Remove</button><button class="ad-btn" id="b_x">Clear</button>'
    var each = function (fn) { return l.reduce(function (p, e) { return p.then(function () { return fn(e) }) }, Promise.resolve()) }
    $('#b_x').onclick = function () { adm.sel = {}; adTable() }
    $('#b_cp').onclick = function () { copyText(l.join(', ')).then(function () { toast('Emails copied') }) }
    $('#b_pw').onclick = function () { adModal({ title: 'Reset password for ' + l.length + ' student' + (l.length > 1 ? 's' : ''), text: 'They will sign in with this new password.', input: '48onDECA', ok: 'Reset password' }).then(function (p) { if (!p) return; each(function (e) { return rpc('admin_set_password', { p_email: e, p_password: p }) }).then(function () { toast('Password changed') }, function (e) { toast(e.msg) }) }) }
    $('#b_rm').onclick = function () { adModal({ title: 'Remove ' + l.length + ' student' + (l.length > 1 ? 's' : '') + '?', text: 'Their accounts and all saved tests will be deleted. This cannot be undone.', ok: 'Remove', danger: true }).then(function (y) { if (!y) return; each(function (e) { return rpc('admin_remove_student', { p_email: e }) }).then(function () { adm.sel = {}; return adLoad() }).then(adDraw).then(function () { toast('Removed') }, function (e) { toast(e.msg) }) }) }
  }
  function adTable() {
    var now = Date.now(), q = adm.q.toLowerCase(), k = adm.k
    var rows = adm.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.email).toLowerCase().indexOf(q) < 0) return false
      var s = sStatus(r)[0]
      return adm.f === 'all' || s === adm.f || (adm.f === 'Start' && (s === 'Not started' || s === 'Invited'))
    })
    var val = function (r) { var v = r[k]; if (k === 'name') return String(v || '').toLowerCase(); if (k === 'last_test' || k === 'last_sign_in') return v ? Date.parse(v) : 0; return v == null ? -1 : +v }
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * adm.dir })
    adm.view = rows
    var th = function (key, label) { return '<th data-k="' + key + '" class="s">' + label + (adm.k === key ? (adm.dir > 0 ? ' &#9650;' : ' &#9660;') : '') + '</th>' }
    var allOn = rows.length && rows.every(function (r) { return adm.sel[r.email] })
    $('#ad_tbl').innerHTML = rows.length ? '<table class="ad-t big"><thead><tr><th class="c"><input type="checkbox" id="ad_all"' + (allOn ? ' checked' : '') + '></th>' + th('name', 'Student') + '<th>Status</th>' + th('tests', 'Tests') + th('avg', 'Average') + th('best', 'Best') + th('last_test', 'Last test') + th('last_sign_in', 'Last sign in') + '</tr></thead><tbody>' +
      rows.map(function (r, i) {
        var p = r.avg == null ? null : Math.round(r.avg)
        return '<tr data-r="' + i + '"><td class="c"><input type="checkbox" data-s="' + i + '"' + (adm.sel[r.email] ? ' checked' : '') + '></td><td><div class="ad-who">' + avatar(r.name) + '<div><b>' + esc(r.name) + '</b><small>' + esc(r.email) + '</small></div></div></td><td>' + badge(r) + '</td><td>' + r.tests + '</td><td>' + (p == null ? '<span class="mut">-</span>' : '<div class="ad-mini"><div class="ad-mt"><i style="width:' + p + '%;background:' + (p >= 70 ? '#22c55e' : p >= 50 ? '#f59e0b' : '#ef4444') + '"></i></div><b>' + p + '%</b></div>') + '</td><td>' + (r.best == null ? '<span class="mut">-</span>' : Math.round(r.best) + '%') + '</td><td>' + (r.last_test ? ago(r.last_test) : '<span class="mut">never</span>') + '</td><td>' + (r.last_sign_in ? ago(r.last_sign_in) : '<span class="mut">never</span>') + '</td></tr>'
      }).join('') + '</tbody></table>' : '<div class="ad-empty pad">' + (adm.rows.length ? 'No students match.' : 'No students yet. Add some from the Add students tab.') + '</div>'
    var t = $('#ad_tbl')
    t.querySelectorAll('th[data-k]').forEach(function (h2) { h2.onclick = function () { if (adm.k === h2.dataset.k) adm.dir = -adm.dir; else { adm.k = h2.dataset.k; adm.dir = adm.k === 'name' ? 1 : -1 } adTable() } })
    if ($('#ad_all')) $('#ad_all').onchange = function () { var on = this.checked; rows.forEach(function (r) { adm.sel[r.email] = on }); adTable() }
    t.querySelectorAll('[data-s]').forEach(function (c) { c.onclick = function (e) { e.stopPropagation() }; c.onchange = function () { adm.sel[rows[+c.dataset.s].email] = c.checked; adBulk(); var a = $('#ad_all'); if (a) a.checked = rows.every(function (r) { return adm.sel[r.email] }) } })
    t.querySelectorAll('tr[data-r]').forEach(function (tr) { tr.onclick = function () { adOpen(rows[+tr.dataset.r].email) } })
    adBulk()
  }
  function adOpen(email) {
    var old = main.querySelector('.ad-drawer'); if (old) old.remove()
    var d = document.createElement('div'); d.className = 'ad-drawer'; d.innerHTML = '<div class="ad-dp"><div class="ad-load">Loading...</div></div>'
    main.querySelector('.ad-shell').appendChild(d)
    var close = function () { d.remove() }
    d.onclick = function (e) { if (e.target === d) close() }
    rpc('admin_student_detail', { p_email: email }).then(function (x) {
      var p = x.profile, T = x.tests, sc = 0, den = 0, secs = 0, best = 0
      T.forEach(function (t) { sc += t.score; den += t.total; secs += t.seconds || 0; best = Math.max(best, Math.round(100 * t.score / t.total)) })
      var row = adm.rows.filter(function (r) { return r.email === email })[0] || { tests: T.length, last_test: T[0] && T[0].taken_at, last_sign_in: p.last_sign_in }
      d.querySelector('.ad-dp').innerHTML = '<div class="ad-dh">' + avatar(p.name, true) + '<div><h2>' + esc(p.name) + '</h2><small>' + esc(p.email) + ' &middot; joined ' + new Date(p.created).toLocaleDateString() + '</small></div><button class="ad-x" id="dp_x">&times;</button></div>' +
        '<div class="ad-kpis four">' + kpi('Tests', T.length, badge(row)) + kpi('Average', den ? Math.round(100 * sc / den) + '%' : '-', 'all tests') + kpi('Best', T.length ? best + '%' : '-', 'single test') + kpi('Avg time', T.length ? dur(secs / T.length) : '-', 'per test') + '</div>' +
        card('Score trend', chTrend(T), 'oldest to newest') +
        card('Weakest topics', heat(x.areas.slice().sort(function (a, b) { return (a.seen - a.wrong) / a.seen - (b.seen - b.wrong) / b.seen }).slice(0, 8)), '') +
        card('PIs to work on', hbars(x.pis.slice(0, 6).map(function (q) { return { label: (q.pi || 'No PI') + (q.txt ? ' - ' + q.txt : ''), v: 100 * q.wrong / q.seen, right: q.wrong + '/' + q.seen, c: '#ef4444' } })), '') +
        card('Test history', table(['Exam', 'Score', 'Time', 'When'], T.slice(0, 15).map(function (t) { var q = Math.round(100 * t.score / t.total); return [esc(t.name), '<span class="ad-pct ' + (q >= 70 ? 'g' : q >= 50 ? 'a' : 'r') + '">' + q + '%</span>', dur(t.seconds), ago(t.taken_at)] })), T.length > 15 ? 'latest 15 of ' + T.length : '') +
        '<div class="ad-card"><div class="ad-ct"><h2>Manage</h2></div><div class="ad-row"><button class="ad-btn" id="dp_ren">Rename</button><button class="ad-btn" id="dp_pw">Reset password</button><button class="ad-btn" id="dp_cp">Copy email</button></div><div class="ad-row" style="margin-top:8px"><button class="ad-btn danger" id="dp_clr">Clear test history</button><button class="ad-btn danger" id="dp_rm">Remove student</button></div></div>'
      var refresh = function () { return adLoad().then(function () { if (adm.tab === 'students') adTable(); else adDraw(); adOpen(email) }) }
      $('#dp_x').onclick = close
      $('#dp_cp').onclick = function () { copyText(email).then(function () { toast('Email copied') }) }
      $('#dp_ren').onclick = function () { adModal({ title: 'Rename student', input: p.name, ok: 'Save' }).then(function (n) { if (!n || !n.trim()) return; rpc('admin_update_student', { p_email: email, p_name: n, p_school: p.school || SCHOOL }).then(function () { toast('Renamed'); return refresh() }, function (e) { toast(e.msg) }) }) }
      $('#dp_pw').onclick = function () { adModal({ title: 'Reset password', text: 'New password for ' + p.name, input: '48onDECA', ok: 'Reset password' }).then(function (n) { if (!n) return; rpc('admin_set_password', { p_email: email, p_password: n }).then(function () { toast('Password changed') }, function (e) { toast(e.msg) }) }) }
      $('#dp_clr').onclick = function () { adModal({ title: 'Clear test history?', text: 'All ' + T.length + ' saved tests for ' + p.name + ' will be deleted. This cannot be undone.', ok: 'Clear history', danger: true }).then(function (y) { if (!y) return; rpc('admin_clear_history', { p_email: email }).then(function () { toast('History cleared'); return refresh() }, function (e) { toast(e.msg) }) }) }
      $('#dp_rm').onclick = function () { adModal({ title: 'Remove ' + p.name + '?', text: 'Their account and all saved tests will be deleted. This cannot be undone.', ok: 'Remove student', danger: true }).then(function (y) { if (!y) return; rpc('admin_remove_student', { p_email: email }).then(function () { close(); return adLoad() }).then(adDraw).then(function () { toast('Student removed') }, function (e) { toast(e.msg) }) }) }
    }).catch(function (e) { d.querySelector('.ad-dp').innerHTML = '<div class="ad-card">Could not load: ' + esc(e && e.msg || 'error') + '</div>' })
  }
  function adAdd() {
    var step = 1
    var steps = [['a_n', 'Enter the student\'s full name.'], ['a_e', 'Enter their email address. This is their Student ID when they sign in.'], ['a_p', 'Check the password. Everyone gets 48onDECA unless you change it. Tell the student what it is.'], ['a_add', 'Click Add student.'], ['a_res', 'Check the result. "created" means the account is ready. Give the student their email and password.'], ['a_bulk', 'To add a whole class at once, paste one student per line as Name, email, then click Add all.']]
    $('#ad_c').innerHTML = '<div class="ad-guidebar"><label class="ad-sw"><input type="checkbox" id="a_demo"' + (demoOn() ? ' checked' : '') + '><span></span> Step-by-step guide</label></div><div id="a_guide"></div>' +
      '<div class="ad-grid g2"><div class="ad-card" id="a_one"><div class="ad-ct"><h2>Add one student</h2></div>' +
      '<label class="ad-f">Full name<input id="a_n" placeholder="Jane Doe"></label><label class="ad-f">Email<input id="a_e" placeholder="jane@school.ca"></label><label class="ad-f">Password<input id="a_p" value="48onDECA"></label><p class="ad-note">School is set to ' + SCHOOL + ' automatically.</p><button class="ad-btn pri" id="a_add">Add student</button></div>' +
      '<div class="ad-card"><div class="ad-ct"><h2>Add a class</h2><span>one per line: Name, email</span></div><textarea id="a_bulk" rows="7" placeholder="Jane Doe, jane@school.ca&#10;Sam Lee, sam@school.ca"></textarea><div id="a_prev" class="ad-prev"></div><button class="ad-btn pri" id="a_bulkgo">Add all</button></div></div>' +
      '<div class="ad-card" id="a_res"><div class="ad-ct"><h2>Results</h2></div><div id="a_msg" class="ad-empty">Nothing added yet</div></div>'
    var parse = function () {
      return $('#a_bulk').value.split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
        var p = l.split(/[,\t;]/).map(function (x) { return x.trim() })
        if (p.length === 1 && /@/.test(p[0])) return { name: '', email: p[0], school: SCHOOL }
        if (/@/.test(p[0]) && !/@/.test(p[1] || '')) return { name: p[1] || '', email: p[0], school: SCHOOL }
        return { name: p[0], email: p[1] || '', school: SCHOOL }
      })
    }
    var okRow = function (r) { return r.name && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) }
    $('#a_bulk').oninput = function () { var r = parse(), bad = r.filter(function (x) { return !okRow(x) }).length; $('#a_prev').innerHTML = r.length ? '<span class="ad-badge green">' + (r.length - bad) + ' ready</span>' + (bad ? ' <span class="ad-badge red">' + bad + ' need a name or valid email</span>' : '') : '' }
    var guide = function () {
      var g = $('#a_guide'); steps.forEach(function (s) { var e = $('#' + s[0]); if (e) e.classList.remove('ad-focus') })
      if (!$('#a_demo').checked) { g.innerHTML = ''; return }
      var s = steps[step - 1], el = $('#' + s[0]); el.classList.add('ad-focus')
      g.innerHTML = '<div class="ad-guide"><div class="ad-dots">' + steps.map(function (_, i) { return '<i class="' + (i < step ? 'on' : '') + '"></i>' }).join('') + '</div><div><b>Step ' + step + ' of ' + steps.length + '</b><p>' + esc(s[1]) + '</p></div><div class="ad-row"><button class="ad-btn" id="g_b"' + (step === 1 ? ' disabled' : '') + '>Back</button><button class="ad-btn pri" id="g_n">' + (step === steps.length ? 'Finish' : 'Next') + '</button></div></div>'
      if (/INPUT|TEXTAREA/.test(el.tagName)) el.focus()
      $('#g_b').onclick = function () { step--; guide() }
      $('#g_n').onclick = function () { if (step === steps.length) { $('#a_demo').checked = false; setDemo(false); step = 1 } else step++; guide() }
    }
    $('#a_demo').onchange = function () { setDemo(this.checked); step = 1; guide() }
    var send = function (rows) {
      if (!rows.length) return toast('Nothing to add')
      $('#a_msg').className = ''; $('#a_msg').textContent = 'Adding...'
      rpc('admin_add_students', { p_rows: rows, p_password: $('#a_p').value || '48onDECA' }).then(function (out) {
        $('#a_msg').innerHTML = table(['Name', 'Email', 'Result'], out.map(function (o) { return [esc(o.name), esc(o.email), '<span class="ad-badge ' + (o.status === 'created' ? 'green' : 'amber') + '">' + esc(o.status) + '</span>'] }))
        if (out.some(function (o) { return o.status === 'created' })) { $('#a_n').value = ''; $('#a_e').value = ''; $('#a_bulk').value = ''; $('#a_prev').innerHTML = ''; adLoad() }
        if ($('#a_demo').checked && step === 4) { step = 5; guide() }
      }).catch(function (e) { $('#a_msg').className = ''; $('#a_msg').innerHTML = '<span class="ad-badge red">Error</span> ' + esc(e.msg || 'could not add') })
    }
    $('#a_add').onclick = function () { send([{ name: $('#a_n').value, email: $('#a_e').value, school: SCHOOL }]) }
    $('#a_bulkgo').onclick = function () { send(parse()) }
    guide()
  }
  function showAccount() {
    clearInterval(timerId); test = null; document.body.className = ''; mark('account'); $('#leg').innerHTML = ''; setBar('My Account - Performance Review')
    topright.innerHTML = '<button id="home">Test list</button>'; $('#home').onclick = showList
    var g = agg(), H = g.H
    if (!H.length) { h('<div class="box"><h3>Performance Review</h3><div class="body">No finished tests yet. Finish a test and your results will show up here (average score, weakest PIs, most missed questions).</div></div>'); return }
    var tot = H.reduce(function (a, t) { return a + t.score }, 0), den = H.reduce(function (a, t) { return a + t.total }, 0)
    var pcts = H.map(function (t) { return Math.round(100 * t.score / t.total) })
    var best = Math.max.apply(null, pcts), last = pcts[pcts.length - 1]
    var html = '<div class="box"><h3>Performance Review - ' + esc(st.user.name) + '</h3><div class="body">' +
      '<table style="width:auto"><tr><td>Tests finished</td><td><b>' + H.length + '</b></td></tr><tr><td>Questions answered</td><td><b>' + den + '</b></td></tr>' +
      '<tr><td>Average score</td><td><b>' + Math.round(100 * tot / den) + '%</b></td></tr><tr><td>Best score</td><td><b>' + best + '%</b></td></tr><tr><td>Latest score</td><td><b>' + last + '%</b></td></tr>' +
      '<tr><td>Last 5 tests average</td><td><b>' + Math.round(pcts.slice(-5).reduce(function (a, b) { return a + b }, 0) / Math.min(5, pcts.length)) + '%</b></td></tr></table>' +
      '<p><button id="dlp">Download Performance Report</button> <button id="rst">Clear History</button></p></div></div>'
    html += '<div class="box"><h3>Score on each test (most recent ' + Math.min(30, H.length) + ')</h3><div class="body">' + bars(H.slice(-30).map(function (t, i) { var p = Math.round(100 * t.score / t.total); return { label: t.name, v: p, right: t.score + '/' + t.total + ' (' + p + '%)', color: p >= 70 ? '#5cb85c' : '#d9534f' } }), '#3b82f6') + '</div></div>'
    var pk = Object.keys(g.pi).filter(function (k) { return g.pi[k].w > 0 }).sort(function (a, b) { return g.pi[b].w - g.pi[a].w || g.pi[a].t - g.pi[b].t }).slice(0, 20)
    html += '<div class="box"><h3>Performance indicators you miss most</h3><div class="body">' + (pk.length ? bars(pk.map(function (k) { var p = g.pi[k]; return { label: k + (p.txt ? ' - ' + p.txt : ''), title: k + ' ' + p.txt, v: 100 * p.w / p.t, right: p.w + ' wrong of ' + p.t + ' (' + Math.round(100 * (p.t - p.w) / p.t) + '% right)', color: '#d9534f' } }), '#d9534f') : 'Nothing missed yet.') + '</div></div>'
    var ak = Object.keys(g.ar).sort(function (a, b) { return (g.ar[a].t - g.ar[a].w) / g.ar[a].t - (g.ar[b].t - g.ar[b].w) / g.ar[b].t })
    html += '<div class="box"><h3>Accuracy by topic area (weakest first)</h3><div class="body">' + bars(ak.map(function (k) { var p = g.ar[k], pc = Math.round(100 * (p.t - p.w) / p.t); return { label: k, v: pc, right: pc + '% (' + p.t + ' seen)', color: pc >= 70 ? '#5cb85c' : '#f0ad4e' } }), '#3b82f6') + '</div></div>'
    var ck = Object.keys(g.cl)
    html += '<div class="box"><h3>Average by cluster</h3><div class="body">' + bars(ck.map(function (k) { var c = g.cl[k], pc = Math.round(100 * c.s / c.t); return { label: k, v: pc, right: pc + '% (' + c.n + ' tests)' } }), '#3b82f6') + '</div></div>'
    var qk = Object.keys(g.qs).filter(function (k) { return g.qs[k].n > 1 }).sort(function (a, b) { return g.qs[b].n - g.qs[a].n }).slice(0, 15)
    if (qk.length) html += '<div class="box"><h3>Questions you keep missing</h3><div class="body">' + qk.map(function (k) { return '<div style="margin:6px 0">Missed ' + g.qs[k].n + ' times: ' + esc(g.qs[k].q) + '...</div>' }).join('') + '</div></div>'
    html += '<div class="box"><h3>My Reports</h3><div class="body"><table class="tests" style="width:100%;min-width:0"><tr><td><b>Date</b></td><td><b>Test</b></td><td><b>Score</b></td><td></td></tr>' + H.slice().reverse().slice(0, 100).map(function (a, i) { return '<tr><td>' + new Date(a.ts).toLocaleString() + '</td><td>' + esc(a.name) + '</td><td>' + a.score + '/' + a.total + ' (' + Math.round(100 * a.score / a.total) + '%)</td><td><button data-v="' + i + '">View</button> <button data-d="' + i + '">Download</button></td></tr>' }).join('') + '</table></div></div>'
    html += '<p style="font-size:13px">Your results are saved to your account.</p>'
    h(html)
    $('#dlp').onclick = function () { downloadPerf(g, pk, ak) }
    var rev = H.slice().reverse()
    var open = function (a, dl) {
      var ex = IDX.exams.filter(function (e) { return e.name === a.name })[0]
      if (!ex) { alert('This test is no longer in the question bank.'); return }
      loadFile(ex.file).then(function () { var res = { id: ex.id, name: ex.name, ts: a.ts, score: a.score, total: a.total, ans: a.ans }; dl ? downloadReport(res, rowsOf(ex.id)) : results(res) })
    }
    main.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { open(rev[+b.dataset.v], false) } })
    main.querySelectorAll('[data-d]').forEach(function (b) { b.onclick = function () { open(rev[+b.dataset.d], true) } })
    $('#rst').onclick = function () { if (confirm('Clear all performance history?')) { st.hist = []; save(); showAccount() } }
  }
  function downloadPerf(g, pk, ak) {
    var H = g.H, tot = H.reduce(function (a, t) { return a + t.score }, 0), den = H.reduce(function (a, t) { return a + t.total }, 0)
    var out = '<html><head><meta charset="utf-8"><title>Performance Report</title>' + RCSS + '</head><body><h1>Ontario DECA Practice - Performance Report</h1><p>' + esc(st.user.name) + ' - ' + esc(st.user.school) + '<br>' + new Date().toLocaleString() + '</p>' +
      '<p><b>Tests finished: ' + H.length + ' - Average score: ' + Math.round(100 * tot / den) + '%</b></p>' +
      '<h2>All tests</h2><table><tr><th>Date</th><th>Test</th><th>Score</th></tr>' + H.map(function (t) { return '<tr><td>' + new Date(t.ts).toLocaleString() + '</td><td>' + esc(t.name) + '</td><td>' + t.score + '/' + t.total + ' (' + Math.round(100 * t.score / t.total) + '%)</td></tr>' }).join('') + '</table>' +
      '<h2>PIs missed most</h2><table><tr><th>PI</th><th>Description</th><th>Wrong</th><th>Seen</th><th>% right</th></tr>' + pk.map(function (k) { var p = g.pi[k]; return '<tr><td>' + esc(k) + '</td><td>' + esc(p.txt) + '</td><td>' + p.w + '</td><td>' + p.t + '</td><td>' + Math.round(100 * (p.t - p.w) / p.t) + '%</td></tr>' }).join('') + '</table>' +
      '<h2>Accuracy by topic area</h2><table><tr><th>Area</th><th>% right</th><th>Seen</th></tr>' + ak.map(function (k) { var p = g.ar[k]; return '<tr><td>' + esc(k) + '</td><td>' + Math.round(100 * (p.t - p.w) / p.t) + '%</td><td>' + p.t + '</td></tr>' }).join('') + '</table></body></html>'
    download('DECA-performance-report.html', out)
  }

  // ---------- calculator ----------
  var calc = { cur: '0', acc: null, op: null, fresh: true }
  function toggleCalc() { var c = $('#calc'); c.hidden ? openCalc() : closeCalc() }
  function closeCalc() { $('#calc').hidden = true }
  function openCalc() {
    var c = $('#calc'); c.hidden = false
    var keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', 'C', '+']
    c.innerHTML = '<div class="cbar" id="cbar">Calculator <button class="x" id="cx">X</button></div><div class="scr"><div class="ex" id="cx2"></div><div id="cs">' + calc.cur + '</div></div><div class="keys">' +
      keys.map(function (k) { return '<button data-k="' + k + '">' + (k === '*' ? '&times;' : k === '/' ? '&divide;' : k === '-' ? '&minus;' : k) + '</button>' }).join('') +
      '<button class="eq" data-k="=">=</button><button data-k="r">&radic;</button></div>'
    $('#cx').onclick = closeCalc
    c.onclick = function (ev) { var b = ev.target.closest ? ev.target.closest('[data-k]') : null; if (b) { press(b.dataset.k); ev.preventDefault() } }
    show()
    var bar = $('#cbar'), sx, sy, ox, oy, drag = false
    bar.onpointerdown = function (ev) { if (ev.target.id === 'cx') return; drag = true; sx = ev.clientX; sy = ev.clientY; var r = c.getBoundingClientRect(); ox = r.left; oy = r.top; bar.setPointerCapture(ev.pointerId); ev.preventDefault() }
    bar.onpointermove = function (ev) { if (!drag) return; c.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + ev.clientX - sx)) + 'px'; c.style.top = Math.max(0, Math.min(window.innerHeight - 40, oy + ev.clientY - sy)) + 'px' }
    bar.onpointerup = bar.onpointercancel = function () { drag = false }
  }
  document.addEventListener('keydown', function (ev) {
    var tg = ev.target || {}
    if ($('#calc').hidden || /TEXTAREA|SELECT/.test(tg.tagName || '') || (tg.tagName === 'INPUT' && tg.type !== 'radio' && tg.type !== 'checkbox')) return
    var k = ev.key
    if (/^[0-9+\-*\/.]$/.test(k)) press(k)
    else if (k === 'Enter' || k === '=') { press('='); ev.preventDefault() }
    else if (k === 'Escape' || k === 'c' || k === 'C') k === 'Escape' ? closeCalc() : press('C')
  })
  function press(k) {
    var apply = function () { var a = parseFloat(calc.acc), b = parseFloat(calc.cur), r = b; if (calc.op === '+') r = a + b; if (calc.op === '-') r = a - b; if (calc.op === '*') r = a * b; if (calc.op === '/') r = b === 0 ? NaN : a / b; calc.cur = isFinite(r) ? String(+r.toPrecision(12)) : 'Error' }
    if (calc.cur === 'Error' && k !== 'C') calc = { cur: '0', acc: null, op: null, fresh: true }
    if (/^\d$/.test(k)) { calc.cur = (calc.fresh || calc.cur === '0') ? k : calc.cur + k; calc.fresh = false }
    else if (k === '.') { if (calc.fresh) { calc.cur = '0.'; calc.fresh = false } else if (calc.cur.indexOf('.') < 0) calc.cur += '.' }
    else if (k === 'C') calc = { cur: '0', acc: null, op: null, fresh: true }
    else if (k === 'r') { calc.cur = String(+Math.sqrt(parseFloat(calc.cur)).toPrecision(12)); calc.fresh = true }
    else if (k === '=') { if (calc.op) { apply(); calc.op = null; calc.acc = null } calc.fresh = true }
    else { if (calc.op && !calc.fresh) apply(); calc.acc = calc.cur; calc.op = k; calc.fresh = true }
    show()
  }
  function show() {
    var d = $('#cs'), e = $('#cx2'); if (!d) return
    var sym = { '*': '\u00d7', '/': '\u00f7', '-': '\u2212', '+': '+' }
    var node = document.createElement('div'); node.id = 'cs'; node.textContent = calc.cur
    d.parentNode.replaceChild(node, d)
    if (e) e.textContent = calc.op && calc.acc != null ? calc.acc + ' ' + sym[calc.op] : '\u00a0'
  }

  window.addEventListener('beforeunload', function (ev) { if (test && test.endAt > Date.now()) { ev.preventDefault(); ev.returnValue = '' } })
  history.replaceState({ v: 'login' }, '')
  if (sess()) {
    main.innerHTML = '<p style="text-align:center;padding-top:80px">Loading...</p>'
    syncAll().then(showList, function (e) { if (e && e.auth) { setSess(null); showLogin() } else { useAccount((sess() || {}).uid); showList() } })
  } else showLogin()
})()
