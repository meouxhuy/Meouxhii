document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('submitBtn');
  const btnContent  = document.getElementById('btnContent');
  const btnLoading  = document.getElementById('btnLoading');
  const errorBox    = document.getElementById('errorBox');
  const errorText   = document.getElementById('errorText');

  // Show loading state
  btn.disabled = true;
  btn.classList.add('loading');
  btnContent.classList.add('hidden');
  btnLoading.classList.remove('hidden');
  errorBox.classList.remove('show');

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (response.ok) {
      // Brief success flash before redirect
      btn.style.background = 'linear-gradient(110deg, #bbf7d0, #34d399)';
      btnLoading.querySelector('span:last-child') && (btnLoading.lastChild.textContent = 'Thành công!');
      setTimeout(() => { window.location.href = '/'; }, 500);
    } else {
      const data = await response.json();
      errorText.textContent = data.message || 'Email hoặc mật khẩu không đúng!';
      errorBox.classList.add('show');
      // Shake the error fields
      document.getElementById('fieldEmail').style.animation = '';
      document.getElementById('fieldPassword').style.animation = '';
      void document.getElementById('fieldEmail').offsetWidth; // force reflow
      document.getElementById('fieldPassword').style.animation = 'shake 0.4s both';
    }
  } catch (err) {
    errorText.textContent = 'Lỗi kết nối server!';
    errorBox.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btnContent.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
});
