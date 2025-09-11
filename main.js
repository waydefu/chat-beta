 // main.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, addDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, doc, updateDoc, arrayUnion, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase, ref, onValue, onDisconnect, set as dbSet } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { getMessaging, getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

// 硬編碼 Firebase 配置
const firebaseConfig = {
apiKey: "AIzaSyDOyp-qGQxiiBi9WC_43YFGt94kUZn7goI", // 從 Firebase 控制台獲取
authDomain: "f-chat-wayde-fu.firebaseapp.com",
projectId: "f-chat-wayde-fu",
appId: "1:838739455782:web:e7538f588ae374d204dbe7",
databaseURL: "https://f-chat-wayde-fu-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
console.log('Firebase initialized:', app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const firestore = getFirestore(app);
const rtdb = getDatabase(app);
const messaging = getMessaging(app);

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
let messageEditState = null;

function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getUserDisplayName(uid) {
  if (userNameCache.has(uid)) return userNameCache.get(uid);
  const userDoc = await getDoc(doc(firestore, 'users', uid));
  const displayName = userDoc.exists() ? userDoc.data().displayName : '未知使用者';
  userNameCache.set(uid, displayName);
  return displayName;
}

async function appendMessage(msg, uid) {
  let time = '未知時間';
  if (msg.timestamp?.toDate) time = msg.timestamp.toDate().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

  const side = msg.uid === uid ? 'you' : 'other';
  let readByText = '', isReadByMe = false;
  if (msg.readBy?.length) {
    const readByNames = await Promise.all(msg.readBy.map(getUserDisplayName));
    readByText = `已讀：${readByNames.join('、')}`;
    isReadByMe = msg.readBy.includes(uid);
  }

  const row = document.createElement('div');
  row.className = `message-row ${side}`;
  row.dataset.msgId = msg.id;

  const avatarText = document.createElement('div');
  avatarText.className = 'avatar-text';
  avatarText.textContent = msg.user?.[0].toUpperCase() || '?';

  const bubble = document.createElement('div');
  bubble.className = `message ${side}`;
  bubble.dataset.msgId = msg.id;
  bubble.innerHTML = `
    <span class="message-text">${sanitizeInput(msg.text)}</span>
    <span class="message-time">${time}</span>
    <span class="read-status" title="${readByText}">${isReadByMe ? '✔' : ''}</span>
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
  await updateDoc(doc(firestore, 'rooms', currentRoom, 'messages', msgId), { readBy: arrayUnion(uid) });
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

loginBtn.onclick = async () => {
  try {
    console.log('Attempting Google login...');
    const result = await signInWithPopup(auth, provider);
    console.log('Login successful:', result.user);
    requestNotificationPermission();
  } catch (e) {
    console.error('Login failed:', e.message);
    alert(`登入失敗：${e.message}`);
  }
};

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
  } catch (e) {
    alert('登出失敗');
  }
};

async function requestNotificationPermission() {
  if (Notification.permission === 'granted') await getFCMToken();
  else if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') await getFCMToken();
  }
}

async function getFCMToken() {
  try {
    const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY' });
    if (token) {
      const user = auth.currentUser;
      if (user) await setDoc(doc(firestore, 'users', user.uid), { fcmToken: token }, { merge: true });
    }
  } catch (e) {
    console.error('FCM Token error:', e.message);
  }
}

onMessage(messaging, payload => {
  alert(`新訊息：${payload.notification?.body || '收到通知'}`);
});

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
    requestNotificationPermission();
  } else {
    userInfo.textContent = '';
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    loginBtn.style.display = 'inline-block';
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3><div>無在線</div>';
    chatBox.innerHTML = '';
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    typingIndicator.textContent = '';
    if (unsubscribe) unsubscribe();
    userNameCache.clear();
    messageEditState = null;
  }
});

joinRoomBtn.onclick = async () => {
  try {
    const room = roomInput.value.trim();
    if (!room) return alert('請輸入聊天室名稱');

    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = '載入中...';

    currentRoom = room;
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

function watchRoomList() {
  onSnapshot(collection(firestore, 'rooms'), snap => {
    roomList.innerHTML = '<option disabled selected>選擇聊天室</option>';
    snap.forEach(doc => {
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.id;
      roomList.appendChild(opt);
    });
  });
}

roomList.onchange = () => {
  roomInput.value = roomList.value;
  joinRoomBtn.click();
};

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
  } catch (e) {
    alert('操作失敗');
  }
};

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

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
    presenceList.innerHTML += onlineUsers.length ? onlineUsers.map(u => `<div>${u.displayName}</div>`).join('') : '<div>無在線</div>';
  });
}

function watchTyping() {
  if (!currentRoom) return;
  const typingRef = ref(rtdb, `typing/${currentRoom}`);
  onValue(typingRef, snap => {
    const data = snap.val() || {};
    const othersTyping = Object.values(data).filter(u => u?.name !== auth.currentUser?.displayName).map(u => u.name);
    typingIndicator.textContent = othersTyping.length ? `${othersTyping.join('、')} 正在輸入...` : '';
  });
}

let typingTimeout;
function debounceTyping() {
  const user = auth.currentUser;
  if (!user || !currentRoom) return;

  const typingRef = ref(rtdb, `typing/${currentRoom}/${user.uid}`);
  clearTimeout(typingTimeout);
  if (!typingTimeout) dbSet(typingRef, { name: user.displayName });
  typingTimeout = setTimeout(() => {
    dbSet(typingRef, null);
    typingTimeout = null;
  }, 2000);
}

messageInput.addEventListener('input', debounceTyping);
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});