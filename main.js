import { auth, provider, firestore, rtdb } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, doc, updateDoc, arrayUnion, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, onValue, onDisconnect, set, serverTimestamp as dbServerTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

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
    console.error('查詢使用者名稱失敗：', uid, error);
    return '未知使用者';
  }
}

// 渲染單條訊息
async function appendMessage(msg, uid) {
  let timestampDate;
  try {
    if (msg.timestamp instanceof Date) {
      timestampDate = msg.timestamp;
    } else if (msg.timestamp && typeof msg.timestamp.toDate === 'function') {
      timestampDate = msg.timestamp.toDate();
    } else {
      timestampDate = new Date();
    }
  } catch {
    timestampDate = new Date();
  }

  const time = timestampDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
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
  bubble.setAttribute('data-msg-id', msg.id);
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <span class="message-time">${time}</span>
    <span class="read-status" data-msg-id="${msg.id}" title="${readByText}">${isReadByMe ? '✔' : ''}</span>
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
    await updateDoc(msgRef, { readBy: arrayUnion(uid) });
  } catch (error) {
    console.error(`標記訊息 ${msgId} 已讀失敗：`, error);
  }
}

// === 登入 / 登出 ===
loginBtn.onclick = async () => {
  try { await signInWithPopup(auth, provider); } 
  catch (error) { console.error('登入失敗：', error); alert(`登入失敗：${error.message}`); }
};

logoutBtn.onclick = async () => {
  try { await signOut(auth); } 
  catch (error) { console.error('登出失敗：', error); alert('無法登出，請稍後重試'); }
};

// === Auth 狀態變化 ===
onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';

    setDoc(doc(firestore, 'users', user.uid), { displayName: user.displayName || '匿名使用者' }, { merge: true });

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

// === 加入 / 建立聊天室 ===
joinRoomBtn.onclick = async () => {
  try {
    const room = roomInput.value.trim();
    if (!room) return alert('請輸入聊天室名稱');

    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = '載入中...';

    currentRoom = room;
    if (unsubscribe) unsubscribe();

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
  } catch (error) {
    console.error('加入聊天室失敗：', error);
    alert(`加入聊天室失敗：${error.message}`);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = '加入 / 建立聊天室';
  }
};

// === 送出訊息 ===
sendBtn.onclick = async () => {
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;
  try {
    await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
      text,
      uid: auth.currentUser.uid,
      user: auth.currentUser.displayName,
      timestamp: serverTimestamp(),
      readBy: [auth.currentUser.uid]
    });
    messageInput.value = '';
  } catch (error) {
    console.error('訊息送出失敗：', error);
  }
};

// Enter 送出訊息
messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
});

// === 在線 / 離線狀態 ===
function setupPresence(user) {
  const userStatusDatabaseRef = ref(rtdb, '/presence/' + user.uid);
  const isOfflineForDatabase = { state: 'offline', last_changed: dbServerTimestamp() };
  const isOnlineForDatabase = { state: 'online', last_changed: dbServerTimestamp(), displayName: user.displayName || '匿名' };

  onDisconnect(userStatusDatabaseRef).set(isOfflineForDatabase).then(() => {
    set(userStatusDatabaseRef, isOnlineForDatabase);
  });
}

function watchPresence() {
  const presenceRef = ref(rtdb, '/presence/');
  onValue(presenceRef, snapshot => {
    const val = snapshot.val() || {};
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3>';
    Object.entries(val).forEach(([uid, info]) => {
      if (info.state === 'online') {
        const div = document.createElement('div');
        div.textContent = info.displayName || '匿名';
        presenceList.appendChild(div);
      }
    });
  });
}

// === 監聽聊天室清單 ===
function watchRoomList() {
  const roomsRef = collection(firestore, 'rooms');
  onSnapshot(roomsRef, snap => {
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    snap.forEach(docSnap => {
      const opt = document.createElement('option');
      opt.value = docSnap.id;
      opt.textContent = docSnap.id;
      roomList.appendChild(opt);
    });
  });
  roomList.onchange = () => { roomInput.value = roomList.value; };
}