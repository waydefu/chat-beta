import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, doc, updateDoc, arrayUnion, deleteDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, onValue, onDisconnect, set as dbSet } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { auth, provider, firestore, rtdb } from './firebase-config.js';

// --- DOM 元素 ---
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
const typingIndicator = document.getElementById('typing-indicator');

// 自定義選單 DOM
const roomSelectWrapper = document.getElementById('room-list-wrapper');
const roomSelectBtn = document.getElementById('room-select-btn');
const roomSelectText = roomSelectBtn.querySelector('.select-text');
const roomListOptions = document.getElementById('room-list-options');
 
// --- 變數 ---
let currentRoom = '';
let unsubscribe = null;
const userNameCache = new Map();
let messageEditState = null;
let typingTimeout;

// --- 工具函數 ---
function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getUserDisplayName(uid) {
  if (userNameCache.has(uid)) return userNameCache.get(uid);
  try {
    const userDoc = await getDoc(doc(firestore, 'users', uid));
    const displayName = userDoc.exists() ? userDoc.data().displayName : '未知使用者';
    userNameCache.set(uid, displayName);
    return displayName;
  } catch (e) {
    return '未知使用者';
  }
}

// --- 訊息 UI ---
async function appendMessage(msg, uid) {
  let time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  try {
    if (msg.timestamp && typeof msg.timestamp.toDate === 'function') {
      time = msg.timestamp.toDate().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (error) {}

  const side = msg.uid === uid ? 'you' : 'other';
  let readByText = '', isReadByMe = false;
  if (msg.readBy && Array.isArray(msg.readBy) && msg.readBy.length > 0) {
    isReadByMe = msg.readBy.includes(uid);
  }

  const row = document.createElement('div');
  row.className = `message-row ${side}`;
  row.dataset.msgId = msg.id;

  const avatarText = document.createElement('div');
  avatarText.className = 'avatar-text';
  avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : '?';

  const bubble = document.createElement('div');
  bubble.className = `message ${side}`;
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <div class="message-meta">
        <span class="message-time">${time}</span>
        <span class="read-status">${isReadByMe && side === 'you' ? '已讀' : ''}</span>
    </div>
    ${msg.uid === uid ? '<div class="message-actions"><button class="edit-btn">編輯</button><button class="delete-btn">刪除</button></div>' : ''}
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

  if (msg.uid === uid) {
    bubble.querySelector('.edit-btn')?.addEventListener('click', () => editMessage(msg.id, msg.text));
    bubble.querySelector('.delete-btn')?.addEventListener('click', () => deleteMessage(msg.id));
  }
}

async function markMessageAsRead(msgId, uid) {
  try {
    await updateDoc(doc(firestore, 'rooms', currentRoom, 'messages', msgId), { readBy: arrayUnion(uid) });
  } catch(e) { console.error(e); }
}

function editMessage(msgId, originalText) {
  messageEditState = { msgId, originalText };
  messageInput.value = originalText;
  messageInput.focus();
  sendBtn.textContent = '更新';
}

async function deleteMessage(msgId) {
  if (confirm('確定刪除？')) await deleteDoc(doc(firestore, 'rooms', currentRoom, 'messages', msgId));
}

// --- 登入/登出 ---
loginBtn.onclick = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    alert(`登入失敗：${e.message}`);
  }
};

logoutBtn.onclick = async () => {
  try { await signOut(auth); } catch (e) { alert('登出失敗'); }
};

onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'inline-block';
    loginBtn.style.display = 'none';
    
    setDoc(doc(firestore, 'users', user.uid), { displayName: user.displayName || '匿名' }, { merge: true });
    
    setupPresence(user);
    watchPresence();
    watchRoomList();
  } else {
    userInfo.textContent = '';
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3><div>無在線</div>';
    chatBox.innerHTML = '';
    roomSelectText.textContent = '選擇聊天室';
    roomListOptions.innerHTML = '<li class="option disabled selected">選擇聊天室</li>';
    typingIndicator.textContent = '';
    if (unsubscribe) unsubscribe();
    userNameCache.clear();
    messageEditState = null;
    currentRoom = '';
  }
});

// --- 房間邏輯 ---
roomSelectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    roomSelectWrapper.classList.toggle('active');
    roomListOptions.style.display = roomListOptions.style.display === 'block' ? 'none' : 'block';
});

document.addEventListener('click', (e) => {
    if (!roomSelectWrapper.contains(e.target)) {
        roomSelectWrapper.classList.remove('active');
        roomListOptions.style.display = 'none';
    }
});

