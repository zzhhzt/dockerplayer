// HTML escaping function to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

document.addEventListener('DOMContentLoaded', () => {
    const loginModal = document.getElementById('loginModal');
    const dashboard = document.getElementById('dashboard');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginError = document.getElementById('loginError');

    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const uploadBtn = document.getElementById('uploadBtn');
    const clearBtn = document.getElementById('clearBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const uploadProgress = document.getElementById('uploadProgress');
    const fileList = document.getElementById('fileList');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

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
                if (data.allowedOrigins && Array.isArray(data.allowedOrigins)) {
                    const allowedOriginsInput = document.getElementById('allowedOriginsInput');
                    if (allowedOriginsInput) {
                        allowedOriginsInput.value = data.allowedOrigins.join(', ');
                    }
                }
            });
    }

    saveSettingsBtn.addEventListener('click', () => {
        const title = siteTitleInput.value;
        const allowedOriginsInput = document.getElementById('allowedOriginsInput');
        let allowedOrigins = [];

        if (allowedOriginsInput && allowedOriginsInput.value.trim()) {
            allowedOrigins = allowedOriginsInput.value
                .split(',')
                .map(origin => origin.trim())
                .filter(origin => origin.length > 0);
        }

        fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify({
                siteTitle: title,
                allowedOrigins: allowedOrigins
            })
        })
            .then(res => {
                if (res.ok) alert('设置已保存');
                else alert('保存失败');
            });
    });

    // --- File Management ---

    function fetchFiles() {
        fetch('/api/admin/playlist', {
            headers: {
                'x-admin-password': adminPassword
            }
        })
            .then(res => res.json())
            .then(files => {
                fileList.innerHTML = '';
                selectedFiles.clear();
                isSelectAll = false;
                updateBatchButtons();

                files.forEach(file => {
                    const li = document.createElement('li');
                    const visibilityClass = file.hidden ? 'hidden' : 'visible';
                    const visibilityText = file.hidden ? '显示' : '隐藏';
                    const visibilityBtnClass = file.hidden ? 'show-btn' : 'hide-btn';
                    const escapedName = escapeHtml(file.name);

                    li.innerHTML = `
                        <div class="file-info">
                            <input type="checkbox" class="checkbox" data-filename="${escapedName}">
                            <span class="file-name ${visibilityClass}">${escapedName} ${file.hidden ? '(👁️‍🗨️已隐藏)' : ''}</span>
                        </div>
                        <div class="actions">
                            <button class="qr-btn" onclick="showQrCode('${escapedName}')">二维码</button>
                            <button class="rename-btn" onclick="renameFile('${escapedName}')">重命名</button>
                            <button class="${visibilityBtnClass}" onclick="toggleVisibility('${escapedName}', ${!file.hidden})">${visibilityText}</button>
                            <button class="delete-btn" data-name="${escapedName}">删除</button>
                        </div>
                    `;

                    // Add checkbox change listener
                    const checkbox = li.querySelector('.checkbox');
                    checkbox.addEventListener('change', (e) => {
                        const filename = e.target.dataset.filename;
                        if (e.target.checked) {
                            selectedFiles.add(filename);
                        } else {
                            selectedFiles.delete(filename);
                        }
                        li.classList.toggle('selected');
                        updateBatchButtons();
                    });

                    fileList.appendChild(li);
                });

                // Add delete listeners
                document.querySelectorAll('.delete-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const filename = e.target.dataset.name;
                        if (selectedFiles.has(filename)) {
                            confirmAndDeleteSelected();
                        } else {
                            deleteFile(filename);
                        }
                    });
                });
            });
    }

    // Batch operations
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.file-list .checkbox');
        const items = document.querySelectorAll('.file-list li');

        isSelectAll = !isSelectAll;
        selectedFiles.clear();

        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = isSelectAll;
            const filename = checkbox.dataset.filename;
            if (isSelectAll) {
                selectedFiles.add(filename);
                items[index].classList.add('selected');
            } else {
                items[index].classList.remove('selected');
            }
        });

        updateBatchButtons();
        selectAllBtn.textContent = isSelectAll ? '取消全选' : '全选';
    });

    deleteSelectedBtn.addEventListener('click', () => {
        if (selectedFiles.size === 0) return;
        confirmAndDeleteSelected();
    });

    function updateBatchButtons() {
        deleteSelectedBtn.disabled = selectedFiles.size === 0;
        deleteSelectedBtn.textContent = `删除选中 (${selectedFiles.size})`;

        // Update select all button text
        const allFiles = document.querySelectorAll('.file-list .checkbox');
        const checkedFiles = document.querySelectorAll('.file-list .checkbox:checked');

        if (allFiles.length === checkedFiles.length && allFiles.length > 0) {
            isSelectAll = true;
            selectAllBtn.textContent = '取消全选';
        } else {
            isSelectAll = false;
            selectAllBtn.textContent = '全选';
        }
    }

    function confirmAndDeleteSelected() {
        const count = selectedFiles.size;
        if (!confirm(`确定要删除选中的 ${count} 个文件吗？此操作不可恢复。`)) return;

        const filenames = Array.from(selectedFiles);
        let deletedCount = 0;
        let errors = [];

        async function deleteNext() {
            if (filenames.length === 0) {
                // All done
                if (deletedCount === count) {
                    uploadStatus.textContent = `✅ 成功删除 ${deletedCount} 个文件`;
                    uploadStatus.style.color = 'green';
                } else {
                    uploadStatus.textContent = `⚠️ 删除了 ${deletedCount}/${count} 个文件`;
                    uploadStatus.style.color = '#f59e0b';
                }
                fetchFiles();
                return;
            }

            const filename = filenames.shift();
            try {
                const res = await fetch(`/api/music/${encodeURIComponent(filename)}`, {
                    method: 'DELETE',
                    headers: {
                        'x-admin-password': adminPassword
                    }
                });

                if (res.ok) {
                    deletedCount++;
                    deleteNext();
                } else {
                    errors.push(filename);
                    deleteNext();
                }
            } catch (err) {
                errors.push(filename);
                deleteNext();
            }
        }

        deleteNext();
    }

    window.toggleVisibility = function (filename, hidden) {
        fetch(`/api/music/${encodeURIComponent(filename)}/visibility`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-password': adminPassword
            },
            body: JSON.stringify({ hidden: hidden })
        })
            .then(async res => {
                if (res.ok) {
                    fetchFiles();
                } else {
                    const data = await res.json();
                    alert('切换可见性失败: ' + (data.error || '未知错误'));
                }
            });
    };

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

    let selectedFiles = new Set();
    let isSelectAll = false;

    // --- Upload Area Events ---
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            updateUploadUI(files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        updateUploadUI(files);
    });

    function updateUploadUI(files) {
        if (files.length === 0) {
            clearBtn.style.display = 'none';
            uploadBtn.disabled = true;
            uploadStatus.textContent = '';
        } else {
            clearBtn.style.display = 'block';
            uploadBtn.disabled = false;
            uploadStatus.textContent = `已选择 ${files.length} 个文件`;
            uploadStatus.className = '';
        }
    }

    clearBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.files = null;
        clearBtn.style.display = 'none';
        uploadBtn.disabled = true;
        uploadStatus.textContent = '';
        uploadProgress.style.display = 'none';
    });

    uploadBtn.addEventListener('click', () => {
        const files = fileInput.files;
        if (!files || files.length === 0) {
            uploadStatus.textContent = '请先选择文件';
            uploadStatus.className = 'error';
            return;
        }

        uploadFiles(files);
    });

    async function uploadFiles(files) {
        const totalFiles = files.length;
        let uploadedCount = 0;
        let errors = [];

        uploadBtn.disabled = true;
        clearBtn.disabled = true;
        uploadStatus.textContent = `正在上传 0/${totalFiles}...`;
        uploadStatus.className = '';
        uploadProgress.style.display = 'block';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: {
                        'x-admin-password': adminPassword
                    },
                    body: formData
                });

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || `Upload failed with status ${res.status}`);
                }

                uploadedCount++;
                updateProgress(uploadedCount, totalFiles);
            } catch (err) {
                console.error(`Error uploading ${file.name}:`, err);
                errors.push(`${file.name}: ${err.message}`);
            }
        }

        // Final result
        uploadProgress.style.display = 'none';
        if (uploadedCount === totalFiles) {
            uploadStatus.textContent = `✅ 全部 ${totalFiles} 个文件上传成功!`;
            uploadStatus.style.color = 'green';
            fetchFiles();
        } else {
            uploadStatus.textContent = `⚠️ ${uploadedCount}/${totalFiles} 个文件上传成功`;
            if (errors.length > 0) {
                uploadStatus.textContent += ` (${errors.length} 个失败)`;
                uploadStatus.style.color = '#f59e0b';
            }
        }

        fileInput.value = '';
        fileInput.files = null;
        clearBtn.style.display = 'none';
        uploadBtn.disabled = false;
        clearBtn.disabled = false;
    }

    function updateProgress(current, total) {
        const percentage = Math.round((current / total) * 100);
        document.querySelector('.progress-fill').style.width = `${percentage}%`;
        document.querySelector('.progress-text').textContent = `${current}/${total} (${percentage}%)`;
        uploadStatus.textContent = `正在上传 ${current}/${total}...`;
    }

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
