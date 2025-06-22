// ========================
// 模組導入
// ========================
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
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { 
  ref, 
  onValue, 
  set,
  onDisconnect 
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ========================
// DOM 元素
// ========================
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const chatSection = document.getElementById('chat-section');
const loginCard = document.getElementById('login-card');
const chatBox = document.getElementById('chat-box');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const roomInput = document.getElementById('room-name');
const joinRoomBtn = document.getElementById('join-room');

// ========================
// 全域變數
// ========================
let currentRoom = ''; // 當前聊天室名稱
let unsubscribeMessages = null; // 取消監聽訊息的函數

// ========================
// 工具函數
// ========================

/**
 * 過濾危險字元防止 XSS 攻擊
 * @param {string} text - 原始輸入
 * @returns {string} 安全字串
 */
function sanitizeInput(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 格式化時間戳 (相對時間 + 完整時間)
 * @param {Date} date - 訊息時間
 * @returns {object} { displayTime: 顯示時間, fullTime: 完整時間 }
 */
function formatTimestamp(date) {
  const now = new Date();
  const diffMinutes = Math.round((now - date) / (1000 * 60));

  // 今天內的訊息
  if (diffMinutes < 60) {
    return {
      displayTime: diffMinutes < 1 ? '剛剛' : `${diffMinutes}分鐘前`,
      fullTime: date.toLocaleString('zh-TW', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Asia/Taipei'
      })
    };
  }

  // 完整時間格式
  return {
    displayTime: date.toLocaleTimeString('zh-TW', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'Asia/Taipei'
    }),
    fullTime: date.toLocaleString('zh-TW')
  };
}

/**
 * 渲染單條訊息到聊天室
 * @param {object} msg - 訊息內容
 * @param {string} currentUserId - 當前使用者ID
 */
async function appendMessage(msg, currentUserId) {
  const isCurrentUser = msg.uid === currentUserId;
  const { displayTime, fullTime } = formatTimestamp(msg.timestamp.toDate());

  const messageElement = document.createElement('div');
  messageElement.className = `message-row ${isCurrentUser ? 'you' : 'other'}`;
  messageElement.innerHTML = `
    <div class="message ${isCurrentUser ? 'you' : 'other'}">
      <span class="message-text">${sanitizeInput(msg.text)}</span>
      <span class="message-time" data-full-time="${fullTime}">
        ${displayTime}
      </span>
    </div>
  `;

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ========================
// 身份驗證邏輯
// ========================

// Google 登入
loginBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error('登入失敗:', error);
    alert('登入失敗，請重試');
  }
});

// 登出
logoutBtn.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('登出失敗:', error);
  }
});

// 監聽登入狀態變化
onAuthStateChanged(auth, (user) => {
  if (user) {
    // 登入成功：顯示聊天室
    loginCard.style.display = 'none';
    chatSection.style.display = 'flex';
    logoutBtn.style.display = 'block';
    
    // 儲存使用者資訊到 Firestore
    setDoc(doc(firestore, 'users', user.uid), {
      name: user.displayName || '匿名使用者',
      lastLogin: serverTimestamp()
    }, { merge: true });
  } else {
    // 登出狀態：顯示登入畫面
    loginCard.style.display = 'block';
    chatSection.style.display = 'none';
    logoutBtn.style.display = 'none';
    if (unsubscribeMessages) unsubscribeMessages();
  }
});

// ========================
// 聊天室功能
// ========================

// 加入或建立聊天室
joinRoomBtn.addEventListener('click', async () => {
  const roomName = roomInput.value.trim();
  if (!roomName) return alert('請輸入聊天室名稱');

  try {
    currentRoom = roomName;
    
    // 監聽該聊天室的訊息
    unsubscribeMessages = onSnapshot(
      collection(firestore, 'rooms', roomName, 'messages'),
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            appendMessage(change.doc.data(), auth.currentUser?.uid);
          }
        });
      }
    );
  } catch (error) {
    console.error('加入聊天室失敗:', error);
  }
});

// 發送訊息
sendBtn.addEventListener('click', async () => {
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;

  try {
    await addDoc(collection(firestore, 'rooms', currentRoom, 'messages'), {
      text,
      uid: auth.currentUser.uid,
      user: auth.currentUser.displayName,
      timestamp: serverTimestamp()
    });
    messageInput.value = '';
  } catch (error) {
    console.error('發送失敗:', error);
  }
});

// 按 Enter 發送
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});