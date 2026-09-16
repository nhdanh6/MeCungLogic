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
let currentPlayerRef = null;

/* ==========================================
   QUẢN LÝ LƯU TRỮ TRẠNG THÁI (SESSION & LOCAL STORAGE)
========================================== */
function saveSession(room, name) {
    localStorage.setItem('noel_room', room);
    localStorage.setItem('noel_name', name);
}

function clearSession() {
    localStorage.removeItem('noel_room');
    localStorage.removeItem('noel_name');
    localStorage.removeItem('noel_map');
    localStorage.removeItem('noel_pos');
    localStorage.removeItem('noel_visited');
}

function saveMapLocal() {
    localStorage.setItem('noel_map', JSON.stringify(mapData));
    localStorage.setItem('noel_pos', JSON.stringify(currentPos));
    localStorage.setItem('noel_visited', JSON.stringify(Array.from(visitedCells)));
}

// Tự động khôi phục nếu học sinh tải lại trang (F5)
window.onload = function() {
    let savedRoom = localStorage.getItem('noel_room');
    let savedName = localStorage.getItem('noel_name');

    if (savedRoom && savedName) {
        myRoomPIN = savedRoom;
        myName = savedName;

        db.ref('Rooms/' + myRoomPIN).once('value', snapshot => {
            if (snapshot.exists() && snapshot.hasChild('Players/' + myName)) {
                let roomData = snapshot.val();
                let myData = roomData.Players[myName];
                
                currentPlayerRef = db.ref('Rooms/' + myRoomPIN + '/Players/' + myName);

                if (roomData.status === 'playing') {
                    // ĐANG CHƠI THÌ KHÔI PHỤC GAME
                    isGameStarted = true;
                    score = myData.score;
                    lives = myData.lives;
                    level = myData.level;

                    document.getElementById('role-selection').style.display = 'none';
                    document.getElementById('game-view').style.display = 'flex';
                    document.getElementById('ui-student-name').textContent = "🧑‍🎓 " + myName;
                    
                    document.getElementById("ui-level").textContent = level;
                    document.getElementById("ui-lives").textContent = lives;
                    document.getElementById("ui-score").textContent = score;

                    // Khôi phục bản đồ và vị trí hiện tại
                    let savedMap = localStorage.getItem('noel_map');
                    if (savedMap) {
                        mapData = JSON.parse(savedMap);
                        currentPos = JSON.parse(localStorage.getItem('noel_pos'));
                        visitedCells = new Set(JSON.parse(localStorage.getItem('noel_visited') || "[]"));
                        renderBoard();
                        startTimer();
                    } else {
                        loadLevel(); // Nếu lỗi file save thì nạp lại màn mới
                    }

                    // Đã vào game thì hủy ngắt kết nối để không mất điểm oan
                    currentPlayerRef.onDisconnect().cancel();
                    
                } else {
                    // NẾU ĐANG Ở PHÒNG CHỜ
                    currentPlayerRef.onDisconnect().remove();
                    listenForKick();
                    
                    document.getElementById('role-selection').style.display = 'none';
                    if (myData.state === 'ready') {
                        document.getElementById('student-waiting-view').style.display = 'block';
                        setupWaitingRoomListeners(); // Bật lại listener phòng chờ
                    } else {
                        document.getElementById('rules-view').style.display = 'block';
                    }
                }
            } else {
                clearSession(); // Phòng không tồn tại hoặc bị kick thì xóa rác
            }
        });
    }
};

/* POPUP CUSTOM */
function showPopup(title, message, callback) {
    const modal = document.getElementById('custom-popup');
    document.getElementById('popup-title').innerHTML = title;
    document.getElementById('popup-message').innerHTML = message;
    modal.style.display = 'flex';
    
    const btn = document.getElementById('popup-btn');
    btn.onclick = null; 
    btn.onclick = () => {
        modal.style.display = 'none';
        if (typeof callback === 'function') callback();
    };
}

