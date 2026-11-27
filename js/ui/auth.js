// ログイン・新規登録の画面（config.js に Supabase を設定したときだけ使う）
import { $ } from './dom.js';
import { isValidEmail } from '../util.js';

export function showAuth(backend, onSignedIn) {
  for (const v of ['home', 'list']) $(`#view-${v}`).hidden = true;
  $('#view-auth').hidden = false;
  document.body.dataset.view = 'auth';
  const st = { mode: 'login', busy: false };
  $('#auth-form').onsubmit = (e) => { e.preventDefault(); submitAuth(backend, st, onSignedIn); };
  $('#auth-toggle').onclick = () => { st.mode = st.mode === 'login' ? 'signup' : 'login'; drawAuth(st); };
  $('#auth-forgot').onclick = () => forgot(backend);
  drawAuth(st);
}

export function hideAuth() {
  $('#view-auth').hidden = true;
}

function drawAuth(st) {
  const signup = st.mode === 'signup';
  $('#auth-title').textContent = signup ? 'はじめまして！' : 'おかえりなさい';
  $('#auth-submit').textContent = signup ? '新規登録する' : 'ログイン';
  $('#auth-toggle').textContent = signup ? 'アカウントをお持ちの方は「ログイン」' : 'はじめての方は「新規登録」';
  $('#auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#auth-forgot').hidden = signup;
  msg('');
}

function msg(text, kind = 'err') {
  const m = $('#auth-msg');
  m.textContent = text;
  m.dataset.kind = kind;
}

async function submitAuth(backend, st, onSignedIn) {
  if (st.busy || !backend) return;
  const email = $('#auth-email').value.trim();
  const pw = $('#auth-password').value;
  if (!isValidEmail(email)) { msg('メールアドレスの形を確かめてね'); return; }
  if (pw.length < 6) { msg('パスワードは6文字以上にしてね'); return; }
  st.busy = true;
  $('#auth-submit').disabled = true;
  msg('通信中…', 'info');
  try {
    if (st.mode === 'login') {
      onSignedIn(await backend.signIn(email, pw));
      return;
    }
    const r = await backend.signUp(email, pw);
    if (r.session) onSignedIn(r.session);
    else msg('確認のメールを送りました 💌 メールのリンクを開いてから、ここでログインしてね', 'ok');
  } catch (e) {
    msg(e.message || 'うまくいきませんでした');
  } finally {
    st.busy = false;
    $('#auth-submit').disabled = false;
  }
}

async function forgot(backend) {
  const email = $('#auth-email').value.trim();
  if (!isValidEmail(email)) { msg('先にメールアドレスを入れてから押してね'); return; }
  try {
    await backend.resetPassword(email);
    msg('パスワードを変えるためのメールを送りました 💌', 'ok');
  } catch (e) {
    msg(e.message || '送れませんでした');
  }
}
