// main.js
import { auth, provider, firestore, rtdb } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, doc, updateDoc, getDoc, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, onValue, onDisconnect, set, serverTimestamp as dbServerTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// DOM 元素
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const chatSection = document.getElementById('chat-section');
const loginCard = document.getElementById('login-card');
const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const roomInput = document.getElementById('room-name');
const joinRoomBtn = document.getElementById('join-room');
const roomList = document.getElementById('room-list');
const typingIndicator = document.getElementById('typing-indicator');
const presenceList = document.getElementById('presence-list');

let currentRoom = '';
let unsubscribe = null;
let typingTimeout = null;
const userNameCache = new Map();

// 工具函數
function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function getUserDisplayName(uid) {
  if (userNameCache.has(uid)) return userNameCache.get(uid);
  try {
    const userDoc = await getDoc(doc(firestore, 'users', uid));
    const displayName = userDoc.exists() ? userDoc.data().displayName : '未知使用者';
    userNameCache.set(uid, displayName);
    return displayName;
  } catch (error) {
    console.error('查詢使用者名稱失敗：', uid, error.message);
    return '未知使用者';
  }
}

// 顯示訊息
async function appendMessage(msg, uid) {
  let timestampDate;
  try {
    if (msg.timestamp instanceof Date) timestampDate = msg.timestamp;
    else if (msg.timestamp && typeof msg.timestamp.toDate === 'function') timestampDate = msg.timestamp.toDate();
    else timestampDate = new Date();
  } catch {
    timestampDate = new Date();
  }

  const time = timestampDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  const side = msg.uid === uid ? 'you' : 'other';

  let readByText = '無人已讀';
  let isReadByMe = false;
  if (msg.readBy && Array.isArray(msg.readBy) && msg.readBy.length > 0) {
    const readByNames = await Promise.all(msg.readBy.map(getUserDisplayName));
    readByText = `已讀：${readByNames.join('、')}`;
    isReadByMe = msg.readBy.includes(uid);
  }

  const row = document.createElement('div');
  row.className = `message-row ${side}`;
  row.setAttribute('data-msg-id', msg.id);

  const avatarText = document.createElement('div');
  avatarText.className = 'avatar-text';
  avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : '?';

  const bubble = document.createElement('div');
  bubble.className = `message ${side}`;
  bubble.setAttribute('aria-label', `${msg.user} 說：${sanitizeInput(msg.text)}，時間：${time}`);
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <span class="message-time">${time}</span>
    <span class="read-status" title="${readByText}">${isReadByMe ? '✔' : ''}</span>
  `;

  if (side === 'you') { row.appendChild(bubble); row.appendChild(avatarText); }
  else { row.appendChild(avatarText); row.appendChild(bubble); }

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// 標記訊息已讀
async function markMessageAsRead(msgId, uid) {
  try {
    const msgRef = doc(firestore, 'rooms', currentRoom, 'messages', msgId);
    await updateDoc(msgRef, { readBy: arrayUnion(uid) });
  } catch (error) {
    console.error('標記已讀失敗：', error.message);
  }
}

// 登入 / 登出
loginBtn.onclick = async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert(e.message); } };
logoutBtn.onclick = async () => { try { await signOut(auth); } catch (e) { alert(e.message); } };

onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';
    setDoc(doc(firestore, 'users', user.uid), { displayName: user.displayName || '匿名使用者' }, { merge: true });
    watchRoomList();
    setupPresence(user);
    watchPresence();
  } else {
    userInfo.textContent = '';
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    chatBox.innerHTML = '';
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    if (unsubscribe) unsubscribe();
    userNameCache.clear();
  }
});

// 加入 / 建立聊天室
joinRoomBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return alert('請輸入聊天室名稱');
  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = '載入中...';
  currentRoom = room;
  if (unsubscribe) unsubscribe();

  await setDoc(doc(firestore, 'rooms', room), { createdAt: serverTimestamp() }, { merge: true });
  const msgsRef = collection(firestore, 'rooms', room, 'messages');
  const q = query(msgsRef, orderBy('timestamp'));

  unsubscribe = onSnapshot(q, snap => {
    const uid = auth.currentUser?.uid;
    snap.docChanges().forEach(async change => {
      if (change.type === 'added') {
        const msg = { id: change.doc.id, ...change.doc.data() };
        await appendMessage(msg, uid);
        if (!msg.readBy?.includes(uid)) await markMessageAsRead(msg.id, uid);
      }
    });
  });

  watchTyping();
  joinRoomBtn.disabled = false;
  joinRoomBtn.textContent = '加入 / 建立聊天室';
};

// 監聽聊天室清單
function watchRoomList() {
  const roomsRef = collection(firestore, 'rooms');
  onSnapshot(roomsRef, snap => {
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    snap.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.id;
      roomList.appendChild(opt);
    });
  });
}
roomList.onchange = () => { roomInput.value = roomList.value; };

// 發訊息
sendBtn.onclick = async () => {
  const text = messageInput.value.trim();
  const user = auth.currentUser;
  if (!text || !user || !currentRoom) return;

  await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
    user: user.displayName,
    uid: user.uid,
    text,
    timestamp: serverTimestamp(),
    readBy: [user.uid]
  });
  messageInput.value = '';
};

// Enter 發送
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });

// 在線狀態
function setupPresence(user) {
  const userRef = ref(rtdb, 'presence/' + user.uid);
  const connRef = ref(rtdb, '.info/connected');
  const onlineObj = { state: 'online', displayName: user.displayName, last_changed: dbServerTimestamp() };
  const offlineObj = { state: 'offline', displayName: user.displayName, last_changed: dbServerTimestamp() };

  onValue(connRef, snap => {
    if (snap.val() === false) return;
    onDisconnect(userRef).set(offlineObj).then(() => { set(userRef, onlineObj); });
  });
}

function watchPresence() {
  const allRef = ref(rtdb, 'presence');
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    for (const uid in users) {
      if (users[uid]?.state === 'online') {
        const div = document.createElement('div');
        div.textContent = users[uid].displayName || uid;
        presenceList.appendChild(div);
      }
    }
  });
}

// 正在輸入提示
function watchTyping() {
  if (!currentRoom) return;
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, snap => {
    const data = snap.val() || {};
    const othersTyping = Object.values(data)
      .filter(u => u && u.name !== auth.currentUser?.displayName)
      .map(u => u.name);
    typingIndicator.textContent = othersTyping.length ? `${othersTyping.join('、')} 正在輸入...` : '';
  });
}

messageInput.addEventListener('input', () => {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  clearTimeout(typingTimeout);
  set(typingRef, { name: user.displayName }).catch(console.error);
  typingTimeout = setTimeout(() => { set(typingRef, null).catch(console.error); typingTimeout = null; }, 2000);

  // 自動調整輸入框高度
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});