/* ==========================================
   GIÁO VIÊN
========================================== */
async function hashPassword(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
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

function kickPlayer(name) {
    if (confirm(`Bạn có chắc muốn xóa học sinh "${name}" khỏi phòng?`)) {
        db.ref(`Rooms/${myRoomPIN}/Players/${name}`).remove();
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
        let kickBtn = `<span onclick="kickPlayer('${name}')" style="cursor:pointer; color:#e74c3c; margin-left:8px; font-weight:bold;">✖</span>`;
        if (p.state === 'ready') {
            readyPlayersCount++;
            list.innerHTML += `<span class="waiting-tag">🧑‍🎓 ${name} ${kickBtn}</span>`;
        } else {
            list.innerHTML += `<span class="waiting-tag" style="background:#bdc3c7; color:#fff; border-color:#7f8c8d;">📖 ${name} (Đang đọc luật) ${kickBtn}</span>`;
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
        showPopup("⚠️ Lớp chưa sẵn sàng!", `Còn ${currentPlayersCount - readyPlayersCount} bạn đang đọc luật chơi. Bạn có thể đợi hoặc bấm nút ✖ để xóa tài khoản ảo!`);
        return;
    }
    db.ref('Rooms/' + myRoomPIN).update({ status: 'playing' });
    document.getElementById('host-waiting-area').style.display = 'none';
    document.getElementById('host-playing-area').style.display = 'block';
}

function cancelRoom() {
    if (confirm("⚠️ Bạn có chắc chắn muốn hủy phòng? Tất cả học sinh sẽ bị kích ra ngoài.")) {
        db.ref('Rooms/' + myRoomPIN).remove(); 
        document.getElementById('host-view').style.display = 'none';
        document.getElementById('role-selection').style.display = 'block';
    }
}

/* ==========================================
   HỌC SINH 
========================================== */
function showStudentLogin() {
    document.getElementById('role-selection').style.display = 'none';
    document.getElementById('student-view').style.display = 'block';
}

function backToHome() {
    if (currentPlayerRef) currentPlayerRef.remove();
    clearSession();
    document.getElementById('host-login-view').style.display = 'none';
    document.getElementById('student-view').style.display = 'none';
    document.getElementById('rules-view').style.display = 'none';
    document.getElementById('role-selection').style.display = 'block';
}

function verifyRoom() {
    myRoomPIN = document.getElementById('pin-input').value.trim();
    myName = document.getElementById('name-input').value.trim();

    if (!myRoomPIN || !myName) { 
        showPopup("⚠️ Lỗi", "Vui lòng nhập đủ Mã phòng và Tên của bạn!"); 
        return; 
    }

    db.ref('Rooms/' + myRoomPIN).once('value', snapshot => {
        if (snapshot.exists()) {
            let roomData = snapshot.val();
            if (roomData.status !== 'waiting') {
                showPopup("⛔ Phòng Đã Khóa", "Trò chơi đã bắt đầu, bạn không thể tham gia lúc này.");
                return;
            }
            if (snapshot.hasChild('Players/' + myName)) {
                showPopup("⚠️ Trùng Tên", "Tên này đã có bạn khác trong lớp sử dụng.\nVui lòng thêm số thứ tự hoặc tên đệm!");
            } else {
                saveSession(myRoomPIN, myName); // Lưu bộ nhớ tạm
                
                currentPlayerRef = db.ref('Rooms/' + myRoomPIN + '/Players/' + myName);
                currentPlayerRef.set({
                    state: 'reading', score: 0, lives: 3, level: 1, isFinished: false
                }).then(() => {
                    currentPlayerRef.onDisconnect().remove();
                    document.getElementById('student-view').style.display = 'none';
                    document.getElementById('rules-view').style.display = 'block';
                    listenForKick();
                });
            }
        } else { 
            showPopup("❌ Sai Mã", "Mã phòng không tồn tại. Vui lòng hỏi lại Giáo viên!"); 
        }
    });
}

function listenForKick() {
    currentPlayerRef.on('value', snap => {
        if (!snap.exists() && !isGameStarted) {
            clearSession();
            showPopup("🚪 Đã Rời Phòng", "Bạn đã bị Giáo viên kích hoặc Phòng đã bị hủy!", () => {
                location.reload(); 
            });
        }
    });
}

function setupWaitingRoomListeners() {
    db.ref('Rooms/' + myRoomPIN + '/Players').on('value', snap => {
        if (snap.exists()) {
            let playersData = snap.val();
            const list = document.getElementById('student-waiting-list');
            if (list) {
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
            if (currentPlayerRef) currentPlayerRef.onDisconnect().cancel();
            
            document.getElementById('student-waiting-view').style.display = 'none';
            document.getElementById('game-view').style.display = 'flex';
            document.getElementById('ui-student-name').textContent = "🧑‍🎓 " + myName;
            loadLevel();
        }
    });
}

function joinWaitingRoom() {
    document.getElementById('rules-view').style.display = 'none';
    document.getElementById('student-waiting-view').style.display = 'block';
    
    if (currentPlayerRef) {
        currentPlayerRef.update({ state: 'ready' });
    }
    setupWaitingRoomListeners();
}

function leaveWaitingRoom() {
    if (confirm("🚪 Bạn có muốn thoát khỏi phòng chờ không?")) {
        if (currentPlayerRef) currentPlayerRef.remove(); 
        clearSession();
        document.getElementById('student-waiting-view').style.display = 'none';
        document.getElementById('role-selection').style.display = 'block';
        location.reload(); 
    }
}

function syncDataToFirebase(isFinished = false) {
    if (currentPlayerRef) {
        currentPlayerRef.update({
            score: score, lives: lives, level: (level > 5) ? 5 : level, isFinished: isFinished
        });
    }
}

/* ==========================================
   BẢNG XẾP HẠNG
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
   ĐẾM GIỜ & THUẬT TOÁN BÀN CỜ
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
            for (let c = 0; c < 8; c++) row.push(['AND', 'OR', 'XOR'][Math.floor(Math.random() * 3)]);
            grid.push(row);
        }

        rowH[0] = 1; colH[0] = 1; grid[0][0] = 'AND'; grid[7][7] = 'ĐÍCH';
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
    saveMapLocal(); // Lưu ma trận mới
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
        syncDataToFirebase(); 
        saveMapLocal(); // Cập nhật vị trí hiện tại
        renderBoard(); 
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
    clearSession(); // Kết thúc game thì xóa dữ liệu bộ nhớ tạm
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('end-view').style.display = 'block';
    document.getElementById('end-student-name').textContent = myName;
    document.getElementById('my-final-score').textContent = score;
    syncDataToFirebase(true);
}