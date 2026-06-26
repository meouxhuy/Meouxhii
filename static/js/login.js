document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('submitBtn');
    const loader = document.getElementById('loader');
    const errorMsg = document.getElementById('errorMessage');

    btn.disabled = true;
    loader.style.display = 'inline-block';
    errorMsg.style.display = 'none';

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (response.ok) {
            window.location.href = '/';
        } else {
            const data = await response.json();
            errorMsg.innerText = data.message;
            errorMsg.style.display = 'block';
        }
    } catch (err) {
        errorMsg.innerText = "Lỗi kết nối server!";
        errorMsg.style.display = 'block';
    } finally {
        btn.disabled = false;
        loader.style.display = 'none';
    }
});
