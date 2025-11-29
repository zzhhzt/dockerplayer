document.addEventListener('DOMContentLoaded', () => {
    const loginModal = document.getElementById('loginModal');
    const dashboard = document.getElementById('dashboard');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginError = document.getElementById('loginError');

    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const fileList = document.getElementById('fileList');

    let adminPassword = localStorage.getItem('adminPassword');

    // --- Auth Logic ---
    if (adminPassword) {
        verifyAndShowDashboard();
    }

    loginBtn.addEventListener('click', () => {
        const pwd = passwordInput.value;
        if (!pwd) return;

        loginBtn.disabled = true;
        loginBtn.textContent = '验证中...';
        loginError.textContent = '';

        fetch('/api/verify', {
            method: 'POST',
            headers: { 'x-admin-password': pwd }
        })
            .then(res => {
                if (res.ok) {
                    adminPassword = pwd;
                    localStorage.setItem('adminPassword', pwd);
                    verifyAndShowDashboard();
                } else {
                    loginError.textContent = '密码错误';
                }
            })
            .catch(() => {
                loginError.textContent = '连接服务器失败';
            })
            .finally(() => {
                loginBtn.disabled = false;
                loginBtn.textContent = '登录';
            });
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('adminPassword');
        location.reload();
    });

    function verifyAndShowDashboard() {
        loginModal.style.display = 'none';
        dashboard.style.display = 'block';
        fetchFiles();
        loadSettings();
    }

    // --- Settings Logic ---
    const siteTitleInput = document.getElementById('siteTitleInput');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    function loadSettings() {
        fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                if (data.siteTitle) {
                    siteTitleInput.value = data.siteTitle;
                }
            });
    }

    saveSettingsBtn.addEventListener('click', () => {
        const title = siteTitleInput.value;
        fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify({ siteTitle: title })
        })
            .then(res => {
                if (res.ok) alert('设置已保存');
                else alert('保存失败');
            });
    });

    // --- File Management ---

    function fetchFiles() {
        fetch('/api/playlist')
            .then(res => res.json())
            .then(files => {
                fileList.innerHTML = '';
                files.forEach(file => {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <span>${file.name}</span>
                        <div class="actions">
                            <button class="qr-btn" onclick="showQrCode('${file.name}')">二维码</button>
                            <button class="rename-btn" onclick="renameFile('${file.name}')">重命名</button>
                            <button class="delete-btn" data-name="${file.name}">删除</button>
                        </div>
                    `;
                    fileList.appendChild(li);
                });

                // Add delete listeners
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        deleteFile(e.target.dataset.name);
                    });
                });
            });
    }

    window.renameFile = function (oldName) {
        const newName = prompt('请输入新文件名 (包含后缀):', oldName);
        if (!newName || newName === oldName) return;

        fetch(`/api/music/${encodeURIComponent(oldName)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify({ newName: newName })
        })
            .then(async res => {
                if (res.ok) {
                    fetchFiles();
                } else {
                    const data = await res.json();
                    alert('重命名失败: ' + (data.error || '未知错误'));
                }
            });
    };

    uploadBtn.addEventListener('click', () => {
        const file = fileInput.files[0];
        if (!file) {
            uploadStatus.textContent = '请先选择文件';
            uploadStatus.className = 'error';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        uploadBtn.disabled = true;
        uploadStatus.textContent = '正在上传...';
        uploadStatus.className = '';

        fetch('/api/upload', {
            method: 'POST',
            headers: {
                'x-admin-password': adminPassword
            },
            body: formData
        })
            .then(async res => {
                if (res.ok) return res.json();
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Upload failed with status ${res.status}`);
            })
            .then(data => {
                uploadStatus.textContent = '上传成功!';
                uploadStatus.style.color = 'green';
                fileInput.value = '';
                fetchFiles();
            })
            .catch(err => {
                console.error(err);
                uploadStatus.textContent = `上传失败: ${err.message}`;
                uploadStatus.className = 'error';
            })
            .finally(() => {
                uploadBtn.disabled = false;
            });
    });

    function deleteFile(filename) {
        if (!confirm(`确定要删除 ${filename} 吗?`)) return;

        fetch(`/api/music/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            headers: {
                'x-admin-password': adminPassword
            }
        })
            .then(res => {
                if (res.ok) {
                    fetchFiles();
                } else {
                    alert('删除失败: 密码错误或服务器问题');
                }
            });
    }

    // --- QR Code Logic ---
    const qrModal = document.getElementById('qrModal');
    const closeQrModal = document.getElementById('closeQrModal');
    const qrcodeContainer = document.getElementById('qrcode');
    const qrSongName = document.getElementById('qrSongName');

    // Controls
    const qrColorDark = document.getElementById('qrColorDark');
    const qrColorLight = document.getElementById('qrColorLight');
    const qrLogoInput = document.getElementById('qrLogoInput');
    const qrTitleInput = document.getElementById('qrTitleInput');

    let currentQrFile = null;
    let currentLogo = null;

    window.showQrCode = function (filename) {
        currentQrFile = filename;
        qrModal.style.display = 'flex'; // Use flex to center
        qrSongName.textContent = filename;
        generateQRCode();
    };

    function generateQRCode() {
        qrcodeContainer.innerHTML = ''; // Clear previous

        if (!currentQrFile) return;

        // Generate URL: current origin + /?song=filename
        const url = `${window.location.origin}/?song=${encodeURIComponent(currentQrFile)}`;

        const options = {
            text: url,
            width: 250,
            height: 250,
            colorDark: qrColorDark.value,
            colorLight: qrColorLight.value,
            correctLevel: QRCode.CorrectLevel.H, // High error correction for logos
            logo: currentLogo,
            logoWidth: 60,
            logoHeight: 60,
            logoBackgroundColor: '#ffffff',
            logoBackgroundTransparent: false,
            title: qrTitleInput.value,
            titleFont: "bold 16px Arial",
            titleColor: "#000000",
            titleBackgroundColor: "#ffffff",
            titleHeight: 40,
            titleTop: 30
        };

        if (typeof QRCode === 'undefined') {
            alert('QR Code library failed to load. Please check your internet connection or try refreshing.');
            return;
        }

        new QRCode(qrcodeContainer, options);
    }

    // Event Listeners for Controls
    qrColorDark.addEventListener('input', generateQRCode);
    qrColorLight.addEventListener('input', generateQRCode);
    qrTitleInput.addEventListener('input', generateQRCode);

    qrLogoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                currentLogo = e.target.result;
                generateQRCode();
            };
            reader.readAsDataURL(file);
        } else {
            currentLogo = null;
            generateQRCode();
        }
    });

    closeQrModal.addEventListener('click', () => {
        qrModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target == qrModal) {
            qrModal.style.display = 'none';
        }
    });
});
