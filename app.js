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

  var SCHOOL = 'A.B. Lucas S.S.'
  var adm = { tab: 'overview', q: '', f: 'all', k: 'name', dir: 1, sel: {}, rows: [], view: [] }
  function demoOn() { try { return localStorage.getItem('decaweb.demo') === '1' } catch (e) { return false } }
  function setDemo(v) { try { localStorage.setItem('decaweb.demo', v ? '1' : '0') } catch (e) {} }
  function ago(ts) { if (!ts) return 'never'; var d = Math.floor((Date.now() - Date.parse(ts)) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago' }
  function dur(s) { s = Math.round(s || 0); return Math.floor(s / 60) + 'm ' + (s % 60) + 's' }
  function aErr(e) { var b = $('#a_body'); if (b) b.textContent = 'Error: ' + (e && e.msg || 'could not load') }
  var TD = 'padding:3px 24px 3px 0'
  function showAdmin(tab) {
    clearInterval(timerId); test = null; document.body.className = ''; mark('admin'); $('#leg').innerHTML = ''; setBar('Admin')
    topright.innerHTML = '<button id="home">Test list</button>'; $('#home').onclick = showList
    if (typeof tab === 'string') adm.tab = tab
    adminDraw()
  }
  function adminDraw() {
    var tabs = [['overview', 'Overview'], ['students', 'Students'], ['add', 'Add students']]
    h('<div style="margin:8px 0">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" style="margin-right:6px;' + (adm.tab === t[0] ? 'font-weight:bold;background:#ccc' : '') + '">' + t[1] + '</button>' }).join('') + '</div><div id="a_body">Loading...</div>')
    main.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { adm.tab = b.dataset.t; adminDraw() } })
    if (adm.tab === 'overview') aOverview(); else if (adm.tab === 'students') aStudents(); else aAdd()
  }
  function box(title, body) { return '<div class="box"><h3>' + title + '</h3><div class="body">' + body + '</div></div>' }
  function aOverview() {
    Promise.all([rpc('admin_overview'), rpc('admin_students2')]).then(function (res) {
      var o = res[0], S = res[1].filter(function (s) { return !s.is_admin })
      var tile = function (a, b) { return '<tr><td style="' + TD + '">' + a + '</td><td><b>' + b + '</b></td></tr>' }
      var tb = function (head, rows) { return '<table class="tests" style="width:100%;min-width:0"><tr>' + head.map(function (x) { return '<td><b>' + x + '</b></td>' }).join('') + '</tr>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>' }).join('') + '</tr>' }).join('') + '</table>' }
      var html = box('Summary', '<table>' + tile('Students', o.students) + tile('Active today', o.active1) + tile('Active in the last 7 days', o.active7 + ' of ' + o.students) + tile('Have not taken a test yet', o.never_tested) + tile('Have never signed in', o.never_signed_in) + tile('Tests taken (all time / last 7 days)', o.tests + ' / ' + o.tests7) + tile('Questions answered', o.questions) + tile('Average score', o.avg == null ? '-' : o.avg + '%') + tile('Average time per test', o.tests ? dur(o.avg_seconds) : '-') + '</table>')
      var mx = Math.max.apply(null, o.daily.map(function (d) { return d.n }).concat([1]))
      html += box('Tests per day (last 14 days)', bars(o.daily.map(function (d) { return { label: d.d, v: 100 * d.n / mx, right: d.n + (d.n ? ' - avg ' + d.avg + '%' : '') } }), '#3b82f6'))
      var dt = o.dist.b0 + o.dist.b50 + o.dist.b70 + o.dist.b85 || 1
      html += box('Score spread (all tests)', bars([['Under 50%', o.dist.b0, '#d9534f'], ['50 - 69%', o.dist.b50, '#f0ad4e'], ['70 - 84%', o.dist.b70, '#5cb85c'], ['85% and up', o.dist.b85, '#3b82f6']].map(function (x) { return { label: x[0], v: 100 * x[1] / dt, right: x[1] + ' tests', color: x[2] } }), '#3b82f6'))
      html += box('Performance indicators missed most (all students)', o.pis.length ? bars(o.pis.map(function (p) { return { label: (p.pi || 'No PI') + (p.txt ? ' - ' + p.txt : ''), title: p.pi + ' ' + p.txt, v: 100 * p.wrong / p.seen, right: p.wrong + ' wrong of ' + p.seen, color: '#d9534f' } }), '#d9534f') : 'No data yet.')
      var ar = o.areas.slice().sort(function (a, b) { return (a.seen - a.wrong) / a.seen - (b.seen - b.wrong) / b.seen })
      html += box('Accuracy by topic area (weakest first)', ar.length ? bars(ar.map(function (a) { var p = Math.round(100 * (a.seen - a.wrong) / a.seen); return { label: a.area, v: p, right: p + '% (' + a.seen + ' seen)', color: p >= 70 ? '#5cb85c' : '#f0ad4e' } }), '#3b82f6') : 'No data yet.')
      html += box('Questions missed most', o.qs.length ? o.qs.map(function (q) { return '<div style="margin:6px 0">Missed ' + q.n + ' time' + (q.n > 1 ? 's' : '') + ' by ' + q.people + ' student' + (q.people > 1 ? 's' : '') + ': ' + esc(q.q) + '...</div>' }).join('') : 'No data yet.')
      html += box('Most taken exams', o.exams.length ? tb(['Exam', 'Times taken', 'Average'], o.exams.slice(0, 15).map(function (e) { return [esc(e.name), e.n, e.avg + '%'] })) : 'No data yet.')
      var low = o.exams.filter(function (e) { return e.n >= 2 }).sort(function (a, b) { return a.avg - b.avg }).slice(0, 10)
      if (low.length) html += box('Hardest exams (lowest average, taken 2+ times)', tb(['Exam', 'Times taken', 'Average'], low.map(function (e) { return [esc(e.name), e.n, e.avg + '%'] })))
      html += box('Average by cluster', o.clusters.length ? bars(o.clusters.map(function (c) { return { label: c.cluster, v: c.avg, right: c.avg + '% (' + c.n + ' tests)' } }), '#3b82f6') : 'No data yet.')
      html += box('Top students (2+ tests)', o.top.length ? tb(['Student', 'Tests', 'Average'], o.top.map(function (t) { return [esc(t.name), t.n, t.avg + '%'] })) : 'Nobody has taken 2 tests yet.')
      var ina = S.filter(function (s) { return !s.last_test || Date.now() - Date.parse(s.last_test) > 7 * 864e5 }).sort(function (a, b) { return (a.last_test ? Date.parse(a.last_test) : 0) - (b.last_test ? Date.parse(b.last_test) : 0) }).slice(0, 15)
      html += box('Needs a nudge (no test in 7 days)', ina.length ? tb(['Student', 'Email', 'Last test', 'Last sign in'], ina.map(function (s) { return [esc(s.name), esc(s.email), s.last_test ? ago(s.last_test) : 'never', ago(s.last_sign_in)] })) : 'Everyone has taken a test this week.')
      html += box('Recent tests', o.recent.length ? tb(['When', 'Student', 'Exam', 'Score'], o.recent.map(function (r) { return [new Date(r.taken_at).toLocaleString(), esc(r.student), esc(r.name), r.score + '/' + r.total + ' (' + Math.round(100 * r.score / r.total) + '%)'] })) : 'No tests yet.')
      $('#a_body').innerHTML = html
    }).catch(aErr)
  }
  function aStudents() {
    rpc('admin_students2').then(function (rows) {
      adm.rows = rows.filter(function (r) { return !r.is_admin }); adm.sel = {}
      $('#a_body').innerHTML = '<div class="box"><h3>Students (<span id="a_cnt"></span>)</h3><div class="body">' +
        '<input id="a_q" placeholder="Search name or email" size="28" value="' + esc(adm.q) + '"> ' +
        '<select id="a_f"><option value="all">All students</option><option value="active">Active this week</option><option value="inactive">No test in 7 days</option><option value="notest">Never taken a test</option><option value="nosignin">Never signed in</option></select> ' +
        '<button id="a_csv">Export CSV</button> <button id="a_bpw">Reset password (selected)</button> <button id="a_brm">Remove (selected)</button>' +
        '<div id="a_tbl" style="margin-top:10px"></div></div></div>'
      $('#a_f').value = adm.f
      $('#a_q').oninput = function () { adm.q = this.value; aTable() }
      $('#a_f').onchange = function () { adm.f = this.value; aTable() }
      var picked = function () { return Object.keys(adm.sel).filter(function (e) { return adm.sel[e] }) }
      var each = function (list, fn) { return list.reduce(function (p, e) { return p.then(function () { return fn(e) }) }, Promise.resolve()) }
      $('#a_csv').onclick = function () {
        var q = function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"' }
        var csv = 'Name,Email,School,Tests,Average %,Best %,Last test,Last sign in\n' + adm.view.map(function (r) { return [r.name, r.email, r.school, r.tests, r.avg, r.best, r.last_test || '', r.last_sign_in || ''].map(q).join(',') }).join('\n')
        download('students.csv', csv, 'text/csv')
      }
      $('#a_bpw').onclick = function () {
        var l = picked(); if (!l.length) return alert('Tick the students first.')
        var p = prompt('New password for ' + l.length + ' student(s)', '48onDECA'); if (!p) return
        each(l, function (e) { return rpc('admin_set_password', { p_email: e, p_password: p }) }).then(function () { alert('Password changed for ' + l.length + ' student(s).') }, function (e) { alert(e.msg) })
      }
      $('#a_brm').onclick = function () {
        var l = picked(); if (!l.length) return alert('Tick the students first.')
        if (!confirm('Remove ' + l.length + ' student(s) and all their saved tests? This cannot be undone.')) return
        each(l, function (e) { return rpc('admin_remove_student', { p_email: e }) }).then(aStudents, function (e) { alert(e.msg); aStudents() })
      }
      aTable()
    }).catch(aErr)
  }
  function aTable() {
    var now = Date.now(), wk = 7 * 864e5, q = adm.q.toLowerCase(), k = adm.k
    var rows = adm.rows.filter(function (r) {
      if (q && (r.name + ' ' + r.email).toLowerCase().indexOf(q) < 0) return false
      var lt = r.last_test ? Date.parse(r.last_test) : 0
      if (adm.f === 'active') return lt && now - lt < wk
      if (adm.f === 'inactive') return !lt || now - lt >= wk
      if (adm.f === 'notest') return !r.tests
      if (adm.f === 'nosignin') return !r.last_sign_in
      return true
    })
    var val = function (r) { var v = r[k]; if (k === 'name' || k === 'email') return String(v || '').toLowerCase(); if (k === 'last_test' || k === 'last_sign_in') return v ? Date.parse(v) : 0; return v == null ? -1 : +v }
    rows.sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * adm.dir })
    adm.view = rows; $('#a_cnt').textContent = rows.length + ' of ' + adm.rows.length
    var th = function (key, label) { return '<td><b><a href="#" data-k="' + key + '" style="color:inherit">' + label + (adm.k === key ? (adm.dir > 0 ? ' &#9650;' : ' &#9660;') : '') + '</a></b></td>' }
    var allOn = rows.length && rows.every(function (r) { return adm.sel[r.email] })
    $('#a_tbl').innerHTML = '<table class="tests" style="width:100%;min-width:0"><tr><td><input type="checkbox" id="a_all"' + (allOn ? ' checked' : '') + '></td>' + th('name', 'Name') + th('email', 'Email') + th('tests', 'Tests') + th('avg', 'Average') + th('best', 'Best') + th('last_test', 'Last test') + th('last_sign_in', 'Last sign in') + '<td></td></tr>' +
      (rows.length ? rows.map(function (r, i) { return '<tr><td><input type="checkbox" data-s="' + i + '"' + (adm.sel[r.email] ? ' checked' : '') + '></td><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + r.tests + '</td><td>' + (r.avg == null ? '' : r.avg + '%') + '</td><td>' + (r.best == null ? '' : r.best + '%') + '</td><td>' + (r.last_test ? ago(r.last_test) : 'never') + '</td><td>' + ago(r.last_sign_in) + '</td><td><button data-v="' + i + '">View</button></td></tr>' }).join('') : '<tr><td colspan="9">No students match.</td></tr>') + '</table>'
    $('#a_tbl').querySelectorAll('[data-k]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); if (adm.k === a.dataset.k) adm.dir = -adm.dir; else { adm.k = a.dataset.k; adm.dir = (adm.k === 'name' || adm.k === 'email') ? 1 : -1 } aTable() } })
    $('#a_all').onchange = function () { var on = this.checked; rows.forEach(function (r) { adm.sel[r.email] = on }); aTable() }
    $('#a_tbl').querySelectorAll('[data-s]').forEach(function (c) { c.onchange = function () { adm.sel[rows[+c.dataset.s].email] = c.checked; var a = $('#a_all'); if (a) a.checked = rows.every(function (r) { return adm.sel[r.email] }) } })
    $('#a_tbl').querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { aDetail(rows[+b.dataset.v].email) } })
  }
  function aDetail(email) {
    $('#a_body').textContent = 'Loading...'
    rpc('admin_student_detail', { p_email: email }).then(function (d) {
      var p = d.profile, T = d.tests, sc = 0, den = 0, secs = 0
      T.forEach(function (t) { sc += t.score; den += t.total; secs += t.seconds || 0 })
      var tile = function (a, b) { return '<tr><td style="' + TD + '">' + a + '</td><td><b>' + b + '</b></td></tr>' }
      var html = '<p><button id="d_back">&laquo; All students</button></p>' +
        box(esc(p.name), '<table>' + tile('Email (Student ID)', esc(p.email)) + tile('School', esc(p.school)) + tile('Account created', new Date(p.created).toLocaleDateString()) + tile('Last sign in', p.last_sign_in ? new Date(p.last_sign_in).toLocaleString() : 'never') + tile('Tests taken', T.length) + tile('Average score', den ? Math.round(1000 * sc / den) / 10 + '%' : '-') + tile('Average time per test', T.length ? dur(secs / T.length) : '-') + '</table>' +
          '<p><button id="d_ren">Rename</button> <button id="d_pw">Reset password</button> <button id="d_clr">Clear test history</button> <button id="d_rm">Remove student</button></p>')
      html += box('Tests', T.length ? '<table class="tests" style="width:100%;min-width:0"><tr><td><b>Date</b></td><td><b>Exam</b></td><td><b>Score</b></td><td><b>Time</b></td></tr>' + T.map(function (t) { return '<tr><td>' + new Date(t.taken_at).toLocaleString() + '</td><td>' + esc(t.name) + '</td><td>' + t.score + '/' + t.total + ' (' + Math.round(100 * t.score / t.total) + '%)</td><td>' + dur(t.seconds) + '</td></tr>' }).join('') + '</table>' : 'No tests yet.')
      html += box('Performance indicators missed most', d.pis.length ? bars(d.pis.map(function (x) { return { label: (x.pi || 'No PI') + (x.txt ? ' - ' + x.txt : ''), v: 100 * x.wrong / x.seen, right: x.wrong + ' wrong of ' + x.seen, color: '#d9534f' } }), '#d9534f') : 'Nothing missed yet.')
      var ar = d.areas.slice().sort(function (a, b) { return (a.seen - a.wrong) / a.seen - (b.seen - b.wrong) / b.seen })
      html += box('Accuracy by topic area (weakest first)', ar.length ? bars(ar.map(function (a) { var q = Math.round(100 * (a.seen - a.wrong) / a.seen); return { label: a.area, v: q, right: q + '% (' + a.seen + ' seen)', color: q >= 70 ? '#5cb85c' : '#f0ad4e' } }), '#3b82f6') : 'No data yet.')
      $('#a_body').innerHTML = html
      $('#d_back').onclick = function () { adminDraw() }
      $('#d_ren').onclick = function () { var n = prompt('Student name', p.name); if (!n || !n.trim()) return; rpc('admin_update_student', { p_email: email, p_name: n, p_school: p.school || SCHOOL }).then(function () { aDetail(email) }, function (e) { alert(e.msg) }) }
      $('#d_pw').onclick = function () { var n = prompt('New password for ' + email, '48onDECA'); if (!n) return; rpc('admin_set_password', { p_email: email, p_password: n }).then(function () { alert('Password changed.') }, function (e) { alert(e.msg) }) }
      $('#d_clr').onclick = function () { if (!confirm('Delete all ' + T.length + ' saved tests for ' + p.name + '? This cannot be undone.')) return; rpc('admin_clear_history', { p_email: email }).then(function () { aDetail(email) }, function (e) { alert(e.msg) }) }
      $('#d_rm').onclick = function () { if (!confirm('Remove ' + p.name + ' (' + email + ') and all their saved tests? This cannot be undone.')) return; rpc('admin_remove_student', { p_email: email }).then(function () { adminDraw() }, function (e) { alert(e.msg) }) }
    }).catch(aErr)
  }
  function aAdd() {
    var step = 1
    var steps = [['a_n', 'Type the student\'s full name in the Name box.'], ['a_e', 'Type their email address. They will use it as their Student ID to sign in.'], ['a_p', 'Check the password. Everyone gets 48onDECA unless you change it here. Tell the student what it is.'], ['a_add', 'Press the Add student button.'], ['a_msg', 'Check the result. "created" means the account is ready. Give the student their email and password.'], ['a_bulk', 'To add a whole class at once, paste one student per line as Name, email, then press Add all. You are done.']]
    $('#a_body').innerHTML = '<p><label><input type="checkbox" id="a_demo"' + (demoOn() ? ' checked' : '') + '> Show step-by-step guide</label></p><div id="a_guide"></div>' +
      box('Add student', '<table style="border-collapse:collapse"><tr><td style="padding:3px 8px 3px 0">Name</td><td><input id="a_n" size="30"></td></tr>' +
        '<tr><td style="padding:3px 8px 3px 0">Email</td><td><input id="a_e" size="30"></td></tr>' +
        '<tr><td style="padding:3px 8px 3px 0">Password</td><td><input id="a_p" size="30" value="48onDECA"></td></tr></table>' +
        '<p><button id="a_add">Add student</button></p>' +
        '<p>Or add many: one per line, as <i>Name, email</i>.</p>' +
        '<textarea id="a_bulk" rows="6" cols="60"></textarea><p><button id="a_bulkgo">Add all</button></p>' +
        '<div id="a_msg" style="min-height:24px"></div>')
    var guide = function () {
      var g = $('#a_guide'); steps.forEach(function (s) { $('#' + s[0]).style.outline = '' })
      if (!$('#a_demo').checked) { g.innerHTML = ''; return }
      var s = steps[step - 1], el = $('#' + s[0]); el.style.outline = '3px solid #f0ad4e'
      g.innerHTML = '<div style="border:2px solid #f0ad4e;padding:10px;margin:0 0 12px;background:#fff8e6"><b>Step ' + step + ' of ' + steps.length + ':</b> ' + esc(s[1]) + '<p style="margin:8px 0 0"><button id="g_b"' + (step === 1 ? ' disabled' : '') + '>Back</button> <button id="g_n">' + (step === steps.length ? 'Finish' : 'Next') + '</button></p></div>'
      if (el.focus && /INPUT|TEXTAREA/.test(el.tagName)) el.focus()
      $('#g_b').onclick = function () { step--; guide() }
      $('#g_n').onclick = function () { if (step === steps.length) { $('#a_demo').checked = false; setDemo(false); step = 1 } else step++; guide() }
    }
    $('#a_demo').onchange = function () { setDemo(this.checked); step = 1; guide() }
    var msg = function (t) { $('#a_msg').innerHTML = t }
    var send = function (rows) {
      if (!rows.length) return msg('Nothing to add.')
      msg('Adding...')
      rpc('admin_add_students', { p_rows: rows, p_password: $('#a_p').value || '48onDECA' }).then(function (out) {
        msg('<table class="tests" style="min-width:0"><tr><td><b>Name</b></td><td><b>Email</b></td><td><b>Result</b></td></tr>' + out.map(function (o) { return '<tr><td>' + esc(o.name) + '</td><td>' + esc(o.email) + '</td><td>' + esc(o.status) + '</td></tr>' }).join('') + '</table>')
        if (out.some(function (o) { return o.status === 'created' })) { $('#a_n').value = ''; $('#a_e').value = ''; $('#a_bulk').value = '' }
        if ($('#a_demo').checked && step === 4) { step = 5; guide() }
      }).catch(function (e) { msg('Error: ' + esc(e.msg || 'could not add')) })
    }
    $('#a_add').onclick = function () { send([{ name: $('#a_n').value, email: $('#a_e').value, school: SCHOOL }]) }
    $('#a_bulkgo').onclick = function () {
      send($('#a_bulk').value.split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
        var p = l.split(/[,\t;]/).map(function (x) { return x.trim() })
        if (p.length === 1 && /@/.test(p[0])) return { name: '', email: p[0], school: SCHOOL }
        if (/@/.test(p[0]) && !/@/.test(p[1] || '')) return { name: p[1] || '', email: p[0], school: SCHOOL }
        return { name: p[0], email: p[1] || '', school: SCHOOL }
      }))
    }
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
