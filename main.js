// main.js
import { auth, provider, firestore, rtdb } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, set, onValue, remove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// --- DOM 元素 ---
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginCard = document.getElementById('login-card');
const chatSection = document.getElementById('chat-section');
const userInfo = document.getElementById('user-info');

const roomList = document.getElementById('room-list');
const roomNameInput = document.getElementById('room-name');
const joinRoomBtn = document.getElementById('join-room');

const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const presenceList = document.getElementById('presence-list');

let currentUser = null;
let currentRoom = null;

// --- 登入 / 登出 ---
loginBtn.addEventListener('click', async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    setupUI();
  } catch (error) {
    console.error('登入失敗：', error);
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  currentUser = null;
  currentRoom = null;
  loginCard.style.display = 'block';
  chatSection.style.display = 'none';
  logoutBtn.style.display = 'none';
  userInfo.textContent = '';
  chatBox.innerHTML = '';
  presenceList.innerHTML = '<h3>🟢 在線使用者</h3><div>無在線使用者</div>';
});

// 確保刷新後仍維持登入狀態
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    setupUI();
  }
});

function setupUI() {
  loginCard.style.display = 'none';
  chatSection.style.display = 'block';
  logoutBtn.style.display = 'block';
  userInfo.textContent = `已登入：${currentUser.displayName}`;
}

// --- 聊天室管理 ---
joinRoomBtn.addEventListener('click', () => {
  const roomName = roomNameInput.value.trim();
  if (!roomName) return alert('請輸入聊天室名稱');
  joinRoom(roomName);
});

function joinRoom(name) {
  currentRoom = name;
  chatBox.innerHTML = '';
  listenMessages(name);
  setupPresence(name);
}

// --- 訊息 ---
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  if (!currentRoom || !messageInput.value.trim()) return;
  try {
    await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
      uid: currentUser.uid,
      name: currentUser.displayName,
      text: messageInput.value.trim(),
      timestamp: serverTimestamp()
    });
    messageInput.value = '';
  } catch (error) {
    console.error('發送訊息失敗：', error);
  }
}

// --- 監聽訊息 ---
function listenMessages(room) {
  const q = query(collection(firestore, 'rooms', room, 'messages'), orderBy('timestamp'));
  onSnapshot(q, snapshot => {
    chatBox.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      const div = document.createElement('div');
      div.className = `message-row ${data.uid === currentUser.uid ? 'you' : 'other'}`;
      div.innerHTML = `
        <div class="avatar-text">${(data.name || '?')[0]}</div>
        <div class="message ${data.uid === currentUser.uid ? 'you' : 'other'}">
          <span class="message-text">${data.text}</span>
        </div>`;
      chatBox.appendChild(div);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}

// --- 在線狀態 ---
function setupPresence(room) {
  const userRef = ref(rtdb, `presence/${room}/${currentUser.uid}`);
  set(userRef, currentUser.displayName);
  window.addEventListener('beforeunload', () => remove(userRef));

  const roomRef = ref(rtdb, `presence/${room}`);
  onValue(roomRef, snapshot => {
    const users = snapshot.val() || {};
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3>';
    const userArray = Object.values(users);
    if (userArray.length === 0) {
      presenceList.innerHTML += '<div>無在線使用者</div>';
    } else {
      userArray.forEach(u => {
        const div = document.createElement('div');
        div.textContent = u;
        presenceList.appendChild(div);
      });
    }
  });
}