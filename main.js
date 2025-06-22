import { auth, provider, firestore, rtdb } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp as dbServerTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const chatSection = document.getElementById("chat-section");
const loginCard = document.getElementById("login-card");
const chatBox = document.getElementById("chat-box");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const roomInput = document.getElementById("room-name");
const joinRoomBtn = document.getElementById("join-room");
const presenceList = document.getElementById("presence-list");

let currentRoom = "";
let unsubscribe = null;

// 登入按鈕事件
loginBtn.onclick = () => signInWithPopup(auth, provider);

// 登出按鈕事件
logoutBtn.onclick = () => signOut(auth);

// 監聽登入狀態變化
onAuthStateChanged(auth, user => {
  if (user) {
    userInfo.textContent = `👋 ${user.displayName}`;
    loginCard.style.display = "none";       // 隱藏登入卡片
    chatSection.style.display = "flex";     // 顯示聊天室區塊
    logoutBtn.style.display = "inline-block"; // 顯示登出按鈕
    loginBtn.style.display = "none";        // 隱藏登入按鈕（防止多餘）
    setupPresence(user);
    watchPresence();
  } else {
    userInfo.textContent = "";
    loginCard.style.display = "block";      // 顯示登入卡片
    chatSection.style.display = "none";     // 隱藏聊天室區塊
    logoutBtn.style.display = "none";       // 隱藏登出按鈕
    loginBtn.style.display = "inline-block";// 顯示登入按鈕
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    chatBox.innerHTML = "";
    if (unsubscribe) unsubscribe();
  }
});

// 加入／建立聊天室
joinRoomBtn.onclick = () => {
  const room = roomInput.value.trim();
  if (!room) return alert("請輸入聊天室名稱");

  currentRoom = room;
  if (unsubscribe) unsubscribe();

  const msgsRef = collection(firestore, "rooms", currentRoom, "messages");
  const q = query(msgsRef, orderBy("timestamp"));

  unsubscribe = onSnapshot(q, snap => {
    chatBox.innerHTML = "";
    const uid = auth.currentUser?.uid;

    snap.forEach(doc => {
      const msg = doc.data();
      const time = msg.timestamp?.toDate().toLocaleTimeString() || "";
      const side = msg.uid === uid ? "you" : "other";

      const row = document.createElement("div");
      row.className = `message-row ${side}`;

      const avatarText = document.createElement("div");
      avatarText.className = "avatar-text";
      avatarText.textContent = msg.user ? msg.user[0].toUpperCase() : "?";

      const bubble = document.createElement("div");
      bubble.className = `message ${side}`;
      bubble.innerHTML = `
        <span class="message-text">${msg.text}</span>
        <span class="message-time">${time}</span>
      `;

      if (side === "you") {
        row.appendChild(bubble);
        row.appendChild(avatarText);
      } else {
        row.appendChild(avatarText);
        row.appendChild(bubble);
      }

      chatBox.appendChild(row);
    });

    // 自動滾到底部
    chatBox.scrollTop = chatBox.scrollHeight;
  });
};

// 發送訊息
sendBtn.onclick = async () => {
  const text = messageInput.value.trim();
  const user = auth.currentUser;
  if (!text || !user || !currentRoom) return;

  await addDoc(collection(firestore, "rooms", currentRoom, "messages"), {
    user: user.displayName,
    uid: user.uid,
    text,
    timestamp: serverTimestamp()
  });

  messageInput.value = "";
};

// 在線狀態管理
function setupPresence(user) {
  const userRef = ref(rtdb, "presence/" + user.uid);
  const connRef = ref(rtdb, ".info/connected");

  const onlineObj = {
    state: "online",
    displayName: user.displayName,
    last_changed: dbServerTimestamp()
  };
  const offlineObj = {
    state: "offline",
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
  const allRef = ref(rtdb, "presence");
  onValue(allRef, snap => {
    const users = snap.val() || {};
    presenceList.innerHTML = `<h3>🟢 在線使用者</h3>`;
    for (const uid in users) {
      if (users[uid].state === "online") {
        const div = document.createElement("div");
        div.textContent = users[uid].displayName || uid;
        presenceList.appendChild(div);
      }
    }
  });
}這是main.js
