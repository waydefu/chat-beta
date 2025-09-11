// main.js
import { auth, provider, firestore, rtdb, app } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  updateDoc,
  arrayUnion,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as dbServerTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// === DOM 元素 ===
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
const presenceList = document.getElementById('presence-list');
const roomList = document.getElementById('room-list');
const typingIndicator = document.getElementById('typing-indicator');

// === 狀態 ===
let currentRoom = '';
let unsubscribe = null;
const userNameCache = new Map();

// === 工具函數 ===
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

async function appendMessage(msg, uid) {
  let time = '';
  let timestampDate;

  try {
    if (msg.timestamp instanceof Date) {
      timestampDate = msg.timestamp;
    } else if (msg.timestamp && typeof msg.timestamp.toDate === 'function') {
      timestampDate = msg.timestamp.toDate();
    } else {
      timestampDate = new Date(); // 使用當前時間作為回退
    }

    time = timestampDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.error('處理訊息時間戳時發生錯誤：', msg.id, error.message);
    time = '未知時間';
  }

  const side = msg.uid === uid ? 'you' : 'other';

  let readByText = '';
  let isReadByMe = false;

  if (msg.readBy && Array.isArray(msg.readBy) && msg.readBy.length > 0) {
    const readByNames = await Promise.all(msg.readBy.map(getUserDisplayName));
    readByText = `已讀：${readByNames.join('、')}`;
    isReadByMe = msg.readBy.includes(uid);
  } else {
    readByText = '無人已讀';
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

  if (side === 'you') {
    row.appendChild(bubble);
    row.appendChild(avatarText);
  } else {
    row.appendChild(avatarText);
    row.appendChild(bubble);
  }

  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function markMessageAsRead(msgId, uid) {
  try {
    const msgRef = doc(firestore, 'rooms', currentRoom, 'messages', msgId);
    await updateDoc(msgRef, { readBy: arrayUnion(uid) });
  } catch (error) {
    console.error(`標記訊息 ${msgId} 已讀失敗：`, error.message);
  }
}

// === 身份驗證 ===
loginBtn.onclick = async () => {
  try { await signInWithPopup(auth, provider); }
  catch (error) { console.error('登入失敗：', error); alert(`登入失敗：${error.message}`); }
};

logoutBtn.onclick = async () => {
  try { await signOut(auth); }
  catch (error) { console.error('登出失敗：', error); alert('無法登出，請稍後重試'); }
};

onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';

    setDoc(doc(firestore, 'users', user.uid), {
      displayName: user.displayName || '匿名使用者'
    }, { merge: true }).catch(error => console.error('儲存使用者名稱失敗：', error.message));

    setupPresence(user);
    watchPresence();
    watchRoomList();
  } else {
    userInfo.textContent = '';
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    chatBox.innerHTML = '';
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    if (unsubscribe) unsubscribe();
    userNameCache.clear();
  }
});

// === 聊天室管理 ===
joinRoomBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return alert('請輸入聊天室名稱');

  joinRoomBtn.disabled = true;
  joinRoomBtn.textContent = '載入中...';

  currentRoom = room;
  if (unsubscribe) unsubscribe();

  try {
    await setDoc(doc(firestore, 'rooms', room), { createdAt: serverTimestamp() }, { merge: true });

    const msgsRef = collection(firestore, 'rooms', currentRoom, 'messages');
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
  } catch (error) {
    console.error('加入聊天室失敗：', error);
    alert(`加入聊天室失敗：${error.message}`);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = '加入 / 建立聊天室';
  }
};

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
  }, error => console.error('監聽聊天室清單失敗：', error));
}

roomList.onchange = () => { roomInput.value = roomList.value; };

// === 訊息發送 ===
sendBtn.onclick = async () => {
  const text = messageInput.value.trim();
  const user = auth.currentUser;
  if (!text || !user || !currentRoom) return;

  try {
    const messageRef = await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
      user: user.displayName,
      uid: user.uid,
      text,
      timestamp: serverTimestamp(),
      readBy: [user.uid]
    });
    messageInput.value = '';
  } catch (error) {
    console.error('發送訊息失敗：', error.message);
    alert('無法發送訊息，請稍後重試');
  }
};

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// === 在線狀態 ===
function setupPresence(user) {
  const userRef = ref(rtdb, 'presence/' + user.uid);
  const connRef = ref(rtdb, '.info/connected');

  onValue(connRef, snap => {
    if (!snap.val()) return;
    onDisconnect(userRef).set({ state: 'offline', displayName: user.displayName, last_changed: dbServerTimestamp() })
      .then(() => set(userRef, { state: 'online', displayName: user.displayName, last_changed: dbServerTimestamp() }))
      .catch(error => console.error('設置在線狀態失敗：', error.message));
  });
}

function watchPresence() {
  const allRef = ref(rtdb, 'presence');
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList