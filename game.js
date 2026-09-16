const firebaseConfig = {
    apiKey: "AIzaSyAVXkx6M_OH3eHlRFZ236-Udu3lV15vpX0",
    authDomain: "mecunglogic.firebaseapp.com",
    databaseURL: "https://mecunglogic-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mecunglogic",
    storageBucket: "mecunglogic.firebasestorage.app",
    messagingSenderId: "588016030891",
    appId: "1:588016030891:web:ae775d33b1f79c6f3693ee"
};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.database();

let myRoomPIN = "", myName = "";
let level = 1, lives = 3, score = 0;
let currentPos = null, mapData = null, visitedCells = new Set();
let isGameStarted = false;
let currentPlayersCount = 0, readyPlayersCount = 0;
let timerInterval, timeLeft = 180;
let currentPlayerRef = null; // Dùng để quản lý kết nối ngắt

/* ==========================================
   HÀM THÔNG BÁO TÙY CHỈNH (POPUP)
========================================== */
function showPopup(title, message, callback) {
    const modal = document.getElementById('custom-popup');
    document.getElementById('popup-title').innerHTML = title;
    document.getElementById('popup-message').innerHTML = message;
    modal.style.display = 'flex';
    
    const btn = document.getElementById('popup-btn');
    btn.onclick = null; 
    btn.onclick = () => {
        modal.style.display = 'none';
        if(typeof callback === 'function') callback();
    };
}