function watchRoomList() {
  onSnapshot(collection(firestore, 'rooms'), snap => {
    roomListOptions.innerHTML = '<li class="option disabled">選擇聊天室</li>';
    snap.forEach(doc => {
      const li = document.createElement('li');
      li.className = 'option';
      li.textContent = doc.id;
      li.onclick = () => {
        roomInput.value = doc.id;
        roomSelectText.textContent = doc.id;
        roomListOptions.style.display = 'none';
        roomSelectWrapper.classList.remove('active');
        joinRoomBtn.click();
      };
      roomListOptions.appendChild(li);
    });
  });
}

joinRoomBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return alert('請輸入聊天室名稱');
  if (currentRoom === room) return;

  try {
    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = '載入中...';
    chatBox.innerHTML = '';
    currentRoom = room;
    roomSelectText.textContent = room;
    if (unsubscribe) unsubscribe();

    await setDoc(doc(firestore, 'rooms', room), { createdAt: serverTimestamp() }, { merge: true });

    const q = query(collection(firestore, 'rooms', currentRoom, 'messages'), orderBy('timestamp'));
    unsubscribe = onSnapshot(q, snap => {
      const uid = auth.currentUser?.uid;
      snap.docChanges().forEach(async change => {
        const msg = { id: change.doc.id, ...change.doc.data() };
        if (change.type === 'added') {
          await appendMessage(msg, uid);
          if (msg.uid !== uid && !msg.readBy?.includes(uid)) await markMessageAsRead(msg.id, uid);
        } else if (change.type === 'modified') {
          const existingRow = chatBox.querySelector(`[data-msg-id="${msg.id}"]`);
          if (existingRow) {
            existingRow.remove();
            await appendMessage(msg, uid);
          }
        } else if (change.type === 'removed') {
          chatBox.querySelector(`[data-msg-id="${msg.id}"]`)?.remove();
        }
      });
    });
    watchTyping();
  } catch (e) {
    alert(`加入失敗：${e.message}`);
  } finally {
    joinRoomBtn.disabled = false;
    joinRoomBtn.textContent = '加入 / 建立';
  }
};

// --- 發送訊息 ---
sendBtn.onclick = async () => {
  try {
    const text = messageInput.value.trim();
    const user = auth.currentUser;
    if (!text || !user || !currentRoom) return;

    if (messageEditState) {
      await updateDoc(doc(firestore, 'rooms', currentRoom, 'messages', messageEditState.msgId), { text, timestamp: serverTimestamp() });
      messageEditState = null;
      sendBtn.textContent = '送出';
    } else {
      await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
        user: user.displayName,
        uid: user.uid,
        text,
        timestamp: serverTimestamp(),
        readBy: [user.uid]
      });
    }
    messageInput.value = '';
    messageInput.style.height = 'auto';
  } catch (e) { alert('操作失敗'); }
};

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
});

// --- 在線/打字提示 ---
function setupPresence(user) {
  const userRef = ref(rtdb, 'presence/' + user.uid);
  onDisconnect(userRef).set({ state: 'offline', displayName: user.displayName || '匿名', last_changed: serverTimestamp() });
  dbSet(userRef, { state: 'online', displayName: user.displayName || '匿名', last_changed: serverTimestamp() });
}

function watchPresence() {
  const allRef = ref(rtdb, 'presence');
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3>';
    const onlineUsers = Object.values(users).filter(u => u?.state === 'online');
    presenceList.innerHTML += onlineUsers.length ? onlineUsers.map(u => `<div class="presence-item">${u.displayName}</div>`).join('') : '<div class="presence-item">無在線</div>';
  });
}

function watchTyping() {
  if (!currentRoom) return;
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, snap => {
    const data = snap.val() || {};
    const othersTyping = Object.values(data).filter(u => u?.name && u.name !== auth.currentUser?.displayName).map(u => u.name);
    typingIndicator.textContent = othersTyping.length ? `${othersTyping.join('、')} 正在輸入...` : '';
  });
}

function debounceTyping() {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;
  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  clearTimeout(typingTimeout);
  dbSet(typingRef, { name: user.displayName });
  typingTimeout = setTimeout(() => { dbSet(typingRef, null); typingTimeout = null; }, 2000);
}

messageInput.addEventListener('input', debounceTyping);
messageInput.addEventListener('input', () => { messageInput.style.height = 'auto'; messageInput.style.height = `${messageInput.scrollHeight}px`; });

// --- PWA Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/chat-beta/firebase-messaging-sw.js')
    .then(reg => console.log('SW Registered'))
    .catch(err => console.log('SW Failed', err));
}
