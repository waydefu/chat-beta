// main.js
import { auth, provider, firestore, rtdb } from './firebase-config.js';
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
  getDocs,
  setDoc,
  doc,
  updateDoc,
  arrayUnion
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

// === 狀態 ===
let currentRoom = '';
let unsubscribe = null;

// === 工具函數 ===
function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 渲染單條訊息
function appendMessage(msg, uid) {
  let time = '';
  try {
    if (msg.timestamp && typeof msg.timestamp.toDate === 'function') {
      time = msg.timestamp.toDate().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    } else {
      console.warn('無效的時間戳：', msg.id, msg.timestamp);
      time = '未知時間';
    }
  } catch (error) {
    console.error('渲染時間戳失敗：', msg.id, error.message);
    time = '未知時間';
  }

  const side = msg.uid === uid ? 'you' : 'other';

  const row = document.createElement('div');
  row.className = `message-row ${side}`;

  const avatarText = document.createElement('div');
  avatarText.className = 'avatar-text';
  avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : '?';

  const bubble = document.createElement('div');
  bubble.className = `message ${side}`;
  bubble.setAttribute('aria-label', `${msg.user} 說：${msg.text}，時間：${time}`);
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <span class="message-time">${time}</span>
    <span class="read-status" data-msg-id="${msg.id}">${msg.readBy?.includes(uid) ? '✔' : ''}</span>
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

// 標記訊息為已讀
async function markMessageAsRead(msgId, uid) {
  try {
    const msgRef = doc(firestore, 'rooms', currentRoom, 'messages', msgId);
    await updateDoc(msgRef, {
      readBy: arrayUnion(uid)
    });
  } catch (error) {
    console.error('標記已讀失敗：', error);
  }
}

// === 身份驗證 ===
loginBtn.onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error('登入失敗：', error);
    alert(`登入失敗：${error.message}`);
  }
};

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('登出失敗：', error);
    alert('無法登出，請稍後重試');
  }
};

onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';
    chatBox.setAttribute('role', 'log');
    chatBox.setAttribute('aria-live', 'polite');
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
  }
});

// === 聊天室管理 ===
joinRoomBtn.onclick = async () => {
  try {
    const room = roomInput.value.trim();
    if (!room) return alert('請輸入聊天室名稱');

    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = '載入中...';

    currentRoom = room;
    if (unsubscribe) unsubscribe();

    await setDoc(doc(firestore, 'rooms', room), {
      createdAt: serverTimestamp()
    }, { merge: true });

    const msgsRef = collection(firestore, 'rooms', currentRoom, 'messages');
    const q = query(msgsRef, orderBy('timestamp'));

    unsubscribe = onSnapshot(q, snap => {
      const uid = auth.currentUser?.uid;
      snap.docChanges().forEach(change => {
        if (change.type === 'added') {
          const msg = { id: change.doc.id, ...change.doc.data() };
          appendMessage(msg, uid);
          if (!msg.readBy?.includes(uid)) {
            markMessageAsRead(msg.id, uid);
          }
        }
      });
    }, error => {
      console.error('監聽訊息失敗：', error);
      alert('無法載入訊息，請稍後重試');
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

// 即時監聽聊天室清單
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
  }, error => {
    console.error('監聽聊天室清單失敗：', error);
    alert('無法載入聊天室清單，請稍後重試');
  });
}

roomList.onchange = () => {
  roomInput.value = roomList.value;
};

// === 訊息發送 ===
sendBtn.onclick = async () => {
  try {
    const text = messageInput.value.trim();
    const user = auth.currentUser;
    if (!text || !user || !currentRoom) return;

    const messageRef = await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
      user: user.displayName,
      uid: user.uid,
      text,
      timestamp: serverTimestamp(),
      readBy: [user.uid]
    });

    console.log('訊息已發送，ID：', messageRef.id); // 確認寫入
    messageInput.value = '';
  } catch (error) {
    console.error('發送訊息失敗：', error.message, error.code);
    alert('無法發送訊息，請稍後重試');
  }
};

// 支援 Enter 鍵發送
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

  const onlineObj = {
    state: 'online',
    displayName: user.displayName,
    last_changed: dbServerTimestamp()
  };
  const offlineObj = {
    state: 'offline',
    last_changed: dbServerTimestamp()
  };

  onValue(connRef, snap => {
    if (snap.val() === false) return;
    onDisconnect(userRef).set(offlineObj).then(() => {
      set(userRef, onlineObj);
    });
  });
}

function watchPresence() {
  const allRef = ref(rtdb, 'presence');
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    for (const uid in users) {
      if (users[uid].state === 'online') {
        const div = document.createElement('div');
        div.textContent = users[uid].displayName || uid;
        presenceList.appendChild(div);
      }
    }
  });
}

// === 正在輸入提示 ===
const typingNotice = document.createElement('div');
typingNotice.id = 'typing-indicator';
chatBox.parentElement.appendChild(typingNotice);

function watchTyping() {
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, snap => {
    const data = snap.val() || {};
    const othersTyping = Object.values(data)
      .filter(u => u && u.name !== auth.currentUser?.displayName)
      .map(u => u.name);

    typingNotice.textContent = othersTyping.length
      ? `${othersTyping.join('、')} 正在輸入...`
      : '';
  });
}

let typingTimeout;
messageInput.addEventListener('input', () => {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  set(typingRef, { name: user.displayName });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, null);
  }, 2000);
});

// === 輸入框動態高度 ===
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});