/* ==========================================
   GIÁO VIÊN (BẢO MẬT & KIỂM SOÁT)
========================================== */
async function hashPassword(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function initHost() {
    document.getElementById('role-selection').style.display = 'none';
    document.getElementById('host-login-view').style.display = 'block';
}

async function verifyHost() {
    const pass = document.getElementById('host-password').value;
    const hashedInput = await hashPassword(pass);
    const correctHash = "e4ce5e95563d63e54c4e606dec1351d77856789cb3e9851ad71fc24fa0d05f3c"; // 123456

    if (hashedInput === correctHash) {
        document.getElementById('host-login-view').style.display = 'none';
        document.getElementById('host-view').style.display = 'block';
        
        myRoomPIN = Math.floor(1000 + Math.random() * 9000).toString();
        document.getElementById('room-pin').textContent = myRoomPIN;
        db.ref('Rooms/' + myRoomPIN).set({ status: 'waiting' });
        db.ref('Rooms/' + myRoomPIN + '/Players').on('value', (snapshot) => {
            const data = snapshot.val();
            renderLeaderboard(data, 'host-leaderboard');
            renderWaitingList(data);
        });
    } else {
        showPopup("❌ Sai Mật Khẩu", "Mật khẩu quản trị không chính xác!");
    }
}

function renderWaitingList(playersData) {
    const list = document.getElementById('waiting-list');
    list.innerHTML = '';
    
    if (!playersData) {
        currentPlayersCount = readyPlayersCount = 0;
        document.getElementById('player-count').textContent = '0';
        document.getElementById('ready-count').textContent = '0';
        return;
    }
    
    let names = Object.keys(playersData);
    currentPlayersCount = names.length;
    readyPlayersCount = 0;
    
    names.forEach(name => {
        let p = playersData[name];
        if (p.state === 'ready') {
            readyPlayersCount++;
            list.innerHTML += `<span class="waiting-tag">🧑‍🎓 ${name}</span>`;
        } else {
            list.innerHTML += `<span class="waiting-tag" style="background:#bdc3c7; color:#fff; border-color:#7f8c8d;">📖 ${name} (Đang đọc luật)</span>`;
        }
    });

    document.getElementById('player-count').textContent = currentPlayersCount;
    document.getElementById('ready-count').textContent = readyPlayersCount;
}

function startHostGame() {
    if (currentPlayersCount === 0) {
        showPopup("⚠️ Khoan đã!", "Chưa có học sinh nào trong phòng chờ.");
        return; 
    }
    if (readyPlayersCount < currentPlayersCount) {
        showPopup("⚠️ Lớp chưa sẵn sàng!", `Còn ${currentPlayersCount - readyPlayersCount} bạn đang đọc luật chơi. Vui lòng đợi các bạn bấm Sẵn sàng!`);
        return;
    }
    db.ref('Rooms/' + myRoomPIN).update({ status: 'playing' });
    document.getElementById('host-waiting-area').style.display = 'none';
    document.getElementById('host-playing-area').style.display = 'block';
}

/* ==========================================
   HỌC SINH (GOOGLE AUTH & CHỐNG TẠO ẢO)
========================================== */
function showStudentLogin() {
    document.getElementById('role-selection').style.display = 'none';
    document.getElementById('student-view').style.display = 'block';
}

function backToHome() {
    if (currentPlayerRef) {
        currentPlayerRef.remove(); // Xóa dữ liệu khi học sinh chủ động bấm quay lại
    }
    document.getElementById('host-login-view').style.display = 'none';
    document.getElementById('student-view').style.display = 'none';
    document.getElementById('rules-view').style.display = 'none';
    document.getElementById('role-selection').style.display = 'block';
}

// Đăng nhập bằng tài khoản Google
function loginWithGoogle() {
    myRoomPIN = document.getElementById('pin-input').value.trim();

    if (!myRoomPIN) { 
        showPopup("⚠️ Lỗi", "Vui lòng nhập Mã phòng trước khi đăng nhập!"); 
        return; 
    }

    db.ref('Rooms/' + myRoomPIN).once('value', snapshot => {
        if (!snapshot.exists()) {
            showPopup("❌ Sai Mã", "Mã phòng không tồn tại. Vui lòng hỏi lại Giáo viên!");
            return;
        }

        let roomData = snapshot.val();
        if (roomData.status !== 'waiting') {
            showPopup("⛔ Phòng Đã Khóa", "Trò chơi đã bắt đầu, bạn không thể tham gia lúc này.");
            return;
        }

        // Kích hoạt bảng popup đăng nhập Google của Firebase
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).then((result) => {
            const user = result.user;
            myName = user.displayName || user.email.split('@')[0]; // Lấy tên hiển thị từ Google

            // Kiểm tra xem tên này đã tồn tại trong phòng chưa
            db.ref('Rooms/' + myRoomPIN + '/Players').once('value', playerSnap => {
                if (playerSnap.hasChild(myName)) {
                    showPopup("⚠️ Trùng Tên", `Tên tài khoản Google (${myName}) đã có bạn khác sử dụng trong phòng này!`);
                    firebase.auth().signOut();
                } else {
                    // Tạo tham chiếu dữ liệu học sinh
                    currentPlayerRef = db.ref('Rooms/' + myRoomPIN + '/Players/' + myName);
                    
                    // Đẩy dữ liệu ban đầu (Đang đọc luật)
                    currentPlayerRef.set({
                        state: 'reading', score: 0, lives: 3, level: 1, isFinished: false
                    });

                    // CƠ CHẾ QUAN TRỌNG: Nếu học sinh thoát trang hoặc mất kết nối khi đang đọc luật, tự động xóa khỏi Firebase
                    currentPlayerRef.onDisconnect().remove();

                    document.getElementById('student-view').style.display = 'none';
                    document.getElementById('rules-view').style.display = 'block';
                }
            });
        }).catch((error) => {
            showPopup("❌ Lỗi Đăng Nhập", "Không thể đăng nhập Google: " + error.message);
        });
    });
}

function joinWaitingRoom() {
    document.getElementById('rules-view').style.display = 'none';
    document.getElementById('student-waiting-view').style.display = 'block';
    
    // Cập nhật trạng thái thành 'ready' (Đã sẵn sàng)
    if (currentPlayerRef) {
        currentPlayerRef.update({ state: 'ready' });
    }

    db.ref('Rooms/' + myRoomPIN + '/Players').on('value', snap => {
        if(snap.exists()) {
            let playersData = snap.val();
            const list = document.getElementById('student-waiting-list');
            if(list) {
                list.innerHTML = '';
                Object.keys(playersData).forEach(name => {
                    let p = playersData[name];
                    if (p.state === 'ready') list.innerHTML += `<span class="waiting-tag">🧑‍🎓 ${name}</span>`;
                    else list.innerHTML += `<span class="waiting-tag" style="background:#bdc3c7; color:#fff; border-color:#7f8c8d;">📖 ${name} (Đang đọc luật)</span>`;
                });
            }
            renderLeaderboard(playersData, 'live-leaderboard'); 
        }
    });

    db.ref('Rooms/' + myRoomPIN + '/status').on('value', snap => {
        if (snap.val() === 'playing' && !isGameStarted) {
            isGameStarted = true;
            document.getElementById('student-waiting-view').style.display = 'none';
            document.getElementById('game-view').style.display = 'flex';
            document.getElementById('ui-student-name').textContent = "🧑‍🎓 " + myName;
            loadLevel();
        }
    });
}

function syncDataToFirebase(isFinished = false) {
    if (currentPlayerRef) {
        currentPlayerRef.update({
            score: score, lives: lives, level: (level > 5) ? 5 : level, isFinished: isFinished
        });
    }
}

/* ==========================================
   BẢNG XẾP HẠNG CHUNG
========================================== */
function renderLeaderboard(playersData, containerId) {
    const board = document.getElementById(containerId);
    if (!board) return;
    board.innerHTML = '';
    if (!playersData) return;

    let players = Object.keys(playersData).map(key => ({ name: key, ...playersData[key] })).sort((a, b) => b.score - a.score);

    players.forEach((p, index) => {
        let isMeClass = (p.name === myName) ? 'is-me' : '';
        let statusIcon = p.isFinished ? '🏁' : '🔥';
        let colorRank = index === 0 ? 'border-left-color: #f1c40f;' : (index === 1 ? 'border-left-color: #bdc3c7;' : (index === 2 ? 'border-left-color: #cd7f32;' : ''));

        board.innerHTML += `
            <div class="lb-item ${isMeClass}" style="${colorRank}">
                <div class="lb-info">
                    <span class="lb-name">#${index + 1} ${statusIcon} ${p.name}</span>
                    <span class="lb-detail">Màn: ${p.level}/5 | ❤️ ${p.lives}</span>
                </div>
                <div class="lb-score">${p.score}</div>
            </div>
        `;
    });
}

/* ==========================================
   LÔGIC GAME PLAY, THỜI GIAN & BFS MA TRẬN
========================================== */
function startTimer() {
    clearInterval(timerInterval); 
    timeLeft = 180;
    updateTimerUI();

    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerUI();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            showPopup("⏰ HẾT GIỜ!", `Đã hết 3 phút cho màn này.\nHệ thống tự động chuyển sang Màn ${level + 1}.`, () => {
                level++; lives = 3; loadLevel();
            });
        }
    }, 1000);
}

function updateTimerUI() {
    let m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    let s = (timeLeft % 60).toString().padStart(2, '0');
    let timerEl = document.getElementById("ui-timer");
    if (timerEl) timerEl.textContent = `${m}:${s}`;
}

function generateMap() {
    let rowH, colH, grid;
    let isValidPath = false;

    while (!isValidPath) {
        rowH = [];
        colH = [];
        for (let i = 0; i < 8; i++) {
            rowH.push(Math.round(Math.random()));
            colH.push(Math.round(Math.random()));
        }

        grid = [];
        for (let r = 0; r < 8; r++) {
            let row = [];
            for (let c = 0; c < 8; c++) {
                row.push(['AND', 'OR', 'XOR'][Math.floor(Math.random() * 3)]);
            }
            grid.push(row);
        }

        rowH[0] = 1; 
        colH[0] = 1; 
        grid[0][0] = 'AND'; 
        grid[7][7] = 'ĐÍCH';

        isValidPath = checkPathExists(rowH, colH, grid);
    }

    return { rowH, colH, grid };
}

function checkPathExists(rowH, colH, grid) {
    let queue = [{r: 0, c: 0}];
    let visited = Array(8).fill(false).map(() => Array(8).fill(false));
    visited[0][0] = true;

    let dr = [-1, 1, 0, 0];
    let dc = [0, 0, -1, 1];

    while (queue.length > 0) {
        let curr = queue.shift();
        if (curr.r === 7 && curr.c === 7) return true;

        for (let i = 0; i < 4; i++) {
            let nr = curr.r + dr[i];
            let nc = curr.c + dc[i];

            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !visited[nr][nc]) {
                if (nr === 7 && nc === 7) return true;

                let val1 = rowH[nr];
                let val2 = colH[nc];
                let op = grid[nr][nc];
                let res = evaluateLogic(val1, op, val2);

                if (res === 1) {
                    visited[nr][nc] = true;
                    queue.push({r: nr, c: nc});
                }
            }
        }
    }
    return false;
}

