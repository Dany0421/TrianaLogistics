let mode = 'login';
let loginAttempts = 0;
let lockoutUntil  = 0;

function setMode(m) {
  mode = m;
  const errEl = document.getElementById('errorMsg');
  errEl.style.display = 'none';
  errEl.style.color   = 'var(--danger)';

  const show = id => document.getElementById(id).style.display = '';
  const hide = id => document.getElementById(id).style.display = 'none';

  hide('nameRow'); show('emailRow'); show('passwordRow'); hide('confirmRow');
  hide('forgotRow');
  document.getElementById('toggleMsg').parentElement.style.display = '';

  if (m === 'login') {
    document.getElementById('loginTitle').textContent = 'Bem-vindo de volta';
    document.getElementById('loginSub').textContent   = 'Introduz as tuas credenciais para entrar.';
    document.getElementById('submitBtn').textContent  = 'Entrar';
    document.getElementById('passwordLabel').textContent = 'Password';
    document.getElementById('password').autocomplete  = 'current-password';
    show('forgotRow');
    document.getElementById('toggleMsg').textContent  = 'Ainda não tens conta?';
    document.getElementById('toggleLink').textContent = 'Registar';
  } else if (m === 'signup') {
    show('nameRow');
    document.getElementById('loginTitle').textContent = 'Criar conta';
    document.getElementById('loginSub').textContent   = 'Preenche os campos abaixo para criar a tua conta.';
    document.getElementById('submitBtn').textContent  = 'Criar conta';
    document.getElementById('passwordLabel').textContent = 'Password';
    document.getElementById('password').autocomplete  = 'new-password';
    document.getElementById('toggleMsg').textContent  = 'Já tens conta?';
    document.getElementById('toggleLink').textContent = 'Entrar';
  } else if (m === 'reset') {
    hide('passwordRow');
    document.getElementById('loginTitle').textContent = 'Recuperar password';
    document.getElementById('loginSub').textContent   = 'Indica o teu email e enviamos um link para redefinir a password.';
    document.getElementById('submitBtn').textContent  = 'Enviar link';
    document.getElementById('toggleMsg').textContent  = 'Voltar ao';
    document.getElementById('toggleLink').textContent = 'Login';
  } else if (m === 'new-password') {
    hide('emailRow');
    show('confirmRow');
    document.getElementById('loginTitle').textContent = 'Nova password';
    document.getElementById('loginSub').textContent   = 'Define a tua nova password.';
    document.getElementById('submitBtn').textContent  = 'Guardar password';
    document.getElementById('passwordLabel').textContent = 'Nova password';
    document.getElementById('password').autocomplete  = 'new-password';
    document.getElementById('toggleMsg').parentElement.style.display = 'none';
  }
}

function toggleSignup() {
  setMode(mode === 'signup' ? 'login' : (mode === 'reset' ? 'login' : 'signup'));
}

async function doSubmit() {
  const errEl = document.getElementById('errorMsg');
  errEl.style.display = 'none';
  errEl.style.color   = 'var(--danger)';

  const email    = document.getElementById('email')?.value.trim() || '';
  const password = document.getElementById('password')?.value     || '';

  if (mode === 'login') {
    if (!email || !password) { errEl.textContent = 'Preenche email e password.'; errEl.style.display = 'block'; return; }
    if (Date.now() < lockoutUntil) {
      errEl.textContent = `Demasiadas tentativas. Aguarda ${Math.ceil((lockoutUntil - Date.now()) / 1000)}s.`;
      errEl.style.display = 'block'; return;
    }
    if (!email.endsWith('@triana.co.mz')) { errEl.textContent = 'Apenas emails @triana.co.mz são permitidos.'; errEl.style.display = 'block'; return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginAttempts++;
      if (loginAttempts >= 5) { lockoutUntil = Date.now() + 60000; loginAttempts = 0; errEl.textContent = 'Demasiadas tentativas. Aguarda 60 segundos.'; }
      else { errEl.textContent = 'Email ou password incorretos.'; }
      errEl.style.display = 'block'; return;
    }
    loginAttempts = 0;
    window.location.href = 'dashboard.html';

  } else if (mode === 'signup') {
    const name = document.getElementById('name').value.trim();
    if (!email || !password) { errEl.textContent = 'Preenche todos os campos.'; errEl.style.display = 'block'; return; }
    if (!email.endsWith('@triana.co.mz')) { errEl.textContent = 'Apenas emails @triana.co.mz são permitidos.'; errEl.style.display = 'block'; return; }
    if (!name || name.length < 2) { errEl.textContent = 'Introduz o teu nome (mínimo 2 caracteres).'; errEl.style.display = 'block'; return; }
    if (name.length > 100) { errEl.textContent = 'Nome demasiado longo (máximo 100 caracteres).'; errEl.style.display = 'block'; return; }
    if (password.length < 8) { errEl.textContent = 'Password deve ter pelo menos 8 caracteres.'; errEl.style.display = 'block'; return; }
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    errEl.style.color   = 'var(--accent)';
    errEl.textContent   = 'Conta criada! Verifica o email para confirmar.';
    errEl.style.display = 'block';

  } else if (mode === 'reset') {
    if (!email) { errEl.textContent = 'Introduz o teu email.'; errEl.style.display = 'block'; return; }
    if (!email.endsWith('@triana.co.mz')) { errEl.textContent = 'Apenas emails @triana.co.mz são permitidos.'; errEl.style.display = 'block'; return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    errEl.style.color   = 'var(--accent)';
    errEl.textContent   = 'Link enviado! Verifica o teu email.';
    errEl.style.display = 'block';
    document.getElementById('submitBtn').disabled = true;

  } else if (mode === 'new-password') {
    const confirm = document.getElementById('confirmPassword').value;
    if (password.length < 8) { errEl.textContent = 'A password deve ter pelo menos 8 caracteres.'; errEl.style.display = 'block'; return; }
    if (password !== confirm) { errEl.textContent = 'As passwords não coincidem.'; errEl.style.display = 'block'; return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    errEl.style.color   = 'var(--accent)';
    errEl.textContent   = 'Password atualizada! A redirecionar...';
    errEl.style.display = 'block';
    setTimeout(() => window.location.href = 'dashboard.html', 1500);
  }
}

document.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('submitBtn').addEventListener('click', doSubmit);

  const forgotSpan = document.querySelector('#forgotRow span');
  if (forgotSpan) {
    forgotSpan.addEventListener('click', () => setMode('reset'));
    forgotSpan.addEventListener('mouseover', () => { forgotSpan.style.color = 'var(--accent)'; });
    forgotSpan.addEventListener('mouseout',  () => { forgotSpan.style.color = 'var(--muted)'; });
  }

  document.getElementById('toggleLink').addEventListener('click', toggleSignup);
});

window.addEventListener('load', async () => {
  const hash   = window.location.hash;
  const params = new URLSearchParams(hash.replace('#', '?'));
  if (params.get('type') === 'recovery') {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) {
      setMode('new-password');
      return;
    }
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.href = 'dashboard.html';
});
