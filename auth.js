(() => {
  'use strict';
  const cfg = window.CREATORSIN_CONFIG || {};
  const configured = Boolean(
    cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('YOUR_') &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('YOUR_')
  );
  const client = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  window.creatorsInSupabase = client;
  const gate = document.getElementById('authGate');
  const status = document.getElementById('accountStatus');
  const message = document.getElementById('authMessage');
  const setupNotice = document.getElementById('authSetupNotice');
  const forgotButton = document.getElementById('forgotPassword');
  let mode = 'signup';
  let currentUser = null;

  function notify(text, type = '') {
    message.textContent = text;
    message.className = `auth-message ${type}`.trim();
  }
  function toastMsg(text) {
    if (typeof showToast === 'function') showToast(text);
    else notify(text);
  }
  function displayName(user) {
    return user?.user_metadata?.full_name || user?.email || 'Member';
  }
  function setBusy(busy) {
    document.querySelectorAll('#authGate button, #authGate input, #authGate select').forEach((el) => {
      if (el.dataset.authMode) return;
      el.disabled = busy;
    });
  }
  function setMode(next) {
    mode = next;
    notify('');
    document.querySelectorAll('[data-auth-mode]').forEach((b) => b.classList.toggle('active', b.dataset.authMode === mode));
    document.getElementById('authTitle').textContent = mode === 'signup' ? 'Create your account' : 'Welcome back';
    document.getElementById('authSubtitle').textContent = mode === 'signup' ? 'Join as a creator, brand, or agency.' : 'Log in to your CreatorsIn account.';
    document.getElementById('emailAuthButton').textContent = mode === 'signup' ? 'Create account' : 'Log in';
    document.getElementById('authName').classList.toggle('hidden', mode === 'login');
    document.getElementById('authAccountType').classList.toggle('hidden', mode === 'login');
    forgotButton.classList.toggle('hidden', mode !== 'login');
    document.getElementById('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  }
  document.querySelectorAll('[data-auth-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.authMode)));

  async function oauth(provider) {
    if (!client) return notify('Add your Supabase URL and public key to config.js before publishing.', 'error');
    setBusy(true);
    const redirectTo = cfg.SITE_URL || window.location.origin;
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setBusy(false);
      notify(error.message, 'error');
    }
  }
  document.getElementById('googleAuth').addEventListener('click', () => oauth('google'));
  document.getElementById('appleAuth').addEventListener('click', () => oauth('apple'));

  document.getElementById('emailAuthForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client) return notify('Finish the Supabase setup in DEPLOY-TODAY.txt first.', 'error');
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const fullName = document.getElementById('authName').value.trim();
    const accountType = document.getElementById('authAccountType').value;
    if (password.length < 8) return notify('Use a password with at least 8 characters.', 'error');
    setBusy(true);
    notify(mode === 'signup' ? 'Creating your account…' : 'Signing you in…');
    try {
      if (mode === 'signup') {
        if (!fullName) return notify('Enter your full name.', 'error');
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, account_type: accountType },
            emailRedirectTo: cfg.SITE_URL || window.location.origin
          }
        });
        if (error) throw error;
        if (data.session) {
          await ensureProfile(data.user);
          await signedIn(data.user);
        } else {
          notify('Account created. Check your email and click the confirmation link.', 'success');
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await signedIn(data.user);
      }
    } catch (error) {
      notify(error.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  });

  forgotButton.addEventListener('click', async () => {
    if (!client) return notify('Finish the Supabase setup first.', 'error');
    const email = document.getElementById('authEmail').value.trim();
    if (!email) return notify('Enter your email address first.', 'error');
    setBusy(true);
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: cfg.SITE_URL || window.location.origin });
    setBusy(false);
    if (error) notify(error.message, 'error');
    else notify('Password reset email sent.', 'success');
  });

  async function ensureProfile(user) {
    if (!client || !user) return;
    const metadata = user.user_metadata || {};
    const { error } = await client.from('profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: metadata.full_name || user.email?.split('@')[0] || 'Member',
      account_type: metadata.account_type || 'creator'
    }, { onConflict: 'id' });
    if (error) console.error('Profile setup failed:', error.message);
  }

  async function signedIn(user) {
    if (!user) return;
    currentUser = user;
    await ensureProfile(user);
    gate.classList.add('hidden');
    status.textContent = displayName(user);
    window.creatorsInAuthUser = user;
    window.dispatchEvent(new CustomEvent('creatorsin:user', { detail: {
      id: user.id,
      name: displayName(user),
      email: user.email,
      accountType: user.user_metadata?.account_type || 'creator',
      avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || ''
    }}));
    toastMsg('Signed in successfully');
  }

  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-action="logout"]')) return;
    if (client) await client.auth.signOut();
    currentUser = null;
    window.creatorsInAuthUser = null;
    gate.classList.remove('hidden');
    status.textContent = 'Not signed in';
    setMode('login');
    toastMsg('Signed out');
  }, true);

  async function init() {
    setMode('signup');
    if (!configured) {
      setupNotice.classList.remove('hidden');
      setupNotice.textContent = 'Setup required: add your Supabase Project URL and publishable/anon key to config.js. See DEPLOY-TODAY.txt.';
      document.querySelectorAll('#emailAuthForm input, #emailAuthForm select, #emailAuthForm button, #googleAuth, #appleAuth').forEach((el) => { el.disabled = true; });
      notify('The design is ready, but account creation stays locked until config.js is connected.', 'error');
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error) notify(error.message, 'error');
    if (data?.session?.user) await signedIn(data.session.user);
    client.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) await signedIn(session.user);
      else if (currentUser) {
        currentUser = null;
        gate.classList.remove('hidden');
        status.textContent = 'Not signed in';
      }
    });
  }
  init();
})();