function loadLevel() {
    if (level > 5) { finishGame(); return; }
    document.getElementById("ui-level").textContent = level;
    document.getElementById("ui-lives").textContent = lives;
    document.getElementById("ui-score").textContent = score;
    mapData = generateMap();
    currentPos = null; visitedCells.clear();
    renderBoard();
    startTimer();
}

function renderBoard() {
    const container = document.getElementById("game-container");
    container.innerHTML = "";
    let emptyCell = document.createElement("div");
    emptyCell.className = "cell empty-cell"; container.appendChild(emptyCell);

    for (let c = 0; c < 8; c++) {
        let cell = document.createElement("div");
        cell.className = "cell header-cell"; cell.textContent = mapData.colH[c];
        container.appendChild(cell);
    }

    for (let r = 0; r < 8; r++) {
        let rowHeader = document.createElement("div");
        rowHeader.className = "cell header-cell"; rowHeader.textContent = mapData.rowH[r];
        container.appendChild(rowHeader);

        for (let c = 0; c < 8; c++) {
            let cell = document.createElement("div");
            cell.className = "cell game-cell";
            cell.id = `cell-${r}-${c}`;
            if (r === 7 && c === 7) {
                cell.textContent = "🎁"; cell.classList.add("treasure");
            } else { cell.textContent = mapData.grid[r][c]; }
            
            if (visitedCells.has(`${r}-${c}`)) cell.classList.add("visited");
            if (isClickable(r, c)) cell.classList.add("clickable");

            cell.onclick = () => handleMove(r, c);
            container.appendChild(cell);
        }
    }
    if (currentPos) document.getElementById(`cell-${currentPos.r}-${currentPos.c}`).classList.add("current");
    else document.getElementById("cell-0-0").style.boxShadow = "0 0 15px 5px #f1c40f";
}

function isClickable(r, c) {
    if (!currentPos) return r === 0 && c === 0; 
    let dr = Math.abs(r - currentPos.r); let dc = Math.abs(c - currentPos.c);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function evaluateLogic(val1, op, val2) {
    if (op === 'AND') return (val1 && val2) ? 1 : 0;
    if (op === 'OR') return (val1 || val2) ? 1 : 0;
    if (op === 'XOR') return (val1 !== val2) ? 1 : 0;
    return 0;
}

function handleMove(r, c) {
    if (!isClickable(r, c)) return;
    let cellEl = document.getElementById(`cell-${r}-${c}`);
    let cellKey = `${r}-${c}`;
    
    if (cellEl.classList.contains("bomb")) return; 

    if (r === 7 && c === 7) {
        clearInterval(timerInterval);
        score += 500; syncDataToFirebase();
        showPopup("🎉 XUẤT SẮC!", `Chúc mừng bạn đã vượt qua màn ${level}!`, () => { level++; loadLevel(); });
        return;
    }

    let result = evaluateLogic(mapData.rowH[r], mapData.grid[r][c], mapData.colH[c]);

    if (result === 1) {
        if (currentPos) document.getElementById(`cell-${currentPos.r}-${currentPos.c}`).classList.replace("current", "visited");
        currentPos = {r, c};
        if (!visitedCells.has(cellKey)) { score += 100; visitedCells.add(cellKey); }
        document.getElementById("ui-score").textContent = score;
        syncDataToFirebase(); renderBoard(); 
    } else {
        cellEl.classList.add("bomb");
        lives--; score -= 200; 
        
        if (lives <= 0) {
            clearInterval(timerInterval);
            score -= 1000; lives = 3;     
            document.getElementById("ui-score").textContent = score;
            document.getElementById("ui-lives").textContent = lives;
            syncDataToFirebase();
            showPopup("💀 HẾT MẠNG", `Bạn mất 3 mạng và bị trừ 1000 điểm.\nChuyển sang Màn ${level + 1}.`, () => { level++; loadLevel(); });
        } else {
            document.getElementById("ui-score").textContent = score;
            document.getElementById("ui-lives").textContent = lives;
            syncDataToFirebase();
            showPopup("💥 BÙM!", `Bạn tính sai và đạp trúng bom.\nBị trừ 200 điểm và mất 1 mạng (Còn ${lives} mạng).`);
        }
    }
}

function finishGame() {
    clearInterval(timerInterval);
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('end-view').style.display = 'block';
    document.getElementById('end-student-name').textContent = myName;
    document.getElementById('my-final-score').textContent = score;
    syncDataToFirebase(true);
}