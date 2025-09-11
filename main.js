import { auth, provider, firestore, rtdb, messaging } from './firebase-config.js';
import { signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, set, onValue, remove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginCard = document.getElementById('login-card');
const chatSection = document.getElementById('chat-section');
const userInfo = document.getElementById('user-info');

let currentUser = null;

// --- 登入 / 登出 ---
loginBtn.addEventListener('click', async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    userInfo.textContent = `已登入：${currentUser.displayName}`;
    loginCard.style.display = 'none';
    chatSection.style.display = 'block';
    logoutBtn.style.display = 'block';
  } catch (error) {
    console.error('登入失敗：', error);
  }
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  currentUser = null;
  loginCard.style.display = 'block';
  chatSection.style.display = 'none';
  logoutBtn.style.display = 'none';
});

// --- 聊天室管理 ---
const roomList = document.getElementById('room-list');
const roomNameInput = document.getElementById('room-name');
const joinRoomBtn = document.getElementById('join-room');
let currentRoom = null;

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
const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  if (!currentRoom || !messageInput.value.trim()) return;
  await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
    uid: currentUser.uid,
    name: currentUser.displayName,
    text: messageInput.value.trim(),
    timestamp: serverTimestamp()
  });
  messageInput.value = '';
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
      chatBox.scrollTop = chatBox.scrollHeight;
    });
  });
}

// --- 在線狀態 ---
const presenceList = document.getElementById('presence-list');

function setupPresence(room) {
  const userRef = ref(rtdb, `presence/${room}/${currentUser.uid}`);
  set(userRef, currentUser.displayName);
  window.addEventListener('beforeunload', () => remove(userRef));

  const roomRef = ref(rtdb, `presence/${room}`);
  onValue(roomRef, snapshot => {
    const users = snapshot.val() || {};
    presenceList.innerHTML = '<h3>🟢 在線使用者</h3>';
    Object.values(users).forEach(u => {
      const div = document.createElement('div');
      div.textContent = u;
      presenceList.appendChild(div);
    });
    if (!Object.values(users).length) {
      presenceList.innerHTML += '<div>無在線使用者</div>';
    }
  });
}